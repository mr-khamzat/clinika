"""manager_mis_webhooks — управление МИС-вебхуками на события подписки.

Доступ: require_manager (tenant-scoped).

Эндпоинты:
  GET    /manager/mis-webhooks
  POST   /manager/mis-webhooks
  PATCH  /manager/mis-webhooks/{hook_id}
  DELETE /manager/mis-webhooks/{hook_id}
  POST   /manager/mis-webhooks/{hook_id}/test   — отправить test-payload
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_manager
from app.database import get_db
from app.models.tenant_mis_subscription_webhook import TenantMisSubscriptionWebhook
from app.models.user import User

from app.services import mis_webhook_sender


router = APIRouter(
    prefix="/manager/mis-webhooks",
    tags=["manager-mis-webhooks"],
    dependencies=[Depends(require_manager)],
)


ALLOWED_EVENTS = {
    "subscription.activated",
    "subscription.cancelled",
    "subscription.renewed",
}
ALLOWED_MIS_TYPES = {"renovatio", "stoclinic", "custom"}


class WebhookIn(BaseModel):
    mis_type: str = Field(pattern=r"^(renovatio|stoclinic|custom)$")
    webhook_url: HttpUrl
    auth_header: Optional[str] = Field(default=None, max_length=200)
    events: list[str] = Field(default_factory=lambda: [
        "subscription.activated", "subscription.cancelled",
    ])
    is_active: bool = True


class WebhookPatch(BaseModel):
    mis_type: Optional[str] = Field(default=None,
                                      pattern=r"^(renovatio|stoclinic|custom)$")
    webhook_url: Optional[HttpUrl] = None
    auth_header: Optional[str] = Field(default=None, max_length=200)
    events: Optional[list[str]] = None
    is_active: Optional[bool] = None


def _to_dict(row: TenantMisSubscriptionWebhook) -> dict:
    return {
        "id": str(row.id),
        "tenant_id": str(row.tenant_id),
        "mis_type": row.mis_type,
        "webhook_url": row.webhook_url,
        "auth_header_set": bool(row.auth_header),
        "events": list(row.events or []),
        "is_active": bool(row.is_active),
        "last_success_at": row.last_success_at.isoformat() if row.last_success_at else None,
        "last_error": row.last_error,
        "last_error_at": row.last_error_at.isoformat() if row.last_error_at else None,
        "retry_count": int(row.retry_count or 0),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _validate_events(events: list[str]) -> None:
    bad = [e for e in events if e not in ALLOWED_EVENTS]
    if bad:
        raise HTTPException(400, f"Неподдерживаемые события: {bad}")


@router.get("")
async def list_hooks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    rows = (
        await db.execute(
            select(TenantMisSubscriptionWebhook).where(
                TenantMisSubscriptionWebhook.tenant_id == user.tenant_id
            ).order_by(TenantMisSubscriptionWebhook.created_at.desc())
        )
    ).scalars().all()
    return {"items": [_to_dict(r) for r in rows]}


@router.post("", status_code=201)
async def create_hook(
    body: WebhookIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    _validate_events(body.events)
    row = TenantMisSubscriptionWebhook(
        tenant_id=user.tenant_id,
        mis_type=body.mis_type,
        webhook_url=str(body.webhook_url),
        auth_header=body.auth_header,
        events=list(body.events),
        is_active=bool(body.is_active),
    )
    db.add(row)
    await db.flush()
    await db.commit()
    return _to_dict(row)


@router.patch("/{hook_id}")
async def update_hook(
    hook_id: uuid.UUID,
    body: WebhookPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    row = (
        await db.execute(
            select(TenantMisSubscriptionWebhook).where(
                TenantMisSubscriptionWebhook.id == hook_id,
                TenantMisSubscriptionWebhook.tenant_id == user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Вебхук не найден")
    patch = body.model_dump(exclude_unset=True)
    if "events" in patch and patch["events"] is not None:
        _validate_events(patch["events"])
    for k, v in patch.items():
        if k == "webhook_url" and v is not None:
            setattr(row, k, str(v))
        elif v is not None:
            setattr(row, k, v)
    await db.flush()
    await db.commit()
    return _to_dict(row)


@router.delete("/{hook_id}", status_code=204)
async def delete_hook(
    hook_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    row = (
        await db.execute(
            select(TenantMisSubscriptionWebhook).where(
                TenantMisSubscriptionWebhook.id == hook_id,
                TenantMisSubscriptionWebhook.tenant_id == user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Вебхук не найден")
    await db.delete(row)
    await db.commit()
    return None


@router.post("/{hook_id}/test")
async def test_hook(
    hook_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    row = (
        await db.execute(
            select(TenantMisSubscriptionWebhook).where(
                TenantMisSubscriptionWebhook.id == hook_id,
                TenantMisSubscriptionWebhook.tenant_id == user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Вебхук не найден")
    result = await mis_webhook_sender.test_webhook(db, hook=row)
    await db.commit()
    return result
