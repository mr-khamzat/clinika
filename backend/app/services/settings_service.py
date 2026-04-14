# ===== БЛОК: Сервис системных настроек =====
# Вспомогательные функции чтения/записи ключей в system_settings.
# Поддержка tenant_id — для тенант-специфичных настроек ключ хранится
# как "{tenant_id}:{key}", что позволяет каждому тенанту иметь свои настройки.

import uuid
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.settings import SystemSettings


def _scoped_key(key: str, tenant_id=None) -> str:
    """Вернуть ключ с префиксом тенанта, если tenant_id указан."""
    if tenant_id:
        return f"{tenant_id}:{key}"
    return key


async def get_setting(db: AsyncSession, key: str, default: str = "", tenant_id=None) -> str:
    """Получить настройку. Если tenant_id задан — ищет сначала тенант-специфичный ключ,
    затем глобальный (для обратной совместимости)."""
    if tenant_id:
        scoped = _scoped_key(key, tenant_id)
        result = await db.execute(select(SystemSettings).where(SystemSettings.key == scoped))
        row = result.scalar_one_or_none()
        if row:
            return row.value
        # Fallback: глобальный ключ (для миграции старых данных)
        result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
        row = result.scalar_one_or_none()
        return row.value if row else default
    result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else default


async def set_setting(db: AsyncSession, key: str, value: str, tenant_id=None):
    """Сохранить настройку. Если tenant_id задан — сохраняет под тенант-специфичным ключом."""
    scoped = _scoped_key(key, tenant_id)
    result = await db.execute(select(SystemSettings).where(SystemSettings.key == scoped))
    row = result.scalar_one_or_none()
    if row:
        row.value = value
        row.updated_at = datetime.utcnow()
    else:
        db.add(SystemSettings(key=scoped, value=value))
    await db.commit()
