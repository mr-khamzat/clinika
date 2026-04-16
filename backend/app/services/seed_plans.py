"""
Seed тарифных планов в БД.

Запускать один раз после миграции j0k1l2m3n4o5.
Идемпотентно: пропускает уже существующие планы.

Планы синхронизированы с PLAN_PRICES из billing.py
и PLAN_DEFAULTS из core/limits.py.

Запуск:
  docker exec clinika-backend python -m app.services.seed_plans
"""
import asyncio
from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
import os

from app.models.billing_plan import TenantPlan

# Определение планов (source of truth)
PLANS = [
    {
        "name": "basic",
        "display_name": "Базовый",
        "description": "Для небольших клиник. До 3 клиник, до 20 сотрудников.",
        "base_price_month": Decimal("9900"),
        "base_price_year": Decimal("99000"),   # ~16% скидка
        "max_clinics": 3,
        "max_users": 20,
        "features": {
            "scheduling": False,
            "analytics": False,
            "kpi": False,
            "financial_ledger": False,
            "audit_log": False,
            "webhooks": False,
            "mis_sync": True,
            "support_chat": True,
        },
        "sort_order": 1,
        "is_public": True,
    },
    {
        "name": "professional",
        "display_name": "Профессиональный",
        "description": "Для сетей клиник. До 10 клиник, до 100 сотрудников. Аналитика и KPI.",
        "base_price_month": Decimal("24900"),
        "base_price_year": Decimal("249000"),
        "max_clinics": 10,
        "max_users": 100,
        "features": {
            "scheduling": True,
            "analytics": True,
            "kpi": True,
            "financial_ledger": True,
            "audit_log": True,
            "webhooks": False,
            "mis_sync": True,
            "support_chat": True,
        },
        "sort_order": 2,
        "is_public": True,
    },
    {
        "name": "enterprise",
        "display_name": "Корпоративный",
        "description": "Без ограничений. Вебхуки, white-label, приоритетная поддержка.",
        "base_price_month": Decimal("49900"),
        "base_price_year": Decimal("499000"),
        "max_clinics": -1,   # -1 = безлимит
        "max_users": -1,
        "features": {
            "scheduling": True,
            "analytics": True,
            "kpi": True,
            "financial_ledger": True,
            "audit_log": True,
            "webhooks": True,
            "mis_sync": True,
            "support_chat": True,
            "white_label": True,
            "api_access": True,
        },
        "sort_order": 3,
        "is_public": True,
    },
]


async def seed_plans(db: AsyncSession) -> int:
    """Вставить планы которых ещё нет. Возвращает количество добавленных."""
    added = 0
    for plan_data in PLANS:
        existing = await db.execute(
            select(TenantPlan).where(TenantPlan.name == plan_data["name"])
        )
        if existing.scalar_one_or_none() is not None:
            continue

        plan = TenantPlan(**plan_data)
        db.add(plan)
        added += 1

    await db.flush()
    return added


async def main():
    url = os.environ.get("DATABASE_URL", "")
    if "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://")

    engine = create_async_engine(url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        async with session.begin():
            added = await seed_plans(session)
            print(f"Seed plans: {added} added, {len(PLANS) - added} already existed")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
