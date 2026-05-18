"""Сегменты пациентов: фильтр-конструктор + резолвинг → patient_ids.

Phase E2 — CRM-hub. Используется патиент-engagement-сегментами в
backend/app/routers/patient_engagement_segments.py.

filter_json — JSONB dict со следующими поддерживаемыми ключами (см.
docstring resolve_segment_filter ниже). Все ключи опциональные, AND-комбинация.
"""
from datetime import datetime, timedelta
from uuid import UUID
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.patient_account import PatientAccount
from app.models.engagement import PatientSegment, PatientTag


def _date_to_range(days: int) -> datetime:
    """Возвращает datetime, который был N дней назад от текущего момента."""
    return datetime.utcnow() - timedelta(days=days)


async def resolve_segment_filter(
    db: AsyncSession, tenant_id: UUID, f: dict
) -> list[str]:
    """Резолвит filter_json в список patient_id (str).

    Поддерживаемые ключи в filter_json:
    - created_after_days, created_before_days (число дней назад)
    - last_seen_within_days, last_seen_after_days_ago (для churn)
    - login_count_min, login_count_max
    - birthday_in_next_days (для ДР-сегмента)
    - tags: ["VIP", ...] — AND-match с тегами этого тенанта
    - has_appointments_in_tenant: true/false
    - marketing_opt_in: true/false
    - city: string (зарезервировано, пока no-op — city в PatientAccount нет)

    Возвращает массив строк patient_id.
    """
    f = f or {}
    stmt = select(PatientAccount.id, PatientAccount.phone)
    conds = []

    if f.get("created_after_days") is not None:
        conds.append(
            PatientAccount.created_at >= _date_to_range(int(f["created_after_days"]))
        )
    if f.get("created_before_days") is not None:
        conds.append(
            PatientAccount.created_at < _date_to_range(int(f["created_before_days"]))
        )
    if f.get("last_seen_within_days") is not None:
        conds.append(
            PatientAccount.last_seen_at
            >= _date_to_range(int(f["last_seen_within_days"]))
        )
    if f.get("last_seen_after_days_ago") is not None:
        conds.append(
            PatientAccount.last_seen_at
            < _date_to_range(int(f["last_seen_after_days_ago"]))
        )
    if f.get("login_count_min") is not None:
        conds.append(PatientAccount.login_count >= int(f["login_count_min"]))
    if f.get("login_count_max") is not None:
        conds.append(PatientAccount.login_count <= int(f["login_count_max"]))
    if f.get("marketing_opt_in") is not None:
        conds.append(PatientAccount.marketing_opt_in == bool(f["marketing_opt_in"]))
    if f.get("birthday_in_next_days"):
        n = int(f["birthday_in_next_days"])
        # Хак для PostgreSQL: совпадение месяца + день в диапазоне [сегодня; сегодня+N]
        conds.append(
            text(
                f"""
            (birth_date IS NOT NULL AND
             EXTRACT(MONTH FROM birth_date) = EXTRACT(MONTH FROM CURRENT_DATE)
             AND EXTRACT(DAY FROM birth_date)
                 BETWEEN EXTRACT(DAY FROM CURRENT_DATE)
                     AND EXTRACT(DAY FROM CURRENT_DATE) + {n})
        """
            )
        )

    if conds:
        stmt = stmt.where(*conds)
    rows = (await db.execute(stmt)).all()
    pa_ids = [str(r.id) for r in rows]

    # Фильтр по тегам (если задан) — пересечение
    if f.get("tags"):
        tag_filter_q = await db.execute(
            select(PatientTag.patient_id)
            .where(
                PatientTag.tenant_id == tenant_id,
                PatientTag.tag.in_(f["tags"]),
            )
            .distinct()
        )
        tag_pa_ids = {str(x) for x in tag_filter_q.scalars().all()}
        pa_ids = [pid for pid in pa_ids if pid in tag_pa_ids]

    # Фильтр has_appointments_in_tenant — оставляем только тех, у кого есть
    # хотя бы один appointment в этом тенанте (по patient_phone)
    if f.get("has_appointments_in_tenant") is True and pa_ids:
        appt_q = await db.execute(
            text(
                """
            SELECT DISTINCT pa.id FROM patient_accounts pa
            WHERE pa.id::text = ANY(:pa_ids)
              AND EXISTS (
                SELECT 1 FROM appointments a
                WHERE a.tenant_id = :tid AND a.patient_phone = pa.phone
              )
            """
            ),
            {"tid": str(tenant_id), "pa_ids": pa_ids},
        )
        with_appts = {str(r[0]) for r in appt_q}
        pa_ids = [pid for pid in pa_ids if pid in with_appts]

    return pa_ids


async def resolve_segment(db: AsyncSession, segment: PatientSegment) -> list[str]:
    """Резолвит сегмент.

    Для is_dynamic=True → пересчитывает filter_json через resolve_segment_filter.
    Для is_dynamic=False → возвращает snapshot_patient_ids как есть.
    """
    if segment.is_dynamic:
        return await resolve_segment_filter(
            db, segment.tenant_id, segment.filter_json or {}
        )
    return list(segment.snapshot_patient_ids or [])
