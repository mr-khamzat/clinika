"""
Атол.Онлайн — адаптер (заглушка).

Документация: https://online.atol.ru/files/API_atol_online_v5.pdf
Базовый URL: https://online.atol.ru/possystem/v5/
Авторизация: getToken (login+pass) → access-token.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app.services.fiscal.base import BaseOfdProvider, FiscalReceiptData


class AtolOnlineProvider(BaseOfdProvider):
    """Атол.Онлайн (cloud-касса + ОФД)."""
    name = "atol_online"

    async def pull_receipts(self, since: datetime) -> list[FiscalReceiptData]:
        raise NotImplementedError(
            "Атол.Онлайн: реализуйте /possystem/v5/getToken → /possystem/v5/{group}/sell"
        )

    async def verify_inn(self, inn: str) -> bool:
        raise NotImplementedError(
            "Атол.Онлайн: проверка ИНН через /possystem/v5/companies/<inn>"
        )
