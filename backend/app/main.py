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

from fastapi import FastAPI, Request
from app.core.logging import setup_logging, get_logger
from app.core.prometheus import router as prometheus_router, metrics_middleware
from fastapi.middleware.cors import CORSMiddleware
from app.core.security_utils import SlidingWindowRateLimiter
from app.core.domain_router import DomainRouterMiddleware, router as domain_router
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.config import settings
from app.database import engine, Base
import asyncio
from app.routers import auth, referrals, bonuses, clinics, admins, integrations
from app.routers.manager import router as manager_router
from app.routers.monitoring import router as monitoring_router
from app.routers.tenant import router as tenant_router
# plugins_router удалён — старая plugin_*-система выпилена (заменена commercial_modules)
from app.routers.modules import router as modules_router
from app.routers.geo import router as geo_router
from app.routers.scheduling import router as scheduling_router
from app.routers.ledger import router as ledger_router
from app.routers.analytics import router as analytics_router
from app.routers.audit import router as audit_router
from app.routers.billing import router as billing_router
from app.routers.consent import router as consent_router
from app.routers.admin import router as admin_router
from app.routers.franchise_owner import router as franchise_owner_router
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
from app.routers.ads import router as ads_router
from app.routers.commercial import router as commercial_router
from app.routers.ai import router as ai_router
from app.routers.ai_platform import router as ai_platform_router
from app.routers.recruiter import router as recruiter_router
from app.routers.visiting_doctor import router as visiting_router
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
from app.routers.permissions import router as permissions_router
from app.routers.ltv import router as ltv_router
# Платёжный каркас (online_payments_pro + fiscal_54fz_pro)
from app.routers.clinic_payments import router as clinic_payments_router
from app.routers.fiscal_receipts import router as fiscal_receipts_router
from app.routers.admin_logs import router as admin_logs_router
# Глобальный поиск Cmd+K и центр уведомлений (W3 UX-улучшения)
from app.routers.search import router as search_router
from app.routers.notifications import router as notifications_router
# W4: Пошаговый wizard онбординга для franchise_owner
from app.routers.onboarding import router as onboarding_router
from app.core.scheduler import scheduler
from app.services.auto_confirm import auto_confirm_loop
from app.models import *  # Import all models for table creation



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
    """APScheduler: каждые 5 мин дёргаем /health сами себя.

    После 5 фейлов подряд — шлём Telegram-алерт админу. После восстановления —
    отдельное «✅ Сервер восстановился». Состояние храним прямо в атрибутах
    функции (fail_count, alert_sent), чтобы не плодить глобалы.
    """
    import httpx as _httpx
    from app.services.alert_service import send_alert_health, send_alert_recovery

    state = health_watchdog_job  # храним состояние в самой функции
    if not hasattr(state, "fail_count"):
        state.fail_count = 0
        state.alert_sent = False

    ok = False
    try:
        async with _httpx.AsyncClient(timeout=5) as client:
            r = await client.get("http://localhost:8000/health")
            ok = (r.status_code == 200)
    except Exception:
        ok = False

    if ok:
        if state.alert_sent:
            await send_alert_recovery()
        state.fail_count = 0
        state.alert_sent = False
        return

    state.fail_count += 1
    if state.fail_count >= 5 and not state.alert_sent:
        await send_alert_health(state.fail_count)
        state.alert_sent = True


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

@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(json_logs=True)
    log.info("clinika_starting", version="1.0.0")
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
    scheduler.add_job(expire_referrals_job, 'interval', hours=1, id='expire_referrals', replace_existing=True)
    scheduler.add_job(renew_plugins_job, 'interval', hours=6, id='renew_plugins', replace_existing=True)
    scheduler.add_job(module_expiry_job, 'interval', hours=1, id='module_expiry', replace_existing=True)
    scheduler.add_job(franchise_invoice_job, 'cron', hour=2, minute=0, id='franchise_invoice', replace_existing=True)
    scheduler.add_job(send_heartbeat, 'interval', hours=1, id='heartbeat', replace_existing=True)
    scheduler.add_job(process_webhook_queue_job, 'interval', minutes=1, id='webhook_queue', replace_existing=True)
    scheduler.add_job(archive_audit_job, 'cron', hour=3, minute=0, id='audit_archive', replace_existing=True)
    scheduler.add_job(daily_invoices_job, 'cron', hour=0, minute=0, id='daily_invoices', replace_existing=True)
    scheduler.add_job(appointment_reminders_job, 'interval', minutes=30, id='appointment_reminders', replace_existing=True)
    # SLA-напоминания (Этап 9 ROADMAP) — пациенту за 3 дня и автору за 1 день
    scheduler.add_job(referral_reminder_patient_job, 'interval', hours=1, id='referral_reminder_patient', replace_existing=True)
    scheduler.add_job(referral_reminder_author_job, 'interval', hours=1, id='referral_reminder_author', replace_existing=True)
    # Гео-IP: еженедельное обновление dbip-city-lite (понедельник 03:00 UTC)
    scheduler.add_job(geoip_update_job, 'cron', day_of_week='mon', hour=3, minute=0, id='geoip_update', replace_existing=True)
    # LTV-аналитика: ежедневный пересчёт снапшотов в 04:00 UTC
    scheduler.add_job(run_ltv_job, 'cron', hour=4, minute=0, id='ltv_recompute', replace_existing=True)
    # Мониторинг: watchdog /health → Telegram-алерт после 5 фейлов подряд
    scheduler.add_job(health_watchdog_job, 'interval', minutes=5, id='health_watchdog', replace_existing=True)
    scheduler.start()
    # При первом запуске (если mmdb ещё нет) — скачать в фоне, чтобы не блокировать старт
    asyncio.create_task(geoip_initial_download_if_missing())
    yield
    scheduler.shutdown(wait=False)

