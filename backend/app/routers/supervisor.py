"""
Кабинет супервизора — только чтение.
Супервизор видит статистику нескольких клиник своего тенанта,
список пользователей и журнал аудита, но НЕ может редактировать данные.

Эндпоинты:
  GET /supervisor/dashboard?days=30  — сводная статистика (записи, пациенты, врачи, топ врачей)
  GET /supervisor/users              — список пользователей тенанта
  GET /supervisor/audit?skip=0&limit=50 — журнал аудита тенанта
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.referral import Referral
from app.models.clinic import Clinic
from app.models.audit import AuditEntry

router = APIRouter(prefix="/supervisor", tags=["supervisor"])


def _require_supervisor(user: User) -> None:
    """Проверяем что пользователь — supervisor или super_admin."""
    if user.role not in (UserRole.SUPERVISOR, UserRole.SUPER_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для супервизора"
        )


# ──────────────────────────────────────────────────────────────
# GET /supervisor/dashboard
# ──────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def supervisor_dashboard(
    days: int = Query(30, ge=1, le=365, description="Период в днях"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Сводная статистика по тенанту:
    - Всего направлений за период
    - Уникальных пациентов (по телефону)
    - Активных врачей
    - Топ-5 врачей по количеству направлений
    """
    _require_supervisor(current_user)
    tenant_id = current_user.tenant_id

    d_from = datetime.utcnow() - timedelta(days=days)

    # Базовые фильтры для направлений тенанта за период
    ref_filters = [Referral.created_at >= d_from]
    if tenant_id:
        ref_filters.append(Referral.tenant_id == tenant_id)

    # Общее число направлений
    total_referrals = await db.scalar(
        select(func.count(Referral.id)).where(and_(*ref_filters))
    ) or 0

    # Уникальные пациенты по номеру телефона
    unique_patients = await db.scalar(
        select(func.count(func.distinct(Referral.patient_phone))).where(and_(*ref_filters))
    ) or 0

    # Активные врачи в тенанте
    doc_filters = [User.role == UserRole.DOCTOR, User.is_active == True]
    if tenant_id:
        doc_filters.append(User.tenant_id == tenant_id)
    active_doctors = await db.scalar(
        select(func.count(User.id)).where(and_(*doc_filters))
    ) or 0

    # Топ-5 врачей по количеству направлений за период
    top_q = await db.execute(
        select(
            User.id,
            User.full_name,
            func.count(Referral.id).label("referrals_count"),
        )
        .join(Referral, Referral.created_by_admin_id == User.id)
        .where(and_(*ref_filters))
        .group_by(User.id, User.full_name)
        .order_by(desc("referrals_count"))
        .limit(5)
    )
    top_doctors = [
        {
            "id": str(row.id),
            "full_name": row.full_name,
            "referrals_count": row.referrals_count,
        }
        for row in top_q.all()
    ]

    # Клиники тенанта
    clinic_filters = [Clinic.is_active == True]
    if tenant_id:
        clinic_filters.append(Clinic.tenant_id == tenant_id)
    total_clinics = await db.scalar(
        select(func.count(Clinic.id)).where(and_(*clinic_filters))
    ) or 0

    return {
        "period_days": days,
        "total_referrals": total_referrals,
        "unique_patients": unique_patients,
        "active_doctors": active_doctors,
        "total_clinics": total_clinics,
        "top_doctors": top_doctors,
    }


# ──────────────────────────────────────────────────────────────
# GET /supervisor/users
# ──────────────────────────────────────────────────────────────

@router.get("/users")
async def supervisor_users(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список всех пользователей тенанта (только чтение)."""
    _require_supervisor(current_user)
    tenant_id = current_user.tenant_id

    filters = []
    if tenant_id:
        filters.append(User.tenant_id == tenant_id)

    result = await db.execute(
        select(User)
        .where(and_(*filters) if filters else True)
        .order_by(User.created_at.desc())
    )
    users = result.scalars().all()

    return [
        {
            "id": str(u.id),
            "full_name": u.full_name,
            "email": u.email,
            "phone_number": u.phone_number,
            "role": u.role.value,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]


# ──────────────────────────────────────────────────────────────
# GET /supervisor/audit
# ──────────────────────────────────────────────────────────────

@router.get("/audit")
async def supervisor_audit(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Журнал аудита тенанта (только чтение, без изменений)."""
    _require_supervisor(current_user)
    tenant_id = current_user.tenant_id

    d_from = datetime.utcnow() - timedelta(days=days)
    filters = [AuditEntry.created_at >= d_from]
    if tenant_id:
        filters.append(AuditEntry.tenant_id == tenant_id)

    result = await db.execute(
        select(AuditEntry)
        .where(and_(*filters))
        .order_by(AuditEntry.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    entries = result.scalars().all()

    # Общий count
    total = await db.scalar(
        select(func.count(AuditEntry.id)).where(and_(*filters))
    ) or 0

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [
            {
                "id": str(e.id),
                "action": e.action,
                "entity_type": e.entity_type,
                "entity_id": str(e.entity_id) if e.entity_id else None,
                "actor_id": str(e.actor_id) if e.actor_id else None,
                "actor_name": e.actor_name,
                "comment": e.comment,
                "ip_address": e.ip_address,
                "created_at": e.created_at.isoformat(),
            }
            for e in entries
        ],
    }
