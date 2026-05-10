"""
FastAPI-зависимости для публичного API (`/api/v1/...`).

Авторизация:
  - Authorization: Bearer clk_live_...
  - либо X-Clinika-API-Key: clk_live_...

Возвращает резолвнутый TenantApiKey + tenant_id. Скоупы проверяются require_scope().
"""
import time
from collections import defaultdict, deque
from typing import Iterable

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.tenant_api_key import TenantApiKey
from app.services import api_key_service


# Rate-limit: 1000 req/hour per key.  In-process (без Redis-зависимости),
# хранится по api-key id. После рестарта счётчик сбрасывается.
_RATE_LIMIT_PER_HOUR = 1000
_RATE_WINDOW_SEC = 3600
_rate_buckets: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str | None:
    for header in ("x-real-ip", "x-forwarded-for"):
        v = request.headers.get(header)
        if v:
            return v.split(",")[0].strip()
    return getattr(request.client, "host", None) if request.client else None


def _check_rate_limit(key_id: str) -> bool:
    now = time.time()
    bucket = _rate_buckets[key_id]
    cutoff = now - _RATE_WINDOW_SEC
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= _RATE_LIMIT_PER_HOUR:
        return False
    bucket.append(now)
    return True


async def verify_tenant_api_key(
    request: Request,
    authorization: str | None = Header(default=None),
    x_clinika_api_key: str | None = Header(default=None, alias="X-Clinika-API-Key"),
    db: AsyncSession = Depends(get_db),
) -> TenantApiKey:
    """Резолвит ключ из заголовков, проверяет валидность и rate-limit."""
    raw = None
    if authorization:
        parts = authorization.split(None, 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            raw = parts[1].strip()
    if not raw and x_clinika_api_key:
        raw = x_clinika_api_key.strip()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API-ключ не передан (Authorization: Bearer ... или X-Clinika-API-Key)",
            headers={"WWW-Authenticate": "Bearer"},
        )
    client_ip = _client_ip(request)
    key_obj = await api_key_service.verify_raw_key(db, raw, client_ip=client_ip)
    if key_obj is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API-ключ недействителен (revoked/expired/IP не разрешён)",
        )
    if not _check_rate_limit(str(key_obj.id)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit: {_RATE_LIMIT_PER_HOUR} запросов в час исчерпан",
        )
    # сохраняем ключ в state, чтобы аудит-роутеры могли логировать api.request
    request.state.api_key = key_obj
    request.state.api_key_tenant_id = key_obj.tenant_id
    return key_obj


def require_scope(*scopes: str):
    """Зависимость: требуется хотя бы один из перечисленных скоупов."""
    required: tuple[str, ...] = tuple(scopes)

    async def checker(api_key: TenantApiKey = Depends(verify_tenant_api_key)) -> TenantApiKey:
        granted: Iterable[str] = api_key.scopes or []
        if not any(s in granted for s in required):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Недостаточно прав. Требуется один из скоупов: {', '.join(required)}",
            )
        return api_key

    return checker
