"""
Утилиты безопасности:
- SlidingWindowRateLimiter: глобальный rate-limit middleware (per IP, Redis)
- assert_tenant_owns: IDOR-защита для ресурсов тенанта
"""
import time
import asyncio
from typing import Optional
from fastapi import HTTPException, Request, status


# ── IDOR защита ───────────────────────────────────────────────────────────────

def assert_tenant_owns(resource_tenant_id: Optional[object], current_tenant_id: Optional[object]) -> None:
    """
    Проверяет принадлежность ресурса тенанту. Бросает 403 если не совпадает.
    Пропускает super_admin (current_tenant_id=None).
    """
    if current_tenant_id is None:
        return  # super_admin — всё разрешено
    if resource_tenant_id is None:
        return  # ресурс без тенанта — глобальный, разрешён
    if str(resource_tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ запрещён: ресурс принадлежит другому тенанту",
        )


# ── Sliding Window Rate Limiter ───────────────────────────────────────────────

class SlidingWindowRateLimiter:
    """
    Middleware глобального rate-limit на основе Redis (sliding window).
    Fallback на in-memory dict если Redis недоступен.
    """

    def __init__(
        self,
        limit: int = 200,
        window: int = 60,
        skip_paths: tuple[str, ...] = ("/health", "/metrics", "/docs", "/openapi.json", "/redoc"),
    ):
        self.limit = limit
        self.window = window
        self.skip_paths = skip_paths
        self._memory: dict[str, list[float]] = {}

    def _get_ip(self, request: Request) -> str:
        return (
            request.headers.get("x-real-ip")
            or (request.headers.get("x-forwarded-for", "").split(",")[0].strip())
            or (request.client.host if request.client else "unknown")
        )

    async def _check_redis(self, ip: str) -> bool:
        """True — запрос разрешён, False — превышен лимит."""
        try:
            import redis.asyncio as aioredis
            from app.config import settings
            r = aioredis.from_url(settings.redis_url, decode_responses=True)
            key = f"rl:{ip}"
            now = time.time()
            pipe = r.pipeline()
            pipe.zremrangebyscore(key, 0, now - self.window)
            pipe.zadd(key, {str(now): now})
            pipe.zcard(key)
            pipe.expire(key, self.window + 5)
            results = await pipe.execute()
            await r.aclose()
            count = results[2]
            return count <= self.limit
        except Exception:
            return self._check_memory(ip)

    def _check_memory(self, ip: str) -> bool:
        now = time.time()
        cutoff = now - self.window
        timestamps = [t for t in self._memory.get(ip, []) if t > cutoff]
        timestamps.append(now)
        self._memory[ip] = timestamps
        return len(timestamps) <= self.limit

    async def __call__(self, request: Request, call_next):
        if any(request.url.path.startswith(p) for p in self.skip_paths):
            return await call_next(request)
        ip = self._get_ip(request)
        allowed = await self._check_redis(ip)
        if not allowed:
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=429,
                content={"detail": "Слишком много запросов. Попробуйте позже."},
                headers={"Retry-After": str(self.window)},
            )
        return await call_next(request)
