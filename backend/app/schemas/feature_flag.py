"""Pydantic схемы для feature flags + tenant overrides."""
from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.feature_flag import RolloutStrategy


_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,79}$")


def validate_rollout_value(
    strategy: RolloutStrategy, value: Optional[dict]
) -> Optional[dict]:
    """Проверяем что rollout_value соответствует выбранной стратегии."""
    if strategy in (RolloutStrategy.all, RolloutStrategy.tenants):
        # Для all/tenants значение не используется — можно None или пустой dict.
        return value or None

    if value is None or not isinstance(value, dict):
        raise ValueError("rollout_value обязателен для percentage/ab_test")

    if strategy is RolloutStrategy.percentage:
        pct = value.get("percentage")
        if not isinstance(pct, (int, float)) or not (0 <= float(pct) <= 100):
            raise ValueError("percentage должен быть числом 0..100")
        return {"percentage": float(pct)}

    if strategy is RolloutStrategy.ab_test:
        variants = value.get("variants")
        if not isinstance(variants, dict) or not variants:
            raise ValueError("variants должен быть непустым словарём {name: weight}")
        total = 0.0
        cleaned: dict[str, float] = {}
        for name, weight in variants.items():
            if not isinstance(name, str) or not name:
                raise ValueError("Имя варианта должно быть непустой строкой")
            if not isinstance(weight, (int, float)) or float(weight) < 0:
                raise ValueError("Вес варианта должен быть числом >= 0")
            cleaned[name] = float(weight)
            total += float(weight)
        if total <= 0:
            raise ValueError("Сумма весов вариантов должна быть > 0")
        return {"variants": cleaned}

    return value


class FeatureFlagBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=4000)
    default_enabled: bool = False
    rollout_strategy: RolloutStrategy = RolloutStrategy.all
    rollout_value: Optional[dict[str, Any]] = None


class FeatureFlagCreate(FeatureFlagBase):
    key: str = Field(min_length=2, max_length=80)

    @field_validator("key")
    @classmethod
    def _check_key(cls, v: str) -> str:
        if not _KEY_RE.match(v):
            raise ValueError(
                "key должен быть snake_case ASCII (a-z, 0-9, _), начинаться с буквы"
            )
        return v

    def normalized_rollout_value(self) -> Optional[dict]:
        return validate_rollout_value(self.rollout_strategy, self.rollout_value)


class FeatureFlagUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=4000)
    default_enabled: Optional[bool] = None
    rollout_strategy: Optional[RolloutStrategy] = None
    rollout_value: Optional[dict[str, Any]] = None


class FeatureFlagResponse(FeatureFlagBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    key: str
    created_at: datetime
    updated_at: datetime
    # Денормализованное поле — заполняет роутер при выдаче списка.
    overrides_count: int = 0


class TenantFeatureFlagSet(BaseModel):
    """PUT /{key}/tenants/{tenant_id} — задать override."""

    enabled: bool
    variant: Optional[str] = Field(default=None, max_length=40)


class TenantFeatureFlagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID
    feature_flag_id: uuid.UUID
    enabled: bool
    variant: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # Денормализованное поле — заполняется при выдаче списка по флагу.
    tenant_name: Optional[str] = None
    tenant_slug: Optional[str] = None
