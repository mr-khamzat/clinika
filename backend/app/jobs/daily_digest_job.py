"""Job: ежедневная сводка по сети клиник для админа.

Запускается APScheduler'ом раз в день в 09:00 МСК (cron). Логика:
  1. За «вчера» (МСК-сутки 00:00 → 24:00) считаем по каждому tenant'у с
     родительской франшизой arc + sub-tenants:
       - приёмы: total + по статусам (completed/cancelled/no_show/pending)
       - выручка: sum(price) по completed
       - cross-clinic направления: где from_tenant != to_tenant
       - топ-3 врача по выручке (по всей сети)
       - region_lock_violations за день
  2. Через alert_service.notify_admin шлём отрендеренный HTML.

Ключевая идея — НЕ дёргать Tenant.is_active=True, а взять конкретные slug'и
тенантов сети ARC. Если в БД нет — пропускаем без ошибки.

Сеть ARC v2 (см. CLAUDE.md): arc + lor + neo + ach + srn (5 клиник).
Конкретные slug'и переопределяются через DIGEST_TENANT_SLUGS env (csv).
"""
import logging
import os
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select, func

from app.database import AsyncSessionLocal
from app.models.audit import AuditEntry
from app.models.doctor import Appointment, AppointmentStatus, Doctor
from app.models.referral import Referral
from app.models.tenant import Tenant
from app.models.clinic import Clinic
from app.services import alert_service

log = logging.getLogger("daily_digest")

DEFAULT_SLUGS = "arc,lor,neo,ach,srn"


def _yesterday_msk_window() -> tuple[datetime, datetime, str]:
    """Возвращает (utc_from, utc_to, label) за «вчера» по МСК.

    БД хранит datetime в UTC naive. МСК = UTC+3. Если сейчас 09:00 МСК
    9 мая, то «вчера МСК» = 8 мая 00:00..24:00 МСК = 7 мая 21:00 UTC →
    8 мая 21:00 UTC.
    """
    msk = timezone(timedelta(hours=3))
    now_msk = datetime.now(msk)
    yest_msk = (now_msk - timedelta(days=1)).date()
    start_msk = datetime.combine(yest_msk, time(0, 0), tzinfo=msk)
    end_msk = start_msk + timedelta(days=1)
    # Переводим в UTC naive (то, что лежит в БД)
    start_utc = start_msk.astimezone(timezone.utc).replace(tzinfo=None)
    end_utc = end_msk.astimezone(timezone.utc).replace(tzinfo=None)
    return start_utc, end_utc, yest_msk.strftime("%Y-%m-%d")


async def _collect_clinic_stats(db, tenant: Tenant, dt_from: datetime,
                                 dt_to: datetime) -> dict:
    """Стата по одному tenant'у за период."""
    # Считаем по статусу с одним запросом
    rows = (await db.execute(
        select(Appointment.status, func.count().label("cnt"),
               func.coalesce(func.sum(Appointment.price), 0).label("rev"))
        .where(
            Appointment.tenant_id == tenant.id,
            Appointment.appointment_date >= dt_from.date(),
            Appointment.appointment_date < dt_to.date(),
        )
        .group_by(Appointment.status)
    )).all()

    by_status = {"completed": 0, "cancelled": 0, "no_show": 0, "pending": 0}
    total = 0
    revenue = Decimal("0")
    for status, cnt, rev in rows:
        total += int(cnt or 0)
        # status может прийти как Enum или str — нормализуем
        s = status.value if hasattr(status, "value") else str(status)
        if s in by_status:
            by_status[s] += int(cnt or 0)
        if s == "completed":
            revenue += Decimal(rev or 0)

    return {
        "name": tenant.name,
        "slug": tenant.slug,
        "appointments": {"total": total, **by_status},
        "revenue": float(revenue),
    }


