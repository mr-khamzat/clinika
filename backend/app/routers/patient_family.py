"""
Глава 8 — Семейный кабинет пациента.

Все эндпоинты требуют patient_session_token (Authorization: Bearer или
X-Patient-Session или ?session_token=...).
"""
import uuid
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.family import FamilyGroup, FamilyMember, FamilyInvite
from app.models.patient_account import PatientAccount
from app.models.patient_session import PatientSession
from app.models.doctor import Appointment, AppointmentStatus
from app.services import family_service as fs
from app.services.patient_session_service import restore_session, create_session
from app.core.security import make_patient_session_token
from app.utils.phone import normalize_phone


router = APIRouter(prefix="/patient/family", tags=["patient-family"])


# ── Auth helper ────────────────────────────────────────────────────────────
async def _get_session(
    db: AsyncSession,
    request: Request,
    authorization: Optional[str] = None,
    x_patient_session: Optional[str] = None,
    session_token: Optional[str] = None,
) -> PatientSession:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
    token = token or x_patient_session or session_token
    if not token:
        # Попытка из cookie
        token = request.cookies.get("clinika_patient_session")
    if not token:
        raise HTTPException(401, "Patient session required")
    sess = await restore_session(db, token)
    if not sess:
        raise HTTPException(401, "Session invalid or expired")
    return sess


async def _current_account(db: AsyncSession, sess: PatientSession) -> PatientAccount:
    acc = await fs.get_account_by_phone(db, sess.phone)
    if not acc:
        # Auto-create skeleton
        acc, _ = await fs.get_or_create_account_by_phone(db, sess.phone)
        await db.commit()
    return acc


# ── Schemas ────────────────────────────────────────────────────────────────
class CreateGroupIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)


class InviteIn(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=200)
    phone: str = Field(min_length=5, max_length=30)
    relation: str = Field(default="other")
    birth_date: Optional[date] = None


class AcceptInviteIn(BaseModel):
    token: str = Field(min_length=8, max_length=128)


class PatchMemberIn(BaseModel):
    relation: Optional[str] = None
    can_view_records: Optional[bool] = None
    can_book_appointments: Optional[bool] = None
    can_manage_payments: Optional[bool] = None


# ── Endpoints ─────────────────────────────────────────────────────────────
@router.get("")
async def get_family(
    request: Request,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
):
    """Вернуть мою семейную группу + список членов. Если группы нет — null."""
    sess = await _get_session(db, request, authorization, x_patient_session, session_token)
    acc = await _current_account(db, sess)

    # Я владелец группы?
    r = await db.execute(
        select(FamilyGroup).where(FamilyGroup.owner_patient_id == acc.id)
    )
    grp = r.scalar_one_or_none()

    # Если нет — я могу быть членом чужой группы
    membership_in = None
    if not grp:
        r2 = await db.execute(
            select(FamilyMember, FamilyGroup)
            .join(FamilyGroup, FamilyMember.group_id == FamilyGroup.id)
            .where(FamilyMember.patient_id == acc.id)
            .limit(1)
        )
        row = r2.first()
        if row:
            membership_in = row[0]
            grp = row[1]

    if not grp:
        return {"group": None, "members": [], "is_owner": False}

    members = await fs.list_members(db, grp.id)
    return {
        "group": {
            "id": str(grp.id),
            "name": grp.name,
            "owner_patient_id": str(grp.owner_patient_id),
            "created_at": grp.created_at.isoformat(),
        },
        "members": members,
        "is_owner": grp.owner_patient_id == acc.id,
        "my_patient_id": str(acc.id),
    }


@router.post("", status_code=201)
async def create_or_get_group(
    request: Request,
    body: CreateGroupIn,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
):
    """Создать (или получить) мою группу как владельца."""
    sess = await _get_session(db, request, authorization, x_patient_session, session_token)
    acc = await _current_account(db, sess)
    grp = await fs.get_or_create_group(db, acc, sess.tenant_id, body.name)
    await db.commit()
    return {
        "group": {
            "id": str(grp.id),
            "name": grp.name,
            "owner_patient_id": str(grp.owner_patient_id),
            "created_at": grp.created_at.isoformat(),
        },
        "members": await fs.list_members(db, grp.id),
        "is_owner": True,
    }


