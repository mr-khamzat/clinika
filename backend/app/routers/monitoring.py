"""Мониторинг системы — состояние сервера, контейнеров, БД, Redis, МИС."""
import asyncio
import json
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


# ─── API статистика (24h по часам) ────────────────────────────────────────────

@router.get("/api-stats")
async def get_api_stats(
    hours: int = 24,
    _: User = Depends(require_manager),
):
    """API stats за последние N часов (≤24): hourly bar, top endpoints, p50/p95/p99."""
    from app.utils.metrics import get_request_metrics_hourly as _hourly
    return await _hourly(hours=hours)


# ─── Активные пользователи (онлайн + recent activity) ─────────────────────────

@router.get("/active-users")
async def get_active_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Онлайн через WS-presence + топ-10 за 24ч + login events за 7 дней."""
    online_count = 0
    online_users = []
    try:
        import redis.asyncio as aioredis
        from app.config import settings
        r = aioredis.from_url(settings.redis_url, encoding="utf8", decode_responses=True,
                              socket_connect_timeout=2, socket_timeout=2)
        # presence:{tenant_id} → hash {user_id: status}
        keys = await r.keys("presence:*")
        all_online_ids: set = set()
        for k in keys:
            try:
                presence_map = await r.hgetall(k)
                for uid, status in presence_map.items():
                    if status and status != "offline":
                        all_online_ids.add(uid)
            except Exception:
                continue
        online_count = len(all_online_ids)
        await r.aclose()

        if all_online_ids:
            try:
                # PG: достать имена пользователей через ANY-массив (без bind expansion)
                ids_list = list(all_online_ids)
                res = await db.execute(
                    text("SELECT id::text, full_name, role FROM users WHERE id::text = ANY(:ids)"),
                    {"ids": ids_list},
                )
                online_users = [{"id": row[0], "full_name": row[1], "role": row[2]} for row in res.fetchall()]
            except Exception:
                online_users = []
    except Exception:
        pass

    # Топ-10 активных за 24ч (по числу действий в activity_log)
    top_active = []
    try:
        r = await db.execute(text("""
            SELECT user_id::text AS uid, MAX(user_name) AS user_name, COUNT(*) AS cnt
            FROM activity_log
            WHERE created_at > NOW() - INTERVAL '24 hours' AND user_id IS NOT NULL
            GROUP BY user_id
            ORDER BY cnt DESC
            LIMIT 10
        """))
        top_active = [{"id": row.uid, "full_name": row.user_name or "—", "actions": row.cnt}
                      for row in r.fetchall()]
    except Exception:
        top_active = []

    # Login events за 7 дней (агрегат по дням)
    login_history = []
    try:
        r = await db.execute(text("""
            SELECT date_trunc('day', created_at) AS day, COUNT(*) AS cnt
            FROM activity_log
            WHERE (action ILIKE '%login%' OR action ILIKE '%вход%' OR action ILIKE '%signin%')
              AND created_at > NOW() - INTERVAL '7 days'
            GROUP BY date_trunc('day', created_at)
            ORDER BY day
        """))
        login_history = [{"day": row.day.isoformat() if row.day else None, "count": row.cnt}
                         for row in r.fetchall()]
    except Exception:
        login_history = []

    # Последние 20 login-событий
    recent_logins = []
    try:
        r = await db.execute(text("""
            SELECT user_name, action, ip_address, geo_country_name, geo_city, created_at
            FROM activity_log
            WHERE action ILIKE '%login%' OR action ILIKE '%вход%' OR action ILIKE '%signin%'
            ORDER BY created_at DESC
            LIMIT 20
        """))
        recent_logins = [
            {"user": row.user_name or "—", "action": row.action,
             "ip": row.ip_address, "country": row.geo_country_name, "city": row.geo_city,
             "at": row.created_at.isoformat() if row.created_at else None}
            for row in r.fetchall()
        ]
    except Exception:
        recent_logins = []

    return {
        "online_count": online_count,
        "online_users": online_users[:50],
        "top_active_24h": top_active,
        "login_history_7d": login_history,
        "recent_logins": recent_logins,
    }


# ─── Бизнес-метрики реалтайм ──────────────────────────────────────────────────

@router.get("/business-now")
async def get_business_now(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Live бизнес-метрики: приёмы сегодня/завтра, выручка, активные телемед-сессии."""
    today_status = {"created": 0, "confirmed": 0, "completed": 0, "cancelled": 0, "no_show": 0}
    try:
        r = await db.execute(text("""
            SELECT status, COUNT(*) AS cnt
            FROM appointments
            WHERE appointment_date = CURRENT_DATE
            GROUP BY status
        """))
        for row in r.fetchall():
            today_status[row.status] = row.cnt
    except Exception:
        pass

    # Приёмы на завтра + capacity по клиникам
    tomorrow_by_clinic = []
    try:
        r = await db.execute(text("""
            SELECT c.id::text AS cid, c.name AS clinic_name, COUNT(a.id) AS cnt
            FROM clinics c
            LEFT JOIN appointments a ON a.clinic_id = c.id
                AND a.appointment_date = CURRENT_DATE + INTERVAL '1 day'
                AND a.status IN ('created', 'confirmed')
            GROUP BY c.id, c.name
            ORDER BY cnt DESC
            LIMIT 20
        """))
        tomorrow_by_clinic = [{"clinic_id": row.cid, "clinic_name": row.clinic_name, "appointments": row.cnt}
                              for row in r.fetchall()]
    except Exception:
        tomorrow_by_clinic = []

    # Выручка за сегодня (sum price из appointments completed)
    revenue_today = 0
    revenue_count = 0
    try:
        r = await db.execute(text("""
            SELECT COALESCE(SUM(price), 0) AS total, COUNT(*) AS cnt
            FROM appointments
            WHERE appointment_date = CURRENT_DATE AND status = 'completed'
        """))
        row = r.fetchone()
        if row:
            revenue_today = float(row.total or 0)
            revenue_count = int(row.cnt or 0)
    except Exception:
        pass

    # Активные телемед-сессии
    telemed_active = 0
    try:
        r = await db.execute(text("""
            SELECT COUNT(*) FROM telemedicine_sessions
            WHERE status IN ('active', 'in_call', 'started')
              AND (ended_at IS NULL OR ended_at > NOW() - INTERVAL '5 minutes')
        """))
        telemed_active = r.scalar() or 0
    except Exception:
        pass

    # Пациенты за сегодня (уникальные приёмы)
    unique_patients_today = 0
    try:
        r = await db.execute(text("""
            SELECT COUNT(DISTINCT patient_phone) FROM appointments
            WHERE appointment_date = CURRENT_DATE AND patient_phone IS NOT NULL
        """))
        unique_patients_today = r.scalar() or 0
    except Exception:
        pass

    # Активные тенанты (с приёмами за неделю)
    active_tenants = 0
    try:
        r = await db.execute(text("""
            SELECT COUNT(DISTINCT tenant_id) FROM appointments
            WHERE created_at > NOW() - INTERVAL '7 days'
        """))
        active_tenants = r.scalar() or 0
    except Exception:
        pass

    return {
        "appointments_today": today_status,
        "appointments_today_total": sum(today_status.values()),
        "tomorrow_by_clinic": tomorrow_by_clinic,
        "tomorrow_total": sum(c["appointments"] for c in tomorrow_by_clinic),
        "revenue_today": revenue_today,
        "revenue_today_count": revenue_count,
        "telemed_active": telemed_active,
        "unique_patients_today": unique_patients_today,
        "active_tenants_7d": active_tenants,
    }


