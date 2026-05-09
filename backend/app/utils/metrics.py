"""
Коллектор метрик запросов (Redis backend, self-contained).
Этап 10 — Monitoring drill-down.

Redis-клиент создаётся лениво при первом вызове — не зависит от startup.
"""
import time
import json
import re
import asyncio
from collections import defaultdict
from typing import Optional

# 24-часовое окно (расширено с 1ч для дашборда мониторинга 24h)
WINDOW_SECONDS = 24 * 3600
MAX_HEALTH_SNAPSHOTS = 288  # 24h × 12 (snapshot каждые 5 минут)

_client = None


def _get_redis():
    """Возвращает (и создаёт при первом вызове) единственный Redis-клиент."""
    global _client
    if _client is None:
        try:
            import redis.asyncio as aio
            from app.config import settings
            _client = aio.from_url(
                settings.redis_url,
                encoding="utf8",
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        except Exception:
            pass
    return _client


# Оставляем set_redis_client для обратной совместимости с main.py
def set_redis_client(r):
    global _client
    _client = r


async def record_request(method: str, path: str, status: int, latency_ms: float) -> None:
    """Записать факт запроса. Молча игнорирует ошибки."""
    if path.startswith(("/docs", "/redoc", "/openapi", "/monitoring/system")):
        return
    r = _get_redis()
    if r is None:
        return
    try:
        now = time.time()
        norm = re.sub(
            r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            "/{id}", path
        )
        value = f"{method}|{norm}|{status}|{round(latency_ms, 1)}|{now}"
        pipe = r.pipeline()
        pipe.zadd("metrics:requests", {value: now})
        pipe.zremrangebyscore("metrics:requests", 0, now - WINDOW_SECONDS)
        await pipe.execute()
    except Exception:
        pass


async def save_health_snapshot(snapshot: dict) -> None:
    r = _get_redis()
    if r is None:
        return
    try:
        snapshot["saved_at"] = time.time()
        await r.lpush("metrics:health_snapshots", json.dumps(snapshot, default=str))
        await r.ltrim("metrics:health_snapshots", 0, MAX_HEALTH_SNAPSHOTS - 1)
    except Exception:
        pass


def _parse_value(value: str):
    """Разбирает строку метрики (поддерживает старый формат на 4 поля и новый на 5)."""
    parts = value.split("|")
    if len(parts) < 4:
        return None
    method, path, status_str, lat_str = parts[0], parts[1], parts[2], parts[3]
    try:
        return method, path, int(status_str), float(lat_str)
    except Exception:
        return None


async def get_request_metrics(window_minutes: int = 60) -> dict:
    r = _get_redis()
    if r is None:
        return {"available": False, "reason": "Redis not connected"}
    try:
        cutoff = time.time() - window_minutes * 60
        raw = await r.zrangebyscore("metrics:requests", cutoff, "+inf", withscores=True)
        if not raw:
            return {"available": True, "total": 0, "window_minutes": window_minutes}

        latencies = []
        status_counts: dict = defaultdict(int)
        endpoint_counts: dict = defaultdict(list)
        minute_counts: dict = defaultdict(lambda: {"total": 0, "errors": 0})

        for value, score in raw:
            parsed = _parse_value(value)
            if parsed is None:
                continue
            method, path, status, lat = parsed
            latencies.append(lat)
            status_counts[status] += 1
            ep_key = f"{method} {path}"
            endpoint_counts[ep_key].append(lat)
            minute_bucket = int(score // 60)
            minute_counts[minute_bucket]["total"] += 1
            if status >= 500:
                minute_counts[minute_bucket]["errors"] += 1

        latencies.sort()
        n = len(latencies)

        def pct(p):
            idx = min(int(n * p / 100), n - 1)
            return round(latencies[idx], 1) if latencies else 0

        errors = sum(v for k, v in status_counts.items() if k >= 500)
        error_rate = round(errors / n * 100, 1) if n else 0

        top_eps = sorted(
            [
                {
                    "endpoint": ep,
                    "count": len(lats),
                    "avg_ms": round(sum(lats) / len(lats), 1),
                    "p95_ms": round(sorted(lats)[min(int(len(lats) * 0.95), len(lats)-1)], 1),
                }
                for ep, lats in endpoint_counts.items()
            ],
            key=lambda x: x["count"], reverse=True,
        )[:10]

        now_bucket = int(time.time() // 60)
        timeseries = []
        for i in range(window_minutes - 1, -1, -1):
            bucket = now_bucket - i
            data = minute_counts.get(bucket, {"total": 0, "errors": 0})
            timeseries.append({"minute": -i, "total": data["total"], "errors": data["errors"]})

        return {
            "available": True,
            "window_minutes": window_minutes,
            "total": n,
            "error_count": errors,
            "error_rate_pct": error_rate,
            "latency": {
                "p50": pct(50), "p95": pct(95), "p99": pct(99),
                "avg": round(sum(latencies) / n, 1) if n else 0,
                "max": round(latencies[-1], 1) if latencies else 0,
            },
            "status_breakdown": dict(sorted(status_counts.items())),
            "top_endpoints": top_eps,
            "timeseries": timeseries,
        }
    except Exception as e:
        return {"available": False, "error": str(e)}


async def get_request_metrics_hourly(hours: int = 24) -> dict:
    """
    Метрики запросов сгруппированные по часам (для 24h-дашборда).
    Возвращает: hourly buckets, top endpoints, p50/p95/p99, total, errors.
    """
    r = _get_redis()
    if r is None:
        return {"available": False, "reason": "Redis not connected"}
    try:
        hours = max(1, min(hours, 24))
        cutoff = time.time() - hours * 3600
        raw = await r.zrangebyscore("metrics:requests", cutoff, "+inf", withscores=True)
        if not raw:
            return {"available": True, "total": 0, "hours": hours, "hourly": [], "top_endpoints": []}

        latencies = []
        status_counts: dict = defaultdict(int)
        endpoint_counts: dict = defaultdict(list)
        hour_counts: dict = defaultdict(lambda: {"total": 0, "errors": 0, "lat_sum": 0.0})

        for value, score in raw:
            parsed = _parse_value(value)
            if parsed is None:
                continue
            method, path, status, lat = parsed
            latencies.append(lat)
            status_counts[status] += 1
            ep_key = f"{method} {path}"
            endpoint_counts[ep_key].append(lat)
            hour_bucket = int(score // 3600)
            hour_counts[hour_bucket]["total"] += 1
            hour_counts[hour_bucket]["lat_sum"] += lat
            if status >= 500:
                hour_counts[hour_bucket]["errors"] += 1

        latencies.sort()
        n = len(latencies)

        def pct(p):
            idx = min(int(n * p / 100), n - 1)
            return round(latencies[idx], 1) if latencies else 0

        errors = sum(v for k, v in status_counts.items() if k >= 500)

        top_eps = sorted(
            [
                {
                    "endpoint": ep,
                    "count": len(lats),
                    "avg_ms": round(sum(lats) / len(lats), 1),
                    "p95_ms": round(sorted(lats)[min(int(len(lats) * 0.95), len(lats)-1)], 1),
                }
                for ep, lats in endpoint_counts.items()
            ],
            key=lambda x: x["count"], reverse=True,
        )[:10]

        now_hour = int(time.time() // 3600)
        hourly = []
        for i in range(hours - 1, -1, -1):
            bucket = now_hour - i
            data = hour_counts.get(bucket, {"total": 0, "errors": 0, "lat_sum": 0.0})
            avg_ms = round(data["lat_sum"] / data["total"], 1) if data["total"] else 0
            hourly.append({
                "hour_offset": -i,
                "ts": bucket * 3600,
                "total": data["total"],
                "errors": data["errors"],
                "avg_ms": avg_ms,
            })

        return {
            "available": True,
            "hours": hours,
            "total": n,
            "error_count": errors,
            "error_rate_pct": round(errors / n * 100, 1) if n else 0,
            "latency": {
                "p50": pct(50), "p95": pct(95), "p99": pct(99),
                "avg": round(sum(latencies) / n, 1) if n else 0,
                "max": round(latencies[-1], 1) if latencies else 0,
            },
            "status_breakdown": dict(sorted(status_counts.items())),
            "top_endpoints": top_eps,
            "hourly": hourly,
        }
    except Exception as e:
        return {"available": False, "error": str(e)}


async def get_health_history(limit: int = 12) -> list:
    r = _get_redis()
    if r is None:
        return []
    try:
        raw = await r.lrange("metrics:health_snapshots", 0, limit - 1)
        return [json.loads(i) for i in raw]
    except Exception:
        return []
