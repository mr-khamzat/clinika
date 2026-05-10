"""
ЮKassa — рабочий адаптер интернет-эквайринга.

Документация: https://yookassa.ru/developers/api

Реализация на чистом httpx (без SDK yookassa) — управляемая зависимость, async,
минимум магии. SDK yookassa синхронен и ставит ещё один HTTP-клиент сверху.

Конфигурация:
  - На уровне клиники: PaymentGatewayConfig.shop_id + secret_key (через UI «Настройки → Онлайн-оплата»).
  - На уровне сервера:  YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY в .env (fallback,
    если у конкретной клиники конфиг ещё не заполнен).
  - YOOKASSA_RETURN_URL — дефолтный return_url, если вызывающий не передал свой.

Если ни в БД, ни в env ключей нет — методы кидают RuntimeError с понятным
сообщением «YOOKASSA не настроена …». Роутер транслирует это в HTTP 503.
"""
from __future__ import annotations

import ipaddress
import logging
import os
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

import httpx

from app.services.acquiring.base import (
    BasePaymentGateway,
    PaymentInitResult,
    PaymentStatusResult,
)


log = logging.getLogger("yookassa_adapter")

YK_API_BASE = "https://api.yookassa.ru/v3"
YK_HTTP_TIMEOUT = 20.0  # секунд

# IP-диапазоны, с которых ЮKassa шлёт webhook'и.
# Источник: https://yookassa.ru/developers/using-api/webhooks#ip
YOOKASSA_WEBHOOK_NETS: tuple[str, ...] = (
    "185.71.76.0/27",
    "185.71.77.0/27",
    "77.75.153.0/25",
    "77.75.156.11/32",
    "77.75.156.35/32",
    "77.75.154.128/25",
    "2a02:5180::/32",
)


def _ip_in_yookassa_allowlist(ip: str | None) -> bool:
    """True если ip входит в один из диапазонов ЮKassa."""
    if not ip:
        return False
    try:
        addr = ipaddress.ip_address(ip.strip())
    except ValueError:
        return False
    for net in YOOKASSA_WEBHOOK_NETS:
        try:
            if addr in ipaddress.ip_network(net, strict=False):
                return True
        except ValueError:
            continue
    return False


