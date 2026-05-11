"""
Per-endpoint rate-limit на Redis (sliding window).

Используется как FastAPI Depends:
    @router.post('/x', dependencies=[Depends(rate_limit_dep('booking', 10, 600))])

Параметры:
    bucket  — имя бакета (изолирует счётчики между endpoint'ами)
    limit   — максимум попыток
    window  — окно в секундах

Fallback: при недоступности Redis — in-memory dict (на процесс),
так что rate-limit продолжает работать локально, но НЕ кросс-процессно.
"""
import time
from typing import Callable, Optional

from fastapi import HTTPException, Request, status


# ── helpers ───────────────────────────────────────────────────────────────────

def get_client_ip(request: Request) -> str:
    """Извлечь IP клиента с учётом прокси (x-real-ip / x-forwarded-for)."""
    return (
        request.headers.get("x-real-ip")
        or (request.headers.get("x-forwarded-for", "").split(",")[0].strip())
        or (request.client.host if request.client else "unknown")
    )


# ── in-memory fallback (на процесс) ───────────────────────────────────────────
_MEMORY: dict[str, list[float]] = {}


def _check_memory(key: str, limit: int, window: int) -> bool:
    now = time.time()
    cutoff = now - window
    ts = [t for t in _MEMORY.get(key, []) if t > cutoff]
    ts.append(now)
    _MEMORY[key] = ts
    # ограничим длину памяти (защита от роста)
    if len(_MEMORY) > 50000:
        _MEMORY.clear()
    return len(ts) <= limit


async def _check_redis(key: str, limit: int, window: int) -> bool:
    """True — разрешено, False — превышен лимит."""
    try:
        import redis.asyncio as aioredis
        from app.config import settings
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        now = time.time()
        pipe = r.pipeline()
        pipe.zremrangebyscore(key, 0, now - window)
        pipe.zadd(key, {f"{now}:{id(pipe)}": now})
        pipe.zcard(key)
        pipe.expire(key, window + 5)
        results = await pipe.execute()
        await r.aclose()
        count = results[2]
        return count <= limit
    except Exception:
        return _check_memory(key, limit, window)


# ── публичные API ─────────────────────────────────────────────────────────────

def rate_limit_dep(
    bucket: str,
    limit: int,
    window: int,
    key_fn: Optional[Callable[[Request], str]] = None,
    error_message: str = "Слишком много запросов. Попробуйте позже.",
) -> Callable:
    """
    Возвращает FastAPI dependency, проверяющий per-IP rate-limit.

    @router.post('/x', dependencies=[Depends(rate_limit_dep('booking', 10, 600))])
    """
    async def _dep(request: Request) -> None:
        suffix = key_fn(request) if key_fn else get_client_ip(request)
        redis_key = f"rl:{bucket}:{suffix}"
        allowed = await _check_redis(redis_key, limit, window)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=error_message,
                headers={"Retry-After": str(window)},
            )
    return _dep


def check_honeypot(value: Optional[str], field_name: str = "website_url") -> None:
    """
    Проверка honeypot-поля: если оно заполнено — это бот, кидаем 403.
    Поле должно быть скрыто в форме (display:none / tabindex=-1).
    """
    if value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Запрос отклонён",
        )
