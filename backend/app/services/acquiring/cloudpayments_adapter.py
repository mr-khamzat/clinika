"""
CloudPayments — адаптер (заглушка).

Документация: https://developers.cloudpayments.ru/
Базовая авторизация: Public ID + API secret.
Часто используется виджет на стороне фронта (cp.payments.run).
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


class CloudPaymentsGateway(BasePaymentGateway):
    """CloudPayments: PublicID (shop_id) + API secret."""
    name = "cloudpayments"

    async def init_payment(
        self,
        amount: Decimal,
        description: str,
        return_url: str,
        metadata: dict[str, Any] | None = None,
    ) -> PaymentInitResult:
        raise NotImplementedError(
            "CloudPayments: реализуйте /orders/create или используйте виджет cp.payments на фронте"
        )

    async def get_status(self, payment_id: str) -> PaymentStatusResult:
        raise NotImplementedError("CloudPayments: реализуйте /payments/get")

    async def refund(self, payment_id: str, amount: Decimal | None = None) -> dict[str, Any]:
        raise NotImplementedError("CloudPayments: реализуйте /payments/refund")

    async def verify_webhook(
        self,
        headers: dict[str, str],
        body: bytes,
    ) -> dict[str, Any] | None:
        raise NotImplementedError(
            "CloudPayments: проверьте Content-HMAC заголовок (HMAC-SHA256 на body+secret)"
        )
