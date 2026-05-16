"""Tenant settings — chat-namespace для SLA и autoclose."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services.chat_sla_job import DEFAULT_SETTINGS

router = APIRouter(prefix="/tenant/settings", tags=["tenant-settings"])

CHAT_KEYS = ("chat_sla_enabled", "chat_sla_minutes_reg", "chat_sla_minutes_manager",
             "chat_sla_minutes_owner", "chat_autoclose_days")


def _get_chat_settings_dict(tenant: Tenant) -> dict:
    s = getattr(tenant, "settings", None) or {}
    return {k: s.get(k, DEFAULT_SETTINGS.get(k)) for k in CHAT_KEYS}


def _merge_chat_settings(tenant: Tenant, payload: dict) -> dict:
    base = getattr(tenant, "settings", None) or {}
    merged = dict(base)
    for k in CHAT_KEYS:
        if k in payload and payload[k] is not None:
            merged[k] = payload[k]
    return merged


class ChatSettingsIn(BaseModel):
    chat_sla_enabled: Optional[bool] = None
    chat_sla_minutes_reg: Optional[int] = Field(default=None, ge=1, le=240)
    chat_sla_minutes_manager: Optional[int] = Field(default=None, ge=1, le=240)
    chat_sla_minutes_owner: Optional[int] = Field(default=None, ge=1, le=240)
    chat_autoclose_days: Optional[int] = Field(default=None, ge=1, le=90)


def _require_settings_role(user: User) -> None:
    if user.role not in (UserRole.MANAGER, UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
        raise HTTPException(403, "Только manager/owner")
    if user.role != UserRole.SUPER_ADMIN and not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")


@router.get("/chat")
async def get_chat_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    tenant = (await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Тенант не найден")
    return _get_chat_settings_dict(tenant)


@router.patch("/chat")
async def patch_chat_settings(
    body: ChatSettingsIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    tenant = (await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Тенант не найден")
    merged = _merge_chat_settings(tenant, body.model_dump(exclude_none=True))
    tenant.settings = merged
    await db.commit()
    return _get_chat_settings_dict(tenant)