# ─── Storage / Disk детально ──────────────────────────────────────────────────

@router.get("/storage-detail")
async def get_storage_detail(
    _: User = Depends(require_manager),
):
    """Детальная разбивка диска: docker images, build cache, backups, uploads, journalctl."""
    import subprocess

    breakdown = {}

    def _run(cmd: list, timeout=8) -> str:
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            return (r.stdout or "").strip()
        except Exception as e:
            return f"err: {e}"

    def _du_bytes(path: str) -> int:
        if not path or not os.path.exists(path):
            return 0
        try:
            r = subprocess.run(["du", "-sb", path], capture_output=True, text=True, timeout=10)
            if r.returncode == 0 and r.stdout:
                return int(r.stdout.split()[0])
        except Exception:
            pass
        return 0

    # Uploads (volume mounted в контейнер на /app/uploads)
    uploads_path = "/app/uploads"
    breakdown["uploads_bytes"] = _du_bytes(uploads_path)
    breakdown["data_bytes"] = _du_bytes("/app/data")

    # Top-10 больших файлов в uploads
    biggest_files = []
    try:
        if os.path.exists(uploads_path):
            r = subprocess.run(
                ["find", uploads_path, "-type", "f", "-printf", "%s\t%p\n"],
                capture_output=True, text=True, timeout=15,
            )
            if r.returncode == 0:
                lines = [l for l in r.stdout.split("\n") if l.strip()]
                items = []
                for line in lines:
                    parts = line.split("\t", 1)
                    if len(parts) == 2:
                        try:
                            items.append({"size_bytes": int(parts[0]), "path": parts[1]})
                        except Exception:
                            continue
                items.sort(key=lambda x: x["size_bytes"], reverse=True)
                biggest_files = items[:10]
    except Exception:
        pass

    # Disk usage всего корня (вызовы docker proxy не нужны — через psutil)
    total = used = free = 0
    try:
        import psutil
        d = psutil.disk_usage("/")
        total, used, free = d.total, d.used, d.free
    except Exception:
        pass

    # Возвращаем последний disk_check (если есть в Redis)
    last_disk_check = None
    try:
        import redis.asyncio as aioredis
        from app.config import settings
        r = aioredis.from_url(settings.redis_url, encoding="utf8", decode_responses=True,
                              socket_connect_timeout=2, socket_timeout=2)
        snap = await r.lindex("metrics:health_snapshots", 0)
        if snap:
            try:
                snap_data = json.loads(snap) if isinstance(snap, str) else snap
                last_disk_check = {
                    "saved_at": snap_data.get("saved_at"),
                    "disk_percent": snap_data.get("disk"),
                }
            except Exception:
                pass
        await r.aclose()
    except Exception:
        pass

    # Auto-cleanup и disk_check job: следующий запуск
    cleanup_info = {
        "disk_check_interval_minutes": 60,
        "ltv_recompute_cron": "04:00 UTC daily",
        "audit_archive_cron": "03:00 UTC daily",
        "daily_digest_cron": "06:00 UTC daily",
        "last_disk_check": last_disk_check,
    }

    return {
        "disk": {"total_bytes": total, "used_bytes": used, "free_bytes": free,
                 "percent": round(used / total * 100, 1) if total else 0},
        "breakdown": breakdown,
        "biggest_files": biggest_files,
        "cleanup": cleanup_info,
    }


