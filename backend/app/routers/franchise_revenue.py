"""
Доходы франшизы с бонусов клиник.

При выплате каждого бонуса любой клиникой франшизы → клиника платит франшизе
fee_per_bonus_from_clinic (по умолчанию 100 ₽). Это её роялти с переводов
бонусов.

Endpoints:
  GET  /franchise-owner/revenue/settings    — текущая ставка fee
  PUT  /franchise-owner/revenue/settings    — изменить ставку
  GET  /franchise-owner/revenue/dashboard   — сводка доходов (этот/прошлый месяц + total)
  GET  /franchise-owner/revenue/by-clinic   — детализация по клиникам за период

Запись комиссии создаётся в bonus_service.mark_bonus_paid через hook.
"""
import uuid
from datetime import datetime, timedelta, date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.clinic import Clinic
from app.models.bonus import Bonus, BonusStatus


router = APIRouter(prefix="/franchise-owner/revenue", tags=["franchise-revenue"])


def _require_franchise_owner(user: User):
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role not in ("franchise_owner", "super_admin"):
        raise HTTPException(403, "Доступ только для владельца франшизы")


async def _get_my_franchise(db: AsyncSession, user: User) -> Franchise:
    r = await db.execute(select(Franchise).where(Franchise.owner_user_id == user.id))
    f = r.scalar_one_or_none()
    if f:
        return f
    if user.tenant_id:
        t = await db.get(Tenant, user.tenant_id)
        if t and t.franchise_id:
            return await db.get(Franchise, t.franchise_id)
    r = await db.execute(select(Franchise).limit(1))
    return r.scalar_one_or_none()


# ─── Settings ─────────────────────────────────────────────────────────────────
class RevenueSettingsUpdate(BaseModel):
    fee_per_bonus_from_clinic: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


@router.get("/settings")
async def get_revenue_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    return {
        "fee_per_bonus_from_clinic": float(getattr(f, "fee_per_bonus_from_clinic", 100)),
        "platform_fee_per_bonus": float(f.platform_fee_per_bonus),
        "min_bonus_amount": float(f.min_bonus_amount),
        "franchise_name": f.name,
    }


@router.put("/settings")
async def update_revenue_settings(
    payload: RevenueSettingsUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    f.fee_per_bonus_from_clinic = payload.fee_per_bonus_from_clinic
    await db.commit()
    return {"fee_per_bonus_from_clinic": float(f.fee_per_bonus_from_clinic)}


# ─── Dashboard ────────────────────────────────────────────────────────────────
@router.get("/dashboard")
async def revenue_dashboard(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Сводка доходов франшизы за этот месяц / прошлый / всё время.

    Доход = сумма (количество paid bonus в клинике × fee_per_bonus_from_clinic).
    """
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    fee = Decimal(str(getattr(f, "fee_per_bonus_from_clinic", 100) or 0))

    # Тенанты франшизы
    rt = await db.execute(select(Tenant.id).where(Tenant.franchise_id == f.id))
    tenant_ids = [row[0] for row in rt.all()]
    if not tenant_ids:
        return {"this_month": 0, "last_month": 0, "all_time": 0, "fee_per_bonus": float(fee)}

    now = datetime.utcnow()
    this_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_month_end = this_month_start - timedelta(seconds=1)
    last_month_start = last_month_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    async def count_paid_bonuses(start: datetime | None, end: datetime | None):
        q = select(func.count(Bonus.id)).where(and_(
            Bonus.tenant_id.in_(tenant_ids),
            Bonus.status == BonusStatus.PAID,
        ))
        if start: q = q.where(Bonus.paid_at >= start)
        if end:   q = q.where(Bonus.paid_at <= end)
        r = await db.execute(q)
        return int(r.scalar() or 0)

    this_m = await count_paid_bonuses(this_month_start, None)
    last_m = await count_paid_bonuses(last_month_start, last_month_end)
    all_t  = await count_paid_bonuses(None, None)

    return {
        "this_month": float(fee * this_m),
        "this_month_bonus_count": this_m,
        "last_month": float(fee * last_m),
        "last_month_bonus_count": last_m,
        "all_time": float(fee * all_t),
        "all_time_bonus_count": all_t,
        "fee_per_bonus": float(fee),
        "franchise_name": f.name,
    }


@router.get("/by-clinic")
async def revenue_by_clinic(
    period_start: Optional[date] = Query(None),
    period_end: Optional[date] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Детализация дохода по клиникам (тенантам) за период.

    По умолчанию: текущий месяц.
    """
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    fee = Decimal(str(getattr(f, "fee_per_bonus_from_clinic", 100) or 0))

    rt = await db.execute(select(Tenant).where(Tenant.franchise_id == f.id))
    tenants = list(rt.scalars().all())

    # Period default: current month
    now = datetime.utcnow()
    if not period_start:
        period_start = now.replace(day=1).date()
    if not period_end:
        period_end = now.date()

    start_dt = datetime.combine(period_start, datetime.min.time())
    end_dt = datetime.combine(period_end, datetime.max.time())

    # Сводка по тенантам
    breakdown = []
    total_count = 0
    total_revenue = Decimal("0")
    for t in tenants:
        rc = await db.execute(select(Clinic).where(Clinic.tenant_id == t.id).limit(1))
        c = rc.scalar_one_or_none()
        # Кол-во paid bonus в тенанте за период
        q = select(func.count(Bonus.id), func.coalesce(func.sum(Bonus.amount), 0)).where(and_(
            Bonus.tenant_id == t.id,
            Bonus.status == BonusStatus.PAID,
            Bonus.paid_at >= start_dt,
            Bonus.paid_at <= end_dt,
        ))
        r = await db.execute(q)
        cnt, total_bonus_amount = r.first()
        cnt = int(cnt or 0)
        total_bonus_amount = Decimal(str(total_bonus_amount or 0))
        revenue = fee * cnt
        breakdown.append({
            "tenant_id": str(t.id),
            "tenant_name": t.name,
            "tenant_slug": t.slug,
            "clinic_name": c.name if c else "—",
            "bonus_count": cnt,
            "bonus_total_paid_rub": float(total_bonus_amount),
            "franchise_revenue_rub": float(revenue),
        })
        total_count += cnt
        total_revenue += revenue

    return {
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "fee_per_bonus": float(fee),
        "total_bonus_count": total_count,
        "total_revenue_rub": float(total_revenue),
        "by_clinic": sorted(breakdown, key=lambda x: -x["franchise_revenue_rub"]),
    }
