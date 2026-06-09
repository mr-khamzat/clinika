"""RateLimitMiddleware — per-tenant rate limiting на Redis sliding window.

Логика:
  1. SKIP_PATHS (/health, /metrics, /docs, /openapi.json, /redoc) — пропускаем.
  2. Достаём tenant_id из JWT (decode без обращения в БД — быстрее).
  3. Если tenant_id есть — проверяем лимит по TenantQuota.requests_per_minute
     (кеш в памяти на 60 секунд, чтобы не ходить в БД на каждый запрос).
  4. Если tenant_id нет — IP-based fallback, 1000 req/min.
  5. Превышение → 429 + Retry-After + JSON {detail, retry_after}.
  6. Учёт RPD: incr quota:rpd:<tid>:<today> и пометить tenant в pending-set,
     чтобы scheduler-flush сбросил это в quota_usage.

Redis (декодируем строки) уровень даёт sliding-window через INCR+EXPIRE.
"""
from __future__ import annotations

import logging
import time
import uuid
from typing import Awaitable, Callable, Optional

import redis.asyncio as aioredis
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.services import quota_service

log = logging.getLogger("rate_limit")


SKIP_PATHS = (
    "/health",
    "/metrics",
    "/docs",
    "/openapi.json",
    "/redoc",
)

# IP-fallback для анонимных запросов: 1000 RPM (по требованию ТЗ).
IP_FALLBACK_RPM = 1000

# Кеш TenantQuota.requests_per_minute в памяти процесса.
# Структура: {tenant_id: (rpm_limit, expires_monotonic)}
_QUOTA_CACHE: dict[str, tuple[int, float]] = {}
_QUOTA_CACHE_TTL = 60.0  # сек


def _get_client_ip(request: Request) -> Optional[str]:
    return (
        request.headers.get("x-real-ip")
        or (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or None)
        or (request.client.host if request.client else None)
    )


def _extract_tenant_from_jwt(request: Request) -> Optional[uuid.UUID]:
    """Декодирует Bearer-токен и возвращает tenant_id из claims (без БД).

    JWT в Clinika хранит user_id в sub. tenant_id положим в request.state.user_id
    и резолвим уже в БД через scheduler? Нет — слишком долго.
    Вариант: достаём tenant_id напрямую из claim 'tid' если он есть, иначе fallback к sub.

    На практике в этом проекте JWT не содержит tenant_id, только sub=user_id.
    Поэтому для middleware используем подход "tenant_id из заголовка X-Tenant-Id"
    (если запрос идёт через api-gateway) ИЛИ из JWT.
    Если ни того, ни другого нет — middleware вернёт None и сработает IP fallback.
    """
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return None
    token = auth.split(" ", 1)[1].strip()
    try:
        from app.core.security import decode_token
        payload = decode_token(token)
    except Exception:
        return None
    if not payload:
        return None

    tid_raw = payload.get("tid") or payload.get("tenant_id")
    if tid_raw:
        try:
            return uuid.UUID(str(tid_raw))
        except Exception:
            return None
    return None


async def _resolve_tenant_id(request: Request, redis) -> Optional[uuid.UUID]:
    """1) JWT claim, 2) кеш user→tenant в Redis, 3) None."""
    tid = _extract_tenant_from_jwt(request)
    if tid is not None:
        return tid

    # Fallback: посмотреть кеш user_id→tenant_id (заполняется auth-роутером при логине).
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return None
    token = auth.split(" ", 1)[1].strip()
    try:
        from app.core.security import decode_token
        payload = decode_token(token)
    except Exception:
        return None
    if not payload:
        return None
    sub = payload.get("sub")
    if not sub or redis is None:
        return None
    try:
        cached = await redis.get(f"user_tenant:{sub}")
        if cached:
            return uuid.UUID(cached)
    except Exception:
        return None
    return None


