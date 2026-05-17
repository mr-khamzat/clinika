"""
Глава 10 — Admin system endpoints (disaster mode + расширенный health).

Только super_admin может включать/выключать disaster mode.
"""
import os
import shutil
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, AsyncSessionLocal
from app.config import settings
from app.core.deps import require_super_admin, get_current_user
from app.models.user import User
from app.core import disaster_middleware


router = APIRouter(prefix="/admin/system", tags=["admin-system"])


class EnableDisasterIn(BaseModel):
    reason: str = Field(default="manual", max_length=500)


# ── Detailed health ─────────────────────────────────────────────────────
@router.get("/status")
async def system_status(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    """Текущее состояние системы (для super_admin UI)."""
    flag = disaster_middleware.get_flag_info()
    # last migration
    try:
        row = (await db.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))).first()
        last_migration = row[0] if row else None
    except Exception as e:
        last_migration = f"error: {str(e)[:80]}"
    return {
        "disaster_mode": flag.get("enabled", False),
        "flag_info": flag,
        "last_migration": last_migration,
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.post("/enable-disaster-mode")
async def enable_disaster(
    payload: EnableDisasterIn = Body(default_factory=EnableDisasterIn),
    _: User = Depends(require_super_admin),
):
    info = disaster_middleware.enable_disaster_mode(payload.reason)
    return {"ok": True, "info": info}


@router.post("/disable-disaster-mode")
async def disable_disaster(
    _: User = Depends(require_super_admin),
):
    info = disaster_middleware.disable_disaster_mode()
    return {"ok": True, "info": info}


# ── Расширенный health-check (доступен без auth — для мониторинга) ──────
detailed_router = APIRouter(tags=["health"])


@detailed_router.get("/health/detailed")
async def health_detailed():
    """Расширенный health-check: DB / Redis / disk / migration / subscriptions / errors."""
    result: dict = {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "disaster_mode": disaster_middleware.is_disaster_mode(),
    }

    # ── DB ──────────────────────────────────────────────────────────────
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("SELECT 1"))
            r.scalar()
            # last migration
            mig_row = (await s.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))).first()
            result["last_migration"] = mig_row[0] if mig_row else None
            # active subscriptions count
            try:
                cnt = (await s.execute(text(
                    "SELECT COUNT(*) FROM patient_subscriptions WHERE status IN ('active','trial')"
                ))).scalar() or 0
                result["active_subscriptions"] = int(cnt)
            except Exception:
                result["active_subscriptions"] = None
        result["db"] = {"status": "ok"}
    except Exception as e:
        result["db"] = {"status": "fail", "error": str(e)[:200]}
        result["status"] = "degraded"

    # ── Redis ───────────────────────────────────────────────────────────
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        pong = await r.ping()
        await r.close()
        result["redis"] = {"status": "ok" if pong else "fail"}
        if not pong:
            result["status"] = "degraded"
    except Exception as e:
        result["redis"] = {"status": "fail", "error": str(e)[:200]}
        result["status"] = "degraded"

    # ── Disk ────────────────────────────────────────────────────────────
    try:
        usage = shutil.disk_usage("/")
        free_gb = round(usage.free / 1024 / 1024 / 1024, 2)
        total_gb = round(usage.total / 1024 / 1024 / 1024, 2)
        used_pct = round((usage.used / usage.total) * 100, 1)
        disk_status = "ok"
        if used_pct >= 95:
            disk_status = "fail"
            result["status"] = "degraded"
        elif used_pct >= 85:
            disk_status = "warn"
        result["disk"] = {
            "status": disk_status,
            "free_gb": free_gb,
            "total_gb": total_gb,
            "used_percent": used_pct,
        }
    except Exception as e:
        result["disk"] = {"status": "fail", "error": str(e)[:200]}

    # ── Recent errors (последний час) ──────────────────────────────────
    try:
        async with AsyncSessionLocal() as s:
            try:
                exists = (await s.execute(text("SELECT to_regclass('public.audit_entries')"))).scalar()
                if not exists:
                    result["recent_errors_1h"] = 0
                else:
                    hour_ago = datetime.utcnow() - timedelta(hours=1)
                    cnt = (await s.execute(
                        text("SELECT COUNT(*) FROM audit_entries WHERE level='error' AND created_at >= :h"),
                        {"h": hour_ago},
                    )).scalar() or 0
                    result["recent_errors_1h"] = int(cnt)
            except Exception:
                result["recent_errors_1h"] = None
    except Exception:
        result["recent_errors_1h"] = None

    # ── Version ─────────────────────────────────────────────────────────
    try:
        with open("/app/VERSION", "r", encoding="utf-8") as f:
            result["version"] = f.read().strip()
    except Exception:
        result["version"] = os.environ.get("APP_VERSION", "unknown")

    return result


# ── Cron-job: каждые 5 минут проверяет состояние, автоматический disaster ──
async def disaster_health_check():
    """
    Cron-job (каждые 5 минут): проверяет критичные подсистемы.
    Если что-то не работает — включает disaster_mode автоматически.
    """
    import logging
    log = logging.getLogger("disaster_check")

    # 1) DB
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(text("SELECT 1"))
    except Exception as e:
        log.error(f"DB unreachable, enabling disaster_mode: {e}")
        disaster_middleware.enable_disaster_mode(f"auto: DB error {str(e)[:100]}")
        return

    # 2) Disk
    try:
        usage = shutil.disk_usage("/")
        used_pct = (usage.used / usage.total) * 100
        if used_pct >= 98:
            log.error(f"Disk usage critical: {used_pct:.1f}%")
            disaster_middleware.enable_disaster_mode(f"auto: disk usage {used_pct:.1f}%")
            return
    except Exception:
        pass

    # Если флаг был включен автоматически и сейчас всё ОК — снимаем.
    info = disaster_middleware.get_flag_info()
    reason = info.get("reason", "")
    if info.get("enabled") and "auto:" in reason:
        log.info("System recovered, auto-disabling disaster_mode")
        disaster_middleware.disable_disaster_mode()
