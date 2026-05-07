"""
Сбер (Сбербанк Эквайринг) — адаптер (заглушка).

Документация: https://securepayments.sberbank.ru/wiki/doku.php
Endpoint: https://securepayments.sberbank.ru/payment/rest/register.do
Авторизация: userName + password (или token).
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


class SberGateway(BasePaymentGateway):
    """Сбер (REST): userName=shop_id, password=secret_key (либо api-token)."""
    name = "sber"

    async def init_payment(
        self,
        amount: Decimal,
        description: str,
        return_url: str,
        metadata: dict[str, Any] | None = None,
    ) -> PaymentInitResult:
        raise NotImplementedError(
            "Сбер: реализуйте register.do (amount в копейках, orderNumber, returnUrl)"
        )

    async def get_status(self, payment_id: str) -> PaymentStatusResult:
        raise NotImplementedError("Сбер: реализуйте getOrderStatusExtended.do")

    async def refund(self, payment_id: str, amount: Decimal | None = None) -> dict[str, Any]:
        raise NotImplementedError("Сбер: реализуйте refund.do (amount в копейках)")

    async def verify_webhook(
        self,
        headers: dict[str, str],
        body: bytes,
    ) -> dict[str, Any] | None:
        raise NotImplementedError(
            "Сбер: проверьте подпись HMAC из заголовка либо callback по checksum"
        )
