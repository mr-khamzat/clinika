"""Аналитика пациентов ЛК — funnel/churn/heatmap/cohort/stuck-in-funnel."""
from datetime import datetime, timedelta, date
from uuid import UUID
from typing import Optional
from sqlalchemy import select, func, cast, Date as SADate, text, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.patient_account import PatientAccount, PatientSession


async def dashboard_summary(db: AsyncSession, tenant_id: UUID) -> dict:
    """Топ-карточки для дашборда CRM-hub.

    ВНИМАНИЕ: tenant_id у PatientAccount нет (это общая таблица). Считаем "пациенты ЛК"
    как все аккаунты, у которых хотя бы один appointment в данном тенанте.
    Упрощение: считаем по всем patient_accounts.
    """
    today = datetime.utcnow()
    now7 = today - timedelta(days=7)
    now30 = today - timedelta(days=30)
    now90 = today - timedelta(days=90)
    now60 = today - timedelta(days=60)

    # total: все аккаунты, которые когда-либо логинились
    total_q = await db.execute(
        select(func.count()).select_from(PatientAccount).where(PatientAccount.login_count > 0)
    )
    new7_q = await db.execute(
        select(func.count()).select_from(PatientAccount).where(PatientAccount.created_at >= now7)
    )
    act7_q = await db.execute(
        select(func.count()).select_from(PatientAccount).where(PatientAccount.last_seen_at >= now7)
    )
    act30_q = await db.execute(
        select(func.count()).select_from(PatientAccount).where(PatientAccount.last_seen_at >= now30)
    )
    act90_q = await db.execute(
        select(func.count()).select_from(PatientAccount).where(PatientAccount.last_seen_at >= now90)
    )
    churn60_q = await db.execute(
        select(func.count()).select_from(PatientAccount).where(
            PatientAccount.last_seen_at < now60,
            PatientAccount.login_count >= 3,
        )
    )

    # Birthdays на ближайшие 7 дней
    bday_q = await db.execute(text("""
        SELECT COUNT(*) FROM patient_accounts
        WHERE birth_date IS NOT NULL
          AND (
            (EXTRACT(MONTH FROM birth_date) = EXTRACT(MONTH FROM CURRENT_DATE)
             AND EXTRACT(DAY FROM birth_date) BETWEEN EXTRACT(DAY FROM CURRENT_DATE) AND EXTRACT(DAY FROM CURRENT_DATE) + 7)
          )
    """))

    return {
        "total_lk_users": total_q.scalar() or 0,
        "new_7d": new7_q.scalar() or 0,
        "active_7d": act7_q.scalar() or 0,
        "active_30d": act30_q.scalar() or 0,
        "active_90d": act90_q.scalar() or 0,
        "churn_60d_loyal": churn60_q.scalar() or 0,
        "birthdays_next_7d": bday_q.scalar() or 0,
    }


async def login_heatmap(db: AsyncSession, days: int = 30) -> list[dict]:
    """Heatmap логинов 7×24 по PatientSession.created_at за последние N дней.

    Postgres dow 0=вс..6=сб → нормализуем к 0=пн..6=вс через (d+6)%7.
    """
    since = datetime.utcnow() - timedelta(days=days)
    stmt = text("""
        SELECT
            ((EXTRACT(DOW FROM created_at)::int + 6) % 7) AS day,
            EXTRACT(HOUR FROM created_at)::int AS hour,
            COUNT(*) AS c
        FROM patient_sessions
        WHERE created_at >= :since
        GROUP BY day, hour
    """)
    rows = (await db.execute(stmt, {"since": since})).all()
    return [{"day": int(r.day), "hour": int(r.hour), "count": int(r.c)} for r in rows]


async def retention_cohorts(db: AsyncSession, weeks: int = 8) -> list[dict]:
    """Cohort-retention: для каждой недели регистрации показывает % вернувшихся в +1, +2, +3, +4 недели.

    Возвращает [{cohort_week, size, week1_pct, week2_pct, week3_pct, week4_pct}].
    """
    stmt = text(f"""
        WITH cohorts AS (
            SELECT
                DATE_TRUNC('week', created_at)::date AS cohort_week,
                id AS pa_id
            FROM patient_accounts
            WHERE created_at >= NOW() - INTERVAL '{weeks} weeks'
        ),
        sessions AS (
            SELECT account_id, DATE_TRUNC('week', created_at)::date AS sess_week FROM patient_sessions
        )
        SELECT
            c.cohort_week,
            COUNT(DISTINCT c.pa_id) AS size,
            COUNT(DISTINCT CASE WHEN s.sess_week = c.cohort_week + INTERVAL '1 week' THEN c.pa_id END) AS w1,
            COUNT(DISTINCT CASE WHEN s.sess_week = c.cohort_week + INTERVAL '2 weeks' THEN c.pa_id END) AS w2,
            COUNT(DISTINCT CASE WHEN s.sess_week = c.cohort_week + INTERVAL '3 weeks' THEN c.pa_id END) AS w3,
            COUNT(DISTINCT CASE WHEN s.sess_week = c.cohort_week + INTERVAL '4 weeks' THEN c.pa_id END) AS w4
        FROM cohorts c
        LEFT JOIN sessions s ON s.account_id = c.pa_id
        GROUP BY c.cohort_week
        ORDER BY c.cohort_week DESC
        LIMIT :weeks
    """)
    rows = (await db.execute(stmt, {"weeks": weeks})).all()
    out = []
    for r in rows:
        size = int(r.size) or 0
        out.append({
            "cohort_week": r.cohort_week.isoformat() if hasattr(r.cohort_week, "isoformat") else str(r.cohort_week),
            "size": size,
            "week1_pct": round((r.w1 or 0) * 100 / size, 1) if size else 0,
            "week2_pct": round((r.w2 or 0) * 100 / size, 1) if size else 0,
            "week3_pct": round((r.w3 or 0) * 100 / size, 1) if size else 0,
            "week4_pct": round((r.w4 or 0) * 100 / size, 1) if size else 0,
        })
    return out


