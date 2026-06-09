"""Cost Attribution Service — оценочная стоимость тенанта для платформы.

Сигналы:
  - storage_mb:        SUM(size_bytes)/1MB по patient_documents + call_recording
                       (если таблиц нет — 0).
  - api_requests:      SUM(requests_count) из quota_usage за период.
  - calls_minutes:     SUM(duration_seconds)/60 из call_recording за период.
  - db_rows_estimate:  COUNT по основным таблицам тенанта
                       (appointments + patient_accounts + audit_log).

Тарифы (захардкодены пока, потом унесём в settings):
    STORAGE_RUB_PER_MB    = 0.5
    API_RUB_PER_REQUEST   = 0.001
    CALLS_RUB_PER_MINUTE  = 0.5

period — date (1-е число месяца). Например 2026-05-01 значит «за май 2026».
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost_attribution import TenantCostSnapshot
from app.models.tenant import Tenant

log = logging.getLogger(__name__)


# ─── тарифы (в рублях) ──────────────────────────────────────────────────────

STORAGE_RUB_PER_MB = Decimal("0.5")
API_RUB_PER_REQUEST = Decimal("0.001")
CALLS_RUB_PER_MINUTE = Decimal("0.5")


# ─── helpers ────────────────────────────────────────────────────────────────


def _period_bounds(period: date) -> tuple[date, date]:
    """Возвращает (start, next_month_start) для аккуратного фильтра по месяцу."""
    start = period.replace(day=1)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


async def _table_exists(db: AsyncSession, table_name: str) -> bool:
    try:
        res = await db.execute(
            text("SELECT to_regclass(:t) AS r"),
            {"t": f"public.{table_name}"},
        )
        return res.scalar() is not None
    except Exception:  # pragma: no cover
        return False


async def _storage_mb(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    """Суммарный объём в МБ по uploads-таблицам тенанта.

    Используем patient_documents.size_bytes и call_recording.file_size_bytes.
    Эти таблицы tenant-изолированы (есть колонка tenant_id).
    """
    total_bytes = 0
    for sql in (
        "SELECT COALESCE(SUM(size_bytes), 0) FROM patient_documents WHERE tenant_id = :tid",
        "SELECT COALESCE(SUM(file_size_bytes), 0) FROM call_recordings WHERE tenant_id = :tid",
    ):
        # Имена таблиц могут меняться — заворачиваем в try.
        try:
            res = await db.execute(text(sql), {"tid": str(tenant_id)})
            total_bytes += int(res.scalar() or 0)
        except ProgrammingError:
            continue
        except Exception:
            continue
    return total_bytes // (1024 * 1024)


async def _api_requests(
    db: AsyncSession, tenant_id: uuid.UUID, period: date
) -> int:
    """SUM(requests_count) из quota_usage за месяц period."""
    if not await _table_exists(db, "quota_usage"):
        return 0
    start, end = _period_bounds(period)
    try:
        res = await db.execute(
            text(
                "SELECT COALESCE(SUM(requests_count), 0) FROM quota_usage "
                "WHERE tenant_id = :tid AND period >= :start AND period < :end"
            ),
            {"tid": str(tenant_id), "start": start, "end": end},
        )
        return int(res.scalar() or 0)
    except ProgrammingError:
        return 0


async def _calls_minutes(
    db: AsyncSession, tenant_id: uuid.UUID, period: date
) -> int:
    """SUM(duration_seconds)/60 из call_recordings за месяц period."""
    if not await _table_exists(db, "call_recordings"):
        return 0
    start, end = _period_bounds(period)
    try:
        res = await db.execute(
            text(
                "SELECT COALESCE(SUM(duration_seconds), 0) FROM call_recordings "
                "WHERE tenant_id = :tid AND created_at >= :start AND created_at < :end"
            ),
            {"tid": str(tenant_id), "start": start, "end": end},
        )
        secs = int(res.scalar() or 0)
        return secs // 60
    except ProgrammingError:
        return 0


async def _db_rows_estimate(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    """COUNT по 3 главным таблицам тенанта (грубая оценка нагрузки)."""
    total = 0
    for sql in (
        "SELECT COUNT(*) FROM appointments WHERE tenant_id = :tid",
        "SELECT COUNT(*) FROM audit_log WHERE tenant_id = :tid",
        "SELECT COUNT(*) FROM users WHERE tenant_id = :tid",
    ):
        try:
            res = await db.execute(text(sql), {"tid": str(tenant_id)})
            total += int(res.scalar() or 0)
        except ProgrammingError:
            continue
        except Exception:
            continue
    return total


def _calc_est_cost(storage_mb: int, api_requests: int, calls_minutes: int) -> Decimal:
    """est_cost_rub = тарифы * объёмы."""
    return (
        Decimal(storage_mb) * STORAGE_RUB_PER_MB
        + Decimal(api_requests) * API_RUB_PER_REQUEST
        + Decimal(calls_minutes) * CALLS_RUB_PER_MINUTE
    ).quantize(Decimal("0.01"))


# ─── публичные функции ────────────────────────────────────────────────────


async def compute_costs(
    db: AsyncSession, tenant_id: uuid.UUID, period: date
) -> dict:
    """Считает компоненты стоимости + est_cost_rub для одного тенанта за период.

    Возвращает dict:
        {
            "storage_mb":        int,
            "api_requests":      int,
            "db_rows_estimate":  int,
            "calls_minutes":     int,
            "est_cost_rub":      Decimal,
        }
    """
    storage_mb = await _storage_mb(db, tenant_id)
    api_requests = await _api_requests(db, tenant_id, period)
    db_rows_estimate = await _db_rows_estimate(db, tenant_id)
    calls_minutes = await _calls_minutes(db, tenant_id, period)
    est_cost_rub = _calc_est_cost(storage_mb, api_requests, calls_minutes)
    return {
        "storage_mb": storage_mb,
        "api_requests": api_requests,
        "db_rows_estimate": db_rows_estimate,
        "calls_minutes": calls_minutes,
        "est_cost_rub": est_cost_rub,
    }


async def snapshot_tenant(
    db: AsyncSession, tenant_id: uuid.UUID, period: date
) -> TenantCostSnapshot:
    """Записать (или обновить) snapshot стоимости тенанта за период."""
    data = await compute_costs(db, tenant_id, period)

    # Upsert: ищем существующий снимок этого периода.
    existing_res = await db.execute(
        select(TenantCostSnapshot).where(
            TenantCostSnapshot.tenant_id == tenant_id,
            TenantCostSnapshot.period == period.replace(day=1),
        )
    )
    snap = existing_res.scalar_one_or_none()
    if snap is None:
        snap = TenantCostSnapshot(
            tenant_id=tenant_id,
            period=period.replace(day=1),
            storage_mb=data["storage_mb"],
            api_requests=data["api_requests"],
            db_rows_estimate=data["db_rows_estimate"],
            calls_minutes=data["calls_minutes"],
            est_cost_rub=data["est_cost_rub"],
        )
        db.add(snap)
    else:
        snap.storage_mb = data["storage_mb"]
        snap.api_requests = data["api_requests"]
        snap.db_rows_estimate = data["db_rows_estimate"]
        snap.calls_minutes = data["calls_minutes"]
        snap.est_cost_rub = data["est_cost_rub"]
        snap.captured_at = datetime.utcnow()
    await db.flush()
    return snap


async def snapshot_all(db: AsyncSession, period: date | None = None) -> int:
    """Снимки для всех активных тенантов за period (по умолчанию текущий месяц).

    Возвращает количество тенантов, для которых был успешно создан/обновлён snapshot.
    """
    if period is None:
        period = date.today().replace(day=1)
    res = await db.execute(select(Tenant.id).where(Tenant.is_active.is_(True)))
    tenant_ids: list[uuid.UUID] = [row[0] for row in res.all()]
    created = 0
    for tid in tenant_ids:
        try:
            await snapshot_tenant(db, tid, period)
            created += 1
        except Exception as exc:  # pragma: no cover
            log.exception("cost snapshot failed for tenant=%s: %s", tid, exc)
    await db.commit()
    return created
