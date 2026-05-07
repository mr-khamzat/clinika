"""
DEPRECATED: используйте `python -m scripts.seed_all --payments`.
Скрипт оставлен для совместимости с docker-командами в существующих ENV/scripts.

Seed модулей online_payments_pro и fiscal_54fz_pro в каталог commercial_modules
(идемпотентно — ON CONFLICT DO NOTHING).

Запуск:
  docker exec clinika-backend python -m app.services.seed_payment_modules
"""
import asyncio
import os
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.models.commercial import CommercialModule


MODULES = [
    {
        "key": "online_payments_pro",
        "name": "Онлайн-оплата",
        "description": (
            "Приём оплаты картой через Юкасса/Т-Банк/Сбер/CloudPayments — "
            "пациент платит онлайн, чек 54-ФЗ автоматически. Несколько шлюзов "
            "одновременно — выберите тот, у которого ниже комиссия."
        ),
        "category": "finance",
        "price_monthly": Decimal("2990"),
        "price_annual": Decimal("29900"),
        "sort_order": 70,
    },
    {
        "key": "fiscal_54fz_pro",
        "name": "Чеки 54-ФЗ",
        "description": (
            "Автоматическая выгрузка фискальных чеков из ОФД "
            "(Платформа/Первый/Такском/Атол.Онлайн). QR пациентам, "
            "отчёт ФНС, проверка по INN."
        ),
        "category": "finance",
        "price_monthly": Decimal("2990"),
        "price_annual": Decimal("29900"),
        "sort_order": 71,
    },
]


async def seed_payment_modules() -> None:
    """Идемпотентный сид. Логирует создание/пропуск каждой записи."""
    # Берём URL из env и приводим к asyncpg-драйверу (как в app/database.py)
    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@postgres:5432/clinika",
    )
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    engine = create_async_engine(db_url)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        for m in MODULES:
            existing = (await db.execute(
                select(CommercialModule).where(CommercialModule.key == m["key"])
            )).scalar_one_or_none()
            if existing:
                print(f"{m['key']} уже существует — пропускаем")
                continue
            db.add(CommercialModule(
                key=m["key"],
                name=m["name"],
                description=m["description"],
                category=m["category"],
                price_monthly=m["price_monthly"],
                price_annual=m["price_annual"],
                is_active=True,
                sort_order=m["sort_order"],
            ))
            print(f"{m['key']} добавлен")
        await db.commit()

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_payment_modules())
