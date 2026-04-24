"""
Prometheus метрики для Clinika.
Endpoint: GET /metrics — возвращает текст в формате Prometheus exposition.
Доступен только для super_admin (через X-Metrics-Token) или локально.
"""
from prometheus_client import (
    Counter, Histogram, Gauge, Info,
    generate_latest, CONTENT_TYPE_LATEST,
    REGISTRY,
)
from fastapi import APIRouter, Request, Response, HTTPException
from app.config import settings

router = APIRouter(tags=["prometheus"])

# ── Метрики ──────────────────────────────────────────────────────────────────

http_requests_total = Counter(
    "clinika_http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"],
)

http_request_duration_seconds = Histogram(
    "clinika_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "endpoint"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
)

active_websockets = Gauge(
    "clinika_active_websockets",
    "Active WebSocket connections",
)

db_pool_checked_out = Gauge(
    "clinika_db_pool_checked_out",
    "DB connections currently checked out",
)

app_info = Info("clinika_app", "Application info")
app_info.info({"version": "1.0.0", "environment": "production"})


def _normalize_path(path: str) -> str:
    """Заменяем UUID/числа в пути на {id} для группировки."""
    import re
    path = re.sub(r'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '/{id}', path)
    path = re.sub(r'/\d+', '/{id}', path)
    return path


async def metrics_middleware(request: Request, call_next):
    """Middleware для сбора HTTP метрик."""
    import time
    start = time.monotonic()
    response = await call_next(request)
    duration = time.monotonic() - start
    endpoint = _normalize_path(request.url.path)
    http_requests_total.labels(
        method=request.method,
        endpoint=endpoint,
        status=str(response.status_code),
    ).inc()
    http_request_duration_seconds.labels(
        method=request.method,
        endpoint=endpoint,
    ).observe(duration)
    return response


# ── Endpoint ──────────────────────────────────────────────────────────────────

METRICS_TOKEN = getattr(settings, 'metrics_token', '')


@router.get("/metrics")
async def prometheus_metrics(request: Request):
    """
    Prometheus exposition format.
    Защищён токеном: ?token=... или заголовок X-Metrics-Token.
    Если токен не настроен — доступен только с localhost.
    """
    # Проверка доступа
    client_ip = (
        request.headers.get("x-real-ip")
        or (request.client.host if request.client else "unknown")
    )
    token = request.query_params.get("token") or request.headers.get("x-metrics-token", "")

    if METRICS_TOKEN:
        if token != METRICS_TOKEN:
            raise HTTPException(status_code=403, detail="Invalid metrics token")
    else:
        # Без токена — только localhost/internal
        if client_ip not in ("127.0.0.1", "::1", "172.18.0.1", "172.19.0.1"):
            raise HTTPException(status_code=403, detail="Metrics require token or local access")

    # Обновляем динамические gauge-метрики
    try:
        from app.routers.presence import presence_manager
        active_websockets.set(len(presence_manager.connections))
    except Exception:
        pass

    try:
        from app.database import engine
        pool = engine.pool
        db_pool_checked_out.set(pool.checkedout())
    except Exception:
        pass

    data = generate_latest(REGISTRY)
    return Response(content=data, media_type=CONTENT_TYPE_LATEST)
