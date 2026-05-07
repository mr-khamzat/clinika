"""
Базовый класс ОФД-провайдера (54-ФЗ).

Каждый провайдер (Платформа ОФД, Первый ОФД, Такском, Атол.Онлайн) реализует
BaseOfdProvider. Конкретные реализации лежат рядом: platforma_ofd_adapter.py и т.д.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any


@dataclass
class FiscalReceiptData:
    """DTO одного чека из ответа ОФД."""
    inn: str
    operation_type: str                                       # sale | refund_sale | sale_correction
    total_sum: Decimal
    qr_code: str | None = None                                # t=...&s=...&fn=...
    fiscal_doc_number: str | None = None                      # ФД
    fiscal_storage_number: str | None = None                  # ФН
    fiscal_sign: str | None = None                            # ФП
    receipt_at: datetime | None = None
    raw_payload: dict[str, Any] = field(default_factory=dict)


class BaseOfdProvider(ABC):
    """Базовый интерфейс ОФД-провайдера."""
    name: str = ""

    def __init__(self, config):  # noqa: ANN001 — OFDConfig
        self.config = config

    @abstractmethod
    async def pull_receipts(self, since: datetime) -> list[FiscalReceiptData]:
        """Вытащить новые чеки начиная с момента since (ОФД-API obычно поддерживает delta)."""
        ...

    @abstractmethod
    async def verify_inn(self, inn: str) -> bool:
        """Проверить, что ИНН зарегистрирован у этого ОФД (true/false)."""
        ...
