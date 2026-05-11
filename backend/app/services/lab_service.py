"""
Сервис лабораторных интеграций.

Содержит:
  - encrypt_api_key / decrypt_api_key — обёртка над secrets_service (fallback на plaintext)
  - test_provider_connection         — проверка api_key (для разных provider_type)
  - send_order_to_provider           — фейк-имплементация: установит 'sent' → через 30 сек 'in_progress'
  - parse_webhook_payload            — нормализация webhook'а от любого провайдера
"""
import asyncio
import uuid
from datetime import datetime
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.models.lab import LabProvider, LabOrder, LabResult


# ─────────────────────────────────────────────────────────────────────
# Шифрование API-ключей. Используем secrets_service если есть; иначе
# просто маркер 'plain:' + сам ключ, чтобы было видно что не зашифровано.
# ─────────────────────────────────────────────────────────────────────
def encrypt_api_key(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        from app.services.secrets_service import encrypt  # type: ignore
        return encrypt(raw)
    except Exception:
        return f"plain:{raw}"


def decrypt_api_key(stored: str | None) -> str | None:
    if not stored:
        return None
    if stored.startswith("plain:"):
        return stored[len("plain:"):]
    try:
        from app.services.secrets_service import decrypt  # type: ignore
        return decrypt(stored)
    except Exception:
        return stored


def mask_api_key(stored: str | None) -> str | None:
    """Скрывает ключ для UI: ****XXXX (последние 4 символа)."""
    raw = decrypt_api_key(stored)
    if not raw:
        return None
    if len(raw) <= 4:
        return "*" * len(raw)
    return "*" * (len(raw) - 4) + raw[-4:]


# ─────────────────────────────────────────────────────────────────────
# Test connection — фейк-проверка api_key.
# В реальной интеграции каждый provider_type имеет свой endpoint /ping.
# ─────────────────────────────────────────────────────────────────────
async def test_provider_connection(provider: LabProvider) -> dict:
    api_key = decrypt_api_key(provider.api_key_encrypted)
    if not api_key:
        return {"ok": False, "error": "API key не задан"}
    if not provider.api_url:
        return {"ok": False, "error": "API URL не задан"}

    # Фейк-проверка по длине ключа (минимум 16 символов).
    if len(api_key) < 8:
        return {"ok": False, "error": "API key выглядит некорректно (короче 8 символов)"}

    # В реальности тут httpx.AsyncClient → ping endpoint провайдера.
    return {
        "ok": True,
        "provider_type": provider.provider_type,
        "api_url": provider.api_url,
        "message": "Тестовое подключение успешно (фейк-имплементация)",
    }


# ─────────────────────────────────────────────────────────────────────
# Фейк-отправка заявки провайдеру:
#   1) status: created → sent (сразу, после COMMIT)
#   2) через 30 секунд — status: in_progress
#   3) результаты приходят отдельно через webhook
# ─────────────────────────────────────────────────────────────────────
async def schedule_async_progress(order_id: uuid.UUID, session_factory):
    """Фейк-имитация прогресса лабораторной заявки."""
    await asyncio.sleep(30)
    async with session_factory() as db:
        await db.execute(
            update(LabOrder)
            .where(LabOrder.id == order_id, LabOrder.status == "sent")
            .values(status="in_progress")
        )
        await db.commit()


async def send_order_to_provider(
    db: AsyncSession, order: LabOrder, session_factory
) -> None:
    """Помечает заявку как sent + планирует переход в in_progress."""
    order.status = "sent"
    order.sent_at = datetime.utcnow()
    # Сгенерируем фейковый external_order_id
    order.external_order_id = f"LAB-{order.id.hex[:10].upper()}"
    await db.flush()

    # Запускаем фоновую задачу — fire-and-forget.
    try:
        asyncio.create_task(schedule_async_progress(order.id, session_factory))
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────
# Парсинг webhook от провайдера. Принимаем generic-форму:
#   {
#     "external_order_id": "...",
#     "results": [
#        {"test_code", "test_name", "value", "unit", "reference_range", "flagged", "result_date"}
#     ]
#   }
# ─────────────────────────────────────────────────────────────────────
def normalize_webhook_payload(provider_type: str, payload: dict) -> dict:
    """Парсит webhook любого provider_type в единый формат."""
    # generic — уже в нужном формате.
    if provider_type == "generic_http":
        return payload

    # Гемотест/Инвитро могут иметь свой шейп — нормализуем простым маппингом.
    # В прод-имплементации каждый тип имеет отдельный парсер.
    if "results" in payload:
        return payload

    # Минимальный fallback
    return {
        "external_order_id": payload.get("orderId") or payload.get("external_order_id"),
        "results": payload.get("tests") or payload.get("results") or [],
    }


async def apply_webhook_results(
    db: AsyncSession, order: LabOrder, results_list: list[dict]
) -> int:
    """Создаёт LabResult записи + обновляет статус LabOrder."""
    inserted = 0
    for r in results_list:
        if not r.get("test_code") or not r.get("test_name"):
            continue
        res_date = r.get("result_date")
        if isinstance(res_date, str):
            try:
                res_date = datetime.fromisoformat(res_date.replace("Z", "+00:00"))
            except Exception:
                res_date = datetime.utcnow()
        elif res_date is None:
            res_date = datetime.utcnow()

        lr = LabResult(
            order_id=order.id,
            test_code=str(r.get("test_code"))[:40],
            test_name=str(r.get("test_name"))[:200],
            value=(str(r.get("value")) if r.get("value") is not None else None),
            unit=(str(r.get("unit")) if r.get("unit") is not None else None),
            reference_range=(str(r.get("reference_range")) if r.get("reference_range") is not None else None),
            flagged=bool(r.get("flagged", False)),
            result_date=res_date,
            raw_json=r,
        )
        db.add(lr)
        inserted += 1

    order.status = "results_ready"
    order.results_at = datetime.utcnow()
    await db.flush()
    return inserted
