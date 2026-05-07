"""
Пакет адаптеров ОФД-провайдеров.

Регистрирует все известные ОФД при импорте. Конкретные реализации —
заглушки до момента подключения реального API.

Использование:
    from app.services.fiscal import get_provider
    p = get_provider('platforma_ofd', config)   # config: OFDConfig
    receipts = await p.pull_receipts(since=...)
"""
from app.services.fiscal.base import BaseOfdProvider, FiscalReceiptData
from app.services.fiscal.registry import (
    register_provider,
    get_provider,
    list_registered,
)

# Импортируем и регистрируем
from app.services.fiscal.platforma_ofd_adapter import PlatformaOfdProvider
from app.services.fiscal.perv_ofd_adapter import PervOfdProvider
from app.services.fiscal.takskom_adapter import TakskomProvider
from app.services.fiscal.atol_online_adapter import AtolOnlineProvider

register_provider("platforma_ofd", PlatformaOfdProvider)
register_provider("perv_ofd",      PervOfdProvider)
register_provider("takskom",       TakskomProvider)
register_provider("atol_online",   AtolOnlineProvider)


__all__ = [
    "BaseOfdProvider",
    "FiscalReceiptData",
    "register_provider",
    "get_provider",
    "list_registered",
]
