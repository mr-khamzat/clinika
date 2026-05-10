"""
KPI-дашборд франшизы.

Глава 3 ROADMAP: агрегаты по всей франшизе с дельтой к предыдущему периоду.

Возвращает:
  - revenue_total / revenue_growth_pct
  - appointments_count / appointments_growth_pct
  - new_patients / returning_patients
  - referrals_in / referrals_out / referrals_conversion_pct
  - bonuses_paid_total / bonuses_avg_per_referral
  - top_clinic_by_revenue / top_doctor_by_appointments
  - ltv_avg / ltv_median
  - active_tenants / trial_tenants / expiring_subscriptions_count
  - module_subscriptions_total / mrr_estimate

Кеш Redis 5 минут (ключ: f"kpi:{franchise_id}:{range}").
"""
from __future__ import annotations

import json
import logging
import statistics
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

import redis.asyncio as aioredis
from sqlalchemy import and_, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.billing import SubStatus, Subscription
from app.models.bonus import Bonus, BonusStatus
from app.models.clinic import Clinic
from app.models.commercial import ModuleStatus, TenantModuleSubscription
from app.models.doctor import Appointment, Doctor
from app.models.ltv import PatientLtvSnapshot
from app.models.referral import Referral, ReferralStatus
from app.models.tenant import Tenant

logger = logging.getLogger("kpi_service")

CACHE_TTL = 300  # 5 минут
RANGES_DAYS = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}


async def _get_redis() -> aioredis.Redis | None:
    try:
        return aioredis.from_url(settings.redis_url, decode_responses=True)
    except Exception as e:
        logger.warning("redis недоступен: %s", e)
        return None


async def _cached_get(key: str) -> dict | None:
    r = await _get_redis()
    if not r:
        return None
    try:
        raw = await r.get(key)
        if raw:
            return json.loads(raw)
    except Exception as e:
        logger.warning("redis get %s: %s", key, e)
    finally:
        try:
            await r.aclose()
        except Exception:
            pass
    return None


async def _cached_set(key: str, value: dict, ttl: int = CACHE_TTL) -> None:
    r = await _get_redis()
    if not r:
        return
    try:
        await r.set(key, json.dumps(value, default=str), ex=ttl)
    except Exception as e:
        logger.warning("redis set %s: %s", key, e)
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


def _pct_change(curr: float, prev: float) -> float:
    """Безопасный расчёт процента изменения."""
    if prev <= 0:
        return 100.0 if curr > 0 else 0.0
    return round(((curr - prev) / prev) * 100.0, 2)


async def _franchise_tenants(db: AsyncSession, franchise_id: uuid.UUID) -> list[uuid.UUID]:
    rows = (
        await db.execute(
            select(Tenant.id).where(
                Tenant.franchise_id == franchise_id, Tenant.is_active.is_(True)
            )
        )
    ).all()
    return [r[0] for r in rows]


