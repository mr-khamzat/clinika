# ===== БЛОК: Сервис системных настроек =====
# Вспомогательные функции чтения/записи ключей в system_settings.
# Используется в settings_mgmt и любом другом роутере.

from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.settings import SystemSettings


async def get_setting(db: AsyncSession, key: str, default: str = "") -> str:
    result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else default


async def set_setting(db: AsyncSession, key: str, value: str):
    result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
    row = result.scalar_one_or_none()
    if row:
        row.value = value
        row.updated_at = datetime.utcnow()
    else:
        db.add(SystemSettings(key=key, value=value))
    await db.commit()