class YookassaGateway(BasePaymentGateway):
    """ЮKassa: shop_id + secret_key + Idempotence-Key в заголовке."""
    name = "yookassa"

    # ── Креды ────────────────────────────────────────────────────────────────

    def _credentials(self) -> tuple[str, str]:
        """Берёт (shop_id, secret_key) из БД-конфига, иначе из env.

        Бросает RuntimeError если ничего не задано — роутер превратит это в 503
        с понятным сообщением для UI.
        """
        shop_id = getattr(self.config, "shop_id", None) if self.config else None
        secret_key = getattr(self.config, "secret_key", None) if self.config else None

        if not shop_id:
            shop_id = os.getenv("YOOKASSA_SHOP_ID", "")
        if not secret_key:
            secret_key = os.getenv("YOOKASSA_SECRET_KEY", "")

        if not shop_id or not secret_key:
            raise RuntimeError(
                "YOOKASSA не настроена: задай YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY "
                "в .env (или PaymentGatewayConfig для клиники)."
            )
        return str(shop_id), str(secret_key)

    def _default_return_url(self) -> str:
        """Дефолтный return_url, если вызывающий не передал свой."""
        return os.getenv("YOOKASSA_RETURN_URL", "https://klinikset.ru/billing/return")

    @staticmethod
    def _format_amount(amount: Decimal) -> str:
        """ЮKassa требует строку с двумя знаками после точки."""
        return f"{Decimal(amount).quantize(Decimal('0.01'))}"

    # ── HTTP helper ──────────────────────────────────────────────────────────

    async def _http(self) -> httpx.AsyncClient:
        shop_id, secret = self._credentials()
        return httpx.AsyncClient(
            base_url=YK_API_BASE,
            auth=(shop_id, secret),
            timeout=YK_HTTP_TIMEOUT,
            headers={"Content-Type": "application/json"},
        )

    # ── 1) Создание платежа ─────────────────────────────────────────────────

    async def init_payment(
        self,
        amount: Decimal,
        description: str,
        return_url: str,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> PaymentInitResult:
        """POST /v3/payments — создаёт платёж и возвращает confirmation_url."""
        idempotency_key = idempotency_key or str(uuid.uuid4())
        body: dict[str, Any] = {
            "amount": {
                "value": self._format_amount(amount),
                "currency": "RUB",
            },
            "capture": True,
            "confirmation": {
                "type": "redirect",
                "return_url": return_url or self._default_return_url(),
            },
            "description": (description or "")[:128],  # YK ограничивает 128 символов
        }
        if metadata:
            # ЮKassa пропускает metadata только string-значения, поэтому конвертим
            body["metadata"] = {str(k): str(v) for k, v in metadata.items() if v is not None}

        async with await self._http() as client:
            try:
                resp = await client.post(
                    "/payments",
                    json=body,
                    headers={"Idempotence-Key": idempotency_key},
                )
            except httpx.HTTPError as e:
                log.error("YooKassa init_payment HTTP error: %s", e)
                raise RuntimeError(f"YOOKASSA: ошибка соединения с api.yookassa.ru: {e}") from e

        if resp.status_code >= 400:
            log.error("YooKassa init_payment %s: %s", resp.status_code, resp.text)
            raise RuntimeError(
                f"YOOKASSA вернула {resp.status_code}: {resp.text[:500]}"
            )

        data = resp.json()
        confirmation = data.get("confirmation") or {}
        return PaymentInitResult(
            payment_url=confirmation.get("confirmation_url", ""),
            payment_id=data.get("id", ""),
            raw=data,
        )

    # ── 2) Статус платежа ────────────────────────────────────────────────────

    async def get_status(self, payment_id: str) -> PaymentStatusResult:
        """GET /v3/payments/{id} — pending|succeeded|canceled|waiting_for_capture."""
        async with await self._http() as client:
            try:
                resp = await client.get(f"/payments/{payment_id}")
            except httpx.HTTPError as e:
                raise RuntimeError(f"YOOKASSA get_status: {e}") from e

        if resp.status_code == 404:
            raise LookupError(f"YooKassa: платёж {payment_id} не найден")
        if resp.status_code >= 400:
            raise RuntimeError(f"YOOKASSA вернула {resp.status_code}: {resp.text[:500]}")

        data = resp.json()
        paid_at: datetime | None = None
        captured_at = data.get("captured_at")
        if isinstance(captured_at, str):
            try:
                paid_at = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
            except ValueError:
                paid_at = None

        return PaymentStatusResult(
            status=data.get("status", "pending"),
            paid_at=paid_at,
            raw=data,
        )

    # ── 3) Возврат ───────────────────────────────────────────────────────────

    async def refund(
        self,
        payment_id: str,
        amount: Decimal | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """POST /v3/refunds — полный или частичный возврат."""
        if not payment_id:
            raise ValueError("YooKassa.refund: payment_id обязателен")

        idempotency_key = idempotency_key or str(uuid.uuid4())
        body: dict[str, Any] = {"payment_id": payment_id}

        if amount is None:
            # Полный возврат — нужен оригинальный amount, дёргаем get_status
            status = await self.get_status(payment_id)
            orig_amount = (status.raw.get("amount") or {}).get("value")
            if not orig_amount:
                raise RuntimeError("YooKassa: не удалось определить сумму для полного возврата")
            body["amount"] = {"value": str(orig_amount), "currency": "RUB"}
        else:
            body["amount"] = {
                "value": self._format_amount(amount),
                "currency": "RUB",
            }

        async with await self._http() as client:
            try:
                resp = await client.post(
                    "/refunds",
                    json=body,
                    headers={"Idempotence-Key": idempotency_key},
                )
            except httpx.HTTPError as e:
                raise RuntimeError(f"YOOKASSA refund: {e}") from e

        if resp.status_code >= 400:
            raise RuntimeError(f"YOOKASSA refund {resp.status_code}: {resp.text[:500]}")

        return resp.json()

    # ── 4) Webhook verification ──────────────────────────────────────────────

    async def verify_webhook(
        self,
        headers: dict[str, str],
        body: bytes,
    ) -> dict[str, Any] | None:
        """
        Проверка подлинности webhook'а от ЮKassa.

        ЮKassa подпись webhook'ов **не использует** — заявленная защита это
        IP allowlist (диапазоны выше) + рекомендация сверять статус через GET
        /payments/{id} перед обновлением состояния.

        Логика:
          1) Проверяем IP отправителя (X-Real-IP или X-Forwarded-For или
             headers['x-yk-signature-ip'] — что есть). Если не в allowlist → None.
          2) Парсим JSON → возвращаем {payment_id, status, paid_at?, raw}.

        Принимает headers как dict (lowercased keys), как в роутере.
        """
        # 1) IP whitelist
        ip = (
            headers.get("x-real-ip")
            or headers.get("x-forwarded-for", "").split(",")[0].strip()
            or headers.get("x-original-forwarded-for")
        )
        if not _ip_in_yookassa_allowlist(ip):
            log.warning("YooKassa webhook отклонён: IP %r не в allowlist", ip)
            return None

        # 2) Парсим тело
        try:
            import json
            payload = json.loads(body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, ValueError) as e:
            log.error("YooKassa webhook: invalid body %s", e)
            return None

        event = payload.get("event") or ""
        obj = payload.get("object") or {}
        payment_id = obj.get("id")
        yk_status = obj.get("status") or ""

        # Маппинг статусов ЮKassa → наш ClinicPaymentStatus
        # YK: pending, waiting_for_capture, succeeded, canceled
        status_map = {
            "succeeded": "succeeded",
            "canceled":  "cancelled",
            "pending":   "pending",
            "waiting_for_capture": "pending",
        }
        # event типа payment.refund.succeeded → refunded
        if event.startswith("refund."):
            mapped = "refunded"
        else:
            mapped = status_map.get(yk_status, yk_status or "pending")

        paid_at: datetime | None = None
        captured_at = obj.get("captured_at") or obj.get("created_at")
        if isinstance(captured_at, str):
            try:
                paid_at = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
            except ValueError:
                paid_at = None

        return {
            "payment_id": payment_id,
            "status": mapped,
            "paid_at": paid_at,
            "raw": payload,
            "event": event,
        }
