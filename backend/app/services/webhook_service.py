"""
Сервис отправки вебхуков.
Вызывается из роутеров при событиях (referral_created, bonus_paid, и т.д.).
Retry 3 раза при ошибке.
"""
import hashlib
import hmac
import json
import uuid
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.webhook import WebhookEndpoint, WebhookDelivery


# Все допустимые события
WEBHOOK_EVENTS = [
    "referral_created",
    "referral_confirmed",
    "referral_cancelled",
    "bonus_paid",
    "patient_registered",
    "clinic_created",
    "user_created",
    "invoice_paid",
    "subscription_trial_ending",  # за 3 дня до конца trial
]


def _sign_payload(secret: str, payload: bytes) -> str:
    """HMAC-SHA256 подпись тела запроса."""
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


async def send_event(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    event: str,
    payload: dict,
) -> None:
    """
    Отправляет событие всем активным вебхукам тенанта, подписанным на это событие.
    Пишет лог в webhook_deliveries.
    Не бросает исключений — ошибки логируются тихо.
    """
    # Ищем активные endpoints тенанта, слушающие это событие
    result = await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.tenant_id == tenant_id,
            WebhookEndpoint.is_active == True,
        )
    )
    endpoints = result.scalars().all()

    # Фильтруем по подпискам на событие
    targets = [
        ep for ep in endpoints
        if not ep.events or event in (ep.events or [])
    ]

    if not targets:
        return

    body = json.dumps({
        "event": event,
        "tenant_id": str(tenant_id),
        "timestamp": datetime.utcnow().isoformat(),
        "data": payload,
    }, ensure_ascii=False).encode()

    async with httpx.AsyncClient(timeout=10.0) as client:
        for ep in targets:
            headers = {
                "Content-Type": "application/json",
                "X-Clinika-Event": event,
                "X-Clinika-Delivery": str(uuid.uuid4()),
            }
            if ep.secret:
                headers["X-Clinika-Signature"] = f"sha256={_sign_payload(ep.secret, body)}"

            status_code = None
            response_body = None
            success = False

            # Retry до 3 раз
            for attempt in range(1, 4):
                try:
                    resp = await client.post(ep.url, content=body, headers=headers)
                    status_code = resp.status_code
                    response_body = resp.text[:500]
                    success = 200 <= status_code < 300
                    if success:
                        break
                except Exception as e:
                    response_body = str(e)[:500]

            # Пишем лог доставки
            delivery = WebhookDelivery(
                endpoint_id=ep.id,
                tenant_id=tenant_id,
                event=event,
                payload=payload,
                status_code=status_code,
                response_body=response_body,
                attempt=min(3, attempt),
                success=success,
            )
            db.add(delivery)

            # Обновляем статистику endpoint
            ep.last_triggered_at = datetime.utcnow()
            ep.last_status_code = status_code
            if not success:
                ep.fail_count = (ep.fail_count or 0) + 1

    try:
        await db.commit()
    except Exception:
        pass  # не ломаем основной флоу из-за вебхука
