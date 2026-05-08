"""
Роутер рекрутера — прямая регистрация врачей и управление бонусами.

POST /recruiter/register_doctor  — зарегистрировать врача напрямую (с QR)
GET  /recruiter/doctors          — список привлечённых врачей
GET  /recruiter/bonuses          — бонусы рекрутера
GET  /recruiter/stats            — сводная статистика
GET  /recruiter/invites          — список зарегистрированных врачей (устар.)
"""
import uuid
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.user import User, UserRole
from app.models.doctor_clinic_access import DoctorClinicAccess
from app.models.recruiter_bonus import RecruiterBonus, RecruiterBonusStatus
from app.models.clinic import Clinic
from app.core.security import hash_password
from app.services.qr_service import generate_url_qr_base64
from app.models.tenant import Tenant
from app.models.doctor import Doctor

router = APIRouter(prefix="/recruiter", tags=["recruiter"])

_recruiter = Depends(require_role("recruiter"))


# ── Схемы ─────────────────────────────────────────────────────────────────────

class RegisterDoctorRequest(BaseModel):
    full_name: str
    email: Optional[str] = None
    phone_number: Optional[str] = None
    address: Optional[str] = None          # место работы врача
    specialization: Optional[str] = None  # профессия/специализация
    username: str                          # логин (выдаётся врачу)
    password: str                          # пароль (выдаётся врачу)
    clinic_ids: list[str] = []


class InviteRequest(BaseModel):
    email: str
    full_name: str
    phone_number: Optional[str] = None
    clinic_ids: list[str]


class AcceptInviteRequest(BaseModel):
    password: str
    full_name: Optional[str] = None


# ── Статистика ────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_recruiter_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = _recruiter,
):
    doctors_count = await db.scalar(
        select(func.count(User.id)).where(User.recruiter_id == current_user.id, User.is_active == True)
    ) or 0

    total_bonuses = await db.scalar(
        select(func.coalesce(func.sum(RecruiterBonus.amount), 0))
        .where(RecruiterBonus.recruiter_id == current_user.id)
    ) or 0

    pending_bonuses = await db.scalar(
        select(func.coalesce(func.sum(RecruiterBonus.amount), 0))
        .where(
            RecruiterBonus.recruiter_id == current_user.id,
            RecruiterBonus.status == RecruiterBonusStatus.PENDING,
        )
    ) or 0

    return {
        "doctors_count": doctors_count,
        "total_bonuses": float(total_bonuses),
        "pending_bonuses": float(pending_bonuses),
        "paid_bonuses": float(total_bonuses) - float(pending_bonuses),
        "my_percent": float(current_user.bonus_percent or 0),
    }


# ── Список врачей ─────────────────────────────────────────────────────────────

@router.get("/doctors")
async def get_my_doctors(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = _recruiter,
):
    result = await db.execute(
        select(User).where(User.recruiter_id == current_user.id).order_by(User.created_at.desc())
    )
    doctors = result.scalars().all()
    if not doctors:
        return []

    doc_ids = [d.id for d in doctors]

    # Один batch-запрос на все клиники всех докторов (вместо N запросов в цикле).
    clinics_rows = (await db.execute(
        select(DoctorClinicAccess.doctor_id, Clinic.id, Clinic.name)
        .join(Clinic, DoctorClinicAccess.clinic_id == Clinic.id)
        .where(DoctorClinicAccess.doctor_id.in_(doc_ids))
    )).all()
    clinics_by_doc: dict = {}
    for did, cid, cname in clinics_rows:
        clinics_by_doc.setdefault(did, []).append({"id": str(cid), "name": cname})

    # Один batch-запрос на сумму бонусов по каждому доктору с GROUP BY.
    bonus_rows = (await db.execute(
        select(
            RecruiterBonus.doctor_id,
            func.coalesce(func.sum(RecruiterBonus.amount), 0),
        )
        .where(
            RecruiterBonus.recruiter_id == current_user.id,
            RecruiterBonus.doctor_id.in_(doc_ids),
        )
        .group_by(RecruiterBonus.doctor_id)
    )).all()
    bonus_by_doc: dict = {did: float(amt or 0) for did, amt in bonus_rows}

    out = []
    for doc in doctors:
        out.append({
            "id": str(doc.id),
            "full_name": doc.full_name,
            "phone_number": doc.phone_number,
            "email": doc.email,
            "username": doc.username,
            "specialization": getattr(doc, 'specialization', None),
            "address": getattr(doc, 'address', None),
            "is_active": doc.is_active,
            "created_at": doc.created_at.isoformat(),
            "clinics": clinics_by_doc.get(doc.id, []),
            "bonuses_earned": bonus_by_doc.get(doc.id, 0.0),
        })

    return out


