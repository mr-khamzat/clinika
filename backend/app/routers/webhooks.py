"""
Роутер вебхуков — регистрация, управление, лог доставок.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, HttpUrl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.core.tenant import require_module
from app.models.user import User
from app.models.webhook import WebhookEndpoint, WebhookDelivery
from app.services.webhook_service import WEBHOOK_EVENTS

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


class WebhookCreateRequest(BaseModel):
    url: str
    events: Optional[list[str]] = None  # None = все события
    secret: Optional[str] = None
    description: Optional[str] = None


class WebhookUpdateRequest(BaseModel):
    url: Optional[str] = None
    events: Optional[list[str]] = None
    secret: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


def _ep_out(ep: WebhookEndpoint) -> dict:
    return {
        "id": str(ep.id),
        "url": ep.url,
        "events": ep.events,
        "description": ep.description,
        "is_active": ep.is_active,
        "last_triggered_at": ep.last_triggered_at.isoformat() if ep.last_triggered_at else None,
        "last_status_code": ep.last_status_code,
        "fail_count": ep.fail_count,
        "created_at": ep.created_at.isoformat(),
    }


@router.get("/events", dependencies=[Depends(require_module("webhooks"))])
async def list_events(_: User = Depends(require_manager)):
    """Список всех доступных событий для подписки."""
    return {"events": WEBHOOK_EVENTS}


@router.get("", dependencies=[Depends(require_module("webhooks"))])
async def list_webhooks(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Все вебхуки текущего тенанта."""
    result = await db.execute(
        select(WebhookEndpoint)
        .where(WebhookEndpoint.tenant_id == current_user.tenant_id)
        .order_by(WebhookEndpoint.created_at.desc())
    )
    return [_ep_out(ep) for ep in result.scalars().all()]


@router.post("", status_code=201, dependencies=[Depends(require_module("webhooks"))])
async def create_webhook(
    body: WebhookCreateRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Зарегистрировать новый вебхук."""
    # Валидируем события
    if body.events:
        invalid = [e for e in body.events if e not in WEBHOOK_EVENTS]
        if invalid:
            raise HTTPException(400, f"Неизвестные события: {invalid}. Допустимые: {WEBHOOK_EVENTS}")

    # Лимит: не более 10 вебхуков на тенанта
    count_result = await db.execute(
        select(WebhookEndpoint).where(WebhookEndpoint.tenant_id == current_user.tenant_id)
    )
    if len(count_result.scalars().all()) >= 10:
        raise HTTPException(400, "Максимум 10 вебхуков на тенанта")

    ep = WebhookEndpoint(
        tenant_id=current_user.tenant_id,
        url=body.url,
        events=body.events,
        secret=body.secret,
        description=body.description,
    )
    db.add(ep)
    await db.commit()
    await db.refresh(ep)
    return _ep_out(ep)


@router.patch("/{webhook_id}", dependencies=[Depends(require_module("webhooks"))])
async def update_webhook(
    webhook_id: uuid.UUID,
    body: WebhookUpdateRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Обновить вебхук."""
    ep = (await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == webhook_id,
            WebhookEndpoint.tenant_id == current_user.tenant_id,
        )
    )).scalar_one_or_none()
    if not ep:
        raise HTTPException(404, "Вебхук не найден")

    if body.url is not None: ep.url = body.url
    if body.events is not None: ep.events = body.events
    if body.secret is not None: ep.secret = body.secret
    if body.description is not None: ep.description = body.description
    if body.is_active is not None: ep.is_active = body.is_active

    await db.commit()
    await db.refresh(ep)
    return _ep_out(ep)


@router.delete("/{webhook_id}", dependencies=[Depends(require_module("webhooks"))])
async def delete_webhook(
    webhook_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Удалить вебхук."""
    ep = (await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == webhook_id,
            WebhookEndpoint.tenant_id == current_user.tenant_id,
        )
    )).scalar_one_or_none()
    if not ep:
        raise HTTPException(404, "Вебхук не найден")
    await db.delete(ep)
    await db.commit()
    return {"status": "deleted"}


@router.get("/{webhook_id}/deliveries", dependencies=[Depends(require_module("webhooks"))])
async def get_deliveries(
    webhook_id: uuid.UUID,
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """История доставок вебхука."""
    # Проверяем принадлежность
    ep = (await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == webhook_id,
            WebhookEndpoint.tenant_id == current_user.tenant_id,
        )
    )).scalar_one_or_none()
    if not ep:
        raise HTTPException(404, "Вебхук не найден")

    deliveries = (await db.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.endpoint_id == webhook_id)
        .order_by(WebhookDelivery.delivered_at.desc())
        .limit(limit)
    )).scalars().all()

    return [
        {
            "id": str(d.id),
            "event": d.event,
            "success": d.success,
            "status_code": d.status_code,
            "attempt": d.attempt,
            "delivered_at": d.delivered_at.isoformat(),
        }
        for d in deliveries
    ]


@router.post("/{webhook_id}/test", dependencies=[Depends(require_module("webhooks"))])
async def test_webhook(
    webhook_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Отправить тестовый пинг на вебхук."""
    from app.services.webhook_service import send_event
    ep = (await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == webhook_id,
            WebhookEndpoint.tenant_id == current_user.tenant_id,
        )
    )).scalar_one_or_none()
    if not ep:
        raise HTTPException(404, "Вебхук не найден")

    await send_event(db, current_user.tenant_id, "test_ping", {
        "message": "Тестовый запрос от КлиникСеть",
        "webhook_id": str(webhook_id),
    })
    return {"status": "sent"}