# ─── Алерты живые (audit_log + region.violation) ──────────────────────────────

@router.get("/alerts")
async def get_alerts(
    limit: int = 50,
    severity: str = "all",   # all | critical | warn | info
    _: User = Depends(require_manager),
):
    """Последние алерты: region.violation, login fail, security events. Фильтр по severity."""
    limit = min(max(limit, 1), 200)
    alerts = []

    # 1. Region violations (критично) + аудит-события
    try:
        from app.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            r = await db.execute(text("""
                SELECT id::text AS id, action, actor_name, comment, before, after,
                       ip_address, geo_country_name, geo_city, created_at
                FROM audit_log
                WHERE action ILIKE '%alert%'
                   OR action ILIKE '%violation%'
                   OR action ILIKE '%region%'
                   OR action ILIKE '%critical%'
                   OR action ILIKE '%failed%'
                ORDER BY created_at DESC
                LIMIT :lim
            """), {"lim": limit})
            for row in r.fetchall():
                act = (row.action or "").lower()
                if "violation" in act or "critical" in act or "alert.critical" in act:
                    sev = "critical"
                elif "failed" in act or "warn" in act or "region" in act:
                    sev = "warn"
                else:
                    sev = "info"
                alerts.append({
                    "id": row.id, "severity": sev, "action": row.action,
                    "actor": row.actor_name, "comment": row.comment,
                    "ip": row.ip_address, "country": row.geo_country_name, "city": row.geo_city,
                    "at": row.created_at.isoformat() if row.created_at else None,
                    "source": "audit_log",
                })
    except Exception as e:
        alerts.append({"id": "err-audit", "severity": "info",
                       "action": "audit_log_query_failed", "comment": str(e),
                       "source": "internal", "at": datetime.now(timezone.utc).isoformat()})

    # 2. Failed logins из activity_log (последние)
    try:
        from app.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            r = await db.execute(text("""
                SELECT id::text, user_name, action, ip_address, geo_country_name, geo_city, created_at
                FROM activity_log
                WHERE (action ILIKE '%fail%' OR action ILIKE '%неверн%' OR action ILIKE '%denied%')
                ORDER BY created_at DESC
                LIMIT 20
            """))
            for row in r.fetchall():
                alerts.append({
                    "id": "act-" + row[0], "severity": "warn", "action": row.action,
                    "actor": row.user_name, "comment": None,
                    "ip": row.ip_address, "country": row.geo_country_name, "city": row.geo_city,
                    "at": row.created_at.isoformat() if row.created_at else None,
                    "source": "activity_log",
                })
    except Exception:
        pass

    # 3. Live system alerts (CPU/RAM/Disk/DB/Redis) — текущее состояние
    try:
        loop = asyncio.get_event_loop()
        from app.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            srv, db_s, redis_s = await asyncio.gather(
                loop.run_in_executor(None, _get_server_stats),
                _get_db_stats(db),
                _get_redis_stats(),
            )
        now = datetime.now(timezone.utc).isoformat()
        if srv.get("cpu_percent", 0) > 85:
            alerts.append({"id": "live-cpu", "severity": "critical", "action": "system.cpu_high",
                           "actor": "system", "comment": f"CPU {srv['cpu_percent']}%",
                           "at": now, "source": "live"})
        if srv.get("ram_percent", 0) > 90:
            alerts.append({"id": "live-ram", "severity": "critical", "action": "system.ram_high",
                           "actor": "system", "comment": f"RAM {srv['ram_percent']}%",
                           "at": now, "source": "live"})
        if srv.get("disk_percent", 0) > 85:
            alerts.append({"id": "live-disk", "severity": "warn" if srv["disk_percent"] < 95 else "critical",
                           "action": "system.disk_high", "actor": "system",
                           "comment": f"Диск {srv['disk_percent']}%",
                           "at": now, "source": "live"})
        if db_s.get("status") != "ok":
            alerts.append({"id": "live-db", "severity": "critical", "action": "system.db_down",
                           "actor": "system", "comment": "PostgreSQL недоступен",
                           "at": now, "source": "live"})
        if redis_s.get("status") != "ok":
            alerts.append({"id": "live-redis", "severity": "critical", "action": "system.redis_down",
                           "actor": "system", "comment": "Redis недоступен",
                           "at": now, "source": "live"})
    except Exception:
        pass

    # Сортировка по времени, фильтр severity
    alerts.sort(key=lambda x: x.get("at") or "", reverse=True)
    if severity != "all":
        alerts = [a for a in alerts if a.get("severity") == severity]
    alerts = alerts[:limit]

    counts = {"critical": 0, "warn": 0, "info": 0}
    for a in alerts:
        s = a.get("severity") or "info"
        counts[s] = counts.get(s, 0) + 1

    return {"alerts": alerts, "total": len(alerts), "by_severity": counts}


