"""
Базовый интерфейс плагина.
Каждый плагин: имеет имя, умеет проверить доступность и пройти health-check.
"""
from abc import ABC, abstractmethod


class BasePlugin(ABC):
    # Переопределить в подклассе
    name: str = ""
    display_name: str = ""
    description: str = ""

    @abstractmethod
    async def is_enabled(self) -> bool:
        """Плагин включён и сконфигурирован (проверяет наличие ключей/настроек)."""

    @abstractmethod
    async def health_check(self) -> dict:
        """
        Возвращает словарь вида:
          {"ok": True/False, "detail": "...", ...}
        """
