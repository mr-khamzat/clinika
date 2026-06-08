# ===== БЛОК: Партнёры и инвайт-ссылки =====
# Управление партнёрами (суб-агентами) и инвайт-кодами.
# /manager/partners/*, /manager/invitations/*

import uuid
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager, require_admin, get_tenant_db
from app.core.region_lock import enforce_region_lock
from app.models.user import User, UserRole
from app.models.clinic import Clinic
from app.models.referral import Referral
from app.models.invitation import Invitation
from app.schemas.manager import CreateAdminRequest, UpdateAdminRequest
from app.services.activity_service import log_activity

router = APIRouter(tags=["manager:partners"])


class CreateInviteRequest(BaseModel):
    clinic_id: Optional[str] = None
    expires_days: Optional[int] = None
    max_uses: int = 100


@router.get("/partners/", response_model=list[dict])
async def list_partners(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    q = select(User).where(User.role == UserRole.PARTNER_DOCTOR).order_by(User.full_name)
    if current_user.tenant_id is not None:
        q = q.where(User.tenant_id == current_user.tenant_id)
    if current_user.clinic_id is not None:
        q = q.where(User.clinic_id == current_user.clinic_id)
    result = await db.execute(q)
    partners = result.scalars().all()
    out = []
    for p in partners:
        ref_count = await db.execute(select(func.count(Referral.id)).where(Referral.created_by_admin_id == p.id))
        out.append({
            "id": str(p.id), "full_name": p.full_name, "username": p.username,
            "phone_number": p.phone_number, "telegram_id": p.telegram_id,
            "is_active": p.is_active, "created_at": p.created_at.isoformat() if p.created_at else None,
            "referrals_count": ref_count.scalar() or 0,
        })
    return out


@router.post("/partners/", response_model=dict, status_code=201, dependencies=[Depends(enforce_region_lock)])
async def create_partner(
    body: CreateAdminRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_tenant_db),
):
    from app.core.security import hash_password
    if body.telegram_id:
        existing = await db.execute(select(User).where(User.telegram_id == body.telegram_id))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Telegram ID уже используется")
    if body.username:
        existing_u = await db.execute(select(User).where(User.username == body.username))
        if existing_u.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Логин уже занят")
    clinic_id = current_user.clinic_id or (uuid.UUID(str(body.clinic_id)) if getattr(body, 'clinic_id', None) else None)
    new_partner = User(
        telegram_id=body.telegram_id or None, username=body.username or None,
        password_hash=hash_password(body.password) if body.password else None,
        # pwdmust01: пароль задал админ → требуем смену при первом входе.
        # Если пароля нет (telegram-only) — флаг бесполезен, ставим False.
        password_must_change=bool(body.password),
        full_name=body.full_name, phone_number=body.phone_number,
        clinic_id=clinic_id, role=UserRole.PARTNER_DOCTOR, is_active=True,
    )
    db.add(new_partner)
    await db.commit()
    await db.refresh(new_partner)
    await log_activity(db, current_user, "Создан партнёр", "user", new_partner.id)
    await db.commit()
    ref_count = await db.execute(select(func.count(Referral.id)).where(Referral.created_by_admin_id == new_partner.id))
    return {"id": str(new_partner.id), "full_name": new_partner.full_name, "username": new_partner.username,
            "phone_number": new_partner.phone_number, "telegram_id": new_partner.telegram_id,
            "is_active": new_partner.is_active, "created_at": new_partner.created_at.isoformat() if new_partner.created_at else None,
            "referrals_count": 0}


