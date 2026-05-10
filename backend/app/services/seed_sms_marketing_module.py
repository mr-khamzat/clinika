"""
Seed модуля sms_marketing в каталог commercial_modules (идемпотентно).

Запуск:
  docker compose exec -T clinika-backend python -m app.services.seed_sms_marketing_module
"""
import asyncio
import os
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.models.commercial import CommercialModule


KEY = "sms_marketing"

PAYLOAD = {
    "name": "SMS-маркетинг",
    "description": (
        "Рассылки спящим пациентам, акции, поздравления, "
        "реактивация по LTV-сегментам"
    ),
    "category": "marketing",
    # 1990*12*0.9 = 21492
    "price_monthly": Decimal("1990.00"),
    "price_annual":  Decimal("21492.00"),
    "is_active": True,
    "sort_order": 70,
    "config_schema": {
        "trial_days": 14,
        "billing_cycle": "monthly",
        "max_recipients_per_campaign": 5000,
        "default_provider": "smsc",
    },
}


async def seed_sms_marketing_module() -> None:
    """Создаёт или обновляет запись модуля sms_marketing."""
    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://clinika:clinika_pass@clinika-db:5432/clinika",
    )
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(db_url)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        existing = (
            await db.execute(
                select(CommercialModule).where(CommercialModule.key == KEY)
            )
        ).scalar_one_or_none()

        if existing:
            # Идемпотентность: обновляем поля.
            for k, v in PAYLOAD.items():
                setattr(existing, k, v)
            await db.commit()
            print(f"Модуль {KEY}: обновлён (id={existing.id})")
            await engine.dispose()
            return

        m = CommercialModule(key=KEY, **PAYLOAD)
        db.add(m)
        await db.commit()
        print(f"Модуль {KEY}: создан (id={m.id})")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_sms_marketing_module())
