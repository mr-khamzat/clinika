"""
Платформа ОФД — адаптер (заглушка).

Документация: https://platformaofd.ru/api-info
Базовый URL: https://lk.platformaofd.ru/api/lkapi/v3/
Авторизация: API-ключ в заголовке lkApiKey.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app.services.fiscal.base import BaseOfdProvider, FiscalReceiptData


class PlatformaOfdProvider(BaseOfdProvider):
    """Платформа ОФД (lkapi v3)."""
    name = "platforma_ofd"

    async def pull_receipts(self, since: datetime) -> list[FiscalReceiptData]:
        raise NotImplementedError(
            "Платформа ОФД: реализуйте GET /lkapi/v3/receipts?dateFrom=...&dateTo=... "
            "с заголовком lkApiKey"
        )

    async def verify_inn(self, inn: str) -> bool:
        raise NotImplementedError("Платформа ОФД: реализуйте /lkapi/v3/companies?inn=...")
