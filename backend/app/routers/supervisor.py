"""
Supervisor — единый мониторинг состояния всех сервисов платформы.

GET  /admin/supervisor/status   — снимок состояния (super_admin)
POST /admin/supervisor/restart  — перезапустить указанный сервис (super_admin)

Сервис проверяет: backend (текущий процесс), db (PostgreSQL),
redis, frontend (читает /VERSION), prometheus, grafana — последние два
через HTTP-GET на их сетевые порты (если доступны).

Также возвращает recent_errors (audit_entries level='error') и system
(cpu/ram/disk через psutil).

Endpoint используется страницей AdminSupervisor.jsx (auto-refresh 10s).
"""
from __future__ import annotations

import asyncio
import os
import shutil
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, AsyncSessionLocal
from app.config import settings
from app.core.deps import require_super_admin
from app.models.user import User


router = APIRouter(prefix="/admin/supervisor", tags=["admin-supervisor"])


# Список сервисов, которые можно перезапустить через эндпоинт.
RESTARTABLE_SERVICES = {"backend", "frontend"}

# Сетевые имена соседей в docker compose (по умолчанию).
PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL", "http://prometheus:9090/-/healthy")
GRAFANA_URL    = os.environ.get("GRAFANA_URL", "http://grafana:3000/api/health")


# ── Версия процесса ─────────────────────────────────────────────────────
def _read_version(*candidates: str) -> str:
    """Читает VERSION-файл из первого доступного места."""
    for p in candidates:
        try:
            return Path(p).read_text(encoding="utf-8").strip()
        except Exception:
            continue
    return os.environ.get("APP_VERSION", "unknown")


# ── Сборщики статусов отдельных сервисов ────────────────────────────────
async def _check_backend() -> dict:
    """Backend = текущий процесс. Жив всегда, если эндпоинт ответил."""
    try:
        import psutil
        proc = psutil.Process(os.getpid())
        uptime_sec = int(time.time() - proc.create_time())
    except Exception:
        uptime_sec = None
    return {
        "name": "backend",
        "status": "healthy",
        "uptime_sec": uptime_sec,
        "version": _read_version("/app/VERSION", "VERSION", "backend/VERSION"),
    }


async def _check_db() -> dict:
    """PostgreSQL: SELECT 1 + кол-во соединений + размер БД."""
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(text("SELECT 1"))
            try:
                conns = (await s.execute(text(
                    "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()"
                ))).scalar() or 0
            except Exception:
                conns = None
            try:
                size_b = (await s.execute(text(
                    "SELECT pg_database_size(current_database())"
                ))).scalar() or 0
                size_mb = round(int(size_b) / 1024 / 1024, 1)
            except Exception:
                size_mb = None
        return {
            "name": "db",
            "status": "healthy",
            "connections": int(conns) if conns is not None else None,
            "size_mb": size_mb,
        }
    except Exception as e:
        return {"name": "db", "status": "down", "error": str(e)[:200]}


async def _check_redis() -> dict:
    """Redis: ping + used_memory + dbsize."""
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(
            settings.redis_url, socket_connect_timeout=2, socket_timeout=2,
            decode_responses=True,
        )
        pong = await r.ping()
        info = await r.info("memory")
        try:
            keys = await r.dbsize()
        except Exception:
            keys = None
        await r.aclose()
        memory_mb = None
        if info and isinstance(info, dict):
            used = info.get("used_memory")
            if used:
                memory_mb = round(int(used) / 1024 / 1024, 1)
        return {
            "name": "redis",
            "status": "healthy" if pong else "degraded",
            "memory_mb": memory_mb,
            "keys": int(keys) if keys is not None else None,
        }
    except Exception as e:
        return {"name": "redis", "status": "down", "error": str(e)[:200]}


async def _check_frontend() -> dict:
    """Frontend: пытаемся прочитать /VERSION фронта (если смонтирован) или http-GET."""
    # 1) Версия из файла, если фронт собирает VERSION.txt в общий volume.
    version = _read_version("/srv/frontend/VERSION", "/usr/share/nginx/html/VERSION",
                            "/app/frontend/VERSION", "frontend/VERSION")

    # 2) HTTP-проба (быстрая, опциональная).
    base = os.environ.get("FRONTEND_HEALTH_URL", "http://clinika-frontend:80/")
    status_label = "healthy"
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            r = await client.get(base)
            if r.status_code >= 500:
                status_label = "degraded"
    except Exception:
        # Frontend может быть недоступен из контейнера backend — это не фатально.
        status_label = "unknown"
    return {"name": "frontend", "status": status_label, "version": version}


