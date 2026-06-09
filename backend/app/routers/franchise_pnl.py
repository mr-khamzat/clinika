"""
Router: P&L (Profit & Loss) кабинета франшизы.

Endpoints:
  GET /franchise-owner/pnl/summary    — KPI сводка за период
  GET /franchise-owner/pnl/by-month   — line-chart по последним N месяцам
  GET /franchise-owner/pnl/by-clinic  — bar-chart разбивки по клиникам

Все endpoints доступны только пользователям с ролью FRANCHISE_OWNER
или SUPER_ADMIN. Период задаётся коротким именем (current_month / last_month /
ytd / custom). Для custom — обязательны from + to.

P&L формулы и список источников — см. services/franchise_pnl_service.py.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.franchise import Franchise
from app.models.tenant import Tenant

from app.services.franchise_pnl_service import (
    compute_pnl,
    resolve_period,
    DEFAULT_TAX_RATE,
)


router = APIRouter(prefix="/franchise-owner/pnl", tags=["franchise-pnl"])


def _require_role(user: User) -> None:
    """Только franchise_owner / super_admin."""
    if user.role not in (UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
        raise HTTPException(
            status_code=403,
            detail="Доступ только для владельца франшизы",
        )


async def _resolve_tenant_id(db: AsyncSession, user: User) -> uuid.UUID:
    """Берём tenant_id для запроса P&L.

    - Если у пользователя есть свой tenant_id (обычно у franchise_owner он указан
      на root-тенанта франшизы) — используем его.
    - Иначе пробуем найти Franchise.owner_user_id == user.id и взять любой
      тенант этой франшизы (для случая если owner создан без tenant_id).
    """
    if user.tenant_id:
        return user.tenant_id
    r = await db.execute(select(Franchise).where(Franchise.owner_user_id == user.id))
    f = r.scalar_one_or_none()
    if not f:
        # super_admin может смотреть «любую» — возьмём первую существующую франшизу
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
    """resolve_period с конвертацией ValueError в HTTP 400."""
    try:
        return resolve_period(period, from_, to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/summary")
async def pnl_summary(
    period: Optional[str] = Query("current_month", description="current_month|last_month|ytd|custom"),
    from_: Optional[date] = Query(None, alias="from", description="Начало периода (для custom)"),
    to: Optional[date] = Query(None, description="Конец периода (для custom)"),
    tax_rate: Optional[float] = Query(None, ge=0, le=1, description="Ставка налога в долях (0.06 = 6%)"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Сводный P&L за выбранный период.

    Возвращает revenue, cogs, gross_margin, taxes, platform_fee, net_income,
    а также разбивку выручки по клиникам сети.
    """
    _require_role(user)
    start, end, label = _resolve_period_safe(period, from_, to)
    tenant_id = await _resolve_tenant_id(db, user)
    rate = Decimal(str(tax_rate)) if tax_rate is not None else DEFAULT_TAX_RATE
    data = await compute_pnl(db, tenant_id, start, end, tax_rate=rate)
    data["period"] = label
    return data


@router.get("/by-month")
async def pnl_by_month(
    months: int = Query(12, ge=1, le=36, description="Сколько месяцев истории (1..36)"),
    tax_rate: Optional[float] = Query(None, ge=0, le=1),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Помесячная история P&L (для line-чарта).

    Возвращает массив элементов {month, revenue, cogs, gross_margin, taxes,
    platform_fee, net_income} за последние `months` месяцев.
    """
    _require_role(user)
    tenant_id = await _resolve_tenant_id(db, user)
    # Период тут не критичен — by_month берёт период из months
    now = datetime.utcnow()
    start = now - timedelta(days=months * 31)
    rate = Decimal(str(tax_rate)) if tax_rate is not None else DEFAULT_TAX_RATE
    data = await compute_pnl(
        db, tenant_id, start, now, tax_rate=rate,
        include_by_month=True, months=months,
    )
    return {
        "months": months,
        "tax_rate": float(rate),
        "by_month": data.get("by_month", []),
    }


@router.get("/by-clinic")
async def pnl_by_clinic(
    period: Optional[str] = Query("current_month"),
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Разбивка выручки по клиникам сети за выбранный период."""
    _require_role(user)
    start, end, label = _resolve_period_safe(period, from_, to)
    tenant_id = await _resolve_tenant_id(db, user)
    data = await compute_pnl(db, tenant_id, start, end)
    return {
        "period": label,
        "period_start": data["period_start"],
        "period_end": data["period_end"],
        "by_clinic": data["revenue_by_clinic"],
        "total_revenue": data["revenue"],
    }