async def daily_invoices_job():
    """Ежедневная генерация счетов для активных подписок (00:00)."""
    try:
        from app.database import AsyncSessionLocal
        from app.services.billing_service import generate_invoice
        from app.models.billing import Subscription, SubscriptionStatus, Invoice
        from sqlalchemy import select
        from datetime import date
        async with AsyncSessionLocal() as db:
            subs = await db.execute(
                select(Subscription).where(Subscription.status == SubscriptionStatus.ACTIVE)
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
                    logger.error(f'daily_invoices: sub {sub.id}: {e}')
            await db.commit()
            logger.info(f'daily_invoices: сгенерировано {generated} счетов из {len(active_subs)} активных подписок')
    except Exception as e:
        logger.error(f'daily_invoices_job: {e}')


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

@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    """Swagger UI: openapi.json подгружается с относительного URL,
    что корректно работает за любым slug-prefix nginx."""
    return get_swagger_ui_html(
        openapi_url="openapi.json",
        title="Клиника API — Swagger UI",
    )


@app.get("/redoc", include_in_schema=False)
async def custom_redoc_html():
    return get_redoc_html(
        openapi_url="openapi.json",
        title="Клиника API — ReDoc",
    )


app.middleware("http")(SlidingWindowRateLimiter(limit=200, window=60))
app.add_middleware(DomainRouterMiddleware)

# ─── Request ContextVar — кладём request в contextvar чтобы audit_service нашёл по fallback
@app.middleware("http")
async def request_ctx_middleware(request: Request, call_next):
    from app.core.request_ctx import current_request
    token = current_request.set(request)
    try:
        return await call_next(request)
    finally:
        current_request.reset(token)


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
app.include_router(referrals.router)
app.include_router(bonuses.router)
app.include_router(clinics.router)
app.include_router(admins.router)
app.include_router(manager_router)
app.include_router(contact_router)
app.include_router(support_router)
app.include_router(integrations.router)
app.include_router(system_router)
app.include_router(wiki_router)
app.include_router(reviews_router)
app.include_router(ici_router)
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
app.include_router(ledger_router)
app.include_router(analytics_router)
app.include_router(audit_router)
app.include_router(billing_router)
app.include_router(consent_router)
from app.routers import call_rules as call_rules_router
app.include_router(call_rules_router.router)
app.include_router(admin_router)
app.include_router(franchise_owner_router)
app.include_router(partner_clinics_router)
app.include_router(mis_router)
app.include_router(presence_router)
app.include_router(calls_router)
app.include_router(push_router)
app.include_router(webhooks_router)
app.include_router(ads_router)
app.include_router(commercial_router)
app.include_router(ai_router)
app.include_router(ai_platform_router)
app.include_router(recruiter_router)
app.include_router(visiting_router)
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
app.include_router(permissions_router)
app.include_router(ltv_router)
# Платёжный каркас (online_payments_pro + fiscal_54fz_pro)
app.include_router(clinic_payments_router)
app.include_router(fiscal_receipts_router)
# Live tail логов backend для super_admin (debug инструмент)
app.include_router(admin_logs_router)
# W3: глобальный поиск /search (Cmd+K) + центр уведомлений
app.include_router(search_router)
app.include_router(notifications_router)
# W4: Onboarding wizard для franchise_owner
app.include_router(onboarding_router)
app.include_router(prometheus_router)

# Reviews plugin
from app.plugins.reviews import ReviewsPlugin
from app.plugins.registry import plugin_registry
plugin_registry.register(ReviewsPlugin())


@app.get("/health")
async def health():
    return {"status": "ok", "service": "clinika-backend"}


@app.get("/_test_alert_500", include_in_schema=False)
async def _test_alert_500():
    """Тестовый endpoint — намеренно бросает исключение, чтобы проверить
    Telegram-алерт через telegram_alert_middleware. Не светим в Swagger."""
    raise RuntimeError("Тестовый алерт: проверка Telegram-уведомлений (это не баг)")
