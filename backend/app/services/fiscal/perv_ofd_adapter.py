"""
Первый ОФД — адаптер (заглушка).

Документация: https://www.1-ofd.ru/api/
Авторизация: API-токен.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app.services.fiscal.base import BaseOfdProvider, FiscalReceiptData


class PervOfdProvider(BaseOfdProvider):
    """Первый ОФД."""
    name = "perv_ofd"

    async def pull_receipts(self, since: datetime) -> list[FiscalReceiptData]:
        raise NotImplementedError(
            "Первый ОФД: реализуйте /api/v2/receipts через токен Authorization: Bearer ..."
        )

    async def verify_inn(self, inn: str) -> bool:
        raise NotImplementedError("Первый ОФД: реализуйте /api/v2/companies/inn/<inn>")