@router.post("/invite", status_code=201)
async def invite_member(
    request: Request,
    body: InviteIn,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
):
    """
    Пригласить родственника по телефону.
      • Если такого PatientAccount ещё нет — создать новый skeleton + сразу
        добавить в группу как члена.
      • Если телефон уже зарегистрирован — создать pending FamilyInvite
        (нужен accept-invite).
    """
    sess = await _get_session(db, request, authorization, x_patient_session, session_token)
    acc = await _current_account(db, sess)

    if body.relation not in fs.VALID_RELATIONS:
        raise HTTPException(422, f"relation must be one of {sorted(fs.VALID_RELATIONS)}")

    grp = await fs.get_or_create_group(db, acc, sess.tenant_id, None)

    phone_n = normalize_phone(body.phone)
    if phone_n == normalize_phone(acc.phone):
        raise HTTPException(422, "Нельзя пригласить себя")

    existing = await fs.get_account_by_phone(db, body.phone)

    if existing is None:
        # Создаём skeleton и добавляем сразу
        new_pa, _ = await fs.get_or_create_account_by_phone(
            db, body.phone, name=body.full_name, birth_date=body.birth_date,
        )
        mem = FamilyMember(
            id=uuid.uuid4(),
            group_id=grp.id,
            patient_id=new_pa.id,
            relation=body.relation,
            can_view_records=True,
            can_book_appointments=True,
            can_manage_payments=False,
        )
        db.add(mem)
        await db.commit()
        return {
            "status": "added",
            "member_id": str(mem.id),
            "patient_id": str(new_pa.id),
            "message": "Член семьи создан и добавлен в группу",
        }

    # Пациент уже есть — invite
    # Если он уже в группе — ничего не делать
    already = await fs.is_member_of(db, grp.id, existing.id)
    if already:
        return {
            "status": "already_member",
            "member_id": str(already.id),
            "patient_id": str(existing.id),
        }

    inv = await fs.create_invite(
        db, grp.id, acc.id, body.phone, body.full_name, body.relation,
    )
    await db.commit()
    return {
        "status": "invite_pending",
        "invite_id": str(inv.id),
        "token": inv.token,
        "expires_at": inv.expires_at.isoformat(),
        "message": "Такой пациент уже есть — отправлено приглашение",
    }


@router.post("/accept-invite")
async def accept_invite(
    request: Request,
    body: AcceptInviteIn,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
):
    """Принять приглашение в группу."""
    sess = await _get_session(db, request, authorization, x_patient_session, session_token)
    acc = await _current_account(db, sess)

    inv = await fs.find_invite_by_token(db, body.token)
    if not inv:
        raise HTTPException(404, "Invite not found")
    try:
        mem = await fs.accept_invite(db, inv, acc)
    except ValueError as e:
        raise HTTPException(409, str(e))

    await db.commit()
    return {
        "status": "joined",
        "group_id": str(inv.group_id),
        "member_id": str(mem.id),
    }


@router.patch("/members/{member_id}")
async def patch_member(
    member_id: uuid.UUID,
    request: Request,
    body: PatchMemberIn,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
):
    """Изменить права/relation члена группы. Только владелец группы."""
    sess = await _get_session(db, request, authorization, x_patient_session, session_token)
    acc = await _current_account(db, sess)

    r = await db.execute(
        select(FamilyGroup).where(FamilyGroup.owner_patient_id == acc.id)
    )
    grp = r.scalar_one_or_none()
    if not grp:
        raise HTTPException(403, "Только владелец может менять права")

    mem = await fs.find_membership(db, grp.id, member_id)
    if not mem:
        raise HTTPException(404, "Member not found")

    if body.relation is not None:
        if body.relation not in fs.VALID_RELATIONS:
            raise HTTPException(422, "Invalid relation")
        if mem.patient_id == acc.id:
            raise HTTPException(422, "Нельзя менять отношение self")
        mem.relation = body.relation
    if body.can_view_records is not None:
        mem.can_view_records = body.can_view_records
    if body.can_book_appointments is not None:
        mem.can_book_appointments = body.can_book_appointments
    if body.can_manage_payments is not None:
        mem.can_manage_payments = body.can_manage_payments

    await db.commit()
    return {"status": "updated", "member_id": str(mem.id)}


@router.delete("/members/{member_id}")
async def delete_member(
    member_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
):
    """Удалить члена группы. Нельзя удалить self."""
    sess = await _get_session(db, request, authorization, x_patient_session, session_token)
    acc = await _current_account(db, sess)

    r = await db.execute(
        select(FamilyGroup).where(FamilyGroup.owner_patient_id == acc.id)
    )
    grp = r.scalar_one_or_none()
    if not grp:
        raise HTTPException(403, "Только владелец может удалять")

    mem = await fs.find_membership(db, grp.id, member_id)
    if not mem:
        raise HTTPException(404, "Member not found")

    if mem.patient_id == acc.id:
        raise HTTPException(422, "Нельзя удалить self")

    await db.delete(mem)
    await db.commit()
    return {"status": "deleted"}


