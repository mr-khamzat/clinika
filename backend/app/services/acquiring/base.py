"""
Базовый класс адаптера интернет-эквайринга.

Каждый шлюз (Юкасса/Т-Банк/Сбер/CloudPayments/Robokassa) должен реализовать
BasePaymentGateway. Конкретные реализации лежат рядом: yookassa_adapter.py и т.д.

Чтобы подключить новый шлюз — создать новый класс-адаптер и зарегистрировать
через register_gateway() в registry.py. Никаких других правок в коде не нужно.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any


@dataclass
class PaymentInitResult:
    """Результат инициализации платежа: куда перенаправить пациента."""
    payment_url: str                        # URL на checkout.yookassa.ru/... или конкретного шлюза
    payment_id: str                         # ID платежа в системе провайдера (gateway_payment_id)
    raw: dict[str, Any] = field(default_factory=dict)  # Сырая полезная нагрузка ответа


@dataclass
class PaymentStatusResult:
    """Результат опроса/получения статуса платежа."""
    status: str                             # pending | succeeded | cancelled | refunded
    paid_at: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class BasePaymentGateway(ABC):
    """
    Базовый интерфейс адаптера платёжного шлюза.

    Контракт:
      - name — короткий ключ ('yookassa', 'tinkoff', 'sber', 'cloudpayments', 'robokassa')
      - конструктор принимает PaymentGatewayConfig (модель)
      - все методы async и возвращают типизированный результат / dict
    """
    name: str = ""

    def __init__(self, config):  # noqa: ANN001 — PaymentGatewayConfig
        # Импорт локально чтобы избежать циклов при загрузке моделей
        self.config = config

    # ── Обязательные методы ──────────────────────────────────────────────────
    @abstractmethod
    async def init_payment(
        self,
        amount: Decimal,
        description: str,
        return_url: str,
        metadata: dict[str, Any] | None = None,
    ) -> PaymentInitResult:
        """Создать платёж в шлюзе и вернуть payment_url для редиректа пациента."""
        ...

    @abstractmethod
    async def get_status(self, payment_id: str) -> PaymentStatusResult:
        """Опросить статус по gateway_payment_id."""
        ...

    @abstractmethod
    async def refund(self, payment_id: str, amount: Decimal | None = None) -> dict[str, Any]:
        """Возврат полностью или частично (amount). Возвращает raw-ответ."""
        ...

    @abstractmethod
    async def verify_webhook(
        self,
        headers: dict[str, str],
        body: bytes,
    ) -> dict[str, Any] | None:
        """
        Проверить подпись webhook и распарсить.

        Возвращает {'payment_id', 'status', 'paid_at?', 'raw'} если подпись валидна;
        None — если webhook не от провайдера / подпись битая.
        """
        ...
