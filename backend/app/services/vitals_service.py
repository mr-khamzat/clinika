"""
Сервис витальных показателей пациента.

Возможности:
- add_vital            — добавить одно измерение (ручной ввод или из бриджа).
- bulk_import          — массовая идемпотентная вставка (для Apple Health sync).
- get_latest_per_metric — последние значения по каждой метрике (для KPI-карточек).
- get_series           — временной ряд по конкретной метрике за N дней.
"""
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Iterable

from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.patient_vital import PatientVital
from app.utils.phone import normalize_phone


# Допустимые метрики — фронт строго к ним привязан.
ALLOWED_METRICS: set[str] = {
    "heart_rate",
    "blood_pressure_sys",
    "blood_pressure_dia",
    "spo2",
    "glucose",
    "weight_kg",
    "height_cm",
    "temperature",
    "steps",
    "sleep_minutes",
    "hrv",
}

# Источники (whitelist)
ALLOWED_SOURCES: set[str] = {"manual", "apple_health", "google_fit", "device"}


def _coerce_value(v) -> Decimal | None:
    """Безопасно привести значение к Decimal."""
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except Exception:
        return None


def _parse_dt(v) -> datetime | None:
    """Принять datetime либо ISO-строку (`2026-05-05T12:00:00Z`)."""
    if isinstance(v, datetime):
        return v.replace(tzinfo=None) if v.tzinfo else v
    if isinstance(v, str) and v:
        s = v.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(s)
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        except ValueError:
            return None
    return None


async def add_vital(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    patient_phone: str,
    metric: str,
    value_num=None,
    value_extra: dict | None = None,
    unit: str | None = None,
    measured_at: datetime | None = None,
    source: str = "manual",
    device_info: str | None = None,
    note: str | None = None,
) -> PatientVital:
    """Добавить одно измерение. Возвращает созданную запись."""
    if metric not in ALLOWED_METRICS:
        raise ValueError(f"Неизвестная метрика: {metric}")
    if source not in ALLOWED_SOURCES:
        source = "manual"

    phone_n = normalize_phone(patient_phone)
    measured_at = measured_at or datetime.utcnow()

    rec = PatientVital(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        patient_phone=phone_n,
        metric=metric,
        value_num=_coerce_value(value_num),
        value_extra=value_extra,
        unit=unit,
        measured_at=measured_at,
        source=source,
        device_info=device_info,
        note=note,
        created_at=datetime.utcnow(),
    )
    db.add(rec)
    await db.flush()
    return rec


async def bulk_import(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    patient_phone: str,
    items: Iterable[dict],
    source: str = "apple_health",
) -> dict:
    """
    Массовая идемпотентная вставка.
    Дедуп по (tenant_id, patient_phone, metric, measured_at) — повторная синхронизация
    одних и тех же сэмплов не создаёт дубликатов.

    items: [{metric, value, unit, measured_at, device, extra?}]
    Возвращает: {"inserted": N, "skipped": M, "errors": K}
    """
    if source not in ALLOWED_SOURCES:
        source = "apple_health"

    phone_n = normalize_phone(patient_phone)
    items_list = list(items or [])

    # Сначала валидируем и нормализуем входные сэмплы.
    norm: list[dict] = []
    errors = 0
    for it in items_list:
        try:
            metric = it.get("metric")
            if metric not in ALLOWED_METRICS:
                errors += 1
                continue
            mat = _parse_dt(it.get("measured_at"))
            if not mat:
                errors += 1
                continue
            norm.append({
                "metric": metric,
                "value": _coerce_value(it.get("value")),
                "unit": (it.get("unit") or None),
                "measured_at": mat,
                "device": (it.get("device") or None),
                "extra": it.get("extra") if isinstance(it.get("extra"), dict) else None,
                "note": it.get("note"),
            })
        except Exception:
            errors += 1

    if not norm:
        return {"inserted": 0, "skipped": 0, "errors": errors}

    # Загружаем уже существующие ключи дедупа одним запросом.
    metrics_set = list({n["metric"] for n in norm})
    times_set = [n["measured_at"] for n in norm]
    cond = and_(
        PatientVital.patient_phone == phone_n,
        PatientVital.metric.in_(metrics_set),
        PatientVital.measured_at.in_(times_set),
    )
    if tenant_id is not None:
        cond = and_(cond, PatientVital.tenant_id == tenant_id)

    existing = (await db.execute(
        select(PatientVital.metric, PatientVital.measured_at).where(cond)
    )).all()
    existing_keys = {(m, t) for (m, t) in existing}

    inserted = 0
    skipped = 0
    for n in norm:
        key = (n["metric"], n["measured_at"])
        if key in existing_keys:
            skipped += 1
            continue
        existing_keys.add(key)  # на случай дублей внутри самого батча
        db.add(PatientVital(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            patient_phone=phone_n,
            metric=n["metric"],
            value_num=n["value"],
            value_extra=n["extra"],
            unit=n["unit"],
            measured_at=n["measured_at"],
            source=source,
            device_info=n["device"],
            note=n["note"],
            created_at=datetime.utcnow(),
        ))
        inserted += 1

    await db.flush()
    return {"inserted": inserted, "skipped": skipped, "errors": errors}


async def get_latest_per_metric(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    patient_phone: str,
) -> dict[str, PatientVital]:
    """
    Последняя запись по каждой метрике для пациента.
    Возвращает {metric: PatientVital}.
    Реализовано через DISTINCT ON (Postgres).
    """
    phone_n = normalize_phone(patient_phone)
    cond = [PatientVital.patient_phone == phone_n]
    if tenant_id is not None:
        cond.append(PatientVital.tenant_id == tenant_id)

    q = (
        select(PatientVital)
        .where(*cond)
        .order_by(PatientVital.metric, desc(PatientVital.measured_at))
        .distinct(PatientVital.metric)
    )
    rows = (await db.execute(q)).scalars().all()
    return {r.metric: r for r in rows}


async def get_series(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    patient_phone: str,
    metric: str,
    days: int = 30,
) -> list[PatientVital]:
    """Временной ряд по метрике за N дней (по возрастанию времени)."""
    if metric not in ALLOWED_METRICS:
        return []
    phone_n = normalize_phone(patient_phone)
    since = datetime.utcnow() - timedelta(days=max(1, min(days, 365)))

    cond = [
        PatientVital.patient_phone == phone_n,
        PatientVital.metric == metric,
        PatientVital.measured_at >= since,
    ]
    if tenant_id is not None:
        cond.append(PatientVital.tenant_id == tenant_id)

    q = (
        select(PatientVital)
        .where(*cond)
        .order_by(PatientVital.measured_at.asc())
        .limit(2000)
    )
    return list((await db.execute(q)).scalars().all())
