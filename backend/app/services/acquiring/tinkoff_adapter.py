"""
Т-Банк (Tinkoff Acquiring) — адаптер интернет-эквайринга (заглушка).

Документация: https://www.tinkoff.ru/kassa/develop/api/
Endpoint: https://securepay.tinkoff.ru/v2/Init
Подпись: SHA-256 от alphabetically-sorted параметров + Password.
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


class TinkoffGateway(BasePaymentGateway):
    """Т-Банк Эквайринг (TerminalKey + Password)."""
    name = "tinkoff"

    async def init_payment(
        self,
        amount: Decimal,
        description: str,
        return_url: str,
        metadata: dict[str, Any] | None = None,
    ) -> PaymentInitResult:
        raise NotImplementedError(
            "Tinkoff: реализуйте POST https://securepay.tinkoff.ru/v2/Init "
            "(amount в копейках, OrderId, подпись Token=SHA256)"
        )

    async def get_status(self, payment_id: str) -> PaymentStatusResult:
        raise NotImplementedError("Tinkoff: реализуйте /v2/GetState")

    async def refund(self, payment_id: str, amount: Decimal | None = None) -> dict[str, Any]:
        raise NotImplementedError("Tinkoff: реализуйте /v2/Cancel")

    async def verify_webhook(
        self,
        headers: dict[str, str],
        body: bytes,
    ) -> dict[str, Any] | None:
        raise NotImplementedError(
            "Tinkoff: проверьте поле Token в JSON-теле, пересчитайте SHA-256"
        )
