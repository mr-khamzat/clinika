"""Мониторинг системы — состояние сервера, контейнеров, БД, Redis, МИС."""
import asyncio
import time
import os
from datetime import datetime, date, timezone

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User

router = APIRouter(prefix="/monitoring", tags=["monitoring"])

# URL docker-proxy sidecar (внутри clinika-net)
DOCKER_PROXY_URL = "http://clinika-docker-proxy:9099"


# ─── Сервер (psutil) ─────────────────────────────────────────────────────────

def _get_server_stats() -> dict:
    """Читает метрики сервера через psutil (синхронно — вызывать в executor)."""
    try:
        import psutil
        cpu = psutil.cpu_percent(interval=0.5)
        vm = psutil.virtual_memory()
        disk = psutil.disk_usage("/")
        boot_ts = psutil.boot_time()
        uptime_hours = round((time.time() - boot_ts) / 3600, 1)
        load = list(psutil.getloadavg())
        net = psutil.net_io_counters()
        proc = psutil.Process(os.getpid())
        return {
            "cpu_percent": round(cpu, 1),
            "ram_percent": round(vm.percent, 1),
            "ram_used_mb": round(vm.used / 1024 / 1024),
            "ram_total_mb": round(vm.total / 1024 / 1024),
            "disk_percent": round(disk.percent, 1),
            "disk_used_gb": round(disk.used / 1024 / 1024 / 1024, 1),
            "disk_total_gb": round(disk.total / 1024 / 1024 / 1024, 1),
            "uptime_hours": uptime_hours,
            "load_avg": [round(x, 2) for x in load],
            "net_bytes_sent_mb": round(net.bytes_sent / 1024 / 1024, 1),
            "net_bytes_recv_mb": round(net.bytes_recv / 1024 / 1024, 1),
            "app_uptime_seconds": round(time.time() - proc.create_time()),
        }
    except Exception as e:
        return {"error": str(e)}


# ─── Docker контейнеры (через sidecar-прокси) ────────────────────────────────

async def _get_containers() -> list:
    """Список контейнеров через docker-proxy sidecar (без монтирования docker.sock)."""
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{DOCKER_PROXY_URL}/containers")
            resp.raise_for_status()
            return resp.json().get("containers", [])
    except Exception as e:
        return [{"error": str(e)}]