@router.get("/switch-context/{patient_id}")
async def switch_context(
    patient_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
):
    """
    Переключиться на другого пациента из моей группы.
    Возвращает новый patient_session_token + основные данные.
    """
    sess = await _get_session(db, request, authorization, x_patient_session, session_token)
    acc = await _current_account(db, sess)

    # Найдём мою группу (как владелец или как член)
    r = await db.execute(
        select(FamilyGroup).where(FamilyGroup.owner_patient_id == acc.id)
    )
    grp = r.scalar_one_or_none()
    if not grp:
        r2 = await db.execute(
            select(FamilyMember, FamilyGroup)
            .join(FamilyGroup, FamilyMember.group_id == FamilyGroup.id)
            .where(FamilyMember.patient_id == acc.id)
            .limit(1)
        )
        row = r2.first()
        grp = row[1] if row else None
    if not grp:
        raise HTTPException(404, "No family group")

    # Target должен быть членом этой же группы
    target_mem = await fs.is_member_of(db, grp.id, patient_id)
    if not target_mem:
        raise HTTPException(403, "Этот пациент не в вашей семье")

    target_pa = await db.get(PatientAccount, patient_id)
    if not target_pa:
        raise HTTPException(404, "Patient not found")

    # Создаём новую сессию на телефон target и возвращаем токен
    new_sess, token = await create_session(
        db, target_pa.phone, sess.tenant_id, device_info="family_switch",
    )
    await db.commit()
    return {
        "session_token": token,
        "patient_id": str(target_pa.id),
        "patient_phone": target_pa.phone,
        "patient_name": target_pa.name,
        "relation": target_mem.relation,
        "can_view_records": target_mem.can_view_records,
        "can_book_appointments": target_mem.can_book_appointments,
        "can_manage_payments": target_mem.can_manage_payments,
    }


@router.get("/aggregated-cabinet")
async def aggregated_cabinet(
    request: Request,
    patient_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
):
    """
    Данные пациента из моей группы (приёмы, направления),
    с проверкой can_view_records.
    """
    sess = await _get_session(db, request, authorization, x_patient_session, session_token)
    acc = await _current_account(db, sess)

    # Найти группу + проверить право
    r = await db.execute(
        select(FamilyGroup).where(FamilyGroup.owner_patient_id == acc.id)
    )
    grp = r.scalar_one_or_none()
    if not grp:
        r2 = await db.execute(
            select(FamilyMember, FamilyGroup)
            .join(FamilyGroup, FamilyMember.group_id == FamilyGroup.id)
            .where(FamilyMember.patient_id == acc.id)
            .limit(1)
        )
        row = r2.first()
        grp = row[1] if row else None
    if not grp:
        raise HTTPException(404, "No family group")

    target_mem = await fs.is_member_of(db, grp.id, patient_id)
    if not target_mem:
        raise HTTPException(403, "Этот пациент не в вашей семье")
    if not target_mem.can_view_records:
        raise HTTPException(403, "Нет прав на просмотр записей")

    target_pa = await db.get(PatientAccount, patient_id)
    if not target_pa:
        raise HTTPException(404, "Patient not found")

    # Приёмы
    appts_r = await db.execute(
        select(Appointment).where(
            Appointment.patient_phone == normalize_phone(target_pa.phone)
        ).order_by(Appointment.appointment_date.desc()).limit(50)
    )
    appts = appts_r.scalars().all()

    return {
        "patient": {
            "id": str(target_pa.id),
            "phone": target_pa.phone,
            "name": target_pa.name,
            "birth_date": target_pa.birth_date.isoformat() if target_pa.birth_date else None,
        },
        "relation": target_mem.relation,
        "permissions": {
            "view_records": target_mem.can_view_records,
            "book_appointments": target_mem.can_book_appointments,
            "manage_payments": target_mem.can_manage_payments,
        },
        "appointments": [
            {
                "id": str(a.id),
                "date": a.appointment_date.isoformat(),
                "start_time": a.start_time.strftime("%H:%M") if a.start_time else None,
                "status": str(a.status).split(".")[-1].lower() if a.status else None,
                "clinic_id": str(a.clinic_id) if a.clinic_id else None,
                "doctor_id": str(a.doctor_id) if a.doctor_id else None,
                "price": float(a.price) if a.price is not None else None,
                "notes": a.notes,
            }
            for a in appts
        ],
    }
