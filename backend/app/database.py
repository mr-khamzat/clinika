from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings


class Base(DeclarativeBase):
    pass


_async_url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")

# ===== Connection Pool =====
# pool_size=10 — постоянных соединений
# max_overflow=20 — допополнительных при пике
# pool_pre_ping=True — проверка соединения перед использованием
# pool_recycle=3600 — переоткрывать соединения раз в час
engine = create_async_engine(
    _async_url,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
