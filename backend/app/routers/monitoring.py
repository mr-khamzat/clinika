"""Мониторинг системы — состояние сервера, контейнеров, БД, Redis, МИС."""
import asyncio
import subprocess
import json
import time
import os
from datetime import datetime, date, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


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

        # сеть
        net = psutil.net_io_counters()

        # аптайм самого Python-процесса
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


# ─── Docker контейнеры ────────────────────────────────────────────────────────

def _get_containers() -> list:
    """Читает список контейнеров через Docker Python SDK (через unix socket)."""
    try:
        import docker as docker_sdk
        client = docker_sdk.DockerClient(base_url="unix:///var/run/docker.sock", timeout=10)
        containers = []
        for c in client.containers.list(all=False):
            status_str = c.status
            # Health
            health_data = c.attrs.get("State", {}).get("Health", {})
            if health_data:
                health = health_data.get("Status", "ok")
            else:
                health = "ok"
            containers.append({
                "name": c.name,
                "status": status_str,
                "health": health,
            })
        client.close()
        return containers
    except Exception as e:
        return [{"error": str(e)}]


# ─── PostgreSQL ───────────────────────────────────────────────────────────────

async def _get_db_stats(db: AsyncSession) -> dict:
    try:
        # Размер БД
        size_result = await db.execute(
            text("SELECT pg_database_size(current_database()) AS size_bytes")
        )
        size_bytes = size_result.scalar() or 0
        size_mb = round(size_bytes / 1024 / 1024, 1)

        # Активные соединения
        conn_result = await db.execute(
            text("SELECT count(*) FROM pg_stat_activity WHERE state IS NOT NULL")
        )
        connections = conn_result.scalar() or 0

        return {"status": "ok", "size_mb": size_mb, "connections": connections}
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
    """Ping к МИС API — GET /api/health (или /), таймаут 5 сек."""
    try:
        import httpx
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
            return {
                "last_check": datetime.now(timezone.utc).isoformat(),
                "status": "ok",
                "response_time_ms": elapsed_ms,
                "error": None,
            }
        else:
            return {
                "last_check": datetime.now(timezone.utc).isoformat(),
                "status": "error",
                "response_time_ms": elapsed_ms,
                "error": f"HTTP {resp.status_code if resp else 'no response'}",
            }
    except Exception as e:
        return {
            "last_check": datetime.now(timezone.utc).isoformat(),
            "status": "error",
            "response_time_ms": None,
            "error": str(e),
        }


# ─── Фоновые задачи ───────────────────────────────────────────────────────────

def _get_background_tasks() -> dict:
    """
    Статус фоновых задач — проверяем имена запущенных asyncio задач.
    Task names назначаются по умолчанию как Task-N, поэтому возвращаем 'running'
    если приложение живо (задачи созданы при старте и не завершились с ошибкой).
    """
    try:
        loop = asyncio.get_event_loop()
        running_tasks = [t for t in asyncio.all_tasks(loop) if not t.done()]
        # Задачи не имеют именования — считаем все три живыми если приложение работает
        count = len(running_tasks)
        status = "running" if count > 0 else "unknown"
        return {
            "auto_confirm": status,
            "expire_referrals": status,
            "heartbeat": status,
        }
    except Exception:
        return {
            "auto_confirm": "unknown",
            "expire_referrals": "unknown",
            "heartbeat": "unknown",
        }


# ─── Статус Telegram-бота ─────────────────────────────────────────────────────

def _get_telegram_bot_status() -> dict:
    """Проверяет статус контейнера clinika-bot через Docker SDK."""
    try:
        import docker as docker_sdk
        client = docker_sdk.DockerClient(base_url="unix:///var/run/docker.sock", timeout=5)
        try:
            c = client.containers.get("clinika-bot")
            status = c.status  # "running", "exited", etc.
            started = c.attrs.get("State", {}).get("StartedAt", None)
            return {"status": status, "running": status == "running", "started_at": started}
        except docker_sdk.errors.NotFound:
            return {"status": "not_found", "running": False}
        finally:
            client.close()
    except Exception as e:
        return {"status": "unknown", "running": False, "error": str(e)}


# ─── Направления за сегодня ───────────────────────────────────────────────────

async def _get_referrals_today(db: AsyncSession) -> dict:
    try:
        today_start = datetime.combine(date.today(), datetime.min.time())
        result = await db.execute(
            text("""
                SELECT status, COUNT(*) AS cnt
                FROM referrals
                WHERE created_at >= :today
                GROUP BY status
            """),
            {"today": today_start},
        )
        rows = {row.status: row.cnt for row in result}
        return {
            "created": rows.get("created", 0),
            "confirmed": rows.get("confirmed", 0),
            "expired": rows.get("expired", 0),
            "cancelled": rows.get("cancelled", 0),
        }
    except Exception as e:
        return {
            "error": str(e),
            "created": None,
            "confirmed": None,
            "expired": None,
            "cancelled": None,
        }


# ─── Основной эндпоинт ────────────────────────────────────────────────────────