# ── Бонусы ────────────────────────────────────────────────────────────────────

@router.get("/bonuses")
async def get_recruiter_bonuses(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = _recruiter,
    limit: int = Query(50, le=200),
    offset: int = Query(0),
):
    result = await db.execute(
        select(RecruiterBonus)
        .where(RecruiterBonus.recruiter_id == current_user.id)
        .order_by(RecruiterBonus.created_at.desc())
        .limit(limit).offset(offset)
    )
    bonuses = result.scalars().all()

    out = []
    for b in bonuses:
        doc = await db.get(User, b.doctor_id)
        out.append({
            "id": str(b.id),
            "doctor_name": doc.full_name if doc else "—",
            "doctor_id": str(b.doctor_id),
            "referral_id": str(b.referral_id),
            "percent_applied": float(b.percent_applied),
            "amount": float(b.amount),
            "status": b.status.value,
            "created_at": b.created_at.isoformat(),
        })

    return out


# ── Прямая регистрация врача (новый флоу) ─────────────────────────────────────

@router.post("/register_doctor")
async def register_doctor_direct(
    body: RegisterDoctorRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = _recruiter,
):
    """
    Рекрутер регистрирует врача напрямую. Логин/пароль выдаются врачу на руки.
    Возвращает данные врача и QR-код со ссылкой на вход.
    Менеджер франшизы видит всех врачей, зарегистрированных рекрутерами.
    """
    # Проверяем уникальность логина
    existing_username = await db.execute(select(User).where(User.username == body.username))
    if existing_username.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")

    if body.email:
        existing_email = await db.execute(select(User).where(User.email == body.email))
        if existing_email.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Пользователь с таким email уже существует")

    # Проверяем клиники
    for cid_str in body.clinic_ids:
        try:
            cid = uuid.UUID(cid_str)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Неверный UUID клиники: {cid_str}")
        clinic = await db.get(Clinic, cid)
        if not clinic:
            raise HTTPException(status_code=404, detail=f"Клиника {cid_str} не найдена")

    # Создаём врача
    doctor = User(
        full_name=body.full_name,
        email=body.email,
        username=body.username,
        password_hash=hash_password(body.password),
        phone_number=body.phone_number,
        role=UserRole.DOCTOR,
        tenant_id=current_user.tenant_id,
        recruiter_id=current_user.id,
        is_active=True,
    )
    # Дополнительные поля если есть в модели
    if hasattr(doctor, 'address'):
        doctor.address = body.address
    if hasattr(doctor, 'specialization'):
        doctor.specialization = body.specialization

    db.add(doctor)
    await db.flush()

    # Доступы к клиникам
    for cid_str in body.clinic_ids:
        try:
            cid = uuid.UUID(cid_str)
            access = DoctorClinicAccess(
                doctor_id=doctor.id,
                clinic_id=cid,
                granted_by=current_user.id,
            )
            db.add(access)
        except Exception:
            pass

    # Создаём запись в таблице doctors (нужна для DoctorLayout)
    if body.clinic_ids:
        try:
            first_clinic_id = uuid.UUID(body.clinic_ids[0])
            doctor_record = Doctor(
                full_name=body.full_name,
                tenant_id=current_user.tenant_id,
                clinic_id=first_clinic_id,
                specialty=body.specialization,
                is_active=True,
                user_id=doctor.id,
            )
            db.add(doctor_record)
            await db.commit()
        except Exception as e:
            await db.rollback()
            pass
    else:
        # Берём первую клинику тенанта
        first_clinic_res = await db.execute(
            select(Clinic).where(Clinic.tenant_id == current_user.tenant_id, Clinic.is_active == True).limit(1)
        )
        first_clinic = first_clinic_res.scalar_one_or_none()
        if first_clinic:
            try:
                doctor_record = Doctor(
                    full_name=body.full_name,
                    tenant_id=current_user.tenant_id,
                    clinic_id=first_clinic.id,
                    specialty=body.specialization,
                    is_active=True,
                    user_id=doctor.id,
                )
                db.add(doctor_record)
                await db.commit()
            except Exception:
                await db.rollback()
                pass

    await db.refresh(doctor)

    # Генерируем QR — ссылка на вход в кабинет (тенантный slug)
    tenant = await db.get(Tenant, doctor.tenant_id) if doctor.tenant_id else None
    slug = tenant.slug if tenant else ''
    if slug:
        login_url = f"https://клиниксеть.рф/{slug}/admin"
    else:
        login_url = "https://клиниксеть.рф/admin"

    qr_base64 = generate_url_qr_base64(login_url)

    return {
        "success": True,
        "doctor": {
            "id": str(doctor.id),
            "full_name": doctor.full_name,
            "email": doctor.email,
            "username": doctor.username,
            "phone_number": doctor.phone_number,
            "address": body.address,
            "specialization": body.specialization,
            "is_active": doctor.is_active,
            "created_at": doctor.created_at.isoformat(),
        },
        "credentials": {
            "username": body.username,
            "password": body.password,
            "login_url": login_url,
        },
        "qr_code": qr_base64,
        "message": f"Врач {body.full_name} успешно зарегистрирован",
    }


