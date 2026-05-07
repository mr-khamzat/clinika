"""
Реестр ОФД-провайдеров (Платформа/Первый/Такском/Атол.Онлайн).

Аналог acquiring/registry.py — просто карта name → класс.
"""
from __future__ import annotations

from typing import Type

from app.services.fiscal.base import BaseOfdProvider


_PROVIDERS: dict[str, Type[BaseOfdProvider]] = {}


def register_provider(name: str, cls: Type[BaseOfdProvider]) -> None:
    """Зарегистрировать ОФД-провайдер."""
    if not name:
        raise ValueError("register_provider: пустое имя")
    _PROVIDERS[name] = cls


def get_provider(name: str, config) -> BaseOfdProvider:  # noqa: ANN001
    """Создать инстанс провайдера по имени. KeyError если не зарегистрирован."""
    cls = _PROVIDERS.get(name)
    if cls is None:
        raise KeyError(f"ОФД-провайдер '{name}' не зарегистрирован")
    return cls(config)


def list_registered() -> list[str]:
    """Список зарегистрированных провайдеров."""
    return sorted(_PROVIDERS.keys())
