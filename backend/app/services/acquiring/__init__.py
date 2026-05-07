"""
Пакет адаптеров интернет-эквайринга.

Регистрирует все известные шлюзы при импорте. Конкретные реализации —
заглушки (NotImplementedError) до момента подключения реального SDK.

Использование в сервисном коде:
    from app.services.acquiring import get_gateway, BasePaymentGateway
    gw = get_gateway('yookassa', config)   # config: PaymentGatewayConfig
    res = await gw.init_payment(...)
"""
from app.services.acquiring.base import (
    BasePaymentGateway,
    PaymentInitResult,
    PaymentStatusResult,
)
from app.services.acquiring.registry import (
    register_gateway,
    get_gateway,
    list_registered,
)

# Импортируем адаптеры и регистрируем — порядок не важен
from app.services.acquiring.yookassa_adapter import YookassaGateway
from app.services.acquiring.tinkoff_adapter import TinkoffGateway
from app.services.acquiring.sber_adapter import SberGateway
from app.services.acquiring.cloudpayments_adapter import CloudPaymentsGateway
from app.services.acquiring.robokassa_adapter import RobokassaGateway

register_gateway("yookassa",      YookassaGateway)
register_gateway("tinkoff",       TinkoffGateway)
register_gateway("sber",          SberGateway)
register_gateway("cloudpayments", CloudPaymentsGateway)
register_gateway("robokassa",     RobokassaGateway)


__all__ = [
    "BasePaymentGateway",
    "PaymentInitResult",
    "PaymentStatusResult",
    "register_gateway",
    "get_gateway",
    "list_registered",
]
