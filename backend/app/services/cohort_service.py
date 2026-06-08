"""
Cohort-анализ клиник франшизы.

Глава 3 ROADMAP: премиум-аналитика для franchise_owner.

Идея:
  Берём все клиники франшизы (через Tenant.franchise_id → Clinic.tenant_id),
  рассчитываем выбранную метрику по месяцам за последние 12 месяцев и
  возвращаем 2D-матрицу + ранги + перцентили.

Метрики:
  revenue       — сумма Bonus.amount (paid+pending) по клинике-получателю
  appointments  — количество Appointment по клинике
  referrals     — количество Referral по from_clinic
  patients      — количество уникальных patient_phone в Appointment

Кеш Redis 10 минут (ключ: f"cohort:{franchise_id}:{period}:{metric}").
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
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.bonus import Bonus, BonusStatus
from app.models.clinic import Clinic
from app.models.doctor import Appointment
from app.models.referral import Referral
from app.models.tenant import Tenant

logger = logging.getLogger("cohort_service")

CACHE_TTL = 600  # 10 минут
ALLOWED_METRICS = ("revenue", "appointments", "referrals", "patients")


def _ym(d: datetime) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _last_n_months(n: int = 12) -> list[str]:
    """Список ['YYYY-MM', ...] за последние n месяцев включая текущий."""
    today = datetime.utcnow()
    out: list[str] = []
    y, m = today.year, today.month
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(out))


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


async def _list_clinics_of_franchise(
    db: AsyncSession, franchise_id: uuid.UUID
) -> list[tuple[uuid.UUID, str, str | None, uuid.UUID | None]]:
    """Все клиники тенантов франшизы. Возвращает (clinic_id, clinic_name, tenant_slug, tenant_id)."""
    rows = (
        await db.execute(
            select(Clinic.id, Clinic.name, Tenant.slug, Tenant.id)
            .join(Tenant, Tenant.id == Clinic.tenant_id)
            .where(Tenant.franchise_id == franchise_id, Clinic.is_active.is_(True))
            .order_by(Clinic.name)
        )
    ).all()
    return [(r[0], r[1], r[2], r[3]) for r in rows]


async def _aggregate_revenue(
    db: AsyncSession, clinic_ids: list[uuid.UUID], months: list[str]
) -> dict[uuid.UUID, dict[str, float]]:
    """Sum(Bonus.amount) по to_clinic за месяц."""
    if not clinic_ids:
        return {}
    start_year, start_month = months[0].split("-")
    start_dt = datetime(int(start_year), int(start_month), 1)
    rows = (
        await db.execute(
            select(
                Referral.to_clinic_id,
                func.to_char(Bonus.created_at, "YYYY-MM").label("ym"),
                func.coalesce(func.sum(Bonus.amount), 0).label("total"),
            )
            .join(Referral, Referral.id == Bonus.referral_id)
            .where(
                Referral.to_clinic_id.in_(clinic_ids),
                Bonus.created_at >= start_dt,
                Bonus.status.in_([BonusStatus.PAID, BonusStatus.PENDING]),
            )
            .group_by(Referral.to_clinic_id, "ym")
        )
    ).all()
    out: dict[uuid.UUID, dict[str, float]] = {cid: {m: 0.0 for m in months} for cid in clinic_ids}
    for cid, ym, total in rows:
        if cid in out and ym in out[cid]:
            out[cid][ym] = float(total or 0)
    return out


async def _aggregate_appointments(
    db: AsyncSession, clinic_ids: list[uuid.UUID], months: list[str]
) -> dict[uuid.UUID, dict[str, float]]:
    """Count(Appointment) по clinic_id и месяцу appointment_date."""
    if not clinic_ids:
        return {}
    start_year, start_month = months[0].split("-")
    start_dt = datetime(int(start_year), int(start_month), 1).date()
    rows = (
        await db.execute(
            select(
                Appointment.clinic_id,
                func.to_char(Appointment.appointment_date, "YYYY-MM").label("ym"),
                func.count(Appointment.id).label("cnt"),
            )
            .where(
                Appointment.clinic_id.in_(clinic_ids),
                Appointment.appointment_date >= start_dt,
            )
            .group_by(Appointment.clinic_id, "ym")
        )
    ).all()
    out: dict[uuid.UUID, dict[str, float]] = {cid: {m: 0.0 for m in months} for cid in clinic_ids}
    for cid, ym, cnt in rows:
        if cid in out and ym in out[cid]:
            out[cid][ym] = float(cnt or 0)
    return out


async def _aggregate_referrals(
    db: AsyncSession, clinic_ids: list[uuid.UUID], months: list[str]
) -> dict[uuid.UUID, dict[str, float]]:
    """Count(Referral) по from_clinic_id и месяцу created_at."""
    if not clinic_ids:
        return {}
    start_year, start_month = months[0].split("-")
    start_dt = datetime(int(start_year), int(start_month), 1)
    rows = (
        await db.execute(
            select(
                Referral.from_clinic_id,
                func.to_char(Referral.created_at, "YYYY-MM").label("ym"),
                func.count(Referral.id).label("cnt"),
            )
            .where(
                Referral.from_clinic_id.in_(clinic_ids),
                Referral.created_at >= start_dt,
            )
            .group_by(Referral.from_clinic_id, "ym")
        )
    ).all()
    out: dict[uuid.UUID, dict[str, float]] = {cid: {m: 0.0 for m in months} for cid in clinic_ids}
    for cid, ym, cnt in rows:
        if cid in out and ym in out[cid]:
            out[cid][ym] = float(cnt or 0)
    return out


async def _aggregate_patients(
    db: AsyncSession, clinic_ids: list[uuid.UUID], months: list[str]
) -> dict[uuid.UUID, dict[str, float]]:
    """Distinct patient_phone из Appointment по clinic_id и месяцу."""
    # TODO(#2 PHI): после миграции shadow-колонок заменить
    # func.distinct(Appointment.patient_phone) на Appointment.patient_phone_hash
    # (детерминированный blind-index) — счёт уникальных пациентов не меняется,
    # но perестаём читать plaintext. Кат вместе с миграцией, не раньше.
    if not clinic_ids:
        return {}
    start_year, start_month = months[0].split("-")
    start_dt = datetime(int(start_year), int(start_month), 1).date()
    rows = (
        await db.execute(
            select(
                Appointment.clinic_id,
                func.to_char(Appointment.appointment_date, "YYYY-MM").label("ym"),
                func.count(func.distinct(Appointment.patient_phone)).label("cnt"),
            )
            .where(
                Appointment.clinic_id.in_(clinic_ids),
                Appointment.appointment_date >= start_dt,
            )
            .group_by(Appointment.clinic_id, "ym")
        )
    ).all()
    out: dict[uuid.UUID, dict[str, float]] = {cid: {m: 0.0 for m in months} for cid in clinic_ids}
    for cid, ym, cnt in rows:
        if cid in out and ym in out[cid]:
            out[cid][ym] = float(cnt or 0)
    return out


async def get_cohort(
    db: AsyncSession,
    franchise_id: uuid.UUID,
    metric: str = "revenue",
    period: str = "monthly",
) -> dict[str, Any]:
    """Главная функция: возвращает структуру для эндпоинта /admin/analytics/cohort-clinics."""
    if metric not in ALLOWED_METRICS:
        raise ValueError(f"Unknown metric: {metric}")

    cache_key = f"cohort:{franchise_id}:{period}:{metric}"
    cached = await _cached_get(cache_key)
    if cached:
        return cached

    months = _last_n_months(12)
    clinics = await _list_clinics_of_franchise(db, franchise_id)
    clinic_ids = [c[0] for c in clinics]
    clinic_meta = {
        c[0]: {"clinic_name": c[1], "tenant_slug": c[2], "tenant_id": str(c[3]) if c[3] else None}
        for c in clinics
    }

    if metric == "revenue":
        agg = await _aggregate_revenue(db, clinic_ids, months)
    elif metric == "appointments":
        agg = await _aggregate_appointments(db, clinic_ids, months)
    elif metric == "referrals":
        agg = await _aggregate_referrals(db, clinic_ids, months)
    else:  # patients
        agg = await _aggregate_patients(db, clinic_ids, months)

    # Текущий месяц для рангов
    current_month = months[-1]
    current_values: list[tuple[uuid.UUID, float]] = [
        (cid, agg[cid][current_month]) for cid in clinic_ids
    ]
    current_values.sort(key=lambda x: x[1], reverse=True)
    rank_map = {cid: idx + 1 for idx, (cid, _) in enumerate(current_values)}

    # Перцентили по текущему месяцу
    flat_current = [v for _, v in current_values]
    percentiles = {"p25": 0.0, "p50": 0.0, "p75": 0.0}
    if flat_current:
        flat_sorted = sorted(flat_current)
        percentiles = {
            "p25": flat_sorted[max(0, int(0.25 * (len(flat_sorted) - 1)))],
            "p50": (statistics.median(flat_sorted) if flat_sorted else 0.0),
            "p75": flat_sorted[min(len(flat_sorted) - 1, int(0.75 * (len(flat_sorted) - 1)))],
        }

    # Среднее по когорте (текущий месяц) — для growth_vs_cohort
    cohort_avg_current = (sum(flat_current) / len(flat_current)) if flat_current else 0.0

    clinics_payload: list[dict[str, Any]] = []
    for cid in clinic_ids:
        meta = clinic_meta[cid]
        values = [agg[cid][m] for m in months]
        cur = values[-1]
        growth = 0.0
        if cohort_avg_current > 0:
            growth = round(((cur - cohort_avg_current) / cohort_avg_current) * 100.0, 1)
        clinics_payload.append(
            {
                "clinic_id": str(cid),
                "clinic_name": meta["clinic_name"],
                "tenant_slug": meta["tenant_slug"],
                "tenant_id": meta["tenant_id"],
                "values": [round(v, 2) for v in values],
                "rank_current": rank_map.get(cid, 0),
                "growth_vs_cohort": growth,
            }
        )
    # Сортируем клиники по рангу (лучшие сверху)
    clinics_payload.sort(key=lambda x: x["rank_current"])

    payload: dict[str, Any] = {
        "cohort_size": len(clinics),
        "period": period,
        "metric": metric,
        "months": months,
        "clinics": clinics_payload,
        "percentiles": {k: round(v, 2) for k, v in percentiles.items()},
        "cohort_avg_current": round(cohort_avg_current, 2),
        "generated_at": datetime.utcnow().isoformat(),
    }

    await _cached_set(cache_key, payload, CACHE_TTL)
    return payload