async def _get_telegram_bot_status() -> dict:
    """Статус контейнера clinika-bot через docker-proxy sidecar."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{DOCKER_PROXY_URL}/containers/clinika-bot/status")
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        return {"status": "unknown", "running": False, "error": str(e)}


# ─── PostgreSQL ───────────────────────────────────────────────────────────────

async def _get_db_stats(db: AsyncSession) -> dict:
    try:
        size_result = await db.execute(
            text("SELECT pg_database_size(current_database()) AS size_bytes")
        )
        size_bytes = size_result.scalar() or 0
        conn_result = await db.execute(
            text("SELECT count(*) FROM pg_stat_activity WHERE state IS NOT NULL")
        )
        connections = conn_result.scalar() or 0
        return {"status": "ok", "size_mb": round(size_bytes / 1024 / 1024, 1), "connections": connections}
    except Exception as e:
        return {"status": "error", "error": str(e), "size_mb": None, "connections": None}


# ─── Redis ────────────────────────────────────────────────────────────────────

async def _get_redis_stats() -> dict:
    try:
        import redis.asyncio as aioredis
        from app.config import settings
        r = aioredis.from_url(settings.redis_url, socket_connect_timeout=3, socket_timeout=3)
        info = await r.info("memory")
        used_memory = info.get("used_memory", 0)
        await r.aclose()
        return {"status": "ok", "used_memory_mb": round(used_memory / 1024 / 1024, 1)}
    except Exception as e:
        return {"status": "error", "error": str(e), "used_memory_mb": None}


# ─── МИС интеграция ───────────────────────────────────────────────────────────

async def _get_mis_stats() -> dict:
    """Ping к МИС API — таймаут 5 сек."""
    try:
        url = "http://mis.stoclinica.ru:3010"
        endpoints = ["/api/health", "/"]
        start = time.monotonic()
        resp = None
        async with httpx.AsyncClient(timeout=5.0, verify=False) as client:
            for ep in endpoints:
                try:
                    resp = await client.get(url + ep)
                    if resp.status_code < 500:
                        break
                except Exception:
                    continue
        elapsed_ms = round((time.monotonic() - start) * 1000)
        if resp is not None and resp.status_code < 500:
            return {"last_check": datetime.now(timezone.utc).isoformat(), "status": "ok", "response_time_ms": elapsed_ms, "error": None}
        return {"last_check": datetime.now(timezone.utc).isoformat(), "status": "error", "response_time_ms": elapsed_ms,
                "error": f"HTTP {resp.status_code if resp else 'no response'}"}
    except Exception as e:
        return {"last_check": datetime.now(timezone.utc).isoformat(), "status": "error", "response_time_ms": None, "error": str(e)}


# ─── Фоновые задачи ───────────────────────────────────────────────────────────

def _get_background_tasks() -> dict:
    try:
        loop = asyncio.get_event_loop()
        running_tasks = [t for t in asyncio.all_tasks(loop) if not t.done()]
        status = "running" if len(running_tasks) > 0 else "unknown"
        return {"auto_confirm": status, "expire_referrals": status, "heartbeat": status}
    except Exception:
        return {"auto_confirm": "unknown", "expire_referrals": "unknown", "heartbeat": "unknown"}


# ─── Направления за сегодня ───────────────────────────────────────────────────

async def _get_referrals_today(db: AsyncSession) -> dict:
    try:
        today_start = datetime.combine(date.today(), datetime.min.time())
        result = await db.execute(
            text("SELECT status, COUNT(*) AS cnt FROM referrals WHERE created_at >= :today GROUP BY status"),
            {"today": today_start},
        )
        rows = {row.status: row.cnt for row in result}
        return {"created": rows.get("created", 0), "confirmed": rows.get("confirmed", 0),
                "expired": rows.get("expired", 0), "cancelled": rows.get("cancelled", 0)}
    except Exception as e:
        return {"error": str(e), "created": None, "confirmed": None, "expired": None, "cancelled": None}


# ─── Основной эндпоинт ────────────────────────────────────────────────────────

@router.get("/system")
async def get_system_status(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Сводная статистика системы. Доступно только системному администратору."""
    loop = asyncio.get_event_loop()

    (
        server_stats,
        containers,
        db_stats,
        redis_stats,
        mis_stats,
        referrals_today,
        telegram_bot_status,
    ) = await asyncio.gather(
        loop.run_in_executor(None, _get_server_stats),
        _get_containers(),
        _get_db_stats(db),
        _get_redis_stats(),
        _get_mis_stats(),
        _get_referrals_today(db),
        _get_telegram_bot_status(),
    )

    bg_tasks = _get_background_tasks()

    alerts = []
    if server_stats.get("cpu_percent", 0) > 85:
        alerts.append({"level": "critical", "msg": f"CPU {server_stats['cpu_percent']}%"})
    elif server_stats.get("cpu_percent", 0) > 70:
        alerts.append({"level": "warning", "msg": f"CPU {server_stats['cpu_percent']}%"})
    if server_stats.get("ram_percent", 0) > 90:
        alerts.append({"level": "critical", "msg": f"RAM {server_stats['ram_percent']}%"})
    elif server_stats.get("ram_percent", 0) > 75:
        alerts.append({"level": "warning", "msg": f"RAM {server_stats['ram_percent']}%"})
    if server_stats.get("disk_percent", 0) > 90:
        alerts.append({"level": "critical", "msg": f"Диск {server_stats['disk_percent']}%"})
    elif server_stats.get("disk_percent", 0) > 75:
        alerts.append({"level": "warning", "msg": f"Диск {server_stats['disk_percent']}%"})
    if db_stats.get("status") != "ok":
        alerts.append({"level": "critical", "msg": "PostgreSQL недоступен"})
    if redis_stats.get("status") != "ok":
        alerts.append({"level": "critical", "msg": "Redis недоступен"})
    if mis_stats.get("status") != "ok":
        alerts.append({"level": "warning", "msg": "МИС недоступна"})

    critical_count = sum(1 for a in alerts if a["level"] == "critical")
    warning_count = sum(1 for a in alerts if a["level"] == "warning")
    overall = "critical" if critical_count > 0 else ("warning" if warning_count > 0 else "ok")

    return {
        "server": server_stats,
        "containers": containers,
        "database": db_stats,
        "redis": redis_stats,
        "mis_integration": mis_stats,
        "background_tasks": bg_tasks,
        "referrals_today": referrals_today,
        "telegram_bot": telegram_bot_status,
        "health_summary": {
            "overall": overall,
            "alerts": alerts,
            "critical": critical_count,
            "warning": warning_count,
        },
    }


