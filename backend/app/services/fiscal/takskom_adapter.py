"""
Такском ОФД — адаптер (заглушка).

Документация: https://taxcom.ru/about/news/api-ofd/
Базовый URL: https://api-online.taxcom.ru/API/
Авторизация: пользователь+пароль или API-key.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app.services.fiscal.base import BaseOfdProvider, FiscalReceiptData


class TakskomProvider(BaseOfdProvider):
    """Такском ОФД."""
    name = "takskom"

    async def pull_receipts(self, since: datetime) -> list[FiscalReceiptData]:
        raise NotImplementedError(
            "Такском: реализуйте POST /API/v2/Login → /API/v2/Documents?from=..."
        )

    async def verify_inn(self, inn: str) -> bool:
        raise NotImplementedError("Такском: реализуйте /API/v2/Companies/{inn}")
