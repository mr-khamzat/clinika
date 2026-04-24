"""Модуль подключения к базе данных PostgreSQL через asyncpg.

Предоставляет асинхронную сессию SQLAlchemy 2.0 с настроенным connection pool.
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from app.config import settings


class Base(DeclarativeBase):
    """Базовый класс для всех SQLAlchemy моделей."""
    pass


# Формируем async URL из конфига (заменяем postgresql:// на postgresql+asyncpg://)
_async_url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")

# ===== Connection Pool Configuration =====
# pool_size=10 — количество постоянных соединений в пуле
# max_overflow=20 — максимальное количество дополнительных соединений при пиковой нагрузке
# pool_pre_ping=True — проверка соединения перед использованием (защита от разрывов)
# pool_recycle=3600 — автоматическое переоткрытие соединений раз в час
engine = create_async_engine(
    _async_url,
    echo=False,  # Логирование SQL-запросов (True для отладки)
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
)

# Фабрика асинхронных сессий для работы с БД
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,  # Не сбрасывать атрибуты после commit
)


async def get_db():
    """FastAPI dependency для получения сессии БД.

    Суперадмин-сессия: app.tenant_id не устанавливается — RLS пропускает все строки.

    Yields:
        AsyncSession: Асинхронная сессия SQLAlchemy

    Example:
        @router.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with AsyncSessionLocal() as session:
        yield session


async def get_db_for_tenant(tenant_id: str):
    """FastAPI dependency-генератор: сессия БД с установленным app.tenant_id для RLS.

    SET LOCAL действует только в пределах текущей транзакции — безопасно для пула.
    Вызывается через get_tenant_db() в deps.py.

    Args:
        tenant_id: UUID тенанта в виде строки

    Yields:
        AsyncSession: Асинхронная сессия SQLAlchemy с активным RLS-фильтром
    """
    async with AsyncSessionLocal() as session:
        # SET LOCAL ограничен текущей транзакцией — не утекает в другие сессии из пула
        await session.execute(text(f"SET LOCAL app.tenant_id = '{tenant_id}'"))
        yield session