async def _collect_referrals(db, tenant_ids: list, dt_from, dt_to) -> dict:
    """Cross-clinic направления = where from_clinic.tenant != to_clinic.tenant.

    Считаем по всему окну, потом разводим на incoming/outgoing для сети.
    Для упрощения — общее число cross-tenant referrals за период.
    """
    if not tenant_ids:
        return {"incoming": 0, "outgoing": 0}
    # Берём все направления, где to_clinic.tenant_id ∈ network — incoming
    # to-network. Для outgoing — from_clinic.tenant_id ∈ network. Cross-clinic
    # = from.tenant != to.tenant. Считаем оба.
    from sqlalchemy.orm import aliased
    FromC = aliased(Clinic)
    ToC = aliased(Clinic)
    base = (
        select(func.count())
        .select_from(Referral)
        .join(FromC, FromC.id == Referral.from_clinic_id, isouter=True)
        .join(ToC, ToC.id == Referral.to_clinic_id)
        .where(
            Referral.created_at >= dt_from,
            Referral.created_at < dt_to,
            FromC.tenant_id.is_not(None),
            FromC.tenant_id != ToC.tenant_id,
        )
    )
    incoming = (await db.execute(
        base.where(ToC.tenant_id.in_(tenant_ids))
    )).scalar() or 0
    outgoing = (await db.execute(
        base.where(FromC.tenant_id.in_(tenant_ids))
    )).scalar() or 0
    return {"incoming": int(incoming), "outgoing": int(outgoing)}


async def _collect_top_doctors(db, tenant_ids: list, dt_from, dt_to) -> list:
    """Топ-3 врача по выручке (sum price у completed) в сети."""
    if not tenant_ids:
        return []
    rows = (await db.execute(
        select(
            Doctor.full_name,
            func.coalesce(func.sum(Appointment.price), 0).label("rev"),
        )
        .join(Appointment, Appointment.doctor_id == Doctor.id)
        .where(
            Appointment.tenant_id.in_(tenant_ids),
            Appointment.appointment_date >= dt_from.date(),
            Appointment.appointment_date < dt_to.date(),
            Appointment.status == AppointmentStatus.COMPLETED,
        )
        .group_by(Doctor.id, Doctor.full_name)
        .order_by(func.sum(Appointment.price).desc().nullslast())
        .limit(3)
    )).all()
    return [(name, float(rev or 0)) for name, rev in rows]


async def _count_region_violations(db, dt_from, dt_to) -> int:
    """Сколько записей region.violation в audit_log за день."""
    n = (await db.execute(
        select(func.count())
        .select_from(AuditEntry)
        .where(
            AuditEntry.action == "region.violation",
            AuditEntry.created_at >= dt_from,
            AuditEntry.created_at < dt_to,
        )
    )).scalar()
    return int(n or 0)


async def run_daily_digest() -> bool:
    """Возвращает True если сводка ушла в Telegram."""
    slugs_csv = os.environ.get("DIGEST_TENANT_SLUGS", DEFAULT_SLUGS)
    slugs = [s.strip() for s in slugs_csv.split(",") if s.strip()]
    if not slugs:
        log.info("DIGEST_TENANT_SLUGS пуст — пропускаю")
        return False

    dt_from, dt_to, label = _yesterday_msk_window()

    async with AsyncSessionLocal() as db:
        tenants = (await db.execute(
            select(Tenant).where(Tenant.slug.in_(slugs))
        )).scalars().all()
        if not tenants:
            log.warning("Сеть из %s в БД не найдена — пропускаю", slugs)
            return False

        clinics_data = []
        for t in tenants:
            try:
                clinics_data.append(await _collect_clinic_stats(db, t, dt_from, dt_to))
            except Exception as e:
                log.warning("clinic stats tenant=%s: %s", t.slug, e)

        tenant_ids = [t.id for t in tenants]
        try:
            refs = await _collect_referrals(db, tenant_ids, dt_from, dt_to)
        except Exception as e:
            log.warning("referrals collect: %s", e)
            refs = {"incoming": 0, "outgoing": 0}

        try:
            top = await _collect_top_doctors(db, tenant_ids, dt_from, dt_to)
        except Exception as e:
            log.warning("top doctors: %s", e)
            top = []

        try:
            rlv = await _count_region_violations(db, dt_from, dt_to)
        except Exception as e:
            log.warning("region violations: %s", e)
            rlv = 0

    stats = {
        "date": label,
        "clinics": clinics_data,
        "referrals": refs,
        "top_doctors": top,
        "region_lock_violations": rlv,
    }
    text = alert_service.format_daily_digest(stats)
    # Дедуп по дате — на случай двойного запуска одного и того же дня
    return await alert_service.notify_admin(
        text,
        dedup_key=f"daily_digest:{label}",
    )
