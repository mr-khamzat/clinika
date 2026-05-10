"""
Управление API-ключами тенанта.
Префикс: /tenant/api-keys
Доступ: только владелец франшизы / super_admin.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_franchise_owner
from app.core.tenant import require_module
from app.models.user import User
from app.models.tenant_api_key import TenantApiKey
from app.services import api_key_service, audit_service


router = APIRouter(prefix="/tenant/api-keys", tags=["tenant-api-keys"])


# ── Pydantic ────────────────────────────────────────────────────────────────
class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    scopes: list[str] = Field(default_factory=list)
    ttl_days: Optional[int] = Field(default=None, ge=0, le=3650)
    allowed_ips: Optional[list[str]] = None


class ApiKeyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    scopes: Optional[list[str]] = None
    allowed_ips: Optional[list[str]] = None
    # ttl_days=0 → unset expires_at; >0 → пересчитать от текущего момента
    ttl_days: Optional[int] = Field(default=None, ge=0, le=3650)


# ── Endpoints ───────────────────────────────────────────────────────────────
@router.get("/scopes")
async def list_scopes(_: User = Depends(require_franchise_owner)):
    """Доступные скоупы с человекочитаемыми названиями."""
    return {
        "scopes": [
            {"key": s, "label": api_key_service.SCOPE_LABELS.get(s, s)}
            for s in api_key_service.ALLOWED_SCOPES
        ]
    }


@router.get("", dependencies=[Depends(require_module("webhooks"))])
async def list_keys(
    current_user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Список API-ключей тенанта (без raw — только prefix)."""
    if current_user.tenant_id is None:
        return []
    res = await db.execute(
        select(TenantApiKey)
        .where(TenantApiKey.tenant_id == current_user.tenant_id)
        .order_by(desc(TenantApiKey.created_at))
    )
    return [api_key_service.serialize(k) for k in res.scalars().all()]


@router.post("", status_code=201, dependencies=[Depends(require_module("webhooks"))])
async def create_key(
    body: ApiKeyCreate,
    request: Request,
    current_user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """
    Создать API-ключ. Возвращает raw key ОДИН РАЗ — клиент обязан сохранить.
    """
    if current_user.tenant_id is None:
        raise HTTPException(status_code=400, detail="У пользователя нет привязки к тенанту")
    try:
        obj, raw = await api_key_service.create_key(
            db,
            tenant_id=current_user.tenant_id,
            name=body.name,
            scopes=body.scopes,
            ttl_days=body.ttl_days,
            allowed_ips=body.allowed_ips,
            created_by_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await audit_service.write_safe(
        db, "api_key.created",
        actor_id=current_user.id, actor_name=current_user.full_name,
        entity_type="api_key", entity_id=obj.id,
        tenant_id=current_user.tenant_id,
        after={
            "name": obj.name,
            "scopes": obj.scopes,
            "key_prefix": obj.key_prefix,
            "expires_at": obj.expires_at.isoformat() if obj.expires_at else None,
            "allowed_ips": obj.allowed_ips,
        },
        request=request,
    )
    await db.commit()
    serialized = api_key_service.serialize(obj)
    serialized["raw_key"] = raw  # показывается ОДИН РАЗ
    serialized["warning"] = (
        "Этот ключ показывается ОДИН РАЗ. Сохраните его сейчас — повторно показать невозможно."
    )
    return serialized


@router.patch("/{key_id}", dependencies=[Depends(require_module("webhooks"))])
async def update_key(
    key_id: uuid.UUID,
    body: ApiKeyUpdate,
    request: Request,
    current_user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Обновить name / scopes / allowed_ips / ttl_days."""
    if current_user.tenant_id is None:
        raise HTTPException(status_code=400, detail="У пользователя нет привязки к тенанту")
    res = await db.execute(
        select(TenantApiKey).where(
            TenantApiKey.id == key_id,
            TenantApiKey.tenant_id == current_user.tenant_id,
        )
    )
    obj = res.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Ключ не найден")
    if obj.revoked_at is not None:
        raise HTTPException(status_code=400, detail="Нельзя редактировать отозванный ключ")

    before = api_key_service.serialize(obj)

    if body.name is not None:
        obj.name = body.name.strip()[:200] or obj.name
    if body.scopes is not None:
        try:
            obj.scopes = api_key_service.validate_scopes(body.scopes)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    if body.allowed_ips is not None:
        obj.allowed_ips = body.allowed_ips or None
    if body.ttl_days is not None:
        from datetime import datetime, timedelta
        obj.expires_at = (
            datetime.utcnow() + timedelta(days=body.ttl_days)
            if body.ttl_days > 0 else None
        )

    await db.flush()
    after = api_key_service.serialize(obj)

    await audit_service.write_safe(
        db, "api_key.updated",
        actor_id=current_user.id, actor_name=current_user.full_name,
        entity_type="api_key", entity_id=obj.id,
        tenant_id=current_user.tenant_id,
        before=before, after=after,
        request=request,
    )
    await db.commit()
    return after


@router.delete("/{key_id}", dependencies=[Depends(require_module("webhooks"))])
async def delete_key(
    key_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Отозвать API-ключ (soft delete: revoked_at = now)."""
    if current_user.tenant_id is None:
        raise HTTPException(status_code=400, detail="У пользователя нет привязки к тенанту")
    obj = await api_key_service.revoke_key(
        db, key_id=key_id, tenant_id=current_user.tenant_id
    )
    if obj is None:
        raise HTTPException(status_code=404, detail="Ключ не найден")
    await audit_service.write_safe(
        db, "api_key.revoked",
        actor_id=current_user.id, actor_name=current_user.full_name,
        entity_type="api_key", entity_id=obj.id,
        tenant_id=current_user.tenant_id,
        after={"name": obj.name, "key_prefix": obj.key_prefix},
        request=request,
    )
    await db.commit()
    return {"status": "revoked", "id": str(obj.id)}
