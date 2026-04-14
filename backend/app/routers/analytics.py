"""
Аналитика — drill-down.
Этап 7 SaaS-трансформации.

Все эндпоинты требуют:
  - авторизацию manager
  - фичу "analytics" в тарифе

Параметры периода:
  ?days=N  (по умолчанию 30) — последние N дней
  ?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD — явный диапазон
"""
import uuid
from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, cast, Date, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.core.tenant import require_feature
from app.models.user import User, UserRole
from app.models.clinic import Clinic
from app.models.referral import Referral, ReferralStatus
from app.models.bonus import Bonus, BonusStatus
from app.models.service import Service
from app.models.ledger import LedgerEntry
from app.services.ledger_service import OpType

router = APIRouter(prefix="/analytics", tags=["analytics"])

_feat = Depends(require_feature("analytics"))
_mgr  = Depends(require_manager)


# ── Хелперы ───────────────────────────────────────────────────────────────────

def _date_range(
    days: int,
    from_date: Optional[str],
    to_date: Optional[str],
) -> tuple[date, date]:
    """Вернуть (d_from, d_to) с учётом явных параметров или last-N-days."""
    if from_date and to_date:
        try:
            return (
                date.fromisoformat(from_date),
                date.fromisoformat(to_date),
            )
        except ValueError:
            pass
    d_to   = date.today()
    d_from = d_to - timedelta(days=days - 1)
    return d_from, d_to


def _dt(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time())


# ── 1. Обзор (overview) ───────────────────────────────────────────────────────

