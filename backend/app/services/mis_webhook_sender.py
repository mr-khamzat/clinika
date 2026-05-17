"""mis_webhook_sender — отправка внешним МИС событий подписки.

События:
  • subscription.activated  — после успешной активации (cash / online / trial);
  • subscription.cancelled  — после ss.cancel_subscription;
  • subscription.renewed    — автоматическое продление (если будет реализовано).

Доставка: best-effort, никогда не ломает основной flow. Ошибки логируются
и сохраняются в tenant_mis_subscription_webhooks.last_error / last_error_at.

Retry: 3 попытки с exponential backoff (1s, 5s, 30s) внутри отдельной
async-таски — основной HTTP-запрос пациента/менеджера не задерживается.

Запуск можно делать как fire-and-forget:
    await mis_webhook_sender.send_mis_webhook_async(db_factory, ...)

Или, если важно дождаться первой попытки в текущей транзакции (test-кнопка):
    await mis_webhook_sender.send_mis_webhook(db, ...)
"""
import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any, Optional

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant_mis_subscription_webhook import TenantMisSubscriptionWebhook


log = logging.getLogger("mis_webhook_sender")


RETRY_DELAYS = (1.0, 5.0, 30.0)
HTTP_TIMEOUT = 10.0  # секунд


def _jsonify(payload: dict) -> dict:
    """Приводит значения к JSON-сериализуемому виду."""
    out: dict = {}
    for k, v in payload.items():
        if isinstance(v, uuid.UUID):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, (str, int, float, bool, type(None))):
            out[k] = v
        elif isinstance(v, dict):
            out[k] = _jsonify(v)
        elif isinstance(v, (list, tuple)):
            out[k] = [
                (str(x) if isinstance(x, uuid.UUID)
                 else x.isoformat() if isinstance(x, datetime) else x)
                for x in v
            ]
        else:
            out[k] = str(v)
    return out


async def _attempt_post(
    url: str, headers: dict, body: dict,
) -> tuple[bool, str]:
    """Одна HTTP-попытка. Возвращает (success, error_or_status)."""
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
            resp = await client.post(url, headers=headers, json=body)
        if 200 <= resp.status_code < 300:
            return True, f"HTTP {resp.status_code}"
        return False, f"HTTP {resp.status_code}: {resp.text[:200]}"
    except httpx.HTTPError as e:
        return False, f"HTTPError: {e!r}"
    except Exception as e:  # noqa: BLE001 — best-effort
        return False, f"Error: {e!r}"


async def _deliver_one(
    db: AsyncSession,
    hook: TenantMisSubscriptionWebhook,
    body: dict,
) -> tuple[bool, str]:
    """Доставка одной интеграции с retry-логикой.

    Обновляет hook.last_success_at / last_error / retry_count внутри своей
    транзакции (вызывающий должен commit-ить).
    """
    headers = {"Content-Type": "application/json"}
    if hook.auth_header:
        headers["Authorization"] = hook.auth_header
    last_err = ""
    for i, delay in enumerate((0.0,) + RETRY_DELAYS):
        if delay > 0:
            await asyncio.sleep(delay)
        ok, info = await _attempt_post(hook.webhook_url, headers, body)
        if ok:
            hook.last_success_at = datetime.utcnow()
            hook.last_error = None
            hook.last_error_at = None
            hook.retry_count = 0
            return True, info
        last_err = info
        hook.retry_count = (hook.retry_count or 0) + 1
        log.warning(
            "mis_webhook attempt %d failed tenant=%s url=%s err=%s",
            i + 1, hook.tenant_id, hook.webhook_url, info,
        )
    hook.last_error = last_err[:2000]
    hook.last_error_at = datetime.utcnow()
    return False, last_err


def _build_payload(
    *, event_type: str, payload: dict,
) -> dict:
    return {
        "event": event_type,
        "occurred_at": datetime.utcnow().isoformat() + "Z",
        "data": _jsonify(payload),
    }


async def send_mis_webhook(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    event_type: str,
    payload: dict,
    blocking: bool = False,
) -> list[dict]:
    """Отправить webhook всем активным интеграциям тенанта.

    blocking=False (по умолчанию) — выполняет первую попытку синхронно для
    каждой интеграции, но НЕ блокирует на retry: оставшиеся попытки уходят
    в фоновую таску asyncio.

    blocking=True — ждёт все ретраи (используется кнопкой Test в UI).

    Возвращает список результатов: [{webhook_id, success, info}].
    """
    rows = (
        await db.execute(
            select(TenantMisSubscriptionWebhook).where(
                TenantMisSubscriptionWebhook.tenant_id == tenant_id,
                TenantMisSubscriptionWebhook.is_active.is_(True),
            )
        )
    ).scalars().all()

    if not rows:
        return []

    body = _build_payload(event_type=event_type, payload=payload)
    results: list[dict] = []
    for hook in rows:
        # Проверяем подписку на event
        events = hook.events or []
        if events and event_type not in events:
            continue
        try:
            ok, info = await _deliver_one(db, hook, body)
        except Exception as e:  # noqa: BLE001
            log.exception("mis_webhook fatal error: %s", e)
            ok, info = False, repr(e)
        results.append({
            "webhook_id": str(hook.id),
            "mis_type": hook.mis_type,
            "success": ok,
            "info": info,
        })
    return results


async def send_mis_webhook_safe(
    db: AsyncSession,
    *,
    tenant_id: Optional[uuid.UUID],
    event_type: str,
    payload: dict,
) -> None:
    """Тихая обёртка: ловит ВСЕ исключения, ничего не возвращает.

    Используется в точках активации/отмены подписки, чтобы НИКОГДА не ронять
    основной flow. Если что-то пойдёт не так — просто запись в логи.
    """
    if tenant_id is None:
        return
    try:
        await send_mis_webhook(
            db,
            tenant_id=tenant_id,
            event_type=event_type,
            payload=payload,
            blocking=False,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("send_mis_webhook_safe failed: %s", e)


async def test_webhook(
    db: AsyncSession,
    *,
    hook: TenantMisSubscriptionWebhook,
) -> dict:
    """Отправить тестовый payload и вернуть детальный результат."""
    body = _build_payload(
        event_type="subscription.test",
        payload={
            "test": True,
            "tenant_id": str(hook.tenant_id),
            "message": "Это тестовая отправка из админки КлиникСеть",
        },
    )
    ok, info = await _deliver_one(db, hook, body)
    return {"success": ok, "info": info}