# ─── Performance графики (CPU/RAM/Disk за 24h из Prometheus) ──────────────────

@router.get("/perf-history")
async def get_perf_history(
    hours: int = 24,
    _: User = Depends(require_manager),
):
    """История CPU/RAM/Disk за N часов из health snapshots (Redis)."""
    from app.utils.metrics import get_health_history as _history
    # один снапшот = ~5 минут (пишется через health_watchdog_job каждые 5 мин)
    # на 24h → 288 снапшотов; ограничиваем
    hours = max(1, min(hours, 24))
    limit = hours * 12  # снапшоты каждые 5 минут
    snapshots = await _history(limit=limit)

    series = []
    for s in reversed(snapshots):  # от старых к новым
        ts = s.get("saved_at")
        try:
            ts_iso = datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat() if ts else None
        except Exception:
            ts_iso = None
        series.append({
            "ts": ts_iso,
            "cpu": s.get("cpu"),
            "ram": s.get("ram"),
            "disk": s.get("disk"),
            "db_connections": s.get("db_connections"),
            "redis_mb": s.get("redis_mb"),
        })

    # Если есть Prometheus — попытаться обогатить (опционально)
    prom_url = os.environ.get("PROMETHEUS_URL")
    prom_data = None
    if prom_url:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                # postgres connections от postgres-exporter
                resp = await client.get(f"{prom_url}/api/v1/query_range", params={
                    "query": "pg_stat_activity_count",
                    "start": int(time.time() - hours * 3600),
                    "end": int(time.time()),
                    "step": "300",
                })
                if resp.status_code == 200:
                    prom_data = resp.json().get("data")
        except Exception:
            pass

    return {
        "hours": hours,
        "snapshots_count": len(series),
        "series": series,
        "prometheus": prom_data,
        "prometheus_available": prom_url is not None,
    }