# ── Изменение пароля врача (только менеджер/франшиза) ─────────────────────────
# Этот endpoint НЕ доступен врачу — только через панель менеджера (admin.py)

@router.get("/invites")
async def get_sent_invites(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = _recruiter,
):
    """Устаревший эндпоинт — теперь используется register_doctor."""
    result = await db.execute(
        select(User)
        .where(User.recruiter_id == current_user.id)
        .order_by(User.created_at.desc())
        .limit(50)
    )
    doctors = result.scalars().all()
    return [
        {
            "id": str(d.id),
            "email": d.email or "",
            "code": str(d.id),
            "is_used": True,
            "created_at": d.created_at.isoformat(),
            "clinic_access": [],
        }
        for d in doctors
    ]


@router.post("/invite")
async def create_doctor_invite(
    body: InviteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = _recruiter,
):
    """Устаревший endpoint для обратной совместимости."""
    from app.models.invitation import Invitation
    token = secrets.token_urlsafe(32)
    invite = Invitation(
        code=token,
        email=body.email,
        role="doctor",
        invited_by_id=current_user.id,
        recruiter_id=current_user.id,
        clinic_access=body.clinic_ids,
        expires_at=datetime.utcnow() + timedelta(days=7),
        max_uses=1,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return {
        "id": str(invite.id),
        "token": token,
        "invite_link": f"/invite/{token}",
        "email": body.email,
        "expires_at": invite.expires_at.isoformat(),
    }


# ── Публичные эндпоинты — принятие приглашения (устаревшие) ──────────────────

@router.get("/accept/{token}", tags=["invite"])
async def check_invite(token: str, db: AsyncSession = Depends(get_db)):
    from app.models.invitation import Invitation
    result = await db.execute(select(Invitation).where(Invitation.code == token))
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Приглашение не найдено")
    if invite.is_used:
        raise HTTPException(status_code=410, detail="Приглашение уже использовано")
    if invite.expires_at and invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Приглашение истекло")
    recruiter = await db.get(User, invite.recruiter_id) if invite.recruiter_id else None
    return {
        "valid": True,
        "email": invite.email,
        "role": invite.role,
        "recruiter_name": recruiter.full_name if recruiter else None,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
    }


@router.post("/accept/{token}", tags=["invite"])
async def accept_invite(
    token: str,
    body: AcceptInviteRequest,
    db: AsyncSession = Depends(get_db),
):
    from app.models.invitation import Invitation
    result = await db.execute(select(Invitation).where(Invitation.code == token))
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Приглашение не найдено")
    if invite.is_used:
        raise HTTPException(status_code=410, detail="Приглашение уже использовано")
    if invite.expires_at and invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Приглашение истекло")

    existing = await db.execute(select(User).where(User.email == invite.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Пользователь с таким email уже существует")

    recruiter = await db.get(User, invite.recruiter_id) if invite.recruiter_id else None
    tenant_id = recruiter.tenant_id if recruiter else None

    doctor = User(
        full_name=body.full_name or invite.email.split("@")[0],
        email=invite.email,
        username=invite.email,
        password_hash=hash_password(body.password),
        role=UserRole.DOCTOR,
        tenant_id=tenant_id,
        recruiter_id=invite.recruiter_id,
        is_active=True,
    )
    db.add(doctor)
    await db.flush()

    for cid_str in (invite.clinic_access or []):
        try:
            cid = uuid.UUID(cid_str)
            access = DoctorClinicAccess(
                doctor_id=doctor.id,
                clinic_id=cid,
                granted_by=invite.recruiter_id,
            )
            db.add(access)
        except Exception:
            pass

    invite.is_used = True
    invite.uses_count += 1
    await db.commit()
    await db.refresh(doctor)

    return {
        "success": True,
        "user_id": str(doctor.id),
        "email": doctor.email,
        "full_name": doctor.full_name,
        "role": doctor.role.value,
    }