async def _get_rpm_limit(db_getter: Callable, tenant_id: uuid.UUID) -> int:
    """Достаёт RPM-лимит из БД или из кеша. db_getter — async () -> AsyncSession ctx."""
    tid_str = str(tenant_id)
    cached = _QUOTA_CACHE.get(tid_str)
    now = time.monotonic()
    if cached and cached[1] > now:
        return cached[0]

    from app.models.api_quota import DEFAULT_REQUESTS_PER_MINUTE
    limit = DEFAULT_REQUESTS_PER_MINUTE
    try:
        async for db in db_getter():
            q = await quota_service.get_quota(db, tenant_id)
            limit = int(q.requests_per_minute) or DEFAULT_REQUESTS_PER_MINUTE
            break
    except Exception as exc:  # pragma: no cover
        log.warning(f"_get_rpm_limit failed: {exc}")
        limit = DEFAULT_REQUESTS_PER_MINUTE

    _QUOTA_CACHE[tid_str] = (limit, now + _QUOTA_CACHE_TTL)
    return limit


def invalidate_quota_cache(tenant_id: Optional[uuid.UUID] = None) -> None:
    """Сбрасывает in-memory кеш RPM-лимита. Если tenant_id=None — целиком."""
    if tenant_id is None:
        _QUOTA_CACHE.clear()
    else:
        _QUOTA_CACHE.pop(str(tenant_id), None)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-tenant rate limiting через Redis sliding window."""

    def __init__(self, app, enabled: bool = True):
        super().__init__(app)
        self.enabled = enabled
        self._redis: Optional[aioredis.Redis] = None

    async def _get_redis(self) -> Optional[aioredis.Redis]:
        if self._redis is not None:
            return self._redis
        try:
            self._redis = aioredis.from_url(settings.redis_url, decode_responses=True)
        except Exception as exc:  # pragma: no cover
            log.warning(f"RateLimitMiddleware: redis init failed: {exc}")
            self._redis = None
        return self._redis

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable]
    ):
        if not self.enabled:
            return await call_next(request)

        path = request.url.path
        if any(path.startswith(p) for p in SKIP_PATHS):
            return await call_next(request)

        redis = await self._get_redis()
        if redis is None:
            # Redis недоступен — лучше пропустить (fail-open), чем блокировать платформу.
            return await call_next(request)

        tenant_id = await _resolve_tenant_id(request, redis)

        if tenant_id is not None:
            # Per-tenant: лимит из TenantQuota.requests_per_minute.
            from app.database import get_db
            limit = await _get_rpm_limit(get_db, tenant_id)
            allowed, current, retry_after = await quota_service.check_rpm(redis, tenant_id, limit)
            if not allowed:
                return JSONResponse(
                    status_code=429,
                    headers={"Retry-After": str(retry_after)},
                    content={
                        "detail": "Превышен лимит запросов в минуту для tenant",
                        "limit": limit,
                        "current": current,
                        "retry_after": retry_after,
                        "scope": "tenant",
                    },
                )
            # Учитываем RPD-счётчик (для scheduler/flush_to_db).
            try:
                await quota_service.increment_usage(redis, tenant_id, "requests", 1)
            except Exception:
                pass
        else:
            # Анонимный IP-fallback.
            ip = _get_client_ip(request) or "unknown"
            key = f"quota:rpm:ip:{ip}"
            try:
                cur = await redis.incr(key)
                if cur == 1:
                    await redis.expire(key, 60)
                if int(cur) > IP_FALLBACK_RPM:
                    ttl = await redis.ttl(key)
                    try:
                        ttl = int(ttl)
                    except Exception:
                        ttl = 60
                    if ttl < 0:
                        ttl = 60
                    return JSONResponse(
                        status_code=429,
                        headers={"Retry-After": str(ttl)},
                        content={
                            "detail": "Превышен лимит запросов в минуту с этого IP",
                            "limit": IP_FALLBACK_RPM,
                            "current": int(cur),
                            "retry_after": ttl,
                            "scope": "ip",
                        },
                    )
            except Exception as exc:  # pragma: no cover
                log.warning(f"rate_limit IP fallback failed: {exc}")

        return await call_next(request)
