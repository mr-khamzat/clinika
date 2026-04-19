"""
Роутер рекрутера — управление привлечёнными врачами и бонусами.

GET  /recruiter/doctors        — список привлечённых врачей
GET  /recruiter/bonuses        — бонусы рекрутера
GET  /recruiter/stats          — сводная статистика
POST /recruiter/invite         — создать приглашение для врача
GET  /recruiter/invites        — список отправленных приглашений

Принятие приглашения (публичный):
GET  /invite/{token}           — проверить токен (возвращает email, роль)
POST /invite/{token}/accept    — принять приглашение (ввод пароля + ФИО)
"""
import uuid
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, EmailStr

from app.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.user import User, UserRole
from app.models.invitation import Invitation
from app.models.doctor_clinic_access import DoctorClinicAccess
from app.models.recruiter_bonus import RecruiterBonus, RecruiterBonusStatus
from app.models.clinic import Clinic
from app.core.security import hash_password

router = APIRouter(prefix="/recruiter", tags=["recruiter"])

_recruiter = Depends(require_role("recruiter"))


# ──────────────────────────────────────────────
# Схемы запросов / ответов
# ──────────────────────────────────────────────

class InviteRequest(BaseModel):
    email: str
    full_name: str
    phone_number: Optional[str] = None
    clinic_ids: list[str]  # UUID-строки клиник к которым будет доступ


class AcceptInviteRequest(BaseModel):
    password: str
    full_name: Optional[str] = None  # если рекрутер не заполнил


# ──────────────────────────────────────────────
# Кабинет рекрутера
# ──────────────────────────────────────────────

@router.get("/stats")
async def get_recruiter_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = _recruiter,
):
    """Сводная статистика рекрутера."""
    # Количество привлечённых врачей
    doctors_count = await db.scalar(
        select(func.count(User.id)).where(User.recruiter_id == current_user.id, User.is_active == True)
    ) or 0

    # Сумма бонусов
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


@router.get("/doctors")
async def get_my_doctors(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = _recruiter,
):
    """Список привлечённых врачей с доступами к клиникам."""
    result = await db.execute(
        select(User).where(User.recruiter_id == current_user.id).order_by(User.created_at.desc())
    )
    doctors = result.scalars().all()

    out = []
    for doc in doctors:
        # Клиники доступа
        acc_result = await db.execute(
            select(DoctorClinicAccess, Clinic)
            .join(Clinic, DoctorClinicAccess.clinic_id == Clinic.id)
            .where(DoctorClinicAccess.doctor_id == doc.id)
        )
        accesses = acc_result.all()
        clinic_list = [
            {"id": str(c.id), "name": c.name}
            for _, c in accesses
        ]

        # Бонусы с этого врача
        doc_bonuses = await db.scalar(
            select(func.coalesce(func.sum(RecruiterBonus.amount), 0))
            .where(
                RecruiterBonus.recruiter_id == current_user.id,
                RecruiterBonus.doctor_id == doc.id,
            )
        ) or 0

        out.append({
            "id": str(doc.id),
            "full_name": doc.full_name,
            "phone_number": doc.phone_number,
            "email": doc.email,
            "is_active": doc.is_active,
            "created_at": doc.created_at.isoformat(),
            "clinics": clinic_list,
            "bonuses_earned": float(doc_bonuses),
        })

    return out


@router.get("/bonuses")
async def get_recruiter_bonuses(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = _recruiter,
    limit: int = Query(50, le=200),
    offset: int = Query(0),
):
    """История бонусов рекрутера."""
    result = await db.execute(
        select(RecruiterBonus)
        .where(RecruiterBonus.recruiter_id == current_user.id)
        .order_by(RecruiterBonus.created_at.desc())
        .limit(limit).offset(offset)
    )
    bonuses = result.scalars().all()

    out = []
    for b in bonuses:
        # Имя врача
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


@router.get("/invites")
async def get_sent_invites(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = _recruiter,
):
    """Список отправленных приглашений."""
    result = await db.execute(
        select(Invitation)
        .where(Invitation.recruiter_id == current_user.id)
        .order_by(Invitation.created_at.desc())
    )
    invites = result.scalars().all()

    return [
        {
            "id": str(i.id),
            "email": i.email,
            "code": i.code,
            "is_used": i.is_used,
            "expires_at": i.expires_at.isoformat() if i.expires_at else None,
            "created_at": i.created_at.isoformat(),
            "clinic_access": i.clinic_access or [],
        }
        for i in invites
    ]


@router.post("/invite")
async def create_doctor_invite(
    body: InviteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = _recruiter,
):
    """Создать приглашение для врача. Возвращает ссылку для отправки врачу."""
    # Проверяем что все clinic_id существуют и принадлежат тому же тенанту
    for cid_str in body.clinic_ids:
        try:
            cid = uuid.UUID(cid_str)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Неверный UUID клиники: {cid_str}")
        clinic = await db.get(Clinic, cid)
        if not clinic:
            raise HTTPException(status_code=404, detail=f"Клиника {cid_str} не найдена")

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


# ──────────────────────────────────────────────
# Публичные эндпоинты — принятие приглашения
# ──────────────────────────────────────────────

@router.get("/accept/{token}", tags=["invite"])
async def check_invite(token: str, db: AsyncSession = Depends(get_db)):
    """Проверить токен приглашения (публичный). Возвращает email и статус."""
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
    """Принять приглашение — создать аккаунт врача."""
    result = await db.execute(select(Invitation).where(Invitation.code == token))
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Приглашение не найдено")
    if invite.is_used:
        raise HTTPException(status_code=410, detail="Приглашение уже использовано")
    if invite.expires_at and invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Приглашение истекло")

    # Проверяем нет ли уже такого email
    existing = await db.execute(select(User).where(User.email == invite.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Пользователь с таким email уже существует")

    # Получаем тенант рекрутера
    recruiter = await db.get(User, invite.recruiter_id) if invite.recruiter_id else None
    tenant_id = recruiter.tenant_id if recruiter else None

    # Создаём врача
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

    # Назначаем доступы к клиникам
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

    # Помечаем приглашение использованным
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