async def _franchise_clinic_ids(db: AsyncSession, tenant_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    if not tenant_ids:
        return []
    rows = (
        await db.execute(
            select(Clinic.id).where(
                Clinic.tenant_id.in_(tenant_ids), Clinic.is_active.is_(True)
            )
        )
    ).all()
    return [r[0] for r in rows]


async def _revenue_in_window(
    db: AsyncSession, clinic_ids: list[uuid.UUID], start: datetime, end: datetime
) -> float:
    if not clinic_ids:
        return 0.0
    val = (
        await db.execute(
            select(func.coalesce(func.sum(Bonus.amount), 0))
            .join(Referral, Referral.id == Bonus.referral_id)
            .where(
                Referral.to_clinic_id.in_(clinic_ids),
                Bonus.created_at >= start,
                Bonus.created_at < end,
                Bonus.status.in_([BonusStatus.PAID, BonusStatus.PENDING]),
            )
        )
    ).scalar()
    return float(val or 0)


async def _appointments_in_window(
    db: AsyncSession, clinic_ids: list[uuid.UUID], start: datetime, end: datetime
) -> int:
    if not clinic_ids:
        return 0
    val = (
        await db.execute(
            select(func.count(Appointment.id)).where(
                Appointment.clinic_id.in_(clinic_ids),
                Appointment.appointment_date >= start.date(),
                Appointment.appointment_date < end.date(),
            )
        )
    ).scalar()
    return int(val or 0)


async def _patients_split(
    db: AsyncSession, clinic_ids: list[uuid.UUID], start: datetime, end: datetime
) -> tuple[int, int]:
    """Возвращает (new, returning).
    new       — пациент, у которого первый Appointment в окне попал в [start, end)
    returning — был хотя бы один Appointment до start.
    """
    if not clinic_ids:
        return (0, 0)

    # Все телефоны с appointments в окне
    phones_in = (
        await db.execute(
            select(distinct(Appointment.patient_phone)).where(
                Appointment.clinic_id.in_(clinic_ids),
                Appointment.appointment_date >= start.date(),
                Appointment.appointment_date < end.date(),
            )
        )
    ).all()
    phones = [p[0] for p in phones_in if p[0]]
    if not phones:
        return (0, 0)

    # Кто из них уже был до start
    prior = (
        await db.execute(
            select(distinct(Appointment.patient_phone)).where(
                Appointment.clinic_id.in_(clinic_ids),
                Appointment.appointment_date < start.date(),
                Appointment.patient_phone.in_(phones),
            )
        )
    ).all()
    prior_set = {p[0] for p in prior if p[0]}
    returning = len(prior_set)
    new = len(phones) - returning
    return (max(new, 0), returning)


async def _referrals_in_out(
    db: AsyncSession, clinic_ids: list[uuid.UUID], start: datetime, end: datetime
) -> tuple[int, int, int]:
    """Возвращает (in, out, confirmed_in_window).
    in   — Referral.to_clinic_id IN clinic_ids
    out  — Referral.from_clinic_id IN clinic_ids
    confirmed — статус CONFIRMED в окне (для conversion)
    """
    if not clinic_ids:
        return (0, 0, 0)
    in_cnt = (
        await db.execute(
            select(func.count(Referral.id)).where(
                Referral.to_clinic_id.in_(clinic_ids),
                Referral.created_at >= start,
                Referral.created_at < end,
            )
        )
    ).scalar() or 0
    out_cnt = (
        await db.execute(
            select(func.count(Referral.id)).where(
                Referral.from_clinic_id.in_(clinic_ids),
                Referral.created_at >= start,
                Referral.created_at < end,
            )
        )
    ).scalar() or 0
    confirmed = (
        await db.execute(
            select(func.count(Referral.id)).where(
                Referral.to_clinic_id.in_(clinic_ids),
                Referral.created_at >= start,
                Referral.created_at < end,
                Referral.status == ReferralStatus.CONFIRMED,
            )
        )
    ).scalar() or 0
    return (int(in_cnt), int(out_cnt), int(confirmed))


async def _bonuses_stats(
    db: AsyncSession, clinic_ids: list[uuid.UUID], start: datetime, end: datetime
) -> tuple[float, float]:
    """Возвращает (paid_total, avg_per_referral). Берём по to_clinic."""
    if not clinic_ids:
        return (0.0, 0.0)
    paid_total = (
        await db.execute(
            select(func.coalesce(func.sum(Bonus.amount), 0))
            .join(Referral, Referral.id == Bonus.referral_id)
            .where(
                Referral.to_clinic_id.in_(clinic_ids),
                Bonus.created_at >= start,
                Bonus.created_at < end,
                Bonus.status == BonusStatus.PAID,
            )
        )
    ).scalar() or 0
    cnt = (
        await db.execute(
            select(func.count(Bonus.id))
            .join(Referral, Referral.id == Bonus.referral_id)
            .where(
                Referral.to_clinic_id.in_(clinic_ids),
                Bonus.created_at >= start,
                Bonus.created_at < end,
                Bonus.status == BonusStatus.PAID,
            )
        )
    ).scalar() or 0
    avg = float(paid_total) / int(cnt) if cnt else 0.0
    return (float(paid_total), round(avg, 2))


async def _top_clinic_by_revenue(
    db: AsyncSession, clinic_ids: list[uuid.UUID], start: datetime, end: datetime
) -> dict[str, Any] | None:
    if not clinic_ids:
        return None
    row = (
        await db.execute(
            select(
                Referral.to_clinic_id,
                Clinic.name,
                func.coalesce(func.sum(Bonus.amount), 0).label("total"),
            )
            .join(Bonus, Bonus.referral_id == Referral.id)
            .join(Clinic, Clinic.id == Referral.to_clinic_id)
            .where(
                Referral.to_clinic_id.in_(clinic_ids),
                Bonus.created_at >= start,
                Bonus.created_at < end,
                Bonus.status.in_([BonusStatus.PAID, BonusStatus.PENDING]),
            )
            .group_by(Referral.to_clinic_id, Clinic.name)
            .order_by(func.sum(Bonus.amount).desc())
            .limit(1)
        )
    ).first()
    if not row:
        return None
    return {"clinic_id": str(row[0]), "clinic_name": row[1], "revenue": float(row[2])}


async def _top_doctor_by_appointments(
    db: AsyncSession, clinic_ids: list[uuid.UUID], start: datetime, end: datetime
) -> dict[str, Any] | None:
    if not clinic_ids:
        return None
    row = (
        await db.execute(
            select(
                Appointment.doctor_id,
                Doctor.full_name,
                func.count(Appointment.id).label("cnt"),
            )
            .join(Doctor, Doctor.id == Appointment.doctor_id)
            .where(
                Appointment.clinic_id.in_(clinic_ids),
                Appointment.appointment_date >= start.date(),
                Appointment.appointment_date < end.date(),
            )
            .group_by(Appointment.doctor_id, Doctor.full_name)
            .order_by(func.count(Appointment.id).desc())
            .limit(1)
        )
    ).first()
    if not row:
        return None
    return {"doctor_id": str(row[0]), "doctor_name": row[1], "appointments": int(row[2])}


async def _ltv_stats(db: AsyncSession, tenant_ids: list[uuid.UUID]) -> tuple[float, float]:
    if not tenant_ids:
        return (0.0, 0.0)
    rows = (
        await db.execute(
            select(PatientLtvSnapshot.ltv_estimate).where(
                PatientLtvSnapshot.tenant_id.in_(tenant_ids)
            )
        )
    ).all()
    vals = [float(r[0]) for r in rows if r[0] is not None]
    if not vals:
        return (0.0, 0.0)
    avg = sum(vals) / len(vals)
    median = statistics.median(vals)
    return (round(avg, 2), round(median, 2))


async def _tenants_status_breakdown(
    db: AsyncSession, tenant_ids: list[uuid.UUID]
) -> tuple[int, int, int]:
    """active_tenants, trial_tenants, expiring_subscriptions_count."""
    if not tenant_ids:
        return (0, 0, 0)
    sub_rows = (
        await db.execute(
            select(Subscription.tenant_id, Subscription.status, Subscription.current_period_end)
            .where(Subscription.tenant_id.in_(tenant_ids))
        )
    ).all()
    active = sum(1 for r in sub_rows if r[1] == SubStatus.ACTIVE)
    trial = sum(1 for r in sub_rows if r[1] == SubStatus.TRIAL)
    today = datetime.utcnow().date()
    expiring = sum(
        1
        for r in sub_rows
        if r[1] == SubStatus.ACTIVE
        and r[2] is not None
        and (r[2] - today).days <= 14
    )
    return (active, trial, expiring)


async def _module_stats(db: AsyncSession, tenant_ids: list[uuid.UUID]) -> tuple[int, float]:
    """Подписки на модули + MRR estimate."""
    if not tenant_ids:
        return (0, 0.0)
    rows = (
        await db.execute(
            select(TenantModuleSubscription.custom_price, TenantModuleSubscription.status)
            .where(TenantModuleSubscription.tenant_id.in_(tenant_ids))
        )
    ).all()
    total = 0
    mrr = 0.0
    for price, st in rows:
        if st in (ModuleStatus.ACTIVE, ModuleStatus.TRIAL, ModuleStatus.GRACE):
            total += 1
            mrr += float(price or 0)

    # Плюс MRR от plan-подписок
    plan_mrr = (
        await db.execute(
            select(func.coalesce(func.sum(Subscription.amount_per_period), 0)).where(
                Subscription.tenant_id.in_(tenant_ids),
                Subscription.status == SubStatus.ACTIVE,
            )
        )
    ).scalar() or 0
    mrr += float(plan_mrr)
    return (total, round(mrr, 2))


async def get_kpi(
    db: AsyncSession, franchise_id: uuid.UUID, range_key: str = "30d"
) -> dict[str, Any]:
    """Главная функция KPI."""
    if range_key not in RANGES_DAYS:
        raise ValueError(f"Invalid range: {range_key}")

    cache_key = f"kpi:{franchise_id}:{range_key}"
    cached = await _cached_get(cache_key)
    if cached:
        return cached

    days = RANGES_DAYS[range_key]
    end = datetime.utcnow()
    start = end - timedelta(days=days)
    prev_start = start - timedelta(days=days)

    tenant_ids = await _franchise_tenants(db, franchise_id)
    clinic_ids = await _franchise_clinic_ids(db, tenant_ids)

    # Текущий период
    revenue = await _revenue_in_window(db, clinic_ids, start, end)
    revenue_prev = await _revenue_in_window(db, clinic_ids, prev_start, start)
    appts = await _appointments_in_window(db, clinic_ids, start, end)
    appts_prev = await _appointments_in_window(db, clinic_ids, prev_start, start)
    new_patients, returning_patients = await _patients_split(db, clinic_ids, start, end)
    ref_in, ref_out, ref_confirmed = await _referrals_in_out(db, clinic_ids, start, end)
    conversion = (ref_confirmed / ref_in * 100.0) if ref_in else 0.0
    bonuses_paid, bonus_avg = await _bonuses_stats(db, clinic_ids, start, end)
    top_clinic = await _top_clinic_by_revenue(db, clinic_ids, start, end)
    top_doctor = await _top_doctor_by_appointments(db, clinic_ids, start, end)
    ltv_avg, ltv_median = await _ltv_stats(db, tenant_ids)
    active_t, trial_t, expiring_subs = await _tenants_status_breakdown(db, tenant_ids)
    module_total, mrr = await _module_stats(db, tenant_ids)

    payload: dict[str, Any] = {
        "range": range_key,
        "period": {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "previous_start": prev_start.isoformat(),
        },
        "tenants_total": len(tenant_ids),
        "clinics_total": len(clinic_ids),
        "revenue_total": round(revenue, 2),
        "revenue_growth_pct": _pct_change(revenue, revenue_prev),
        "appointments_count": appts,
        "appointments_growth_pct": _pct_change(appts, appts_prev),
        "new_patients": new_patients,
        "returning_patients": returning_patients,
        "referrals_in": ref_in,
        "referrals_out": ref_out,
        "referrals_conversion_pct": round(conversion, 2),
        "bonuses_paid_total": round(bonuses_paid, 2),
        "bonuses_avg_per_referral": bonus_avg,
        "top_clinic_by_revenue": top_clinic,
        "top_doctor_by_appointments": top_doctor,
        "ltv_avg": ltv_avg,
        "ltv_median": ltv_median,
        "active_tenants": active_t,
        "trial_tenants": trial_t,
        "expiring_subscriptions_count": expiring_subs,
        "module_subscriptions_total": module_total,
        "mrr_estimate": mrr,
        "generated_at": datetime.utcnow().isoformat(),
    }

    await _cached_set(cache_key, payload, CACHE_TTL)
    return payload
