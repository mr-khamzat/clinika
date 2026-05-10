"""
BlockIpMiddleware — отвергает запросы с IP, помеченных как заблокированные
super_admin'ом в таблице blocked_ips.

Кеширует список IP в памяти на BLOCK_CACHE_TTL секунд, чтобы не ходить
в БД на каждый запрос. Кеш обновляется лениво при первом запросе после
истечения TTL.

Никогда не блокирует health-эндпоинты — иначе watchdog не сможет
проверить /health после блокировки.
"""
import asyncio
import logging
import time
from typing import Awaitable, Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

log = logging.getLogger("block_ip")

BLOCK_CACHE_TTL = 30  # секунд — между обновлениями кеша
SKIP_PATHS = (
    "/health",
    "/health/full",
    "/metrics",
)


class BlockIpMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self._cache: set[str] = set()
        self._cache_expires_at: float = 0.0
        self._refresh_lock = asyncio.Lock()

    def _get_ip(self, request: Request) -> str | None:
        return (
            request.headers.get("x-real-ip")
            or (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or None)
            or (request.client.host if request.client else None)
        )

    async def _refresh_cache(self) -> None:
        # Только один таск обновляет кеш одновременно
        async with self._refresh_lock:
            if time.monotonic() < self._cache_expires_at:
                return  # пока ждали лок, кто-то уже обновил
            try:
                from app.services.security_service import get_active_blocked_ips
                self._cache = await get_active_blocked_ips()
                self._cache_expires_at = time.monotonic() + BLOCK_CACHE_TTL
            except Exception as e:
                log.warning(f"block-ip cache refresh failed: {e}")
                # Не обновляем expires — пробуем снова через короткое время
                self._cache_expires_at = time.monotonic() + 5

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable]
    ):
        if any(request.url.path.startswith(p) for p in SKIP_PATHS):
            return await call_next(request)

        if time.monotonic() >= self._cache_expires_at:
            await self._refresh_cache()

        ip = self._get_ip(request)
        if ip and ip in self._cache:
            log.info(f"[block-ip] denied {ip} → {request.url.path}")
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "Доступ с этого IP заблокирован администратором платформы",
                    "blocked": True,
                },
            )

        return await call_next(request)

    def invalidate(self) -> None:
        """Сбросить кеш — вызывается после block-ip/unblock из роутера."""
        self._cache_expires_at = 0.0


# Singleton-инстанс middleware — чтобы роутер мог инвалидировать кеш.
# Экспортируется как module-level, создаётся при .add_middleware и
# регистрируется через app.state.block_ip_mw в lifespan.