# ─── Логи контейнера (через sidecar-прокси) ──────────────────────────────────

@router.get("/logs")
async def get_container_logs(
    container: str = "clinika-backend",
    lines: int = 100,
    _: User = Depends(require_manager),
):
    """Последние N строк логов Docker-контейнера через docker-proxy sidecar."""
    allowed = {"clinika-backend", "clinika-frontend", "clinika-db", "clinika-redis", "clinika-bot"}
    if container not in allowed:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Недопустимый контейнер")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"{DOCKER_PROXY_URL}/containers/{container}/logs",
                params={"lines": min(lines, 500)},
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        return {"container": container, "lines": [str(e)], "count": 1}


# ─── Анализ БД ────────────────────────────────────────────────────────────────

@router.get("/db-analysis")
async def get_db_analysis(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Статистика таблиц PostgreSQL: размер, строки, последняя активность."""
    try:
        result = await db.execute(text("""
            SELECT
                t.table_name,
                c.reltuples::bigint AS row_estimate,
                pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
                pg_total_relation_size(c.oid) AS size_bytes,
                s.n_live_tup,
                s.n_dead_tup,
                s.last_vacuum,
                s.last_autovacuum,
                s.last_analyze
            FROM information_schema.tables t
            JOIN pg_class c ON c.relname = t.table_name
            LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
            WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
            ORDER BY pg_total_relation_size(c.oid) DESC
        """))
        tables = [
            {
                "name": row.table_name,
                "rows": row.n_live_tup or 0,
                "dead_rows": row.n_dead_tup or 0,
                "size": row.total_size,
                "size_bytes": row.size_bytes,
                "last_analyze": row.last_analyze.isoformat() if row.last_analyze else None,
            }
            for row in result
        ]
        return {"tables": tables}
    except Exception as e:
        return {"tables": [], "error": str(e)}


# ─── Производительность БД ────────────────────────────────────────────────────

@router.get("/performance")
async def get_performance_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Производительность БД: медленные запросы, cache hit ratio, bloat таблиц."""
    results = {}

    try:
        r = await db.execute(text("""
            SELECT
                sum(heap_blks_hit) as hits,
                sum(heap_blks_read) as reads,
                CASE WHEN sum(heap_blks_hit) + sum(heap_blks_read) > 0
                    THEN round(100.0 * sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)), 2)
                    ELSE 100
                END as cache_hit_pct
            FROM pg_statio_user_tables
        """))
        row = r.fetchone()
        results["cache_hit_ratio"] = float(row.cache_hit_pct) if row else None
    except Exception:
        results["cache_hit_ratio"] = None

    try:
        r = await db.execute(text("""
            SELECT relname, n_live_tup, n_dead_tup,
                CASE WHEN n_live_tup + n_dead_tup > 0
                    THEN round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 1)
                    ELSE 0
                END as dead_pct,
                last_autovacuum, last_vacuum
            FROM pg_stat_user_tables
            WHERE n_live_tup + n_dead_tup > 10
            ORDER BY dead_pct DESC
            LIMIT 10
        """))
        results["table_bloat"] = [
            {"table": row.relname, "live": row.n_live_tup, "dead": row.n_dead_tup,
             "dead_pct": float(row.dead_pct),
             "last_vacuum": row.last_vacuum.isoformat() if row.last_vacuum else (
                 row.last_autovacuum.isoformat() if row.last_autovacuum else None)}
            for row in r.fetchall()
        ]
    except Exception:
        results["table_bloat"] = []

    try:
        r = await db.execute(text("""
            SELECT query, calls,
                round(mean_exec_time::numeric, 2) as avg_ms,
                round(total_exec_time::numeric, 2) as total_ms,
                rows
            FROM pg_stat_statements
            WHERE query NOT LIKE '%pg_stat%'
            ORDER BY mean_exec_time DESC
            LIMIT 10
        """))
        results["slow_queries"] = [
            {"query": row.query[:120], "calls": row.calls, "avg_ms": float(row.avg_ms),
             "total_ms": float(row.total_ms), "rows": row.rows}
            for row in r.fetchall()
        ]
    except Exception:
        results["slow_queries"] = []

    try:
        r = await db.execute(text("""
            SELECT relname, idx_scan, seq_scan,
                CASE WHEN idx_scan + seq_scan > 0
                    THEN round(100.0 * idx_scan / (idx_scan + seq_scan), 1)
                    ELSE 0 END as idx_pct
            FROM pg_stat_user_tables
            WHERE seq_scan + idx_scan > 10
            ORDER BY seq_scan DESC
            LIMIT 8
        """))
        results["index_usage"] = [
            {"table": row.relname, "idx_scans": row.idx_scan, "seq_scans": row.seq_scan, "idx_pct": float(row.idx_pct)}
            for row in r.fetchall()
        ]
    except Exception:
        results["index_usage"] = []

    return results


# ─── Безопасность ─────────────────────────────────────────────────────────────

@router.get("/security")
async def get_security_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Безопасность: неудачные входы, активные сессии."""
    results = {}

    try:
        r = await db.execute(text("""
            SELECT COUNT(*) as cnt FROM activity_log
            WHERE action ILIKE '%login%fail%' OR action ILIKE '%неверн%'
            AND created_at > NOW() - INTERVAL '24 hours'
        """))
        results["failed_logins_24h"] = r.scalar() or 0
    except Exception:
        results["failed_logins_24h"] = None

    try:
        r = await db.execute(text("""
            SELECT COUNT(DISTINCT user_id) as cnt FROM activity_log
            WHERE created_at > NOW() - INTERVAL '30 minutes'
        """))
        results["active_users_30m"] = r.scalar() or 0
    except Exception:
        results["active_users_30m"] = None

    try:
        r = await db.execute(text("SELECT COUNT(*) FROM users WHERE is_active = true"))
        results["total_active_users"] = r.scalar() or 0
    except Exception:
        results["total_active_users"] = None

    try:
        r = await db.execute(text("""
            SELECT al.action, u.full_name, al.created_at
            FROM activity_log al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE al.action ILIKE '%login%' OR al.action ILIKE '%вход%'
            ORDER BY al.created_at DESC
            LIMIT 10
        """))
        results["recent_logins"] = [
            {"user": row.full_name or "—", "action": row.action,
             "at": row.created_at.isoformat() if row.created_at else None}
            for row in r.fetchall()
        ]
    except Exception:
        results["recent_logins"] = []

    return results


# ─── Статистика интеграций ────────────────────────────────────────────────────

@router.get("/integrations")
async def get_integrations_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Статистика интеграций: МИС вебхуки, Telegram-бот."""
    results = {}

    try:
        r = await db.execute(text("""
            SELECT id, event_type, status, detail, created_at
            FROM mis_integration_log
            ORDER BY created_at DESC
            LIMIT 50
        """))
        results["mis_log"] = [
            {"id": row.id, "event_type": row.event_type, "status": row.status,
             "detail": row.detail, "created_at": row.created_at.isoformat() if row.created_at else None}
            for row in r.fetchall()
        ]
    except Exception as e:
        results["mis_log"] = []
        results["mis_log_error"] = str(e)

    try:
        r = await db.execute(text("""
            SELECT status, COUNT(*) as cnt
            FROM mis_integration_log
            WHERE created_at > NOW() - INTERVAL '24 hours' AND event_type = 'webhook_in'
            GROUP BY status
        """))
        stats = {row.status: row.cnt for row in r.fetchall()}
        results["mis_today"] = {"ok": stats.get("ok", 0), "error": stats.get("error", 0),
                                "not_found": stats.get("not_found", 0), "ignored": stats.get("ignored", 0),
                                "total": sum(stats.values())}
    except Exception:
        results["mis_today"] = {"ok": 0, "error": 0, "not_found": 0, "ignored": 0, "total": 0}

    # Telegram-бот статус (через docker-proxy sidecar)
    results["telegram_bot"] = await _get_telegram_bot_status()

    try:
        r = await db.execute(text("""
            SELECT created_at, detail FROM mis_integration_log
            WHERE status = 'ok' ORDER BY created_at DESC LIMIT 1
        """))
        row = r.fetchone()
        results["last_successful_webhook"] = {
            "at": row.created_at.isoformat() if row and row.created_at else None,
            "detail": row.detail if row else None,
        }
    except Exception:
        results["last_successful_webhook"] = None

    return results


# ─── Health check ─────────────────────────────────────────────────────────────

@router.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    """Публичная проверка здоровья (без авторизации)."""
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    redis_ok = False
    try:
        import redis.asyncio as aioredis
        from app.config import settings
        r = aioredis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
        await r.ping()
        await r.aclose()
        redis_ok = True
    except Exception:
        pass

    status = "ok" if (db_ok and redis_ok) else "degraded"
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=200 if status == "ok" else 503,
        content={"status": status, "db": "ok" if db_ok else "error",
                 "redis": "ok" if redis_ok else "error",
                 "timestamp": datetime.now(timezone.utc).isoformat()},
    )


