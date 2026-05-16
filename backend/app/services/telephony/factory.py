"""Фабрика провайдеров. Сейчас всегда NullProvider. Реальные — отдельные сессии."""
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.telephony import TelephonyConfig
from app.services import encryption_service as enc
from .base import TelephonyProvider
from .null import NullProvider
from .sipuni import SipuniProvider
from .mango import MangoProvider
from .zadarma import ZadarmaProvider


async def get_provider(db: AsyncSession, tenant_id: uuid.UUID) -> TelephonyProvider:
    """Возвращает провайдер для тенанта. Если нет config / не активен / unknown — NullProvider."""
    if not tenant_id:
        return NullProvider()
    cfg = (await db.execute(
        select(TelephonyConfig).where(TelephonyConfig.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not cfg or not cfg.is_active or cfg.provider in ("null", ""):
        return NullProvider()
    if cfg.provider == "sipuni":
        sipuni_id = enc.decrypt(cfg.api_key_encrypted) if cfg.api_key_encrypted else ""
        secret = enc.decrypt(cfg.api_secret_encrypted) if cfg.api_secret_encrypted else ""
        if not sipuni_id or not secret:
            return NullProvider()
        return SipuniProvider(sipuni_id, secret)
    if cfg.provider == "mango":
        key = enc.decrypt(cfg.api_key_encrypted) if cfg.api_key_encrypted else ""
        salt = enc.decrypt(cfg.api_secret_encrypted) if cfg.api_secret_encrypted else ""
        if not key or not salt:
            return NullProvider()
        return MangoProvider(key, salt)
    if cfg.provider == "zadarma":
        user_key = enc.decrypt(cfg.api_key_encrypted) if cfg.api_key_encrypted else ""
        secret = enc.decrypt(cfg.api_secret_encrypted) if cfg.api_secret_encrypted else ""
        if not user_key or not secret:
            return NullProvider()
        return ZadarmaProvider(user_key, secret)
    # Другие провайдеры (onlinepbx/...) — отдельной сессией
    return NullProvider()
