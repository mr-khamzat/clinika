"""
DEPRECATED: используйте `python -m scripts.seed_all --ltv`.
Скрипт оставлен для совместимости с docker-командами в существующих ENV/scripts.

Seed модуля ltv_pro в каталог commercial_modules (идемпотентно).

Запуск:
  docker exec clinika-backend python -m app.services.seed_ltv_module
"""
import asyncio
import os
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.models.commercial import CommercialModule


async def seed_ltv_module():
    """Создаёт запись модуля ltv_pro, если её ещё нет."""
    db_url = os.environ.get("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@postgres:5432/clinika")
    engine = create_async_engine(db_url)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        existing = (await db.execute(
            select(CommercialModule).where(CommercialModule.key == "ltv_pro")
        )).scalar_one_or_none()
        if existing:
            print("ltv_pro уже существует, пропускаем")
            return

        m = CommercialModule(
            key="ltv_pro",
            name="LTV-аналитика",
            description=(
                "Расчёт пожизненной ценности пациентов из МИС: "
                "топ по LTV, когорты, churn risk, средний чек."
            ),
            category="analytics",
            price_monthly=Decimal("2990"),
            price_annual=Decimal("29900"),
            is_active=True,
            sort_order=60,
        )
        db.add(m)
        await db.commit()
        print("Модуль ltv_pro успешно добавлен")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_ltv_module())