@router.patch("/partners/{partner_id}", response_model=dict, dependencies=[Depends(enforce_region_lock)])
async def update_partner(
    partner_id: uuid.UUID,
    body: UpdateAdminRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_tenant_db),
):
    from app.core.security import hash_password
    result = await db.execute(select(User).where(User.id == partner_id, User.role == UserRole.PARTNER_DOCTOR))
    partner = result.scalar_one_or_none()
    if not partner or (current_user.tenant_id is not None and partner.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Партнёр не найден")
    if body.full_name is not None: partner.full_name = body.full_name
    if body.username is not None: partner.username = body.username
    if body.password:
        partner.password_hash = hash_password(body.password)
        # pwdmust01: руководитель сбросил пароль → требуем смену при следующем входе
        partner.password_must_change = True
    if 'phone_number' in body.model_fields_set: partner.phone_number = body.phone_number
    if body.is_active is not None: partner.is_active = body.is_active
    await db.commit()
    await db.refresh(partner)
    await log_activity(db, current_user, "Обновлён партнёр", "user", partner.id)
    await db.commit()
    ref_count = await db.execute(select(func.count(Referral.id)).where(Referral.created_by_admin_id == partner.id))
    return {"id": str(partner.id), "full_name": partner.full_name, "username": partner.username,
            "phone_number": partner.phone_number, "telegram_id": partner.telegram_id,
            "is_active": partner.is_active, "created_at": partner.created_at.isoformat() if partner.created_at else None,
            "referrals_count": ref_count.scalar() or 0}


@router.delete("/partners/{partner_id}", dependencies=[Depends(enforce_region_lock)])
async def delete_partner(
    partner_id: uuid.UUID,
    hard: bool = Query(False),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(select(User).where(User.id == partner_id, User.role == UserRole.PARTNER_DOCTOR))
    partner = result.scalar_one_or_none()
    if not partner or (current_user.tenant_id is not None and partner.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Партнёр не найден")
    if hard:
        partner.is_active = False; partner.username = None; partner.telegram_id = None
        partner.phone_number = None; partner.password_hash = None; partner.full_name = "[Удалён]"; partner.clinic_id = None
        await db.commit()
        return {"status": "deleted"}
    partner.is_active = False
    await log_activity(db, current_user, "Деактивирован партнёр", "user", partner.id)
    await db.commit()
    return {"status": "deactivated"}


@router.post("/invitations/", response_model=dict, status_code=201)
async def create_invitation(
    body: CreateInviteRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    if current_user.clinic_id:
        clinic_id = current_user.clinic_id
    elif body.clinic_id:
        clinic_id = uuid.UUID(body.clinic_id)
    else:
        raise HTTPException(status_code=400, detail="Укажите клинику для инвайта")
    clinic = (await db.execute(select(Clinic).where(Clinic.id == clinic_id))).scalar_one_or_none()
    if not clinic:
        raise HTTPException(status_code=404, detail="Клиника не найдена")
    expires_at = datetime.utcnow() + timedelta(days=body.expires_days) if body.expires_days else None
    invite = Invitation(code=secrets.token_urlsafe(16), clinic_id=clinic_id, role="partner_doctor",
        invited_by_id=current_user.id, expires_at=expires_at, max_uses=body.max_uses)
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return {"id": str(invite.id), "code": invite.code, "clinic_id": str(invite.clinic_id),
            "clinic_name": clinic.name, "role": invite.role,
            "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
            "max_uses": invite.max_uses, "uses_count": invite.uses_count, "created_at": invite.created_at.isoformat()}


@router.get("/invitations/", response_model=list[dict])
async def list_invitations(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    # Tenant isolation: фильтруем JOIN'ом по invited_by.tenant_id
    q = select(Invitation).order_by(Invitation.created_at.desc())
    if current_user.tenant_id is not None:
        q = q.join(User, User.id == Invitation.invited_by_id).where(User.tenant_id == current_user.tenant_id)
    if current_user.clinic_id: q = q.where(Invitation.clinic_id == current_user.clinic_id)
    result = await db.execute(q)
    invites = result.scalars().all()
    out = []
    for inv in invites:
        clinic = (await db.execute(select(Clinic).where(Clinic.id == inv.clinic_id))).scalar_one_or_none()
        is_valid = not (inv.expires_at and inv.expires_at < datetime.utcnow()) and inv.uses_count < inv.max_uses
        out.append({"id": str(inv.id), "code": inv.code, "clinic_id": str(inv.clinic_id),
            "clinic_name": clinic.name if clinic else "—", "role": inv.role,
            "expires_at": inv.expires_at.isoformat() if inv.expires_at else None,
            "max_uses": inv.max_uses, "uses_count": inv.uses_count, "is_valid": is_valid,
            "created_at": inv.created_at.isoformat()})
    return out


@router.delete("/invitations/{invitation_id}")
async def delete_invitation(
    invitation_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(select(Invitation).where(Invitation.id == invitation_id))
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Инвайт не найден")
    # Tenant isolation: проверяем что инвайт создан внутри нашего тенанта
    if current_user.tenant_id is not None:
        inviter = (await db.execute(select(User).where(User.id == invite.invited_by_id))).scalar_one_or_none()
        if not inviter or inviter.tenant_id != current_user.tenant_id:
            raise HTTPException(status_code=404, detail="Инвайт не найден")
    if current_user.clinic_id and invite.clinic_id != current_user.clinic_id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    await db.delete(invite)
    await db.commit()
    return {"status": "deleted"}
