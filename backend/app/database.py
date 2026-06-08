"""Модуль подключения к базе данных PostgreSQL через asyncpg.

Предоставляет асинхронную сессию SQLAlchemy 2.0 с настроенным connection pool.
"""
import uuid as _uuid
from contextvars import ContextVar

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event
from app.config import settings


class Base(DeclarativeBase):
    """Базовый класс для всех SQLAlchemy моделей."""
    pass


# ===== RLS tenant-контекст (находка #1, Часть B) =====
# Контекст текущего тенанта запроса. Заполняется зависимостью get_tenant_db
# (deps.py) из аутентифицированного пользователя. Для super_admin / фоновых
# джобов / неаутентифицированных запросов остаётся None → RLS пропускает все
# строки (permissive-when-unset).
#
# ПОЧЕМУ contextvar + event, а не одноразовый set_config в зависимости:
#   set_config('app.tenant_id', v, is_local=true) == SET LOCAL — действует
#   ТОЛЬКО до конца текущей транзакции. Многие PHI-роутеры вызывают db.commit()
#   В СЕРЕДИНЕ хэндлера (medcard/patient_documents/patient_chat), после чего
#   SQLAlchemy autobegin открывает НОВУЮ транзакцию уже без app.tenant_id —
#   и RLS становится permissive (видны все тенанты). Чтобы контекст переживал
#   mid-handler commit, мы переустанавливаем его в событии "begin" соединения:
#   событие срабатывает в начале КАЖДОЙ транзакции на соединении в рамках
#   запроса, поэтому транзакции #2, #3… снова получают app.tenant_id.
current_tenant_id: ContextVar[str | None] = ContextVar("current_tenant_id", default=None)


def set_current_tenant(tenant_id) -> None:
    """Положить tenant_id в контекст запроса (канонизируем как UUID-строку).

    None / пустое → контекст очищается (permissive RLS: super_admin/джобы/аноним).
    Значение приводится к каноничной UUID-строке (валидация = защита от
    инъекции в литерал SET LOCAL внутри _apply_tenant_on_begin).
    """
    if not tenant_id:
        current_tenant_id.set(None)
        return
    # str(UUID(...)) канонизирует и валидирует — небезопасное значение бросит
    # ValueError ещё в зависимости, до похода в БД.
    current_tenant_id.set(str(_uuid.UUID(str(tenant_id))))


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


# ── RLS: переустановка app.tenant_id в начале КАЖДОЙ транзакции ──
# Слушаем синхронное событие "begin" на нижележащем sync-движке (асинхронный
# движок проксирует его). exec_driver_sql выполняется в той же транзакции, что
# и последующие запросы хэндлера, поэтому RLS-предикат current_setting(...)
# увидит установленное значение. SET LOCAL автоматически сбрасывается на
# COMMIT/ROLLBACK → соединение возвращается в пул без утечки тенанта.
#
# Если контекст пуст (super_admin/джоб/аноним), мы ЯВНО ставим пустую строку:
# защита-в-глубину на случай, если соединение из пула почему-то сохранило
# значение (RLS-политика трактует '' как «контекст не задан» → permissive).
def _apply_tenant_on_begin(conn):  # noqa: ANN001
    # Engine-событие "begin" передаёт SQLAlchemy Connection (sync-фасад поверх
    # asyncpg). exec_driver_sql выполняет сырой SQL в уже открытой транзакции.
    # tid уже канонизирован через uuid.UUID() в set_current_tenant — безопасно
    # подставлять в литерал. Пустой контекст → set_config(..., '') → RLS
    # трактует как «не задан» (permissive: super_admin/джобы/аноним).
    value = current_tenant_id.get() or ""
    conn.exec_driver_sql(f"SELECT set_config('app.tenant_id', '{value}', true)")


# Регистрируем на sync_engine — он есть только у настоящего async-движка
# поверх PostgreSQL/asyncpg. На SQLite (юнит-тесты) RLS отсутствует, поэтому
# отсутствие sync_engine/драйвера без SET LOCAL не критично.
def _install_rls_listener() -> None:
    try:
        sync_engine = engine.sync_engine
    except Exception:  # pragma: no cover - не-async движок
        return
    if not event.contains(sync_engine, "begin", _apply_tenant_on_begin):
        event.listen(sync_engine, "begin", _apply_tenant_on_begin)


_install_rls_listener()

# Фабрика асинхронных сессий для работы с БД
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,  # Не сбрасывать атрибуты после commit
)


async def get_db():
    """FastAPI dependency для получения сессии БД.

    Контекст тенанта НЕ задаётся этой зависимостью — она нейтральна к RLS.
    Если запрос прошёл через get_tenant_db (deps.py), которая положила
    tenant_id в contextvar, то begin-listener применит app.tenant_id ко всем
    транзакциям этой сессии. Если контекст пуст (super_admin / фоновые джобы /
    публичные эндпоинты) — app.tenant_id='' и RLS пропускает все строки.

    ВНИМАНИЕ (фоновые джобы): использование get_db / AsyncSessionLocal вне
    HTTP-запроса означает пустой tenant-контекст → супер-режим (видны все
    тенанты). Это осознанное поведение для системных задач (см. residualRisk).

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
    """Контекст-менеджер: сессия БД с принудительно установленным app.tenant_id.

    Для НЕ-HTTP сценариев (фоновые джобы, скрипты), где нужно явно работать в
    рамках конкретного тенанта. Кладёт tenant_id в тот же contextvar, что и
    get_tenant_db, поэтому begin-listener применяет app.tenant_id ко ВСЕМ
    транзакциям сессии (переживает mid-handler commit). По выходе контекст
    восстанавливается (token reset) — безопасно для пула и для последующих
    задач в том же потоке/таске.

    Args:
        tenant_id: UUID тенанта (строка/UUID). None/пусто → супер-режим.

    Yields:
        AsyncSession: Асинхронная сессия SQLAlchemy с активным RLS-фильтром
    """
    token = current_tenant_id.set(
        str(_uuid.UUID(str(tenant_id))) if tenant_id else None
    )
    try:
        async with AsyncSessionLocal() as session:
            yield session
    finally:
        current_tenant_id.reset(token)
