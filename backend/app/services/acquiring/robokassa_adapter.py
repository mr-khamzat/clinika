"""
Robokassa — адаптер (заглушка).

Документация: https://docs.robokassa.ru/
Авторизация: MerchantLogin + Password1/Password2.
Платёж: redirect на https://auth.robokassa.ru/Merchant/Index.aspx?...
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


class RobokassaGateway(BasePaymentGateway):
    """Robokassa: MerchantLogin (shop_id) + Password1 (secret_key)."""
    name = "robokassa"

    async def init_payment(
        self,
        amount: Decimal,
        description: str,
        return_url: str,
        metadata: dict[str, Any] | None = None,
    ) -> PaymentInitResult:
        raise NotImplementedError(
            "Robokassa: соберите URL https://auth.robokassa.ru/Merchant/Index.aspx "
            "с параметрами OutSum, InvId, SignatureValue=MD5(MerchantLogin:OutSum:InvId:Password1)"
        )

    async def get_status(self, payment_id: str) -> PaymentStatusResult:
        raise NotImplementedError("Robokassa: реализуйте /webservice/Service.asmx OpStateExt")

    async def refund(self, payment_id: str, amount: Decimal | None = None) -> dict[str, Any]:
        raise NotImplementedError(
            "Robokassa: возвраты только через личный кабинет либо отдельную заявку"
        )

    async def verify_webhook(
        self,
        headers: dict[str, str],
        body: bytes,
    ) -> dict[str, Any] | None:
        raise NotImplementedError(
            "Robokassa: проверьте SignatureValue=MD5(OutSum:InvId:Password2)"
        )
