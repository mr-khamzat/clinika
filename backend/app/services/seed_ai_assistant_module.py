"""
Seed модуля ai_assistant в каталог commercial_modules (идемпотентно).

Запуск:
  docker compose exec -T clinika-backend python -m app.services.seed_ai_assistant_module
"""
import asyncio
import os
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.models.commercial import CommercialModule


KEY = "ai_assistant"

PAYLOAD = {
    "name": "AI-ассистент пациенту",
    "description": (
        "Чат-бот для пациентов на основе Gemini API: FAQ, навигация, "
        "эскалация к менеджеру"
    ),
    "category": "ai",
    # 2990*12*0.9 = 32292
    "price_monthly": Decimal("2990.00"),
    "price_annual": Decimal("32292.00"),
    "is_active": True,
    "sort_order": 85,
    "config_schema": {
        "trial_days": 14,
        "billing_cycle": "monthly",
        "model": "gemini-1.5-flash",
        "max_messages_per_day": 50,
        "escalation_threshold": 0.7,
        "system_prompt": (
            "Ты — медицинский AI-ассистент клиники. Отвечай на русском, "
            "не ставь диагнозы, при сложных вопросах эскалируй к менеджеру."
        ),
    },
}


async def seed_ai_assistant_module() -> None:
    """Создаёт или обновляет запись модуля ai_assistant."""
    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@postgres:5432/clinika",
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
    asyncio.run(seed_ai_assistant_module())
