"""
Реестр плагинов — синглтон.
Регистрирует плагины при старте приложения, предоставляет доступ по имени.
"""
from typing import Iterator
from app.plugins.base import BasePlugin


class PluginRegistry:
    def __init__(self):
        self._plugins: dict[str, BasePlugin] = {}

    def register(self, plugin: BasePlugin) -> None:
        """Зарегистрировать плагин. Вызывается при старте приложения."""
        self._plugins[plugin.name] = plugin

    def get(self, name: str) -> BasePlugin | None:
        return self._plugins.get(name)

    def all(self) -> list[BasePlugin]:
        return list(self._plugins.values())

    def __iter__(self) -> Iterator[BasePlugin]:
        return iter(self._plugins.values())


# Глобальный реестр (импортируется везде)
plugin_registry = PluginRegistry()
