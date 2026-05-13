"""
Seed модуля call_recording в каталог commercial_modules (идемпотентно).

Запуск:
  docker compose exec -T clinika-backend python -m app.services.seed_call_recording_module
"""
import asyncio
import os
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.models.commercial import CommercialModule


KEY = "call_recording"

PAYLOAD = {
    "name": "Запись звонков",
    "description": (
        "Запись аудио/видео звонков, AI-расшифровка, "
        "AI-summary, поиск по транскриптам"
    ),
    "category": "telephony",
    # 3990*12*0.9 = 43092
    "price_monthly": Decimal("3990.00"),
    "price_annual":  Decimal("43092.00"),
    "is_active": True,
    "sort_order": 75,
    "config_schema": {
        "trial_days": 14,
        "billing_cycle": "monthly",
        "whisper_model": "whisper-1",
        "max_recording_minutes_per_month": 1000,
        "retention_days": 90,
        "auto_summary": True,
    },
}


async def seed_call_recording_module() -> None:
    """Создаёт или обновляет запись модуля call_recording."""
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
    asyncio.run(seed_call_recording_module())
