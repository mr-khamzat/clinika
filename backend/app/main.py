import os
# ─── Инициализация Sentry — отключена если DSN не задан ───
# Подключается до остальных импортов, чтобы перехватывать ранние ошибки.
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

_SENTRY_DSN = os.environ.get("SENTRY_DSN", "").strip()
if _SENTRY_DSN:
    # DSN задан — поднимаем интеграцию с FastAPI и SQLAlchemy.
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        traces_sample_rate=0.1,
        profiles_sample_rate=0.0,
        environment=os.environ.get("ENVIRONMENT", "production"),
        release=os.environ.get("APP_VERSION"),
    )

from fastapi import FastAPI, Request, Depends, HTTPException
from app.core.logging import setup_logging, get_logger
from app.core.prometheus import router as prometheus_router, metrics_middleware
from fastapi.middleware.cors import CORSMiddleware
from app.core.security_utils import SlidingWindowRateLimiter
from app.core.domain_router import DomainRouterMiddleware, router as domain_router
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.config import settings
from app.database import engine, Base, AsyncSessionLocal
from sqlalchemy import text
import asyncio
from app.routers import auth, referrals, bonuses, clinics, admins, integrations
# Партнёрский прайс (partneroffers01): категории + офферы услуг для cross-clinic направлений
from app.routers import partner_offers
# Профиль текущего сотрудника (avatar01): /profile/me, /profile/me/avatar и т.д.
from app.routers import profile as profile_router_module
from app.routers.password_reset import router as password_reset_router, cleanup_expired_password_reset_tokens
from app.routers.manager import router as manager_router
from app.routers.accountant import router as accountant_router
from app.routers.monitoring import router as monitoring_router
from app.routers.tenant import router as tenant_router
# plugins_router удалён — старая plugin_*-система выпилена (заменена commercial_modules)
from app.routers.modules import router as modules_router
from app.routers.geo import router as geo_router
from app.routers.scheduling import router as scheduling_router
# Итоги приёма (W?): заключение / файлы / внутриклинические направления / история пациента
from app.routers.appointments import router as appointments_router
from app.routers.ledger import router as ledger_router
from app.routers.analytics import router as analytics_router
from app.routers.audit import router as audit_router
from app.routers.billing import router as billing_router
from app.routers.consent import router as consent_router
from app.routers.admin import router as admin_router
from app.routers.franchise_owner import router as franchise_owner_router
from app.routers.franchise_owner_clinics import router as franchise_owner_clinics_router
from app.routers.franchise_analytics import router as franchise_analytics_router
from app.routers.partner_clinics import router as partner_clinics_router
from app.routers.mis_sync import router as mis_router
from app.routers.presence import router as presence_router
from app.routers.calls import router as calls_router
from app.routers.contact import router as contact_router
from app.routers.support import router as support_router
from app.routers.patient import router as patient_router
from app.routers.patient_chat import router as patient_chat_router
from app.routers.ai_knowledge import router as ai_knowledge_router
from app.routers.portal import router as portal_router
from app.routers.push import router as push_router
from app.routers.webhooks import router as webhooks_router
# API-ключи тенанта + публичный API v1 (CRM / BI интеграции)
from app.routers.tenant_api_keys import router as tenant_api_keys_router
from app.routers.public_api_v1 import router as public_api_v1_router
from app.routers.ads import router as ads_router
from app.routers.ads_ai import router as ads_ai_router
from app.routers.ads_analytics import router as ads_analytics_router
from app.routers.patient_engagement_analytics import router as engagement_analytics_router
from app.routers.patient_engagement_segments import router as engagement_segments_router
from app.routers.patient_engagement_crm import router as engagement_crm_router
from app.routers.network_dashboard import router as network_dashboard_router
from app.routers.franchise_visibility import router as franchise_visibility_router
from app.routers.ads_workflow import router as ads_workflow_router
from app.routers.commercial import router as commercial_router
from app.routers.marketplace import router as marketplace_router
from app.routers.ai import router as ai_router
from app.routers.ai_platform import router as ai_platform_router
from app.routers.recruiter import router as recruiter_router
from app.routers.visiting_doctor import router as visiting_router
from app.routers.doctor_ai import router as doctor_ai_router
from app.routers.announcements import router as announcements_router
from app.routers.director import router as director_router
from app.routers.director_export import router as director_export_router
from app.routers.inventory_import import router as inventory_import_router
from app.routers.inventory_batches import router as inventory_batches_router
from app.routers.manager_mis_webhooks import router as manager_mis_webhooks_router
from app.routers.marketing_ads import router as marketing_ads_router
from app.routers.service_norms import router as service_norms_router
from app.routers.subscription_discounts import router as subscription_discounts_router
from app.routers.subscription_pending import router as subscription_pending_router
from app.routers.regulations import router as regulations_router
from app.routers.admin_regulations import router as admin_regulations_router
from app.routers.external_doctor import router as external_doctor_router
from app.routers.cms import router as cms_router
from app.routers.acts import router as acts_router, inter_clinic_router as inter_clinic_acts_router
from app.routers.system import router as system_router, heartbeat_loop, send_heartbeat
from app.routers.public_booking import router as public_booking_router
from app.routers.public_clinic import router as public_clinic_router
from app.routers.wiki import router as wiki_router
from app.routers.reviews import router as reviews_router
from app.routers.inter_clinic_invoices import router as ici_router
from app.routers.medcard import router as medcard_router
from app.routers.patient_documents import router as patient_documents_router
from app.routers.prescriptions import router as prescriptions_router
from app.routers.vitals import router as vitals_router
from app.routers.loyalty import router as loyalty_router
from app.routers.patient_family import router as patient_family_router
from app.routers.patient_loyalty import router as patient_loyalty_router
from app.routers.admin_loyalty import router as admin_loyalty_router
from app.routers.patient_spending import router as patient_spending_router
from app.routers.permissions import router as permissions_router
from app.routers.ltv import router as ltv_router
# Платёжный каркас (online_payments_pro + fiscal_54fz_pro)
from app.routers.clinic_payments import router as clinic_payments_router
from app.routers.fiscal_receipts import router as fiscal_receipts_router
from app.routers.admin_logs import router as admin_logs_router
# Tenant impersonation (RFC 8693 OAuth 2 Token Exchange) — для super_admin
from app.routers.impersonation import router as impersonation_router
# Глобальный поиск Cmd+K и центр уведомлений (W3 UX-улучшения)
from app.routers.search import router as search_router
from app.routers.notifications import router as notifications_router
# W4: Пошаговый wizard онбординга для franchise_owner
from app.routers.onboarding import router as onboarding_router
from app.routers.public_onboarding import router as public_onboarding_router
# Telemedicine модуль (4990₽/мес) — Этап 2: REST + WebSocket signaling
from app.routers.telemedicine import (
    router as telemedicine_router,
    patient_router as telemedicine_patient_router,
)
# Patient notifications — realtime push в ЛК (входящие звонки Zoom-стиль)
from app.routers.patient_notifications import router as patient_notifications_router
# SMS-маркетинг модуль (1990₽/мес) — рассылки, реактивация спящих пациентов
from app.routers.sms_marketing import router as sms_marketing_router
# AI-ассистент пациенту через Gemini (2990₽/мес) — модуль ai_assistant (W6)
from app.routers.ai_assistant import (
    router as ai_assistant_router,
    admin_router as ai_assistant_admin_router,
)
# Запись звонков + Whisper транскрипция (3990₽/мес) — модуль call_recording (W5)
from app.routers.call_recording import router as call_recording_router
# Inventory модуль (1990₽/мес) — учёт материалов, остатков и движений (W7)
from app.routers.inventory import router as inventory_router
# Module Monitoring System — health-status платных модулей per-tenant
from app.routers.module_monitoring import router as module_monitoring_router
# Журнал безопасности — единый dashboard алертов для super_admin
from app.routers.security import router as security_router
# Глава 9 — Подписка Здоровье+, async-чат, iCal, document storage
from app.routers.patient_subscription import router as patient_subscription_router
from app.routers.admin_subscription_plans import router as admin_subscription_plans_router
from app.routers.manager_subscription_cash import router as manager_subscription_cash_router
from app.routers.patient_chat_threads import router as patient_chat_threads_router
from app.routers.clinic_chat import router as clinic_chat_router
# chatslot01: запись через чат — slot_offer от регистратора + slot_request/book-slot от пациента
from app.routers.clinic_chat_slots import router as clinic_chat_slots_router
from app.routers.patient_chat_slots import router as patient_chat_slots_router
from app.routers.staff_chat import router as staff_chat_router, _bot_router as staff_chat_bot_router
from app.routers.staff_chat_cross import router as staff_chat_cross_router
from app.routers.owner_bot_webhook import router as owner_bot_webhook_router
from app.routers.chat_admin import router as chat_admin_router
from app.routers.franchise_modules import router as franchise_modules_router
from app.routers.franchise_revenue import router as franchise_revenue_router
from app.services.staff_chat_cleanup_job import cleanup_staff_chat_files_job
from app.services.tg_owner_bot_poll import tg_owner_bot_poll_job
from app.routers.patient_calendar import router as patient_calendar_router
from app.routers.patient_documents_v2 import router as patient_health_documents_router
from app.routers.doctor_patient_documents import router as doctor_patient_documents_router
# Глава 10 — Интеграции (лаборатория / wellness / агрегаторы / disaster mode)
from app.routers.admin_lab import router as admin_lab_router
from app.routers.doctor_lab import router as doctor_lab_router
from app.routers.patient_lab import router as patient_lab_router
from app.routers.wellness import router as wellness_router
from app.routers.admin_aggregator import router as admin_aggregator_router
from app.routers.public_aggregator import router as public_aggregator_router
from app.routers.admin_system import (
    router as admin_system_router,
    detailed_router as health_detailed_router,
    disaster_health_check,
)
# Supervisor — мониторинг всех сервисов для super_admin (страница AdminSupervisor.jsx)
from app.routers.supervisor import router as supervisor_router
from app.core import disaster_middleware as _disaster_mw
from app.core.scheduler import scheduler
from app.services.auto_confirm import auto_confirm_loop
from app.models import *  # Import all models for table creation
from app.services import user_audit_listeners  # noqa: F401  # registers SQLA event listeners (user.created / user.password_changed audit)



