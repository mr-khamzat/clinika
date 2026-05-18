"""Генератор подсказок (suggestions) для CRM-hub.

Сканирует пациентов по триггер-условиям и создаёт pending suggestions.
ВАЖНО: не отправляет push автоматически. Только создаёт подсказки для менеджера.
"""
from datetime import datetime, timedelta, date
from typing import Optional
from uuid import UUID
import uuid as uuid_pkg

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.patient_account import PatientAccount
from app.models.engagement import (
    EngagementSuggestion,
    PushTemplate,
    SuggestionKind,
    TemplateCategory,
)


DEFAULT_CONFIG = {
    "welcome_days_after": [1, 3, 7],
    "birthday_days_before": 3,
    "nps_hours_after_visit": 24,
    "anniversary_yearly": True,
    "churn_thresholds_days": [30, 60, 90],
    "max_suggestions_per_run_per_kind": 200,  # safety cap
}


async def _suggestion_exists_today(
    db: AsyncSession, tenant_id: UUID, patient_id: UUID, kind: str
) -> bool:
    """Проверка идемпотентности: не дублируем suggestion для одного pair в один день."""
    today_start = datetime.combine(date.today(), datetime.min.time())
    stmt = (
        select(EngagementSuggestion.id)
        .where(
            EngagementSuggestion.tenant_id == tenant_id,
            EngagementSuggestion.patient_id == patient_id,
            EngagementSuggestion.kind == kind,
            EngagementSuggestion.created_at >= today_start,
        )
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def _default_template_id_for(
    db: AsyncSession, tenant_id: UUID, category: str
) -> Optional[UUID]:
    """Найти is_default=true template для категории; если нет — любой первый."""
    stmt = (
        select(PushTemplate)
        .where(
            PushTemplate.tenant_id == tenant_id,
            PushTemplate.category == category,
        )
        .order_by(PushTemplate.is_default.desc(), PushTemplate.created_at.asc())
        .limit(1)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    return row.id if row else None


async def _create_suggestion(
    db: AsyncSession,
    tenant_id: UUID,
    patient_id: UUID,
    kind: str,
    template_category: Optional[str] = None,
    meta: Optional[dict] = None,
) -> Optional[EngagementSuggestion]:
    """Создать suggestion при условии что сегодня такого ещё нет."""
    if await _suggestion_exists_today(db, tenant_id, patient_id, kind):
        return None
    template_id = None
    if template_category:
        template_id = await _default_template_id_for(db, tenant_id, template_category)
    sug = EngagementSuggestion(
        id=uuid_pkg.uuid4(),
        tenant_id=tenant_id,
        patient_id=patient_id,
        kind=kind,
        template_id=template_id,
        status="pending",
        meta=meta or {},
    )
    db.add(sug)
    return sug


async def generate_welcome_suggestions(
    db: AsyncSession, tenant_id: UUID, cfg: dict
) -> int:
    """Для каждого N в days_after: пациенты, которые зарегистрировались ровно N дней назад."""
    created = 0
    today = date.today()
    for d in cfg.get("welcome_days_after", DEFAULT_CONFIG["welcome_days_after"]):
        from_dt = datetime.combine(today - timedelta(days=d), datetime.min.time())
        to_dt = datetime.combine(today - timedelta(days=d - 1), datetime.min.time())
        rows = (
            await db.execute(
                select(PatientAccount.id)
                .where(
                    PatientAccount.created_at >= from_dt,
                    PatientAccount.created_at < to_dt,
                )
                .limit(cfg.get("max_suggestions_per_run_per_kind", 200))
            )
        ).scalars().all()
        for pid in rows:
            if await _create_suggestion(
                db,
                tenant_id,
                pid,
                SuggestionKind.WELCOME,
                TemplateCategory.WELCOME,
                {"days_after": d},
            ):
                created += 1
    return created


async def generate_birthday_suggestions(
    db: AsyncSession, tenant_id: UUID, cfg: dict
) -> int:
    """Пациенты, у которых ДР в ближайшие N дней (за N дней до)."""
    n = cfg.get("birthday_days_before", DEFAULT_CONFIG["birthday_days_before"])
    rows = (
        await db.execute(
            text(
                """
                SELECT id FROM patient_accounts
                WHERE birth_date IS NOT NULL
                  AND marketing_opt_in = true
                  AND (
                    (EXTRACT(MONTH FROM birth_date) = EXTRACT(MONTH FROM CURRENT_DATE)
                     AND EXTRACT(DAY FROM birth_date) BETWEEN EXTRACT(DAY FROM CURRENT_DATE)
                         AND EXTRACT(DAY FROM CURRENT_DATE) + :n)
                  )
                LIMIT :lim
                """
            ),
            {"n": n, "lim": cfg.get("max_suggestions_per_run_per_kind", 200)},
        )
    ).all()
    created = 0
    for r in rows:
        if await _create_suggestion(
            db,
            tenant_id,
            r[0],
            SuggestionKind.BIRTHDAY,
            TemplateCategory.BIRTHDAY,
            {"days_until_bday": n},
        ):
            created += 1
    return created


async def generate_churn_suggestions(
    db: AsyncSession, tenant_id: UUID, cfg: dict
) -> int:
    """Пациенты last_seen ровно 30/60/90 дней назад (с допуском ±1 день)."""
    created = 0
    today = datetime.utcnow()
    for d in cfg.get("churn_thresholds_days", DEFAULT_CONFIG["churn_thresholds_days"]):
        from_dt = today - timedelta(days=d + 1)
        to_dt = today - timedelta(days=d)
        rows = (
            await db.execute(
                select(PatientAccount.id)
                .where(
                    PatientAccount.last_seen_at >= from_dt,
                    PatientAccount.last_seen_at < to_dt,
                    PatientAccount.login_count >= 3,  # loyal
                    PatientAccount.marketing_opt_in == True,  # noqa: E712
                )
                .limit(cfg.get("max_suggestions_per_run_per_kind", 200))
            )
        ).scalars().all()
        kind = {
            30: SuggestionKind.CHURN_30D,
            60: SuggestionKind.CHURN_60D,
            90: SuggestionKind.CHURN_90D,
        }.get(d, SuggestionKind.CHURN_60D)
        for pid in rows:
            if await _create_suggestion(
                db,
                tenant_id,
                pid,
                kind,
                TemplateCategory.CHURN,
                {"churn_days": d},
            ):
                created += 1
    return created


async def generate_anniversary_suggestions(
    db: AsyncSession, tenant_id: UUID, cfg: dict
) -> int:
    """Пациенты, у которых первая запись ровно 365*N дней назад в этом тенанте."""
    rows = (
        await db.execute(
            text(
                """
                SELECT pa.id, MIN(a.created_at) AS first_appt
                FROM patient_accounts pa
                JOIN appointments a
                  ON a.patient_phone = pa.phone AND a.tenant_id = :tid
                GROUP BY pa.id
                HAVING ABS(EXTRACT(EPOCH FROM (NOW() - MIN(a.created_at))) - 365*86400) < 86400
                LIMIT :lim
                """
            ),
            {"tid": str(tenant_id), "lim": cfg.get("max_suggestions_per_run_per_kind", 200)},
        )
    ).all()
    created = 0
    for r in rows:
        if await _create_suggestion(
            db,
            tenant_id,
            r[0],
            SuggestionKind.ANNIVERSARY,
            TemplateCategory.ANNIVERSARY,
            {},
        ):
            created += 1
    return created


async def generate_nps_suggestions(
    db: AsyncSession, tenant_id: UUID, cfg: dict
) -> int:
    """После визита (через 24ч), если NPS ещё не отправляли — suggestion."""
    hours = cfg.get("nps_hours_after_visit", DEFAULT_CONFIG["nps_hours_after_visit"])
    threshold = datetime.utcnow() - timedelta(hours=hours)
    cutoff_min = datetime.utcnow() - timedelta(hours=hours + 4)  # окно 4 часа
    rows = (
        await db.execute(
            text(
                """
                SELECT pa.id, a.id AS appt_id
                FROM patient_accounts pa
                JOIN appointments a
                  ON a.patient_phone = pa.phone AND a.tenant_id = :tid
                WHERE a.created_at >= :cutoff_min AND a.created_at < :threshold
                  AND NOT EXISTS (
                    SELECT 1 FROM nps_responses nps
                    WHERE nps.patient_id = pa.id AND nps.appointment_id = a.id
                  )
                  AND pa.marketing_opt_in = true
                LIMIT :lim
                """
            ),
            {
                "tid": str(tenant_id),
                "threshold": threshold,
                "cutoff_min": cutoff_min,
                "lim": cfg.get("max_suggestions_per_run_per_kind", 200),
            },
        )
    ).all()
    created = 0
    for r in rows:
        if await _create_suggestion(
            db,
            tenant_id,
            r[0],
            SuggestionKind.NPS,
            TemplateCategory.NPS,
            {"appointment_id": str(r[1])},
        ):
            created += 1
    return created


async def run_engine(
    db: AsyncSession, tenant_id: UUID, cfg: Optional[dict] = None
) -> dict:
    """Главный entry — пробегает все генераторы. Возвращает stats per kind."""
    cfg = cfg or DEFAULT_CONFIG
    stats: dict = {}
    for name, gen in [
        ("welcome", generate_welcome_suggestions),
        ("birthday", generate_birthday_suggestions),
        ("churn", generate_churn_suggestions),
        ("anniversary", generate_anniversary_suggestions),
        ("nps", generate_nps_suggestions),
    ]:
        try:
            stats[name] = await gen(db, tenant_id, cfg)
        except Exception as e:
            stats[name] = {"error": str(e)[:200]}
    await db.commit()
    return stats
