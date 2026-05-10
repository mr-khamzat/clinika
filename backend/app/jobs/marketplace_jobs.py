"""
Marketplace jobs — pre-expiry уведомления о триале + (опц.) auto-expire post-check.

`module_expiry_job` уже переводит trial→expired по достижении trial_ends_at.
Здесь мы добавляем:
  • trial_expiring_soon_job — за 3 дня до окончания триала шлёт Telegram админу тенанта;
  • trial_expired_alert_job — после автоперехода в expired шлёт Telegram админу tenant'а.

Оба джоба идемпотентны через дедуп `alert_service.notify_admin(dedup_key=...)`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.commercial import (
    CommercialModule,
    TenantModuleSubscription,
    ModuleStatus,
)
from app.models.tenant import Tenant
from app.services import alert_service

log = logging.getLogger("marketplace_jobs")


async def trial_expiring_soon_job() -> None:
    """Каждые 6 часов: предупреждение за 3 дня до окончания триала.

    Дедуп — по (sub.id, дата) — чтобы не спамить.
    """
    try:
        async with AsyncSessionLocal() as db:  # type: AsyncSession
            now = datetime.utcnow()
            window_start = now + timedelta(days=2, hours=12)
            window_end   = now + timedelta(days=3, hours=12)

            rows = (await db.execute(
                select(TenantModuleSubscription).where(
                    TenantModuleSubscription.status == ModuleStatus.TRIAL,
                    TenantModuleSubscription.trial_ends_at != None,  # noqa: E711
                    TenantModuleSubscription.trial_ends_at >= window_start,
                    TenantModuleSubscription.trial_ends_at <= window_end,
                )
            )).scalars().all()

            if not rows:
                return

            # Пресет: подтянем имена тенантов и модулей одним проходом
            tenant_ids = {r.tenant_id for r in rows}
            module_keys = {r.module_key for r in rows}
            tenants_map = {
                t.id: t for t in (await db.execute(
                    select(Tenant).where(Tenant.id.in_(tenant_ids))
                )).scalars().all()
            }
            modules_map = {
                m.key: m for m in (await db.execute(
                    select(CommercialModule).where(
                        CommercialModule.key.in_(module_keys)
                    )
                )).scalars().all()
            }

            sent = 0
            for sub in rows:
                t = tenants_map.get(sub.tenant_id)
                m = modules_map.get(sub.module_key)
                if not (t and m and sub.trial_ends_at):
                    continue
                ends = sub.trial_ends_at.strftime("%d.%m.%Y %H:%M UTC")
                key  = f"trial_expiring:{sub.id}:{sub.trial_ends_at.date()}"
                ok = await alert_service.notify_admin(
                    "\n".join([
                        "<b>Триал модуля заканчивается через 3 дня</b>",
                        f"  • Тенант: <b>{t.name}</b> ({t.slug})",
                        f"  • Модуль: <b>{m.name}</b> ({m.key})",
                        f"  • Окончание: <b>{ends}</b>",
                        "После — модуль перейдёт в expired (или active при оплате).",
                    ]),
                    dedup_key=key,
                )
                if ok:
                    sent += 1
            if sent:
                log.info(f"trial_expiring_soon_job: sent {sent} alerts")
    except Exception as e:
        log.error(f"trial_expiring_soon_job: {e}")


async def trial_expired_alert_job() -> None:
    """Каждый час после module_expiry_job: алерт о только что истёкшем триале.

    Дедуп — по sub.id (один раз на подписку).
    Берём подписки в expired, где trial_ends_at < now < trial_ends_at + 2h.
    """
    try:
        async with AsyncSessionLocal() as db:  # type: AsyncSession
            now = datetime.utcnow()
            cutoff = now - timedelta(hours=2)

            rows = (await db.execute(
                select(TenantModuleSubscription).where(
                    TenantModuleSubscription.status == ModuleStatus.EXPIRED,
                    TenantModuleSubscription.trial_ends_at != None,  # noqa: E711
                    TenantModuleSubscription.trial_ends_at >= cutoff,
                    TenantModuleSubscription.trial_ends_at <= now,
                )
            )).scalars().all()
            if not rows:
                return

            tenant_ids = {r.tenant_id for r in rows}
            module_keys = {r.module_key for r in rows}
            tenants_map = {
                t.id: t for t in (await db.execute(
                    select(Tenant).where(Tenant.id.in_(tenant_ids))
                )).scalars().all()
            }
            modules_map = {
                m.key: m for m in (await db.execute(
                    select(CommercialModule).where(
                        CommercialModule.key.in_(module_keys)
                    )
                )).scalars().all()
            }
            sent = 0
            for sub in rows:
                t = tenants_map.get(sub.tenant_id)
                m = modules_map.get(sub.module_key)
                if not (t and m):
                    continue
                key = f"trial_expired:{sub.id}"
                ok = await alert_service.notify_admin(
                    "\n".join([
                        "<b>Триал модуля закончился</b>",
                        f"  • Тенант: <b>{t.name}</b> ({t.slug})",
                        f"  • Модуль: <b>{m.name}</b>",
                        "Статус подписки: <b>expired</b>. "
                        "Для продолжения — активировать через Marketplace.",
                    ]),
                    dedup_key=key,
                )
                if ok:
                    sent += 1
            if sent:
                log.info(f"trial_expired_alert_job: sent {sent} alerts")
    except Exception as e:
        log.error(f"trial_expired_alert_job: {e}")