def _register_plugins():
    """Регистрирует все плагины в глобальном реестре."""
    from app.plugins.registry import plugin_registry
    from app.plugins.mis.plugin import MISPlugin
    from app.plugins.sms.plugin import SMSPlugin
    from app.plugins.notify.plugin import NotifyPlugin
    plugin_registry.register(MISPlugin())
    plugin_registry.register(SMSPlugin())
    plugin_registry.register(NotifyPlugin())




# ── APScheduler job functions (без while-циклов) ──────────────────────────────

async def run_auto_confirm_job():
    """APScheduler: авто-подтверждение направлений (каждые 10 мин)."""
    try:
        count = await auto_confirm_loop.__wrapped__() if hasattr(auto_confirm_loop, '__wrapped__') else await _run_auto_confirm()
    except Exception as e:
        import logging; logging.getLogger('scheduler').error(f'auto_confirm: {e}')

async def _run_auto_confirm():
    from app.services.auto_confirm import run_auto_confirm
    return await run_auto_confirm()

async def run_ltv_job():
    """
    APScheduler: ежедневно в 04:00 UTC пересчитывает LTV-снапшоты для всех
    тенантов с активной подпиской ltv_pro. Идёт по каждой клинике тенанта
    (compute_ltv_for_clinic с clinic_id=None — обработает все).
    """
    import logging
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.commercial import ModuleStatus, TenantModuleSubscription
    from app.models.tenant import Tenant
    from app.services.ltv_service import compute_ltv_for_clinic

    logger = logging.getLogger("ltv_recompute")
    try:
        async with AsyncSessionLocal() as db:
            subs = (await db.execute(
                select(TenantModuleSubscription).where(
                    TenantModuleSubscription.module_key == "ltv_pro",
                    TenantModuleSubscription.status.in_([
                        ModuleStatus.ACTIVE, ModuleStatus.TRIAL, ModuleStatus.GRACE,
                    ]),
                )
            )).scalars().all()

            total_updated = 0
            for sub in subs:
                t = (await db.execute(
                    select(Tenant).where(Tenant.id == sub.tenant_id, Tenant.is_active == True)
                )).scalar_one_or_none()
                if not t:
                    continue
                try:
                    res = await compute_ltv_for_clinic(db, t, clinic_id=None)
                    total_updated += int(res.get("updated", 0))
                    logger.info("ltv: tenant=%s обновлено снапшотов=%s", t.slug, res.get("updated", 0))
                except Exception as e:
                    logger.warning("ltv: tenant=%s ошибка пересчёта: %s", t.slug, e)

            if total_updated:
                logger.info("ltv: всего обновлено снапшотов=%s", total_updated)
    except Exception as e:
        logger.error("run_ltv_job: %s", e)


async def expire_referrals_job():
    """APScheduler: просрочка направлений (каждый час)."""
    import logging
    from datetime import datetime
    from app.database import AsyncSessionLocal
    from app.models.referral import Referral, ReferralStatus
    from sqlalchemy import update
    logger = logging.getLogger('expire_referrals')
    try:
        async with AsyncSessionLocal() as db:
            now = datetime.utcnow()
            result = await db.execute(
                update(Referral)
                .where(Referral.status == ReferralStatus.CREATED, Referral.expires_at < now)
                .values(status=ReferralStatus.EXPIRED)
                .returning(Referral.id)
            )
            expired = result.fetchall()
            if expired:
                await db.commit()
                logger.info(f'Просрочено направлений: {len(expired)}')
    except Exception as e:
        logger.error(f'expire_referrals: {e}')

async def renew_plugins_job():
    """APScheduler: автопродление плагинов (каждые 6 часов)."""
    import logging
    from datetime import datetime
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.billing import TenantPluginSubscription
    from app.services.billing_service import charge_plugin_subscription, PluginSubStatus
    logger = logging.getLogger('plugin_renewal')
    try:
        async with AsyncSessionLocal() as db:
            now = datetime.utcnow()
            result = await db.execute(
                select(TenantPluginSubscription).where(
                    TenantPluginSubscription.status == PluginSubStatus.ACTIVE,
                    TenantPluginSubscription.auto_renew == True,
                    TenantPluginSubscription.expires_at < now,
                )
            )
            subs = result.scalars().all()
            renewed = 0
            for sub in subs:
                try:
                    await charge_plugin_subscription(db, sub.id)
                    await db.commit()
                    renewed += 1
                except Exception as e:
                    await db.rollback()
                    logger.warning(f'Не удалось продлить плагин {sub.feature_key}: {e}')
            if renewed:
                logger.info(f'Продлено плагинов: {renewed}')
    except Exception as e:
        logger.error(f'renew_plugins: {e}')

async def module_expiry_job():
    """APScheduler: переключение коммерческих модулей по срокам (каждый час).

    Логика:
      - active + expires_at < now           → grace, grace_until = now + 3 дня
      - trial + trial_ends_at < now         → expired
      - grace + grace_until < now           → expired
    """
    import logging
    from datetime import datetime, timedelta
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.commercial import TenantModuleSubscription, ModuleStatus
    logger = logging.getLogger("module_expiry")
    GRACE_DAYS = 3
    try:
        async with AsyncSessionLocal() as db:
            now = datetime.utcnow()
            grace_count = 0
            expired_count = 0

            active_subs = (await db.execute(
                select(TenantModuleSubscription).where(
                    TenantModuleSubscription.status == ModuleStatus.ACTIVE,
                    TenantModuleSubscription.expires_at != None,
                    TenantModuleSubscription.expires_at < now,
                )
            )).scalars().all()
            for sub in active_subs:
                sub.status = ModuleStatus.GRACE
                sub.grace_until = now + timedelta(days=GRACE_DAYS)
                grace_count += 1

            trial_subs = (await db.execute(
                select(TenantModuleSubscription).where(
                    TenantModuleSubscription.status == ModuleStatus.TRIAL,
                    TenantModuleSubscription.trial_ends_at != None,
                    TenantModuleSubscription.trial_ends_at < now,
                )
            )).scalars().all()
            for sub in trial_subs:
                sub.status = ModuleStatus.EXPIRED
                expired_count += 1

            grace_subs = (await db.execute(
                select(TenantModuleSubscription).where(
                    TenantModuleSubscription.status == ModuleStatus.GRACE,
                    TenantModuleSubscription.grace_until != None,
                    TenantModuleSubscription.grace_until < now,
                )
            )).scalars().all()
            for sub in grace_subs:
                sub.status = ModuleStatus.EXPIRED
                expired_count += 1

            if grace_count or expired_count:
                await db.commit()
                logger.info(f"module_expiry: grace+={grace_count}, expired+={expired_count}")
    except Exception as e:
        logger.error(f"module_expiry: {e}")


async def franchise_invoice_job():
    """APScheduler: выставление счетов франшизам по истечении billing_period_days."""
    import logging
    from app.database import AsyncSessionLocal
    from app.services.franchise_billing_service import run_invoice_job
    logger = logging.getLogger("franchise_invoice")
    try:
        async with AsyncSessionLocal() as db:
            res = await run_invoice_job(db)
            if res["created"]:
                logger.info(f"franchise_invoice: created={res['created']}, skipped={res['skipped']}")
    except Exception as e:
        logger.error(f"franchise_invoice: {e}")


async def process_webhook_queue_job():
    """APScheduler: обработка очереди вебхуков (каждую минуту)."""
    from redis.asyncio import Redis
    from app.services.webhook_queue import process_webhook_queue
    r = Redis.from_url(settings.redis_url)
    try:
        await process_webhook_queue(r)
    finally:
        await r.aclose()


async def appointment_reminders_job():
    """APScheduler: push-напоминания пациентам о записи (каждые 30 минут)."""
    import logging
    try:
        from app.jobs.appointment_reminders import run_appointment_reminders
        sent = await run_appointment_reminders()
        if sent:
            logging.getLogger('scheduler').info(f'appointment_reminders: sent {sent}')
    except Exception as e:
        logging.getLogger('scheduler').error(f'appointment_reminders: {e}')


async def sms_campaign_dispatch_job():
    """APScheduler: воркер SMS-кампаний (sms_marketing). Тик раз в минуту."""
    import logging
    try:
        from app.jobs.sms_campaign_dispatch import run_sms_campaign_dispatch
        sent = await run_sms_campaign_dispatch()
        if sent:
            logging.getLogger('scheduler').info(f'sms_dispatch: sent {sent}')
    except Exception as e:
        logging.getLogger('scheduler').error(f'sms_dispatch: {e}')