async def funnel_summary(db: AsyncSession, tenant_id: UUID, days: int = 30) -> dict:
    """Funnel: registrations → first_login → repeat_login → first_appointment.

    Для tenant_id ограничиваем по appointments.tenant_id.
    """
    since = datetime.utcnow() - timedelta(days=days)
    # registrations
    reg = (await db.execute(
        select(func.count()).select_from(PatientAccount).where(PatientAccount.created_at >= since)
    )).scalar() or 0
    # first_login: created_at и login_count >= 1
    first_login = (await db.execute(
        select(func.count()).select_from(PatientAccount).where(
            PatientAccount.created_at >= since,
            PatientAccount.login_count >= 1,
        )
    )).scalar() or 0
    # repeat: login_count >= 2
    repeat = (await db.execute(
        select(func.count()).select_from(PatientAccount).where(
            PatientAccount.created_at >= since,
            PatientAccount.login_count >= 2,
        )
    )).scalar() or 0
    # first_appointment: есть appointment у этого аккаунта в tenant_id
    appointed = (await db.execute(text("""
        SELECT COUNT(DISTINCT pa.id) FROM patient_accounts pa
        WHERE pa.created_at >= :since
          AND EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.tenant_id = :tid AND a.patient_phone = pa.phone
          )
    """), {"since": since, "tid": str(tenant_id)})).scalar() or 0
    return {
        "stages": [
            {"key": "registration", "label": "Зарегистрировались", "value": reg},
            {"key": "first_login", "label": "Зашли хотя бы 1 раз", "value": first_login,
             "rate": round(first_login * 100 / reg, 1) if reg else 0},
            {"key": "repeat_login", "label": "Вернулись (2+ заходов)", "value": repeat,
             "rate": round(repeat * 100 / first_login, 1) if first_login else 0},
            {"key": "appointment", "label": "Записались на приём", "value": appointed,
             "rate": round(appointed * 100 / repeat, 1) if repeat else 0},
        ],
        "days": days,
    }


async def churn_list(
    db: AsyncSession,
    tenant_id: UUID,
    days_threshold: int = 60,
    limit: int = 100,
) -> list[dict]:
    """Список loyal-пациентов, которые не заходят > N дней.

    Loyal = login_count >= 3 И был >= 1 визит в данном тенанте.
    """
    threshold = datetime.utcnow() - timedelta(days=days_threshold)
    stmt = text("""
        SELECT pa.id, pa.phone, pa.name, pa.last_seen_at, pa.login_count,
               (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id=:tid AND a.patient_phone=pa.phone) AS visits
        FROM patient_accounts pa
        WHERE pa.last_seen_at < :threshold
          AND pa.login_count >= 3
          AND EXISTS (SELECT 1 FROM appointments a WHERE a.tenant_id=:tid AND a.patient_phone=pa.phone)
        ORDER BY pa.last_seen_at ASC NULLS LAST
        LIMIT :lim
    """)
    rows = (await db.execute(stmt, {"tid": str(tenant_id), "threshold": threshold, "lim": limit})).all()
    return [
        {
            "id": str(r.id),
            "phone": r.phone,
            "name": r.name,
            "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
            "login_count": int(r.login_count),
            "visits": int(r.visits or 0),
        }
        for r in rows
    ]


async def stuck_in_funnel(
    db: AsyncSession,
    tenant_id: UUID,
    opens_threshold: int = 3,
    limit: int = 100,
) -> list[dict]:
    """Кто открывал конкретную услугу/баннер несколько раз, но не записался.

    Используем AdEvent (event_type='click') как прокси, если конкретного service_view-эвента нет.
    Считаем clicks по ad-баннеру того же tenant без последующей conversion для того же user_id.
    """
    stmt = text("""
        SELECT ae.ad_id, COUNT(DISTINCT ae.id) AS clicks, COUNT(DISTINCT ae.user_id) AS unique_users
        FROM ad_events ae
        WHERE ae.tenant_id = :tid AND ae.event_type = 'click' AND ae.created_at >= NOW() - INTERVAL '14 days'
          AND NOT EXISTS (
              SELECT 1 FROM ad_events ae2
              WHERE ae2.ad_id = ae.ad_id AND ae2.event_type = 'conversion'
                AND ae2.user_id = ae.user_id AND ae2.created_at >= ae.created_at
          )
        GROUP BY ae.ad_id
        HAVING COUNT(DISTINCT ae.id) >= :thr
        ORDER BY clicks DESC
        LIMIT :lim
    """)
    rows = (await db.execute(stmt, {"tid": str(tenant_id), "thr": opens_threshold, "lim": limit})).all()
    return [
        {"ad_id": str(r.ad_id), "clicks": int(r.clicks), "unique_users": int(r.unique_users or 0)}
        for r in rows
    ]
