"""
ЮKassa — адаптер интернет-эквайринга (заглушка).

Реальная реализация: pip install yookassa, использовать SDK yookassa.Payment.
Документация: https://yookassa.ru/developers/api
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from app.services.acquiring.base import (
    BasePaymentGateway,
    PaymentInitResult,
    PaymentStatusResult,
)


class YookassaGateway(BasePaymentGateway):
    """ЮKassa: shop_id + secret_key, Idempotence-Key обязателен."""
    name = "yookassa"

    async def init_payment(
        self,
        amount: Decimal,
        description: str,
        return_url: str,
        metadata: dict[str, Any] | None = None,
    ) -> PaymentInitResult:
        raise NotImplementedError(
            "YooKassa: подключите реальный SDK yookassa.Payment "
            "(https://yookassa.ru/developers/api)"
        )

    async def get_status(self, payment_id: str) -> PaymentStatusResult:
        raise NotImplementedError("YooKassa: реализуйте Payment.find_one(payment_id)")

    async def refund(self, payment_id: str, amount: Decimal | None = None) -> dict[str, Any]:
        raise NotImplementedError("YooKassa: реализуйте Refund.create(...)")

    async def verify_webhook(
        self,
        headers: dict[str, str],
        body: bytes,
    ) -> dict[str, Any] | None:
        raise NotImplementedError(
            "YooKassa: проверьте IP-белый список webhook + распарсите event=payment.succeeded"
        )