# ─── Метрики запросов ────────────────────────────────────────────────────────

@router.get("/metrics")
async def get_request_metrics(
    window: int = 60,
    _: User = Depends(require_manager),
):
    """Метрики запросов за последние N минут (из Redis)."""
    from app.utils.metrics import get_request_metrics as _metrics
    return await _metrics(window_minutes=min(window, 180))


@router.get("/metrics/endpoints")
async def get_endpoint_breakdown(
    window: int = 60,
    _: User = Depends(require_manager),
):
    """Топ эндпоинтов по кол-ву запросов + средняя задержка."""
    from app.utils.metrics import get_request_metrics as _metrics
    data = await _metrics(window_minutes=min(window, 180))
    return {"window_minutes": window, "endpoints": data.get("top_endpoints", []),
            "status_breakdown": data.get("status_breakdown", {})}


@router.get("/health/history")
async def get_health_history(
    limit: int = 12,
    _: User = Depends(require_manager),
):
    """История снимков здоровья системы."""
    from app.utils.metrics import get_health_history as _history
    return await _history(limit=min(limit, 144))


@router.post("/health/snapshot")
async def save_health_snapshot(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Сохранить текущий снимок здоровья системы в Redis."""
    loop = asyncio.get_event_loop()
    server_stats, db_stats, redis_stats = await asyncio.gather(
        loop.run_in_executor(None, _get_server_stats),
        _get_db_stats(db),
        _get_redis_stats(),
    )
    snapshot = {
        "cpu": server_stats.get("cpu_percent"),
        "ram": server_stats.get("ram_percent"),
        "disk": server_stats.get("disk_percent"),
        "db_connections": db_stats.get("connections"),
        "redis_mb": redis_stats.get("used_memory_mb"),
        "db_status": db_stats.get("status"),
        "redis_status": redis_stats.get("status"),
    }
    from app.utils.metrics import save_health_snapshot as _save
    await _save(snapshot)
    return {"saved": True, "snapshot": snapshot}


@router.get("/pool")
async def get_db_pool_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Статус пула соединений SQLAlchemy + PostgreSQL pg_stat_activity."""
    from app.database import engine
    pool = engine.pool
    try:
        pool_stats = {"size": pool.size(), "checked_out": pool.checkedout(),
                      "overflow": pool.overflow(), "checked_in": pool.checkedin()}
    except Exception as e:
        pool_stats = {"error": str(e)}

    try:
        r = await db.execute(text("""
            SELECT state, wait_event_type, COUNT(*) as cnt
            FROM pg_stat_activity
            WHERE datname = current_database()
            GROUP BY state, wait_event_type
            ORDER BY cnt DESC
        """))
        pg_sessions = [{"state": row.state, "wait_event_type": row.wait_event_type, "count": row.cnt}
                       for row in r.fetchall()]
    except Exception as e:
        pg_sessions = [{"error": str(e)}]

    try:
        r = await db.execute(text("""
            SELECT MAX(EXTRACT(EPOCH FROM (NOW() - query_start))) as max_sec
            FROM pg_stat_activity
            WHERE state = 'active' AND query_start IS NOT NULL
            AND query NOT LIKE '%pg_stat_activity%'
        """))
        max_query_sec = r.scalar()
    except Exception:
        max_query_sec = None

    return {"pool": pool_stats, "pg_sessions": pg_sessions,
            "longest_query_sec": round(max_query_sec, 1) if max_query_sec else None}
