"""Фабрика провайдеров. Сейчас всегда NullProvider. Реальные — отдельные сессии."""
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.telephony import TelephonyConfig
from .base import TelephonyProvider
from .null import NullProvider


async def get_provider(db: AsyncSession, tenant_id: uuid.UUID) -> TelephonyProvider:
    """Возвращает провайдер для тенанта. Если нет config / не активен / unknown — NullProvider."""
    if not tenant_id:
        return NullProvider()
    cfg = (await db.execute(
        select(TelephonyConfig).where(TelephonyConfig.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not cfg or not cfg.is_active or cfg.provider in ("null", ""):
        return NullProvider()
    # TODO: реальные провайдеры — отдельные сессии (mango.py, zadarma.py, sipuni.py)
    return NullProvider()
