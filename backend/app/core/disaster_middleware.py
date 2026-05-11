"""
Disaster-mode middleware.

Файл-флаг: /app/data/disaster_mode.flag (внутри контейнера) =
            /opt/clinika/backend/data/disaster_mode.flag (на хосте).

Если флаг есть:
  - все mutation-запросы (POST/PUT/PATCH/DELETE) → 503 с Retry-After
  - GET-запросы продолжают работать (read-only)
  - whitelist путей для health-check и админ-управления:
        /health
        /health/full
        /health/detailed
        /admin/system/...
        /openapi.json, /docs, /redoc
"""
import os
from pathlib import Path
from fastapi import Request
from fastapi.responses import JSONResponse
from app.core.logging import get_logger

logger = get_logger("disaster_mode")

# Путь к флагу. Backend контейнер mount'ит /opt/clinika/backend/data в /app/data.
# Если /app/data не существует — используем относительный путь.
_CANDIDATES = [
    Path("/app/data/disaster_mode.flag"),
    Path("/opt/clinika/backend/data/disaster_mode.flag"),
    Path("./data/disaster_mode.flag"),
]


def _flag_path() -> Path:
    for p in _CANDIDATES:
        if p.parent.exists():
            return p
    # fallback: создадим в /tmp если ничего из выше не существует
    return Path("/tmp/disaster_mode.flag")


def is_disaster_mode() -> bool:
    return _flag_path().exists()


def get_flag_info() -> dict:
    p = _flag_path()
    info = {"flag_path": str(p), "enabled": p.exists()}
    if p.exists():
        try:
            stat = p.stat()
            info["since"] = stat.st_mtime
            info["reason"] = p.read_text(encoding="utf-8")[:500]
        except Exception:
            pass
    return info


def enable_disaster_mode(reason: str = "manual") -> dict:
    p = _flag_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(f"reason: {reason}\n", encoding="utf-8")
    logger.warning(f"DISASTER MODE ENABLED: {reason}")
    return get_flag_info()


def disable_disaster_mode() -> dict:
    p = _flag_path()
    if p.exists():
        try:
            p.unlink()
        except Exception:
            pass
    logger.warning("DISASTER MODE DISABLED")
    return get_flag_info()


# ─── Whitelist путей (всегда доступны) ──────────────────────────────────
_WHITELIST_PREFIXES = (
    "/health",
    "/openapi.json",
    "/docs",
    "/redoc",
    "/metrics",
    "/admin/system/",  # super_admin должен иметь возможность выключить флаг
)

# Mutation методы, которые блокируются.
_MUTATION_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


async def disaster_middleware(request: Request, call_next):
    """FastAPI HTTP-middleware: блокирует mutation-методы в disaster-mode."""
    if not is_disaster_mode():
        return await call_next(request)

    method = request.method.upper()
    path = request.url.path or ""

    # Whitelisted prefix → пропускаем.
    if any(path.startswith(pref) for pref in _WHITELIST_PREFIXES):
        return await call_next(request)

    # GET / HEAD / OPTIONS — read-only, пропускаем.
    if method not in _MUTATION_METHODS:
        return await call_next(request)

    # Логируем заблокированный запрос.
    logger.info(f"[disaster] blocked {method} {path}")
    return JSONResponse(
        status_code=503,
        headers={"Retry-After": "300"},
        content={
            "detail": "Сервис на технических работах. Запросы на изменение временно недоступны.",
            "disaster_mode": True,
            "retry_after_seconds": 300,
        },
    )
