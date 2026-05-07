"""
Реестр адаптеров платёжных шлюзов.

Адаптеры регистрируются один раз (при импорте acquiring/__init__.py).
Чтобы добавить новый шлюз:
    1) написать <name>_adapter.py с подклассом BasePaymentGateway
    2) добавить импорт + register_gateway(...) в acquiring/__init__.py
"""
from __future__ import annotations

from typing import Type

from app.services.acquiring.base import BasePaymentGateway


# Глобальная карта name → класс адаптера
_GATEWAYS: dict[str, Type[BasePaymentGateway]] = {}


def register_gateway(name: str, cls: Type[BasePaymentGateway]) -> None:
    """Зарегистрировать адаптер под указанным ключом (yookassa, tinkoff, ...)."""
    if not name:
        raise ValueError("register_gateway: пустое имя")
    _GATEWAYS[name] = cls


def get_gateway(name: str, config) -> BasePaymentGateway:  # noqa: ANN001
    """Создать инстанс адаптера по name. Кидает KeyError если адаптер не найден."""
    cls = _GATEWAYS.get(name)
    if cls is None:
        raise KeyError(f"Платёжный шлюз '{name}' не зарегистрирован")
    return cls(config)


def list_registered() -> list[str]:
    """Список ключей зарегистрированных адаптеров (для UI/диагностики)."""
    return sorted(_GATEWAYS.keys())