@router.get("/system")
async def get_system_status(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_manager),
):
    """
    Сводная статистика системы:
    сервер, контейнеры, PostgreSQL, Redis, МИС, фоновые задачи, направления за сегодня.
    Доступно только системному администратору (manager).
    """
    loop = asyncio.get_event_loop()

    # Параллельно запускаем все сборы метрик
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
        loop.run_in_executor(None, _get_containers),
        _get_db_stats(db),
        _get_redis_stats(),
        _get_mis_stats(),
        _get_referrals_today(db),
        loop.run_in_executor(None, _get_telegram_bot_status),
    )

    bg_tasks = _get_background_tasks()

    # Агрегированный health_summary
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
    health_summary = {
        "overall": overall,
        "alerts": alerts,
        "critical": critical_count,
        "warning": warning_count,
    }

    return {
        "server": server_stats,
        "containers": containers,
        "database": db_stats,
        "redis": redis_stats,
        "mis_integration": mis_stats,
        "background_tasks": bg_tasks,
        "referrals_today": referrals_today,
        "telegram_bot": telegram_bot_status,
        "health_summary": health_summary,
    }


# ─── Логи контейнера ──────────────────────────────────────────────────────────

@router.get("/logs")
async def get_container_logs(
    container: str = "clinika-backend",
    lines: int = 100,
    _: User = Depends(require_manager),
):
    """Последние N строк логов Docker-контейнера через Docker SDK."""
    allowed = ["clinika-backend", "clinika-frontend", "clinika-db", "clinika-redis"]
    if container not in allowed:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Недопустимый контейнер")
    try:
        import docker as docker_sdk
        client = docker_sdk.DockerClient(base_url="unix:///var/run/docker.sock", timeout=15)
        c = client.containers.get(container)
        raw = c.logs(tail=lines, timestamps=True).decode("utf-8", errors="replace")
        client.close()
        log_lines = raw.strip().splitlines()
        return {"container": container, "lines": log_lines, "count": len(log_lines)}
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
        tables = []
        for row in result:
            tables.append({
                "name": row.table_name,
                "rows": row.n_live_tup or 0,
                "dead_rows": row.n_dead_tup or 0,
                "size": row.total_size,
                "size_bytes": row.size_bytes,
                "last_analyze": row.last_analyze.isoformat() if row.last_analyze else None,
            })
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

    # Cache hit ratio (должно быть >99%)
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
    except Exception as e:
        results["cache_hit_ratio"] = None

    # Dead rows по таблицам (нужен VACUUM если > 10%)
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
            {
                "table": row.relname,
                "live": row.n_live_tup,
                "dead": row.n_dead_tup,
                "dead_pct": float(row.dead_pct),
                "last_vacuum": row.last_vacuum.isoformat() if row.last_vacuum else (
                    row.last_autovacuum.isoformat() if row.last_autovacuum else None
                ),
            }
            for row in r.fetchall()
        ]
    except Exception as e:
        results["table_bloat"] = []

    # Медленные запросы (если pg_stat_statements включён)
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
            {
                "query": row.query[:120],
                "calls": row.calls,
                "avg_ms": float(row.avg_ms),
                "total_ms": float(row.total_ms),
                "rows": row.rows,
            }
            for row in r.fetchall()
        ]
    except Exception:
        results["slow_queries"] = []  # pg_stat_statements не включён — это нормально

    # Index usage
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

    # Неудачные попытки входа за 24ч (ищем в activity_log если есть, иначе пустой)
    try:
        r = await db.execute(text("""
            SELECT COUNT(*) as cnt FROM activity_log
            WHERE action ILIKE '%login%fail%' OR action ILIKE '%неверн%'
            AND created_at > NOW() - INTERVAL '24 hours'
        """))
        results["failed_logins_24h"] = r.scalar() or 0
    except Exception:
        results["failed_logins_24h"] = None

    # Активные пользователи (входили за последние 30 мин — по activity_log)
    try:
        r = await db.execute(text("""
            SELECT COUNT(DISTINCT user_id) as cnt FROM activity_log
            WHERE created_at > NOW() - INTERVAL '30 minutes'
        """))
        results["active_users_30m"] = r.scalar() or 0
    except Exception:
        results["active_users_30m"] = None

    # Всего пользователей
    try:
        r = await db.execute(text("SELECT COUNT(*) FROM users WHERE is_active = true"))
        results["total_active_users"] = r.scalar() or 0
    except Exception:
        results["total_active_users"] = None

    # Последние 10 входов (успешных)
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

    # МИС лог — последние 50 событий
    try:
        r = await db.execute(text("""
            SELECT id, event_type, status, detail, created_at
            FROM mis_integration_log
            ORDER BY created_at DESC
            LIMIT 50
        """))
        rows = r.fetchall()
        results["mis_log"] = [
            {
                "id": row.id,
                "event_type": row.event_type,
                "status": row.status,
                "detail": row.detail,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]
    except Exception as e:
        results["mis_log"] = []
        results["mis_log_error"] = str(e)

    # Статистика МИС вебхуков за сегодня
    try:
        r = await db.execute(text("""
            SELECT status, COUNT(*) as cnt
            FROM mis_integration_log
            WHERE created_at > NOW() - INTERVAL '24 hours'
              AND event_type = 'webhook_in'
            GROUP BY status
        """))
        stats = {row.status: row.cnt for row in r.fetchall()}
        results["mis_today"] = {
            "ok": stats.get("ok", 0),
            "error": stats.get("error", 0),
            "not_found": stats.get("not_found", 0),
            "ignored": stats.get("ignored", 0),
            "total": sum(stats.values()),
        }
    except Exception:
        results["mis_today"] = {"ok": 0, "error": 0, "not_found": 0, "ignored": 0, "total": 0}

    # Telegram-бот статус (через Docker SDK)
    results["telegram_bot"] = _get_telegram_bot_status()

    # Последний успешный вебхук
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
