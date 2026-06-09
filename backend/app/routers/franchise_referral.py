"""
Router: «Перелив пациентов» (cross-clinic referrals matrix).

Endpoints:
  GET /franchise-owner/referrals/matrix   — полная матрица направлений
  GET /franchise-owner/referrals/summary  — агрегаты (всего + top-5)
  GET /franchise-owner/referrals/top      — топ-N направлений (по умолчанию 10)

Доступ: FRANCHISE_OWNER / SUPER_ADMIN.

NB: префикс намеренно отличается от старого роутера `referrals_cross.py`
    (там операционные действия — отправить/принять/завершить направление).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.franchise import Franchise
from app.models.tenant import Tenant

from app.services.franchise_referral_service import (
    compute_matrix,
    compute_summary,
    compute_top,
)
from app.services.franchise_pnl_service import resolve_period


router = APIRouter(prefix="/franchise-owner/referrals", tags=["franchise-referrals"])


def _require_role(user: User) -> None:
    if user.role not in (UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
        raise HTTPException(403, "Доступ только для владельца франшизы")


async def _resolve_tenant_id(db: AsyncSession, user: User) -> uuid.UUID:
    if user.tenant_id:
        return user.tenant_id
    r = await db.execute(select(Franchise).where(Franchise.owner_user_id == user.id))
    f = r.scalar_one_or_none()
    if not f:
        r2 = await db.execute(select(Franchise).limit(1))
        f = r2.scalar_one_or_none()
        if not f:
            raise HTTPException(404, "Франшиза не найдена")
    rt = await db.execute(select(Tenant).where(Tenant.franchise_id == f.id).limit(1))
    t = rt.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "В франшизе нет тенантов")
    return t.id


def _resolve_period_safe(
    period: Optional[str], from_: Optional[date], to: Optional[date],
):
    try:
        return resolve_period(period, from_, to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/matrix")
async def referrals_matrix(
    period: Optional[str] = Query("current_month"),
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Полная матрица «from-клиника → to-клиника» с count и total_amount."""
    _require_role(user)
    start, end, label = _resolve_period_safe(period, from_, to)
    tenant_id = await _resolve_tenant_id(db, user)
    data = await compute_matrix(db, tenant_id, start, end)
    data["period"] = label
    return data


@router.get("/summary")
async def referrals_summary(
    period: Optional[str] = Query("current_month"),
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Агрегаты переливов: общее количество, сумма, top-5 направлений."""
    _require_role(user)
    start, end, label = _resolve_period_safe(period, from_, to)
    tenant_id = await _resolve_tenant_id(db, user)
    data = await compute_summary(db, tenant_id, start, end)
    data["period"] = label
    return data


@router.get("/top")
async def referrals_top(
    limit: int = Query(10, ge=1, le=100, description="Сколько направлений вернуть"),
    period: Optional[str] = Query("current_month"),
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Топ-N самых активных направлений (по количеству переливов)."""
    _require_role(user)
    start, end, label = _resolve_period_safe(period, from_, to)
    tenant_id = await _resolve_tenant_id(db, user)
    top = await compute_top(db, tenant_id, start, end, limit=limit)
    return {
        "period": label,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "limit": limit,
        "items": top,
    }