@router.get("/overview", dependencies=[_feat, _mgr])
async def analytics_overview(
    days: int = Query(30, ge=1, le=365),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Сводные метрики за период: кол-во направлений, конверсия, сумма бонусов,
    сравнение с предыдущим аналогичным периодом.
    """
    d_from, d_to = _date_range(days, from_date, to_date)
    # Tenant isolation
    _tenant_id = current_user.tenant_id
    span = (d_to - d_from).days + 1
    prev_to   = d_from - timedelta(days=1)
    prev_from = prev_to - timedelta(days=span - 1)

    async def _period_stats(pf: date, pt: date) -> dict:
        r = await db.execute(
            select(
                func.count(Referral.id).label("total"),
                func.count(Referral.id).filter(
                    Referral.status == ReferralStatus.CONFIRMED
                ).label("confirmed"),
                func.coalesce(
                    func.sum(Bonus.amount).filter(Bonus.status == BonusStatus.PAID), 0
                ).label("bonuses_paid"),
                func.coalesce(
                    func.sum(Bonus.amount).filter(Bonus.status == BonusStatus.PENDING), 0
                ).label("bonuses_pending"),
            )
            .outerjoin(Bonus, Bonus.referral_id == Referral.id)
            .where(
                Referral.created_at >= _dt(pf),
                Referral.tenant_id == _tenant_id if _tenant_id else Referral.tenant_id.isnot(None) | True,
                Referral.created_at < _dt(pt) + timedelta(days=1),
            )
        )
        row = r.one()
        total = row.total or 0
        confirmed = row.confirmed or 0
        return {
            "total":           total,
            "confirmed":       confirmed,
            "cancelled":       0,  # будет добавлено ниже
            "conversion_pct":  round(confirmed / total * 100, 1) if total else 0.0,
            "bonuses_paid":    float(row.bonuses_paid or 0),
            "bonuses_pending": float(row.bonuses_pending or 0),
        }

    current  = await _period_stats(d_from, d_to)
    previous = await _period_stats(prev_from, prev_to)

    def _delta(key: str) -> float:
        c, p = current[key], previous[key]
        if p == 0:
            return None
        return round((c - p) / p * 100, 1)

    return {
        "period": {"from": d_from.isoformat(), "to": d_to.isoformat(), "days": span},
        "current":  current,
        "previous": previous,
        "delta": {
            "total_pct":           _delta("total"),
            "confirmed_pct":       _delta("confirmed"),
            "conversion_pct_diff": round(current["conversion_pct"] - previous["conversion_pct"], 1),
            "bonuses_paid_pct":    _delta("bonuses_paid"),
        },
    }


# ── 2. Воронка (funnel) ───────────────────────────────────────────────────────

@router.get("/funnel", dependencies=[_feat, _mgr])
async def analytics_funnel(
    days: int = Query(30, ge=1, le=365),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Воронка направлений:
      Создано → Подтверждено → Бонус начислен → Бонус выплачен
    """
    d_from, d_to = _date_range(days, from_date, to_date)
    # Tenant isolation
    _tenant_id = current_user.tenant_id
    dt_from = _dt(d_from)
    dt_to   = _dt(d_to) + timedelta(days=1)

    # Шаг 1 — созданные направления
    total_q = await db.execute(
        select(func.count(Referral.id))
        .where(Referral.created_at >= dt_from,
            *([Referral.tenant_id == _tenant_id] if _tenant_id else []), Referral.created_at < dt_to)
    )
    total = total_q.scalar() or 0

    # Шаг 2 — подтверждённые
    confirmed_q = await db.execute(
        select(func.count(Referral.id))
        .where(
            Referral.status == ReferralStatus.CONFIRMED,
            Referral.created_at >= dt_from,
            Referral.created_at < dt_to,
            *([Referral.tenant_id == _tenant_id] if _tenant_id else []),
        )
    )
    confirmed = confirmed_q.scalar() or 0

    # Шаг 3 — с начисленным бонусом
    bonus_accrued_q = await db.execute(
        select(func.count(func.distinct(Bonus.referral_id)))
        .join(Referral, Referral.id == Bonus.referral_id)
        .where(
            Referral.created_at >= dt_from,
            Referral.created_at < dt_to,
            *([Referral.tenant_id == _tenant_id] if _tenant_id else []),
        )
    )
    with_bonus = bonus_accrued_q.scalar() or 0

    # Шаг 4 — бонус выплачен
    bonus_paid_q = await db.execute(
        select(func.count(func.distinct(Bonus.referral_id)))
        .join(Referral, Referral.id == Bonus.referral_id)
        .where(
            Bonus.status == BonusStatus.PAID,
            Referral.created_at >= dt_from,
            Referral.created_at < dt_to,
            *([Referral.tenant_id == _tenant_id] if _tenant_id else []),
        )
    )
    bonus_paid = bonus_paid_q.scalar() or 0

    def _rate(num: int, denom: int) -> float:
        return round(num / denom * 100, 1) if denom else 0.0

    return {
        "period": {"from": d_from.isoformat(), "to": d_to.isoformat()},
        "steps": [
            {"step": 1, "label": "Создано",              "count": total,     "rate_from_prev": 100.0},
            {"step": 2, "label": "Подтверждено",         "count": confirmed, "rate_from_prev": _rate(confirmed, total)},
            {"step": 3, "label": "Бонус начислен",       "count": with_bonus,"rate_from_prev": _rate(with_bonus, confirmed)},
            {"step": 4, "label": "Бонус выплачен",       "count": bonus_paid,"rate_from_prev": _rate(bonus_paid, with_bonus)},
        ],
        "overall_conversion": _rate(confirmed, total),
        "bonus_coverage":     _rate(with_bonus, confirmed),
        "payout_rate":        _rate(bonus_paid, with_bonus),
    }


# ── 3. Динамика (time series) ─────────────────────────────────────────────────

@router.get("/dynamics", dependencies=[_feat, _mgr])
async def analytics_dynamics(
    days: int = Query(30, ge=7, le=365),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    granularity: str = Query("day", pattern="^(day|week|month)$"),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Динамика направлений по времени.
    granularity: day | week | month
    Возвращает: [{date, total, confirmed, conversion_pct, bonuses}]
    """
    d_from, d_to = _date_range(days, from_date, to_date)
    # Tenant isolation
    _tenant_id = current_user.tenant_id
    dt_from = _dt(d_from)
    dt_to   = _dt(d_to) + timedelta(days=1)

    if granularity == "day":
        trunc = func.date_trunc("day", Referral.created_at)
    elif granularity == "week":
        trunc = func.date_trunc("week", Referral.created_at)
    else:
        trunc = func.date_trunc("month", Referral.created_at)

    q = await db.execute(
        select(
            trunc.label("period"),
            func.count(Referral.id).label("total"),
            func.count(Referral.id).filter(
                Referral.status == ReferralStatus.CONFIRMED
            ).label("confirmed"),
            func.coalesce(func.sum(Bonus.amount), 0).label("bonuses"),
        )
        .outerjoin(Bonus, Bonus.referral_id == Referral.id)
        .where(Referral.created_at >= dt_from,
            *([Referral.tenant_id == _tenant_id] if _tenant_id else []), Referral.created_at < dt_to)
        .group_by("period")
        .order_by("period")
    )
    rows = q.all()

    return {
        "period":      {"from": d_from.isoformat(), "to": d_to.isoformat()},
        "granularity": granularity,
        "series": [
            {
                "date":           r.period.date().isoformat() if hasattr(r.period, "date") else str(r.period)[:10],
                "total":          r.total,
                "confirmed":      r.confirmed,
                "conversion_pct": round(r.confirmed / r.total * 100, 1) if r.total else 0.0,
                "bonuses":        float(r.bonuses or 0),
            }
            for r in rows
        ],
    }


# ── 4. Топ услуг ──────────────────────────────────────────────────────────────

@router.get("/top-services", dependencies=[_feat, _mgr])
async def analytics_top_services(
    days: int = Query(30, ge=1, le=365),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=50),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Топ услуг: кол-во направлений, конверсия, бонусный объём, средний бонус.
    """
    d_from, d_to = _date_range(days, from_date, to_date)
    # Tenant isolation
    _tenant_id = current_user.tenant_id
    dt_from = _dt(d_from)
    dt_to   = _dt(d_to) + timedelta(days=1)

    q = await db.execute(
        select(
            Service.id,
            Service.name,
            func.count(Referral.id).label("total"),
            func.count(Referral.id).filter(
                Referral.status == ReferralStatus.CONFIRMED
            ).label("confirmed"),
            func.coalesce(func.sum(Bonus.amount), 0).label("bonus_sum"),
            func.coalesce(
                func.sum(Bonus.amount).filter(Bonus.status == BonusStatus.PAID), 0
            ).label("bonus_paid"),
        )
        .join(Referral, Referral.service_id == Service.id)
        .outerjoin(Bonus, Bonus.referral_id == Referral.id)
        .where(Referral.created_at >= dt_from,
            *([Referral.tenant_id == _tenant_id] if _tenant_id else []), Referral.created_at < dt_to)
        .group_by(Service.id, Service.name)
        .order_by(func.count(Referral.id).desc())
        .limit(limit)
    )

    result = []
    for i, r in enumerate(q.all()):
        avg_bonus = float(r.bonus_sum) / r.confirmed if r.confirmed else 0.0
        result.append({
            "rank":           i + 1,
            "service_id":     str(r.id),
            "name":           r.name,
            "total":          r.total,
            "confirmed":      r.confirmed,
            "conversion_pct": round(r.confirmed / r.total * 100, 1) if r.total else 0.0,
            "bonus_sum":      float(r.bonus_sum),
            "bonus_paid":     float(r.bonus_paid),
            "avg_bonus":      round(avg_bonus, 2),
        })
    return {"period": {"from": d_from.isoformat(), "to": d_to.isoformat()}, "items": result}


# ── 5. Топ сотрудников ────────────────────────────────────────────────────────

@router.get("/top-staff", dependencies=[_feat, _mgr])
async def analytics_top_staff(
    days: int = Query(30, ge=1, le=365),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Рейтинг сотрудников: кол-во направлений, конверсия, заработанные бонусы.
    """
    d_from, d_to = _date_range(days, from_date, to_date)
    # Tenant isolation
    _tenant_id = current_user.tenant_id
    dt_from = _dt(d_from)
    dt_to   = _dt(d_to) + timedelta(days=1)

    q = await db.execute(
        select(
            User.id,
            User.full_name,
            Clinic.name.label("clinic_name"),
            func.count(Referral.id).label("total"),
            func.count(Referral.id).filter(
                Referral.status == ReferralStatus.CONFIRMED
            ).label("confirmed"),
            func.coalesce(func.sum(Bonus.amount), 0).label("bonus_accrued"),
            func.coalesce(
                func.sum(Bonus.amount).filter(Bonus.status == BonusStatus.PAID), 0
            ).label("bonus_paid"),
        )
        .join(Referral, Referral.created_by_admin_id == User.id)
        .outerjoin(Clinic, Clinic.id == User.clinic_id)
        .outerjoin(Bonus, Bonus.referral_id == Referral.id)
        .where(
            User.role == UserRole.ADMIN,
            Referral.created_at >= dt_from,
            Referral.created_at < dt_to,
            *([Referral.tenant_id == _tenant_id] if _tenant_id else []),
        )
        .group_by(User.id, User.full_name, Clinic.name)
        .order_by(func.count(Referral.id).filter(Referral.status == ReferralStatus.CONFIRMED).desc())
        .limit(limit)
    )

    result = []
    for i, r in enumerate(q.all()):
        result.append({
            "rank":           i + 1,
            "user_id":        str(r.id),
            "full_name":      r.full_name or "—",
            "clinic_name":    r.clinic_name or "—",
            "total":          r.total,
            "confirmed":      r.confirmed,
            "conversion_pct": round(r.confirmed / r.total * 100, 1) if r.total else 0.0,
            "bonus_accrued":  float(r.bonus_accrued),
            "bonus_paid":     float(r.bonus_paid),
        })
    return {"period": {"from": d_from.isoformat(), "to": d_to.isoformat()}, "items": result}


# ── 6. Сравнение клиник ───────────────────────────────────────────────────────

@router.get("/clinics", dependencies=[_feat, _mgr])
async def analytics_clinics(
    days: int = Query(30, ge=1, le=365),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Сравнение клиник: направления, конверсия, объём бонусов.
    """
    d_from, d_to = _date_range(days, from_date, to_date)
    # Tenant isolation
    _tenant_id = current_user.tenant_id
    dt_from = _dt(d_from)
    dt_to   = _dt(d_to) + timedelta(days=1)

    q = await db.execute(
        select(
            Clinic.id,
            Clinic.name,
            func.count(Referral.id).label("total"),
            func.count(Referral.id).filter(
                Referral.status == ReferralStatus.CONFIRMED
            ).label("confirmed"),
            func.coalesce(func.sum(Bonus.amount), 0).label("bonuses"),
            func.coalesce(
                func.sum(Bonus.amount).filter(Bonus.status == BonusStatus.PAID), 0
            ).label("bonuses_paid"),
        )
        .join(Referral, Referral.from_clinic_id == Clinic.id)
        .outerjoin(Bonus, Bonus.referral_id == Referral.id)
        .where(Referral.created_at >= dt_from,
            *([Referral.tenant_id == _tenant_id] if _tenant_id else []), Referral.created_at < dt_to)
        .group_by(Clinic.id, Clinic.name)
        .order_by(func.count(Referral.id).desc())
    )

    items = []
    for i, r in enumerate(q.all()):
        items.append({
            "rank":           i + 1,
            "clinic_id":      str(r.id),
            "name":           r.name,
            "total":          r.total,
            "confirmed":      r.confirmed,
            "conversion_pct": round(r.confirmed / r.total * 100, 1) if r.total else 0.0,
            "bonuses":        float(r.bonuses),
            "bonuses_paid":   float(r.bonuses_paid),
        })
    return {"period": {"from": d_from.isoformat(), "to": d_to.isoformat()}, "items": items}


# ── 7. Тренд баланса из реестра (enterprise) ──────────────────────────────────

@router.get("/ledger-trend", dependencies=[Depends(require_feature("financial_ledger")), _mgr])
async def analytics_ledger_trend(
    user_id: uuid.UUID = Query(...),
    days: int = Query(30, ge=7, le=365),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Накопительный баланс пользователя по дням (из ledger_entries).
    Только для тарифа enterprise (financial_ledger feature).
    """
    d_from = date.today() - timedelta(days=days - 1)
    dt_from = _dt(d_from)

    q = await db.execute(
        select(
            cast(LedgerEntry.created_at, Date).label("day"),
            func.sum(LedgerEntry.amount).label("daily_sum"),
        )
        .where(LedgerEntry.user_id == user_id, LedgerEntry.created_at >= dt_from)
        .group_by("day")
        .order_by("day")
    )
    rows = {r.day: float(r.daily_sum) for r in q.all()}

    # Накопительный итог
    series = []
    running = 0.0
    for i in range(days):
        d = d_from + timedelta(days=i)
        running += rows.get(d, 0.0)
        series.append({"date": d.isoformat(), "daily": rows.get(d, 0.0), "balance": round(running, 2)})

    return {"user_id": str(user_id), "series": series}
