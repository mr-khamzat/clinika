"""Сервис feature flags.

Главная точка входа — ``is_enabled(db, flag_key, tenant_id)`` — возвращает
кортеж ``(enabled, variant)``. ``variant`` имеет смысл только для стратегии
ab_test (либо если super_admin задал явный variant в override).

Кеш Redis (TTL 60s):
  ff:flag:<key>                     → JSON метаданных флага (стратегия, дефолт, value).
  ff:override:<flag_id>:<tenant_id> → JSON override (enabled, variant) либо "null".

Кеш-промахи / Redis-обрывы безопасны: при недоступности Redis сразу идём в БД.

Детерминированность:
  percentage / ab_test используют HMAC-SHA256(key=flag_key, msg=tenant_id) →
  целое 0..9999 → bucket. Это значит: при одном и том же ключе и tenant_id
  результат стабилен, а смена ключа фичи (новый эксперимент) даёт новую
  «случайную» раскатку.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import uuid
from typing import Optional

import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.feature_flag import FeatureFlag, RolloutStrategy, TenantFeatureFlag


logger = logging.getLogger("feature_flag_service")

CACHE_TTL = 60  # seconds
_FLAG_KEY_TPL = "ff:flag:{key}"
_OVERRIDE_KEY_TPL = "ff:override:{flag_id}:{tenant_id}"


# ─── Redis helpers ──────────────────────────────────────────────────────────


async def _get_redis() -> aioredis.Redis | None:
    """Возвращает Redis-клиент или None если недоступен."""
    try:
        return aioredis.from_url(settings.redis_url, decode_responses=True)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("redis недоступен: %s", exc)
        return None


async def _cache_get(key: str) -> Optional[str]:
    r = await _get_redis()
    if not r:
        return None
    try:
        return await r.get(key)
    except Exception as exc:  # pragma: no cover
        logger.warning("redis get %s: %s", key, exc)
        return None
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


async def _cache_set(key: str, value: str, ttl: int = CACHE_TTL) -> None:
    r = await _get_redis()
    if not r:
        return
    try:
        await r.set(key, value, ex=ttl)
    except Exception as exc:  # pragma: no cover
        logger.warning("redis set %s: %s", key, exc)
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


async def _cache_delete(*keys: str) -> None:
    if not keys:
        return
    r = await _get_redis()
    if not r:
        return
    try:
        await r.delete(*keys)
    except Exception as exc:  # pragma: no cover
        logger.warning("redis del %s: %s", keys, exc)
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


# ─── Внутренние «лоадеры» с кешем ───────────────────────────────────────────


async def _load_flag(db: AsyncSession, flag_key: str) -> Optional[dict]:
    """Возвращает dict-снимок флага либо None если не существует."""
    cache_key = _FLAG_KEY_TPL.format(key=flag_key)
    cached = await _cache_get(cache_key)
    if cached is not None:
        try:
            data = json.loads(cached)
            return data if data else None  # "null" → None
        except json.JSONDecodeError:
            pass  # упал кеш — перечитаем из БД

    res = await db.execute(select(FeatureFlag).where(FeatureFlag.key == flag_key))
    flag: Optional[FeatureFlag] = res.scalar_one_or_none()
    if flag is None:
        await _cache_set(cache_key, "null")
        return None

    snapshot = {
        "id": str(flag.id),
        "key": flag.key,
        "default_enabled": bool(flag.default_enabled),
        "rollout_strategy": flag.rollout_strategy.value
        if isinstance(flag.rollout_strategy, RolloutStrategy)
        else str(flag.rollout_strategy),
        "rollout_value": flag.rollout_value or {},
    }
    await _cache_set(cache_key, json.dumps(snapshot))
    return snapshot


async def _load_override(
    db: AsyncSession, flag_id: uuid.UUID, tenant_id: uuid.UUID
) -> Optional[dict]:
    cache_key = _OVERRIDE_KEY_TPL.format(flag_id=flag_id, tenant_id=tenant_id)
    cached = await _cache_get(cache_key)
    if cached is not None:
        try:
            data = json.loads(cached)
            return data if data else None
        except json.JSONDecodeError:
            pass

    res = await db.execute(
        select(TenantFeatureFlag).where(
            TenantFeatureFlag.feature_flag_id == flag_id,
            TenantFeatureFlag.tenant_id == tenant_id,
        )
    )
    row: Optional[TenantFeatureFlag] = res.scalar_one_or_none()
    if row is None:
        await _cache_set(cache_key, "null")
        return None

    snapshot = {"enabled": bool(row.enabled), "variant": row.variant}
    await _cache_set(cache_key, json.dumps(snapshot))
    return snapshot


# ─── Детерминистический bucket ──────────────────────────────────────────────


def _bucket(flag_key: str, tenant_id: uuid.UUID, modulo: int = 10_000) -> int:
    """HMAC-SHA256(flag_key, tenant_id) → целое 0..modulo-1."""
    mac = hmac.new(
        flag_key.encode("utf-8"),
        str(tenant_id).encode("utf-8"),
        hashlib.sha256,
    ).digest()
    # Берём первые 8 байт как big-endian unsigned int.
    n = int.from_bytes(mac[:8], "big")
    return n % modulo


def _pick_variant(flag_key: str, tenant_id: uuid.UUID, variants: dict) -> str:
    """Выбирает variant пропорционально весам, детерминистически по tenant_id."""
    total = sum(float(w) for w in variants.values())
    if total <= 0:
        # Защита от битых данных — отдаём первый.
        return next(iter(variants))
    point = _bucket(flag_key, tenant_id) / 10_000 * total
    cumulative = 0.0
    for name, weight in variants.items():
        cumulative += float(weight)
        if point < cumulative:
            return name
    # Edge-case с плавающей точкой — последний.
    return list(variants)[-1]


# ─── Публичное API ──────────────────────────────────────────────────────────


async def is_enabled(
    db: AsyncSession, flag_key: str, tenant_id: uuid.UUID | None
) -> tuple[bool, Optional[str]]:
    """Возвращает (enabled, variant) для фичи на конкретном тенанте.

    Логика:
      1. Флага нет в БД          → (False, None).
      2. tenant_id == None       → возвращаем default_enabled (variant=None).
      3. Override на тенанте     → возвращаем (override.enabled, override.variant).
      4. Иначе по rollout_strategy:
         - all        → (default_enabled, None)
         - tenants    → (False, None)   (включаются только явные overrides)
         - percentage → bucket < percentage*100 → (True, None), иначе (False, None)
         - ab_test    → выбираем variant; enabled = (default_enabled or variant != "control")
    """
    flag = await _load_flag(db, flag_key)
    if flag is None:
        return (False, None)

    # Глобальный вызов без тенанта (например — system job).
    if tenant_id is None:
        return (bool(flag["default_enabled"]), None)

    override = await _load_override(db, uuid.UUID(flag["id"]), tenant_id)
    if override is not None:
        return (bool(override["enabled"]), override.get("variant"))

    strategy = flag["rollout_strategy"]
    rollout_value = flag.get("rollout_value") or {}

    if strategy == RolloutStrategy.all.value:
        return (bool(flag["default_enabled"]), None)

    if strategy == RolloutStrategy.tenants.value:
        # Без override фича выключена.
        return (False, None)

    if strategy == RolloutStrategy.percentage.value:
        pct = float(rollout_value.get("percentage", 0))
        # bucket 0..9999 — сравниваем с pct*100.
        enabled = _bucket(flag_key, tenant_id) < int(pct * 100)
        return (enabled, None)

    if strategy == RolloutStrategy.ab_test.value:
        variants = rollout_value.get("variants") or {}
        if not variants:
            return (bool(flag["default_enabled"]), None)
        chosen = _pick_variant(flag_key, tenant_id, variants)
        # A/B-тест по-умолчанию считается включённым (фича запущена в эксперименте).
        # Если super_admin хочет «контрольную ветку выкл» — он задаст
        # variant 'control' с весом, а в коде проверит variant != 'control'.
        return (True, chosen)

    # Неизвестная стратегия — fallback на default.
    return (bool(flag["default_enabled"]), None)


async def invalidate_flag_cache(flag_key: str) -> None:
    """Снести кеш конкретного флага. Override-ключи живут не больше TTL — не трогаем."""
    await _cache_delete(_FLAG_KEY_TPL.format(key=flag_key))


async def invalidate_override_cache(
    flag_id: uuid.UUID, tenant_id: uuid.UUID
) -> None:
    """Снести кеш override после изменения."""
    await _cache_delete(
        _OVERRIDE_KEY_TPL.format(flag_id=flag_id, tenant_id=tenant_id)
    )