async def _http_probe(name: str, url: str, ok_codes: tuple = (200, 204)) -> dict:
    """Универсальная HTTP-проба для сторонних сервисов (Prometheus/Grafana)."""
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            r = await client.get(url)
            return {
                "name": name,
                "status": "healthy" if r.status_code in ok_codes else "degraded",
                "http_code": r.status_code,
            }
    except Exception as e:
        return {"name": name, "status": "down", "error": str(e)[:160]}


# ── Recent errors из audit_entries ──────────────────────────────────────
async def _recent_errors(limit: int = 20) -> list:
    """Последние ошибки (level='error') из таблицы audit_entries — best-effort."""
    try:
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(text(
                "SELECT created_at, level, action, COALESCE(detail, '') AS detail "
                "FROM audit_entries WHERE level='error' "
                "ORDER BY created_at DESC LIMIT :lim"
            ), {"lim": int(limit)})).mappings().all()
        out: list = []
        for r in rows:
            ts = r.get("created_at")
            ts_iso = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
            msg = r.get("action") or ""
            detail = r.get("detail") or ""
            if detail:
                msg = f"{msg}: {detail}"
            out.append({"ts": ts_iso, "level": str(r.get("level") or "ERROR").upper(),
                        "msg": msg[:300]})
        return out
    except Exception:
        return []


# ── System metrics ──────────────────────────────────────────────────────
def _system_stats() -> dict:
    """CPU / RAM / disk через psutil (синхронно — вызвать в executor)."""
    try:
        import psutil
        cpu = psutil.cpu_percent(interval=0.3)
        vm = psutil.virtual_memory()
        du = shutil.disk_usage("/")
        return {
            "cpu_pct": round(cpu, 1),
            "ram_pct": round(vm.percent, 1),
            "disk_pct": round((du.used / du.total) * 100, 1),
        }
    except Exception as e:
        return {"cpu_pct": None, "ram_pct": None, "disk_pct": None, "error": str(e)[:160]}


# ── Главный эндпоинт ────────────────────────────────────────────────────
@router.get("/status")
async def supervisor_status(
    _: User = Depends(require_super_admin),
):
    """Снимок состояния всех сервисов (для AdminSupervisor.jsx, auto-refresh 10s)."""
    # Сервисы — собираем параллельно.
    backend, db_s, redis_s, frontend_s, prom_s, graf_s = await asyncio.gather(
        _check_backend(),
        _check_db(),
        _check_redis(),
        _check_frontend(),
        _http_probe("prometheus", PROMETHEUS_URL),
        _http_probe("grafana", GRAFANA_URL),
    )

    # CPU/RAM/disk — синхронные (~300ms), уносим в executor.
    loop = asyncio.get_event_loop()
    system, recent = await asyncio.gather(
        loop.run_in_executor(None, _system_stats),
        _recent_errors(20),
    )

    return {
        "services": [backend, db_s, redis_s, frontend_s, prom_s, graf_s],
        "recent_errors": recent,
        "system": system,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ── Перезапуск сервиса ──────────────────────────────────────────────────
class RestartIn(BaseModel):
    service: str = Field(..., description="backend | frontend")
    confirm: bool = Field(default=False, description="Доп. защита от случайного клика")


@router.post("/restart")
async def supervisor_restart(
    payload: RestartIn = Body(...),
    _: User = Depends(require_super_admin),
):
    """Перезапустить сервис.

    Поддерживаются только `backend` / `frontend` (whitelist). Фактический
    рестарт делает Docker (restart policy + сигнал SIGTERM). Бэкенд после
    ответа уйдёт в exit(0) — Docker поднимет новый контейнер.
    """
    svc = (payload.service or "").strip().lower()
    if svc not in RESTARTABLE_SERVICES:
        raise HTTPException(
            status_code=400,
            detail=f"Сервис '{svc}' нельзя перезапустить через этот эндпоинт",
        )
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="Требуется confirm=true")

    if svc == "backend":
        # Планируем graceful exit ПОСЛЕ ответа клиенту — Docker рестартует контейнер.
        async def _delayed_exit():
            await asyncio.sleep(1.0)
            os._exit(0)
        asyncio.create_task(_delayed_exit())
        return {"ok": True, "service": "backend", "action": "scheduled_restart"}

    if svc == "frontend":
        # Перезапуск фронта = тач health-файла или попытка дёрнуть nginx по сети.
        # Реальный рестарт делает оператор через `docker compose restart clinika-frontend`.
        return {
            "ok": True,
            "service": "frontend",
            "action": "manual_required",
            "hint": "docker compose restart clinika-frontend",
        }

    # Недостижимо, но на всякий случай.
    raise HTTPException(status_code=400, detail="Неизвестный сервис")