async def transcription_dispatch_job():
    """APScheduler: воркер транскрипции записей звонков (call_recording).

    Раз в 2 минуты берёт записи в статусе 'ready', шлёт в Whisper,
    делает AI-summary через Gemini, выставляет 'done' / 'failed'.
    """
    import logging
    try:
        from app.jobs.transcription_dispatch import run_transcription_dispatch
        n = await run_transcription_dispatch()
        if n:
            logging.getLogger('scheduler').info(f'transcription: processed {n}')
    except Exception as e:
        logging.getLogger('scheduler').error(f'transcription: {e}')


async def engagement_suggestions_job():
    """Каждый час: сканирует тенантов и создаёт pending suggestions для CRM-hub."""
    import logging
    try:
        from app.jobs.engagement_suggestions_job import run_all_tenants
        stats = await run_all_tenants()
        logging.getLogger("scheduler").info(f"engagement_suggestions: {stats}")
    except Exception as e:
        logging.getLogger("scheduler").error(f"engagement_suggestions: {e}")

async def ads_attribution_job():
    """Ежедневная привязка конверсий рекламы по кликам пациентов."""
    try:
        from app.database import async_session
        from app.jobs.ads_attribution_job import run_attribution
        async with async_session() as db:
            stats = await run_attribution(db)
            logging.getLogger('scheduler').info(f'ads_attribution: {stats}')
    except Exception as e:
        logging.getLogger('scheduler').error(f'ads_attribution: {e}')


async def ads_health_pause_job():
    """Авто-пауза мёртвой рекламы (idle > N дней или бюджет потрачен)."""
    try:
        from app.database import async_session
        from app.models.advertising import Ad, AdStatus
        from sqlalchemy import select
        from datetime import datetime, timedelta
        async with async_session() as db:
            rows = (await db.execute(
                select(Ad).where(Ad.status == AdStatus.ACTIVE)
            )).scalars().all()
            paused = 0
            for ad in rows:
                idle_days = ad.auto_pause_idle_days or 7
                is_idle = False
                if ad.last_impression_at:
                    if (datetime.utcnow() - ad.last_impression_at).days >= idle_days:
                        is_idle = True
                elif ad.created_at and (datetime.utcnow() - ad.created_at).days >= idle_days:
                    is_idle = True
                budget_done = (ad.budget_total and ad.spent_total
                               and float(ad.spent_total) >= float(ad.budget_total))
                if is_idle or budget_done:
                    ad.status = AdStatus.PAUSED
                    paused += 1
            if paused:
                await db.commit()
                logging.getLogger('scheduler').info(f'ads_health_pause: paused {paused} ads')
    except Exception as e:
        logging.getLogger('scheduler').error(f'ads_health_pause: {e}')


async def inventory_alerts_job():
    """APScheduler: ежедневный сканер inventory-алертов (cron 09:00).

    Шлёт компактный Telegram-дайджест админу платформы по тенантам с
    активным модулем inventory: low_stock + expiring + expired.
    """
    import logging
    try:
        from app.jobs.inventory_alerts import run_inventory_alerts
        n = await run_inventory_alerts()
        if n:
            logging.getLogger('scheduler').info(f'inventory_alerts: notified {n} tenants')
    except Exception as e:
        logging.getLogger('scheduler').error(f'inventory_alerts: {e}')


async def subscription_monthly_supply_job():
    """APScheduler: 1-го числа каждого месяца в 03:00 UTC — для каждой
    активной подписки с features.monthly_supply=True генерирует расходник
    за предыдущий месяц и шлёт patient-notification.
    """
    import logging
    try:
        from app.database import AsyncSessionLocal  # type: ignore
        from app.services import subscription_supply_cron as sup
    except Exception as e:
        logging.getLogger('scheduler').error(f'supply_cron import failed: {e}')
        return
    try:
        async with AsyncSessionLocal() as db:  # type: ignore
            res = await sup.run_monthly_for_all(db)
            await db.commit()
            logging.getLogger('scheduler').info(
                f"subscription_monthly_supply: {res.get('ok')}/{res.get('processed')} ok"
            )
    except Exception as e:
        logging.getLogger('scheduler').error(f'subscription_monthly_supply: {e}')


async def module_health_check_job():
    """APScheduler: каждые 30 мин обходим все active tenants, проверяем модули.

    Использует `module_health_service.run_health_checks_all_tenants` —
    адаптеры на каждый платный модуль (telemedicine, ads, inventory, ...).
    При переходе ok→error/degraded — Telegram-алерт админу (дедуп 1 час).
    """
    import logging
    try:
        from app.database import AsyncSessionLocal
        from app.services.module_health_service import run_health_checks_all_tenants
        async with AsyncSessionLocal() as db:
            stats = await run_health_checks_all_tenants(db)
            logging.getLogger('scheduler').info(f'module_health: {stats}')
    except Exception as e:
        logging.getLogger('scheduler').error(f'module_health: {e}')


async def module_daily_digest_job():
    """09:00 МСК: сводка по модулям всех тенантов в Telegram админу.

    Эмодзи-таблица: ✅ ok / ⚠️ degraded / ❌ error / 💤 idle / ❔ unknown.
    Только агрегаты — детали смотреть в /admin/modules/health/all.
    """
    import logging
    try:
        from app.database import AsyncSessionLocal
        from app.services import alert_service
        from app.services.module_health_service import (
            get_modules_health_all_tenants,
        )
        from app.models.module_health import ModuleHealthStatus
        async with AsyncSessionLocal() as db:
            rows = await get_modules_health_all_tenants(db)
        # Считаем суммарно по платформе + по проблемным тенантам
        totals = {"ok": 0, "degraded": 0, "error": 0, "idle": 0, "unknown": 0}
        problem_lines = []
        for r in rows:
            t_err = t_deg = 0
            for m in r["modules"]:
                st = (m.get("health") or {}).get("status") or "unknown"
                totals[st] = totals.get(st, 0) + 1
                if st == ModuleHealthStatus.ERROR.value:
                    t_err += 1
                elif st == ModuleHealthStatus.DEGRADED.value:
                    t_deg += 1
            if t_err or t_deg:
                problem_lines.append(
                    f"  • <b>{r['tenant_name']}</b>: ❌{t_err} ⚠️{t_deg}"
                )
        head = "📊 <b>Дайджест модулей за сутки</b>"
        line = (f"\n✅ {totals['ok']}  ⚠️ {totals['degraded']}  "
                f"❌ {totals['error']}  💤 {totals['idle']}  "
                f"❔ {totals['unknown']}")
        body = head + line
        if problem_lines:
            body += "\n\n<b>Проблемные тенанты:</b>\n" + "\n".join(
                problem_lines[:15])
        await alert_service.notify_admin(body, dedup_key="module_daily_digest")
        logging.getLogger('scheduler').info(f'module_daily_digest: {totals}')
    except Exception as e:
        logging.getLogger('scheduler').error(f'module_daily_digest: {e}')

async def integration_retest_job():
    """Каждый час перетестирует активные TenantIntegration (МИС и др.).
    Чтобы health-check mis_sync не помечал degraded из-за устаревшего last_tested_at."""
    try:
        from app.database import AsyncSessionLocal
        from app.models.commercial import TenantIntegration
        from app.routers.commercial import _do_test
        from datetime import datetime as _dt
        from sqlalchemy import select as _sel
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                _sel(TenantIntegration).where(TenantIntegration.is_active == True)
            )).scalars().all()
            ok_n = err_n = 0
            for obj in rows:
                try:
                    status, error = await _do_test(obj)
                    obj.last_tested_at = _dt.utcnow()
                    obj.test_status = status
                    obj.test_error = error
                    obj.updated_at = _dt.utcnow()
                    if status == 'ok': ok_n += 1
                    else: err_n += 1
                except Exception as _e:
                    obj.last_tested_at = _dt.utcnow()
                    obj.test_status = 'error'
                    obj.test_error = str(_e)[:200]
                    err_n += 1
            await db.commit()
            log.info(f'integration_retest: ok={ok_n} err={err_n} total={len(rows)}')
    except Exception as e:
        log.error(f'integration_retest: {e}')




async def disk_check_job():
    """APScheduler: контроль свободного места (раз в час).

    Если used% > DISK_ALERT_THRESHOLD (default 80) — шлём админу с топ-3
    директорий через du -sh. Дедуп — на стороне notify_admin (1% гранулярность).
    """
    import logging
    try:
        from app.jobs.disk_check_job import run_disk_check
        sent = await run_disk_check()
        if sent:
            logging.getLogger('scheduler').info('disk_check: alert sent')
    except Exception as e:
        logging.getLogger('scheduler').error(f'disk_check: {e}')


async def daily_digest_job():
    """APScheduler: ежедневная сводка по сети ARC в 09:00 МСК (= 06:00 UTC)."""
    import logging
    try:
        from app.jobs.daily_digest_job import run_daily_digest
        sent = await run_daily_digest()
        if sent:
            logging.getLogger('scheduler').info('daily_digest: digest sent')
    except Exception as e:
        logging.getLogger('scheduler').error(f'daily_digest: {e}')


