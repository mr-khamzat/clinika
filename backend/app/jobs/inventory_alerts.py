"""
Background-job: ежедневный сканер inventory-алертов.

Запускается APScheduler'ом раз в день (cron 09:00). Алгоритм:
1. Проходит по всем тенантам, у которых модуль `inventory` ACTIVE/TRIAL/GRACE.
2. Для каждого считает low_stock + expiring (≤ 30 дней) + expired позиции.
3. Если есть алерты — отправляет компактное сообщение админу платформы
   через alert_service._send_telegram (ADMIN_CHAT_ID).

Важно: в первую итерацию шлём только админу платформы. Персональные
алерты менеджеру тенанта потребуют tenant-level Telegram-конфига —
сделаем во второй итерации.
"""
import logging
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models.commercial import (
    ModuleStatus,
    TenantModuleSubscription,
)
from app.models.inventory import InventoryItem, InventoryStock
from app.models.tenant import Tenant
from app.services import alert_service


log = logging.getLogger("inventory_alerts")


async def run_inventory_alerts() -> int:
    """Возвращает количество тенантов, которым ушло хотя бы одно сообщение."""
    sent_to_tenants = 0

    async with AsyncSessionLocal() as db:
        # Тенанты с подключённым модулем inventory
        rows = (
            await db.execute(
                select(TenantModuleSubscription.tenant_id, Tenant.name)
                .join(Tenant, Tenant.id == TenantModuleSubscription.tenant_id)
                .where(
                    TenantModuleSubscription.module_key == "inventory",
                    TenantModuleSubscription.status.in_([
                        ModuleStatus.ACTIVE,
                        ModuleStatus.TRIAL,
                        ModuleStatus.GRACE,
                    ]),
                )
            )
        ).all()

        today = date.today()
        cutoff = today + timedelta(days=30)

        for tenant_id, tenant_name in rows:
            # ── low_stock ────────────────────────────────────────────────
            sum_q = (
                select(
                    InventoryStock.item_id.label("item_id"),
                    func.coalesce(
                        func.sum(InventoryStock.quantity), Decimal("0"),
                    ).label("total"),
                )
                .where(InventoryStock.tenant_id == tenant_id)
                .group_by(InventoryStock.item_id)
                .subquery()
            )
            low_count = (
                await db.execute(
                    select(func.count(InventoryItem.id))
                    .outerjoin(sum_q, sum_q.c.item_id == InventoryItem.id)
                    .where(
                        InventoryItem.tenant_id == tenant_id,
                        InventoryItem.is_active.is_(True),
                        InventoryItem.min_stock_threshold > 0,
                        func.coalesce(sum_q.c.total, Decimal("0"))
                        < InventoryItem.min_stock_threshold,
                    )
                )
            ).scalar_one()

            # ── expiring ─────────────────────────────────────────────────
            expiring_count = (
                await db.execute(
                    select(func.count(InventoryStock.id)).where(
                        InventoryStock.tenant_id == tenant_id,
                        InventoryStock.expiry_date.is_not(None),
                        InventoryStock.expiry_date >= today,
                        InventoryStock.expiry_date <= cutoff,
                        InventoryStock.quantity > 0,
                    )
                )
            ).scalar_one()

            # ── expired ──────────────────────────────────────────────────
            expired_count = (
                await db.execute(
                    select(func.count(InventoryStock.id)).where(
                        InventoryStock.tenant_id == tenant_id,
                        InventoryStock.expiry_date.is_not(None),
                        InventoryStock.expiry_date < today,
                        InventoryStock.quantity > 0,
                    )
                )
            ).scalar_one()

            total = (low_count or 0) + (expiring_count or 0) + (expired_count or 0)
            if total <= 0:
                continue

            text = (
                f"📦 <b>Inventory · {tenant_name}</b>\n"
                f"Низкие остатки: <b>{low_count}</b>\n"
                f"Скоро просрочка (≤30д): <b>{expiring_count}</b>\n"
                f"Просрочено: <b>{expired_count}</b>"
            )
            try:
                ok = await alert_service._send_telegram(text)
                if ok:
                    sent_to_tenants += 1
            except Exception as e:
                log.warning(f"send alert for tenant {tenant_id}: {e}")

    return sent_to_tenants
