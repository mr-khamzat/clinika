"""
JWT Blacklist через Redis.
Отозванные access токены хранятся до их истечения: bl:<jti> = "1"
"""
import time
import redis.asyncio as aioredis
from app.config import settings

_redis_client: aioredis.Redis | None = None


def _get_redis() -> aioredis.Redis:
    """Ленивая инициализация единственного клиента."""
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


async def revoke_access_token(jti: str, exp: int) -> None:
    """
    Добавить jti в blacklist до момента истечения токена.
    exp — unix-timestamp из JWT payload.
    """
    ttl = int(exp - time.time())
    if ttl <= 0:
        # токен уже истёк — нет смысла хранить
        return
    r = _get_redis()
    await r.setex(f"bl:{jti}", ttl, "1")


async def is_token_revoked(jti: str) -> bool:
    """Вернуть True если токен находится в blacklist."""
    r = _get_redis()
    return bool(await r.exists(f"bl:{jti}"))