async def geoip_update_job():
    """APScheduler: еженедельное обновление гео-IP базы (понедельник 03:00)."""
    import asyncio as _aio
    import logging
    import os
    log = logging.getLogger("scheduler")
    script = "/app/scripts/download_geoip.sh"
    if not os.path.exists(script):
        log.warning("geoip_update: скрипт %s не найден, пропускаю", script)
        return
    try:
        proc = await _aio.create_subprocess_exec(
            "bash", script,
            stdout=_aio.subprocess.PIPE,
            stderr=_aio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode == 0:
            log.info("geoip_update: ok | %s", (stdout or b"").decode(errors="ignore").strip())
            # Сбрасываем кеш Reader — подхватим обновлённый файл
            try:
                from app.services.geoip_service import reset_reader
                reset_reader()
            except Exception:
                pass
        else:
            log.warning("geoip_update: rc=%s stderr=%s", proc.returncode, (stderr or b"").decode(errors="ignore").strip())
    except Exception as e:
        log.error("geoip_update: %s", e)


async def referral_reminder_patient_job():
    """APScheduler: напоминание пациенту за 3 дня до дедлайна SLA направления.

    Раз в час сканирует Referral в статусе CREATED. Для каждого:
      - вычисляем sla_deadline = created_at + service.sla_days
      - если now ∈ [sla_deadline-3д, sla_deadline-3д+1ч] — шлём напоминание
    Канал доставки:
      - SMS-плагин (если SMS_PROVIDER не stub) — на patient_phone
      - Telegram (если у пользователя с phone_number=patient_phone есть telegram_id)
      - Иначе пишем в /var/log/clinika/referral_reminder.log
    Чтобы не дублировать — помечаем notes маркером "[sla-reminded-patient]".
    """
    import logging, os
    from datetime import datetime, timedelta
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.referral import Referral, ReferralStatus
    from app.models.service import Service
    from app.models.user import User
    from app.plugins.registry import plugin_registry

    log = logging.getLogger("referral_reminder_patient")
    LOG_FILE = "/var/log/clinika/referral_reminder.log"
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    except Exception:
        pass

    def _audit(msg: str):
        log.info(msg)
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(f"{datetime.utcnow().isoformat()} | {msg}\n")
        except Exception:
            pass

    try:
        async with AsyncSessionLocal() as db:
            now = datetime.utcnow()
            # Берём только CREATED — кому ещё нужен напоминание о дедлайне
            result = await db.execute(
                select(Referral).where(Referral.status == ReferralStatus.CREATED)
            )
            referrals = result.scalars().all()
            sent = 0
            for r in referrals:
                # Маркер уже отправленного напоминания — чтобы не дублировать
                if r.notes and "[sla-reminded-patient]" in r.notes:
                    continue
                svc = await db.get(Service, r.service_id)
                sla_days = int(getattr(svc, "sla_days", 14) or 14)
                deadline = r.created_at + timedelta(days=sla_days)
                # Отправляем когда now входит в окно [deadline-3д, deadline-3д+1ч]
                window_start = deadline - timedelta(days=3)
                window_end = window_start + timedelta(hours=1)
                if not (window_start <= now < window_end):
                    continue

                msg = (
                    f"Напоминание: запись на услугу '{svc.name if svc else ''}' "
                    f"истекает {deadline.strftime('%d.%m.%Y')}. "
                    f"Пожалуйста, обратитесь в клинику для подтверждения."
                )
                delivered = False

                # SMS-плагин
                try:
                    sms_plugin = plugin_registry.get("sms")
                    if sms_plugin and await sms_plugin.is_enabled():
                        ok = await sms_plugin.send(r.patient_phone, msg)
                        if ok:
                            delivered = True
                            _audit(f"SMS sent referral={r.id} phone={r.patient_phone}")
                except Exception as e:
                    log.warning(f"SMS send failed for referral={r.id}: {e}")

                # Telegram (если в users есть аккаунт с тем же phone_number и заполненным telegram_id)
                try:
                    user_with_tg = (await db.execute(
                        select(User).where(
                            User.phone_number == r.patient_phone,
                            User.telegram_id != None,
                        ).limit(1)
                    )).scalar_one_or_none()
                    if user_with_tg and user_with_tg.telegram_id:
                        notify_plugin = plugin_registry.get("notify")
                        if notify_plugin and await notify_plugin.is_enabled():
                            ok = await notify_plugin.send_message(user_with_tg.telegram_id, msg)
                            if ok:
                                delivered = True
                                _audit(f"Telegram sent referral={r.id} tg={user_with_tg.telegram_id}")
                except Exception as e:
                    log.warning(f"Telegram send failed for referral={r.id}: {e}")

                if not delivered:
                    _audit(
                        f"NO CHANNEL referral={r.id} phone={r.patient_phone} "
                        f"deadline={deadline.isoformat()} (плагины не настроены)"
                    )

                # Помечаем направление чтобы не отправить повторно
                marker = "[sla-reminded-patient]"
                r.notes = (r.notes + " " + marker) if r.notes else marker
                sent += 1

            if sent:
                await db.commit()
                log.info(f"referral_reminder_patient: отправлено {sent}")
    except Exception as e:
        log.error(f"referral_reminder_patient: {e}")


async def referral_reminder_author_job():
    """APScheduler: напоминание автору направления за 1 день до дедлайна SLA.

    Раз в час сканирует Referral в статусе CREATED. Для каждого:
      - вычисляем sla_deadline = created_at + service.sla_days
      - если now ∈ [sla_deadline-1д, sla_deadline-1д+1ч] — шлём автору
    Канал доставки:
      - Telegram (NotifyPlugin) на admin_telegram_id из настроек тенанта или User.telegram_id
      - Запись в activity_log (для отображения в дашборде автора)
    Маркер: notes += "[sla-reminded-author]" — чтобы не дублировать.
    """
    import logging
    from datetime import datetime, timedelta
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.referral import Referral, ReferralStatus
    from app.models.service import Service
    from app.models.user import User
    from app.models.activity_log import ActivityLog
    from app.plugins.registry import plugin_registry

    log = logging.getLogger("referral_reminder_author")
    try:
        async with AsyncSessionLocal() as db:
            now = datetime.utcnow()
            result = await db.execute(
                select(Referral).where(Referral.status == ReferralStatus.CREATED)
            )
            referrals = result.scalars().all()
            sent = 0
            for r in referrals:
                if r.notes and "[sla-reminded-author]" in r.notes:
                    continue
                svc = await db.get(Service, r.service_id)
                sla_days = int(getattr(svc, "sla_days", 14) or 14)
                deadline = r.created_at + timedelta(days=sla_days)
                window_start = deadline - timedelta(days=1)
                window_end = window_start + timedelta(hours=1)
                if not (window_start <= now < window_end):
                    continue

                author = await db.get(User, r.created_by_admin_id)
                author_name = author.full_name if author else "—"
                msg = (
                    f"⏰ Дедлайн направления через 24 часа.\n"
                    f"Пациент: {r.patient_name or '—'} ({r.patient_phone})\n"
                    f"Услуга: {svc.name if svc else '—'}\n"
                    f"Дедлайн: {deadline.strftime('%d.%m.%Y %H:%M')}"
                )

                # Telegram автору (если у него есть telegram_id)
                try:
                    if author and author.telegram_id:
                        notify_plugin = plugin_registry.get("notify")
                        if notify_plugin and await notify_plugin.is_enabled():
                            await notify_plugin.send_message(author.telegram_id, msg)
                except Exception as e:
                    log.warning(f"author tg fail referral={r.id}: {e}")

                # Внутрикабинетная нотификация — запись в activity_log
                try:
                    db.add(ActivityLog(
                        tenant_id=r.tenant_id,
                        user_id=r.created_by_admin_id,
                        user_name=author_name,
                        action="SLA-напоминание: дедлайн направления через 24ч",
                        entity_type="referral",
                        entity_id=r.id,
                    ))
                except Exception as e:
                    log.warning(f"activity_log fail referral={r.id}: {e}")

                marker = "[sla-reminded-author]"
                r.notes = (r.notes + " " + marker) if r.notes else marker
                sent += 1

            if sent:
                await db.commit()
                log.info(f"referral_reminder_author: отправлено {sent}")
    except Exception as e:
        log.error(f"referral_reminder_author: {e}")


async def health_watchdog_job():
    """APScheduler: каждые 5 мин дёргаем /health/full сами себя.

    Логика двухуровневая:
      1) Если сам endpoint не отвечает (TCP-fail / 5xx / timeout) — копим
         fail_count, после 5 подряд шлём legacy «СЕРВЕР НЕ ОТВЕЧАЕТ».
      2) Если endpoint отвечает 200, но один из подсистем (db/redis/scheduler)
         в статусе fail/degraded — шлём admin-уведомление с детализацией.
         Дедуп по подписи провалившихся подсистем — повтор только при
         смене состояния. После восстановления шлём recovery.

    Состояние храним в атрибутах функции (fail_count, alert_sent,
    last_failed_set), чтобы не плодить глобалы.
    """
    import httpx as _httpx
    from app.services import alert_service
    from app.services.alert_service import send_alert_health, send_alert_recovery

    state = health_watchdog_job  # храним состояние в самой функции
    if not hasattr(state, "fail_count"):
        state.fail_count = 0
        state.alert_sent = False
        state.last_failed_set: frozenset[str] = frozenset()

    # ── 1. Достаём /health/full с детализацией подсистем ──
    transport_ok = False
    payload: dict | None = None
    status_code: int | None = None
    try:
        async with _httpx.AsyncClient(timeout=10) as client:
            r = await client.get("http://localhost:8000/health/full")
            status_code = r.status_code
            transport_ok = (r.status_code == 200)
            try:
                payload = r.json()
            except Exception:
                payload = None
    except Exception:
        transport_ok = False

    # ── 2. Транспортный fail (endpoint лежит / 5xx) ──
    if not transport_ok:
        state.fail_count += 1
        if state.fail_count >= 5 and not state.alert_sent:
            await send_alert_health(state.fail_count)
            state.alert_sent = True
        return

    # endpoint отвечает — сбрасываем legacy-счётчик
    if state.alert_sent:
        await send_alert_recovery()
    state.fail_count = 0
    state.alert_sent = False

    # ── 3. Проверяем подсистемы внутри payload ──
    failed: list[str] = []
    if isinstance(payload, dict):
        for key in ("db", "redis", "scheduler", "disk"):
            sub = payload.get(key)
            if isinstance(sub, dict) and sub.get("status") == "fail":
                failed.append(key)

    failed_set = frozenset(failed)
    # Уведомляем только если состояние сменилось (новый сбой / новая комбинация
    # сбоев / переход в OK после сбоя). Это и есть «дедуп: одно уведомление
    # на состояние, повтор если другая ошибка или recovered».
    if failed_set != state.last_failed_set:
        if failed:
            text = alert_service.format_health_alert(
                failed_checks=failed,
                status_code=status_code,
            )
            await alert_service.notify_admin(
                text,
                dedup_key=f"health_full:{','.join(sorted(failed))}",
                bypass_switch=True,
            )
        elif state.last_failed_set:
            # Был сбой → теперь чисто
            text = alert_service.format_health_recovery(
                prev_failed=sorted(state.last_failed_set),
            )
            await alert_service.notify_admin(
                text,
                dedup_key=f"health_full_recovery:{','.join(sorted(state.last_failed_set))}",
                bypass_switch=True,
            )
        state.last_failed_set = failed_set


async def geoip_initial_download_if_missing():
    """При первом старте после деплоя — скачать mmdb если файла ещё нет."""
    import logging, os
    log = logging.getLogger("startup")
    db_path = os.environ.get("GEOIP_DB_PATH", "/app/data/GeoLite2-City.mmdb")
    if os.path.exists(db_path):
        return
    log.info("geoip: %s отсутствует, инициирую первичную загрузку", db_path)
    try:
        await geoip_update_job()
    except Exception as e:
        log.warning("geoip_initial_download: %s", e)

log = get_logger("clinika")


# chatslot01: cron-job (15min) — помечает slot_offer старше 24ч как expired.
# Используем отдельную async-сессию (AsyncSessionLocal) чтобы не делиться с request-сессиями.
async def _expire_slot_offers_job():
    import logging as _lg
    _logger = _lg.getLogger("expire_slot_offers")
    try:
        from app.database import AsyncSessionLocal
        from app.services.slot_booking_service import expire_old_offers
        async with AsyncSessionLocal() as session:
            try:
                count = await expire_old_offers(session)
                if count > 0:
                    await session.commit()
                    _logger.info("expire_slot_offers: marked %d offers as expired", count)
            except Exception as e:
                await session.rollback()
                _logger.exception("expire_slot_offers: error: %s", e)
    except Exception as e:
        _logger.exception("expire_slot_offers: outer error: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(json_logs=True)
    log.info("clinika_starting", version="1.0.0")

    # ── Phase 0: fail-fast при дефолтных секретах ──
    # Phase 0 audit нашёл: SECRET_KEY=clinika-super-secret-key-change-in-production-2024 (default)
    # Если в проде остались дефолты — отказываемся стартовать.
    _danger_markers = ("change-in-production", "change-me", "clinika-super-secret",
                       "clinika-qr-hmac-secret-key", "clinika-support-bot-secret")
    _checks = [
        ("SECRET_KEY", settings.secret_key),
        ("QR_SECRET", getattr(settings, "qr_secret", "")),
        ("WEBHOOK_API_KEY", getattr(settings, "webhook_api_key", "")),
    ]
    _fatal = []
    for _name, _val in _checks:
        if not _val:
            _fatal.append(f"{_name} is empty")
            continue
        for _m in _danger_markers:
            if _m in str(_val).lower():
                _fatal.append(f"{_name} contains insecure default marker '{_m}'")
                break
    if _fatal:
        # В dev-режиме (DEBUG=true) — warning. В prod — отказ старта.
        _is_prod = (str(getattr(settings, "environment", "production")).lower() != "development")
        if _is_prod:
            for _msg in _fatal:
                log.error("startup_secret_check_failed", error=_msg)
            raise RuntimeError("REFUSE TO START with insecure default secrets: " + "; ".join(_fatal))
        else:
            for _msg in _fatal:
                log.warning("startup_secret_warning", message=_msg)

    # Инициализация rate limiter (Redis)
    # Инициализация Redis-клиента для метрик (независимо от rate limiter)
    try:
        import redis.asyncio as _aio
        _rc = _aio.from_url(settings.redis_url, encoding="utf8", decode_responses=True)
        from app.utils.metrics import set_redis_client as _smr
        _smr(_rc)
    except Exception as _e:
        import logging; logging.getLogger("startup").warning(f"Metrics Redis: {_e}")

    try:
        import redis.asyncio as aioredis
        from fastapi_limiter import FastAPILimiter
        redis_client = aioredis.from_url(settings.redis_url, encoding="utf8", decode_responses=True)
        await FastAPILimiter.init(redis_client)
    except Exception as e:
        import logging
        logging.getLogger("startup").warning(f"Rate limiter не инициализирован: {e}")

    async with engine.begin() as conn:
        pass  # Миграции через Alembic: alembic upgrade head
    await seed_initial_data()
    _register_plugins()
    # APScheduler — задачи с персистентностью через Redis
    scheduler.add_job(run_auto_confirm_job, 'interval', minutes=10, id='auto_confirm', replace_existing=True)
    from app.services.mis_payments_sync import sync_all_tenants_job as _mis_pay_sync_job
    scheduler.add_job(_mis_pay_sync_job, 'interval', minutes=10, id='mis_payments_sync', replace_existing=True)
    scheduler.add_job(expire_referrals_job, 'interval', hours=1, id='expire_referrals', replace_existing=True)
    scheduler.add_job(renew_plugins_job, 'interval', hours=6, id='renew_plugins', replace_existing=True)
    scheduler.add_job(module_expiry_job, 'interval', hours=1, id='module_expiry', replace_existing=True)
    # Marketplace: pre-expiry alert (за 3 дня) + post-expire alert (час)
    from app.jobs.marketplace_jobs import trial_expiring_soon_job, trial_expired_alert_job
    scheduler.add_job(trial_expiring_soon_job, 'interval', hours=6, id='mp_trial_expiring', replace_existing=True)
    scheduler.add_job(trial_expired_alert_job, 'interval', hours=1, id='mp_trial_expired', replace_existing=True)
    scheduler.add_job(franchise_invoice_job, 'cron', hour=2, minute=0, id='franchise_invoice', replace_existing=True)
    scheduler.add_job(send_heartbeat, 'interval', hours=1, id='heartbeat', replace_existing=True)
    scheduler.add_job(process_webhook_queue_job, 'interval', minutes=1, id='webhook_queue', replace_existing=True)
    scheduler.add_job(archive_audit_job, 'cron', hour=3, minute=0, id='audit_archive', replace_existing=True)
    scheduler.add_job(daily_invoices_job, 'cron', hour=0, minute=0, id='daily_invoices', replace_existing=True)
    scheduler.add_job(appointment_reminders_job, 'interval', minutes=30, id='appointment_reminders', replace_existing=True)
    # SMS-маркетинг: воркер кампаний (sms_marketing) — раз в минуту
    scheduler.add_job(sms_campaign_dispatch_job, 'interval', minutes=1, id='sms_campaign_dispatch', replace_existing=True)
    # Транскрипция записей звонков (call_recording) — раз в 2 минуты
    scheduler.add_job(transcription_dispatch_job, 'interval', minutes=2, id='transcription_dispatch', replace_existing=True)
    # Inventory-алерты (low_stock + expiring + expired) — ежедневно в 09:00 UTC
    scheduler.add_job(inventory_alerts_job, 'cron', hour=9, minute=0, id='inventory_alerts', replace_existing=True)
    # Здоровье+: ежемесячный расходник пациентам — 1-го числа в 03:00 UTC
    scheduler.add_job(subscription_monthly_supply_job, 'cron', day=1, hour=3, minute=0,
                      id='subscription_monthly_supply', replace_existing=True)
    scheduler.add_job(ads_attribution_job, 'cron', hour=4, minute=30, id='ads_attribution', replace_existing=True)
    scheduler.add_job(ads_health_pause_job, 'cron', hour=4, minute=0, id='ads_health_pause', replace_existing=True)
    scheduler.add_job(engagement_suggestions_job, 'cron', minute=15, id='engagement_suggestions', replace_existing=True)  # каждый час в :15
    scheduler.add_job(cleanup_staff_chat_files_job, 'interval', minutes=30, id='staff_chat_files_cleanup', replace_existing=True)
    # Workflow batch — SLA-checker + autoclose чатов пациент↔клиника (раз в минуту)
    from app.services.chat_sla_job import chat_sla_checker_job
    scheduler.add_job(
        chat_sla_checker_job, 'interval', seconds=60,
        id='chat_sla_checker', replace_existing=True, max_instances=1,
    )
    scheduler.add_job(tg_owner_bot_poll_job, 'interval', seconds=2, id='tg_owner_bot_poll', max_instances=1, replace_existing=True)
    # SLA-напоминания (Этап 9 ROADMAP) — пациенту за 3 дня и автору за 1 день
    scheduler.add_job(referral_reminder_patient_job, 'interval', hours=1, id='referral_reminder_patient', replace_existing=True)
    scheduler.add_job(referral_reminder_author_job, 'interval', hours=1, id='referral_reminder_author', replace_existing=True)
    # Гео-IP: еженедельное обновление dbip-city-lite (понедельник 03:00 UTC)
    scheduler.add_job(geoip_update_job, 'cron', day_of_week='mon', hour=3, minute=0, id='geoip_update', replace_existing=True)
    # LTV-аналитика: ежедневный пересчёт снапшотов в 04:00 UTC
    scheduler.add_job(run_ltv_job, 'cron', hour=4, minute=0, id='ltv_recompute', replace_existing=True)
    # Мониторинг: watchdog /health/full → Telegram-алерт админу
    # (5 фейлов подряд транспорта = «сервер не отвечает», fail подсистем =
    # отдельные уведомления с детализацией db/redis/scheduler/disk)
    scheduler.add_job(health_watchdog_job, 'interval', minutes=5, id='health_watchdog', replace_existing=True)
    # Disk usage > 80% → Telegram админу (раз в час)
    scheduler.add_job(disk_check_job, 'interval', minutes=60, id='disk_check', replace_existing=True)
    # Ежедневная сводка по сети ARC в 09:00 МСК (06:00 UTC)
    scheduler.add_job(daily_digest_job, 'cron', hour=6, minute=0, id='daily_digest', replace_existing=True)
    scheduler.add_job(cleanup_expired_password_reset_tokens, 'interval', hours=1, id='password_reset_cleanup', replace_existing=True)
    # Module Monitoring System — каждые 30 мин проверяем все active tenants
    scheduler.add_job(module_health_check_job, 'interval', minutes=30, id='module_health_check', replace_existing=True)
    scheduler.add_job(integration_retest_job, 'interval', minutes=60, id='integration_retest', replace_existing=True)
    # Журнал безопасности: каждые 5 минут сканируем audit_log на brute-force,
    # шлём Telegram-алерты, агрегируем permission.denied.
    from app.services.security_service import security_threat_scan_job
    scheduler.add_job(
        security_threat_scan_job, 'interval', minutes=5,
        id='security_threat_scan', replace_existing=True,
    )
    # Daily digest по модулям всех тенантов админу платформы (09:00 МСК = 06:00 UTC)
    scheduler.add_job(module_daily_digest_job, 'cron', hour=6, minute=0, id='module_daily_digest', replace_existing=True)
    # Глава 10: каждые 5 минут проверяем DB/disk; если критично → авто-disaster mode.
    scheduler.add_job(disaster_health_check, 'interval', minutes=5, id='disaster_health_check', replace_existing=True)
    # chatslot01: каждые 15 минут помечаем устаревшие slot_offer (>24ч) как expired
    scheduler.add_job(_expire_slot_offers_job, 'interval', minutes=15, id='expire_slot_offers', replace_existing=True)
    scheduler.start()
    # Лог зарегистрированных job'ов — удобно дебажить что реально стартует
    try:
        _log = get_logger("scheduler")
        for j in scheduler.get_jobs():
            _log.info("scheduled_job", job_id=j.id, next_run=str(j.next_run_time))
    except Exception:
        pass
    # При первом запуске (если mmdb ещё нет) — скачать в фоне, чтобы не блокировать старт
    asyncio.create_task(geoip_initial_download_if_missing())
    yield
    scheduler.shutdown(wait=False)

async def daily_invoices_job():
    """Ежедневная генерация счетов для активных подписок (00:00).

    Фикс #10 (audit Фаза 1): импорт ``SubscriptionStatus`` не существует —
    в backend/app/models/billing.py определён ``SubStatus``. Раньше job
    падала на ImportError при первом же запуске.
    Дополнительно: ``logger`` в этом модуле не определён глобально —
    используем локальный logging.getLogger.
    """
    import logging as _lg
    _logger = _lg.getLogger("daily_invoices")
    try:
        from app.database import AsyncSessionLocal
        from app.services.billing_service import generate_invoice
        from app.models.billing import Subscription, SubStatus, Invoice
        from sqlalchemy import select
        from datetime import date
        async with AsyncSessionLocal() as db:
            subs = await db.execute(
                select(Subscription).where(Subscription.status == SubStatus.ACTIVE)
            )
            active_subs = subs.scalars().all()
            generated = 0
            for sub in active_subs:
                try:
                    # Проверяем что счёт на текущий период ещё не выставлен
                    today = date.today()
                    exists = await db.execute(
                        select(Invoice).where(
                            Invoice.subscription_id == sub.id,
                            Invoice.period_start <= today,
                            Invoice.period_end >= today,
                        ).limit(1)
                    )
                    if not exists.scalar_one_or_none():
                        await generate_invoice(db, sub.id)
                        generated += 1
                except Exception as e:
                    _logger.error(f'daily_invoices: sub {sub.id}: {e}')
            await db.commit()
            _logger.info(f'daily_invoices: сгенерировано {generated} счетов из {len(active_subs)} активных подписок')
    except Exception as e:
        _logger.error(f'daily_invoices_job: {e}')


async def archive_audit_job():
    """Архивация audit_log: записи старше 90 дней переносятся в audit_log_archive."""
    try:
        from app.database import AsyncSessionLocal
        from sqlalchemy import text
        from datetime import datetime, timedelta
        cutoff = datetime.utcnow() - timedelta(days=90)
        async with AsyncSessionLocal() as db:
            # Создаём архивную таблицу если нет
            await db.execute(text(
                "CREATE TABLE IF NOT EXISTS audit_log_archive (LIKE audit_log INCLUDING ALL)"
            ))
            # Перемещаем
            result = await db.execute(text(
                "WITH moved AS (DELETE FROM audit_log WHERE created_at < :cutoff RETURNING *) "
                "INSERT INTO audit_log_archive SELECT * FROM moved"
            ), {"cutoff": cutoff})
            await db.commit()
        import logging
        logging.getLogger("scheduler").info(f"audit_archive: moved records older than {cutoff.date()}")
    except Exception as e:
        import logging; logging.getLogger("scheduler").error(f"audit_archive: {e}")



async def seed_initial_data():
    from app.database import AsyncSessionLocal
    from app.models.service import Service
    from app.models.clinic import Clinic
    from app.models.user import User, UserRole
    from app.core.security import hash_password
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        # Seed services
        result = await db.execute(select(Service).limit(1))
        if not result.scalar_one_or_none():
            services = [
                Service(name="КТ (компьютерная томография)", code="CT", bonus_amount=500),
                Service(name="МРТ", code="MRI", bonus_amount=600),
                Service(name="ЛОР", code="ENT", bonus_amount=300),
                Service(name="Кардиология", code="CARDIO", bonus_amount=400),
                Service(name="Офтальмология", code="OPHTHA", bonus_amount=300),
                Service(name="Неврология", code="NEURO", bonus_amount=400),
                Service(name="УЗИ", code="USG", bonus_amount=250),
                Service(name="Эндоскопия", code="ENDO", bonus_amount=450),
            ]
            for s in services:
                db.add(s)
            await db.commit()

        # Seed clinics
        clinic_result = await db.execute(select(Clinic).limit(1))
        if not clinic_result.scalar_one_or_none():
            demo_clinics = [
                Clinic(name="Клиника А", address="ул. Центральная, 1", phone="+7 (900) 000-00-01"),
                Clinic(name="Клиника Б — Диагностика", address="пр. Мира, 15", phone="+7 (900) 000-00-02"),
                Clinic(name="Клиника В — Кардиоцентр", address="ул. Советская, 7", phone="+7 (900) 000-00-03"),
            ]
            for c in demo_clinics:
                db.add(c)
            await db.commit()

        # Seed суперадмин — данные берутся из .env (SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD)
        admin_result = await db.execute(select(User).where(User.username == settings.superadmin_username))
        if not admin_result.scalar_one_or_none():
            superadmin = User(
                username=settings.superadmin_username,
                password_hash=hash_password(settings.superadmin_password),
                full_name=settings.superadmin_full_name,
                role=UserRole.SUPER_ADMIN,
                is_active=True,
            )
            db.add(superadmin)
            await db.commit()

        # Seed дефолтный тенант
        await _seed_default_tenant(db)

        # Seed города
        await _seed_cities(db)


async def _seed_default_tenant(db):
    from app.models.tenant import Tenant, TenantLicense, TenantBranding
    from datetime import datetime
    from sqlalchemy import select
    result = await db.execute(select(Tenant).where(Tenant.slug == "default"))
    if result.scalar_one_or_none():
        return
    tenant = Tenant(name="КлиникаСеть", slug="default", is_active=True)
    db.add(tenant)
    await db.flush()
    db.add(TenantLicense(
        tenant_id=tenant.id,
        plan="professional",
        max_clinics=50,
        max_users=500,
        valid_from=datetime(2024, 1, 1),
        is_active=True,
    ))
    db.add(TenantBranding(
        tenant_id=tenant.id,
        brand_name="КлиникаСеть",
        primary_color="#0097A7",
        sidebar_color="#004D5F",
        bg_color="#F0F5F6",
        font_family="Inter",
    ))
    await db.commit()



async def _seed_cities(db):
    from app.models.city import City
    from sqlalchemy import select
    result = await db.execute(select(City).limit(1))
    if result.scalar_one_or_none():
        return
    cities_data = [
        {"name": "Грозный",        "region": "Чеченская Республика",  "latitude": 43.317, "longitude": 45.698},
        {"name": "Москва",         "region": "Московская область",     "latitude": 55.751, "longitude": 37.618},
        {"name": "Санкт-Петербург","region": "Ленинградская область",  "latitude": 59.939, "longitude": 30.316},
        {"name": "Краснодар",      "region": "Краснодарский край",     "latitude": 45.040, "longitude": 38.976},
        {"name": "Ставрополь",     "region": "Ставропольский край",    "latitude": 45.047, "longitude": 41.969},
    ]
    for c in cities_data:
        db.add(City(**c))
    await db.commit()


async def expire_old_referrals_loop():
    """Фоновая задача: переводит просроченные направления в статус EXPIRED."""
    import logging
    from datetime import datetime
    from app.database import AsyncSessionLocal
    from app.models.referral import Referral, ReferralStatus
    from sqlalchemy import select, update

    logger = logging.getLogger("expire_referrals")
    await asyncio.sleep(120)  # Ждём запуска приложения

    while True:
        try:
            async with AsyncSessionLocal() as db:
                now = datetime.utcnow()
                result = await db.execute(
                    update(Referral)
                    .where(
                        Referral.status == ReferralStatus.CREATED,
                        Referral.expires_at < now,
                    )
                    .values(status=ReferralStatus.EXPIRED)
                    .returning(Referral.id)
                )
                expired_ids = result.fetchall()
                if expired_ids:
                    await db.commit()
                    logger.info(f"Просрочено направлений: {len(expired_ids)}")
        except Exception as e:
            import logging as _log
            _log.getLogger("expire_referrals").error(f"Ошибка истечения направлений: {e}")
        await asyncio.sleep(3600)  # Раз в час


async def renew_plugin_subscriptions_loop():
    """Фоновая задача: автопродление истёкших платных плагинов (раз в 6 часов)."""
    import logging
    from datetime import datetime
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.billing import TenantPluginSubscription
    from app.services.billing_service import charge_plugin_subscription, PluginSubStatus

    logger = logging.getLogger("plugin_renewal")
    await asyncio.sleep(180)  # Ждём старта приложения

    while True:
        try:
            async with AsyncSessionLocal() as db:
                now = datetime.utcnow()
                # Находим активные подписки с истёкшим expires_at
                result = await db.execute(
                    select(TenantPluginSubscription).where(
                        TenantPluginSubscription.status == PluginSubStatus.ACTIVE,
                        TenantPluginSubscription.auto_renew == True,
                        TenantPluginSubscription.expires_at < now,
                    )
                )
                subs = result.scalars().all()
                renewed = 0
                for sub in subs:
                    try:
                        await charge_plugin_subscription(db, sub.id)
                        await db.commit()
                        renewed += 1
                    except Exception as e:
                        await db.rollback()
                        logger.warning(f"Не удалось продлить плагин {sub.feature_key} tenant={sub.tenant_id}: {e}")
                if renewed:
                    logger.info(f"Продлено плагинов: {renewed}")
        except Exception as e:
            logger.error(f"Ошибка цикла продления плагинов: {e}")
        await asyncio.sleep(21600)  # Раз в 6 часов


app = FastAPI(
    title="Клиника — Система направлений",
    description="Платформа учёта направлений и бонусов для сети клиник",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url="/openapi.json",
)

# ─── CORS: берём из конфига (ALLOWED_ORIGINS в .env) ───
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)




# ─── Custom Swagger UI / Redoc — независимо от tenant slug ──────────────────
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html

# Phase 0: /docs и /redoc только для super_admin
from app.core.deps import get_current_user as _gcu_docs
from app.models.user import User as _UserDocs, UserRole as _UR

async def _require_super_admin_docs(user: _UserDocs = Depends(_gcu_docs)):
    if user.role != _UR.SUPER_ADMIN:
        raise HTTPException(404)
    return user

@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html(_: _UserDocs = Depends(_require_super_admin_docs)):
    return get_swagger_ui_html(openapi_url="openapi.json", title="Клиника API — Swagger UI")

@app.get("/redoc", include_in_schema=False)
async def custom_redoc_html(_: _UserDocs = Depends(_require_super_admin_docs)):
    return get_redoc_html(openapi_url="openapi.json", title="Клиника API — ReDoc")


app.middleware("http")(SlidingWindowRateLimiter(limit=200, window=60))
app.add_middleware(DomainRouterMiddleware)

# ─── Журнал безопасности: блокировка IP по ручному списку super_admin'а ─
# Middleware кеширует список заблокированных IP на 30 секунд. Кеш инвалидируется
# роутером /admin/security/block-ip через app.state.block_ip_mw.invalidate().
# Создаём singleton через @app.middleware('http'), чтобы роутер мог инвалидировать
# его кеш (через app.state). Через add_middleware был бы создан внутренний
# инстанс, недоступный для invalidate.
from app.core.block_ip_middleware import BlockIpMiddleware as _BlockIpMW
block_ip_middleware = _BlockIpMW(app)
app.state.block_ip_mw = block_ip_middleware

@app.middleware("http")
async def _block_ip_dispatch(request: Request, call_next):
    return await block_ip_middleware.dispatch(request, call_next)

# ─── Request ContextVar — кладём request в contextvar чтобы audit_service нашёл по fallback
@app.middleware("http")
async def request_ctx_middleware(request: Request, call_next):
    from app.core.request_ctx import current_request
    token = current_request.set(request)
    try:
        return await call_next(request)
    finally:
        current_request.reset(token)


# ─── Глава 10: Disaster-mode middleware ───
# Если файл /app/data/disaster_mode.flag существует — блокируем все mutation-запросы
# (POST/PUT/PATCH/DELETE) с 503. GET-запросы продолжают работать (read-only).
# Whitelisted: /health*, /docs, /admin/system/*.
@app.middleware("http")
async def _disaster_mode_dispatch(request: Request, call_next):
    return await _disaster_mw.disaster_middleware(request, call_next)


# ─── Security headers ───
@app.middleware("http")
async def request_metrics_middleware(request: Request, call_next):
    """Собирает метрики каждого запроса в Redis."""
    import time as _time
    _start = _time.monotonic()
    response = await call_next(request)
    _latency = (_time.monotonic() - _start) * 1000
    try:
        from app.utils.metrics import record_request as _rec
        await _rec(request.method, request.url.path, response.status_code, _latency)
    except Exception:
        pass
    return response


@app.middleware("http")
async def device_detection_middleware(request: Request, call_next):
    from app.utils.device import parse_user_agent
    ua = request.headers.get("user-agent")
    request.state.device_type = parse_user_agent(ua)
    request.state.client_ip = (
        request.headers.get("x-real-ip")
        or (request.headers.get("x-forwarded-for", "").split(",")[0].strip())
        or (request.client.host if request.client else None)
    )
    return await call_next(request)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response

@app.middleware("http")
async def telegram_alert_middleware(request: Request, call_next):
    """Catch-all 500: при любой 5xx или unhandled exception шлём Telegram-алерт.

    Внутренняя логика — в app.services.alert_service. Дедупликация (10 минут)
    защищает чат от спама при сломанном endpoint'е.
    """
    try:
        response = await call_next(request)
        if response.status_code >= 500:
            from app.services.alert_service import send_alert_500
            asyncio.create_task(send_alert_500(
                method=request.method,
                path=str(request.url.path),
                status=response.status_code,
                client_ip=request.client.host if request.client else "?",
            ))
        return response
    except Exception as e:
        # Поймали unhandled exception — отдаём дальше FastAPI, но успеваем
        # уведомить Telegram (asyncio.create_task → не блокируем raise).
        import traceback
        from app.services.alert_service import send_alert_exception
        asyncio.create_task(send_alert_exception(
            method=request.method,
            path=str(request.url.path),
            exc=e,
            tb=traceback.format_exc(),
            client_ip=request.client.host if request.client else "?",
        ))
        raise  # пусть дальше обрабатывает FastAPI


@app.middleware("http")
async def prometheus_middleware(request: Request, call_next):
    return await metrics_middleware(request, call_next)

app.include_router(domain_router)  # /.well-known/clinika-domain/*
app.include_router(auth.router)
app.include_router(password_reset_router)
from app.routers.reg_speed import router as reg_speed_router
app.include_router(reg_speed_router)  # Глава 5: PDF/печать/поиск пациентов для регистратора
app.include_router(referrals.router)
app.include_router(bonuses.router)
app.include_router(partner_offers.router)  # /clinics/me/partner-* и /clinics/{id}/partner-offers
app.include_router(clinics.router)
app.include_router(admins.router)
# Профиль сотрудника — личный кабинет (avatar01): /profile/me, /profile/me/avatar
app.include_router(profile_router_module.router)
app.include_router(manager_router)
app.include_router(accountant_router)
app.include_router(contact_router)
app.include_router(support_router)
app.include_router(integrations.router)
app.include_router(system_router)
app.include_router(wiki_router)
app.include_router(reviews_router)
app.include_router(ici_router)
app.include_router(patient_family_router)
app.include_router(patient_router)
app.include_router(patient_chat_router)
app.include_router(ai_knowledge_router)
app.include_router(portal_router)
app.include_router(monitoring_router)
app.include_router(tenant_router)
# plugins_router удалён — старая plugin_*-система выпилена (заменена commercial_modules)
app.include_router(modules_router)
app.include_router(geo_router)
app.include_router(scheduling_router)
# Итоги приёма (заключение/файлы/направления/история пациента)
app.include_router(appointments_router)
app.include_router(ledger_router)
app.include_router(analytics_router)
app.include_router(audit_router)
app.include_router(billing_router)
app.include_router(consent_router)
from app.routers import call_rules as call_rules_router
app.include_router(call_rules_router.router)
app.include_router(admin_router)
app.include_router(franchise_owner_router)
app.include_router(franchise_owner_clinics_router)
app.include_router(franchise_analytics_router)
app.include_router(partner_clinics_router)
app.include_router(mis_router)
app.include_router(presence_router)
app.include_router(calls_router)
app.include_router(push_router)
app.include_router(webhooks_router)
app.include_router(tenant_api_keys_router)
app.include_router(public_api_v1_router)
app.include_router(ads_router)
app.include_router(ads_ai_router)
app.include_router(ads_analytics_router)
app.include_router(engagement_analytics_router)
app.include_router(engagement_segments_router)
app.include_router(engagement_crm_router)
app.include_router(network_dashboard_router)
app.include_router(franchise_visibility_router)
app.include_router(ads_workflow_router)
app.include_router(commercial_router)
app.include_router(marketplace_router)
app.include_router(ai_router)
app.include_router(ai_platform_router)
app.include_router(recruiter_router)
app.include_router(visiting_router)
app.include_router(doctor_ai_router)
app.include_router(regulations_router)
app.include_router(admin_regulations_router)
app.include_router(external_doctor_router)
app.include_router(cms_router)
app.include_router(acts_router)
app.include_router(inter_clinic_acts_router)
app.include_router(public_booking_router)
app.include_router(public_clinic_router)
app.include_router(medcard_router)
app.include_router(patient_documents_router)
app.include_router(prescriptions_router)
app.include_router(vitals_router)
app.include_router(loyalty_router)
app.include_router(patient_loyalty_router)
app.include_router(admin_loyalty_router)
app.include_router(patient_spending_router)
app.include_router(permissions_router)
app.include_router(ltv_router)
# Платёжный каркас (online_payments_pro + fiscal_54fz_pro)
app.include_router(clinic_payments_router)
app.include_router(fiscal_receipts_router)
# Live tail логов backend для super_admin (debug инструмент)
app.include_router(admin_logs_router)
# Tenant impersonation — POST /admin/impersonate + /stop + GET /active + /history
app.include_router(impersonation_router)
# W3: глобальный поиск /search (Cmd+K) + центр уведомлений
app.include_router(search_router)
app.include_router(notifications_router)
# W4: Onboarding wizard для franchise_owner
app.include_router(onboarding_router)
app.include_router(public_onboarding_router)
# Telemedicine: REST врача + публичный portal + WS signaling
app.include_router(telemedicine_router)
app.include_router(telemedicine_patient_router)
# Patient notifications WS — realtime входящие «звонки» в ЛК пациента
app.include_router(patient_notifications_router)
# SMS-маркетинг — модуль рассылок (W5)
app.include_router(sms_marketing_router)
# AI-ассистент пациенту через Gemini — модуль ai_assistant (W6)
app.include_router(ai_assistant_router)
app.include_router(ai_assistant_admin_router)
# Запись звонков + Whisper транскрипция — модуль call_recording (W5)
app.include_router(call_recording_router)
# Inventory — учёт материалов, остатков и движений (W7)
app.include_router(inventory_router)
# Module Monitoring System — health-state платных модулей (cron + UI)
app.include_router(module_monitoring_router)
# Журнал безопасности — единый dashboard алертов для super_admin
app.include_router(security_router)
# Глава 9 — Подписка/чат/календарь/документы пациента
app.include_router(patient_subscription_router)
app.include_router(admin_subscription_plans_router)
app.include_router(manager_subscription_cash_router)
app.include_router(patient_chat_threads_router)
app.include_router(clinic_chat_router)
# chatslot01: запись через чат — slot_offer / slot_request / book-slot
app.include_router(clinic_chat_slots_router)
app.include_router(patient_chat_slots_router)
app.include_router(staff_chat_router)
app.include_router(staff_chat_bot_router)
app.include_router(staff_chat_cross_router)
app.include_router(owner_bot_webhook_router)
app.include_router(chat_admin_router)
# Workflow batch — tenant chat settings (SLA/autoclose) + CRUD message templates
from app.routers.tenant_settings import router as _tenant_settings_router
from app.routers.chat_templates import router as _chat_templates_router
app.include_router(_tenant_settings_router)
app.include_router(_chat_templates_router)
app.include_router(franchise_modules_router)
app.include_router(franchise_revenue_router)
app.include_router(patient_calendar_router)
app.include_router(patient_health_documents_router)
app.include_router(doctor_patient_documents_router)
# Глава 10 — Интеграции
app.include_router(admin_lab_router)
app.include_router(doctor_lab_router)
app.include_router(patient_lab_router)
app.include_router(wellness_router)
app.include_router(admin_aggregator_router)
app.include_router(public_aggregator_router)
app.include_router(admin_system_router)
app.include_router(supervisor_router)
app.include_router(health_detailed_router)
app.include_router(prometheus_router)

# Telephony (PSTN: конфиг провайдера, DID-номера, dial, история звонков)
from app.routers.tenant_telephony import router as _telephony_router
app.include_router(_telephony_router)
app.include_router(announcements_router)
app.include_router(director_router)
app.include_router(director_export_router)
app.include_router(inventory_import_router)
app.include_router(inventory_batches_router)
app.include_router(manager_mis_webhooks_router)
app.include_router(marketing_ads_router)
app.include_router(service_norms_router)
app.include_router(subscription_discounts_router)
app.include_router(subscription_pending_router)

# Reviews plugin
from app.plugins.reviews import ReviewsPlugin
from app.plugins.registry import plugin_registry
plugin_registry.register(ReviewsPlugin())


@app.get("/health")
async def health():
    return {"status": "ok", "service": "clinika-backend"}


@app.get("/health/full")
async def health_full():
    """Расширенный health-чек для Uptime-Kuma и алёртов.
    Возвращает JSON со статусом критичных подсистем:
      - db: PostgreSQL (SELECT 1)
      - redis: Redis (PING)
      - disk: свободное место на /
      - scheduler: APScheduler (running + кол-во job)
      - version: содержимое /app/VERSION
    Никогда не падает с 5xx — все ошибки ловим, чтобы Uptime-Kuma
    видел JSON, а не connection error.
    """
    import shutil

    result: dict = {"status": "ok"}

    # ── DB ───────────────────────────────────────────────────────────────
    try:
        async with AsyncSessionLocal() as _s:
            r = await _s.execute(text("SELECT 1"))
            r.scalar()
        result["db"] = {"status": "ok"}
    except Exception as e:
        result["db"] = {"status": "fail", "error": str(e)[:200]}
        result["status"] = "degraded"

    # ── Redis ────────────────────────────────────────────────────────────
    try:
        import redis.asyncio as aioredis
        _r = aioredis.from_url(settings.redis_url, decode_responses=True)
        pong = await _r.ping()
        await _r.close()
        result["redis"] = {"status": "ok" if pong else "fail"}
        if not pong:
            result["status"] = "degraded"
    except Exception as e:
        result["redis"] = {"status": "fail", "error": str(e)[:200]}
        result["status"] = "degraded"

    # ── Disk ─────────────────────────────────────────────────────────────
    try:
        usage = shutil.disk_usage("/")
        free_gb = round(usage.free / 1024 / 1024 / 1024, 2)
        total_gb = round(usage.total / 1024 / 1024 / 1024, 2)
        used_pct = round((usage.used / usage.total) * 100, 1)
        disk_status = "ok"
        if used_pct >= 95:
            disk_status = "fail"
            result["status"] = "degraded"
        elif used_pct >= 85:
            disk_status = "warn"
        result["disk"] = {
            "status": disk_status,
            "free_gb": free_gb,
            "total_gb": total_gb,
            "used_percent": used_pct,
        }
    except Exception as e:
        result["disk"] = {"status": "fail", "error": str(e)[:200]}

    # ── Scheduler (APScheduler) ─────────────────────────────────────────
    try:
        running = bool(getattr(scheduler, "running", False))
        jobs = scheduler.get_jobs() if running else []
        result["scheduler"] = {
            "status": "ok" if running else "fail",
            "running": running,
            "jobs": len(jobs),
        }
        if not running:
            result["status"] = "degraded"
    except Exception as e:
        result["scheduler"] = {"status": "fail", "error": str(e)[:200]}
        result["status"] = "degraded"

    # ── Version ──────────────────────────────────────────────────────────
    try:
        with open("/app/VERSION", "r", encoding="utf-8") as f:
            result["version"] = f.read().strip()
    except Exception:
        result["version"] = os.environ.get("APP_VERSION", "unknown")

    return result



@app.get("/_test_alert_500", include_in_schema=False)
async def _test_alert_500():
    """Тестовый endpoint — намеренно бросает исключение, чтобы проверить
    Telegram-алерт через telegram_alert_middleware. Не светим в Swagger."""
    raise RuntimeError("Тестовый алерт: проверка Telegram-уведомлений (это не баг)")
