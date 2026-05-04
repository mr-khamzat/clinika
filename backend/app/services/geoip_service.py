"""
GeoIP-сервис: lookup IP -> {country, country_name, region, city, lat, lon}.

База: /app/data/GeoLite2-City.mmdb (или dbip-city-lite — формат совместим).
Reader инициализируется лениво (при первом lookup), кешируется в модуле.
Кеш результатов в Redis: ключ geoip:{ip}, TTL 24h.

Любые ошибки гасятся — функция возвращает None, не ломает основной поток.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Optional

logger = logging.getLogger("geoip")

# Путь к mmdb — можно переопределить переменной окружения
GEOIP_DB_PATH = os.environ.get("GEOIP_DB_PATH", "/app/data/GeoLite2-City.mmdb")
CACHE_TTL_SECONDS = 24 * 3600  # 24 часа

_reader = None              # geoip2.database.Reader, lazy
_reader_init_failed = False  # флаг чтобы не лезть на диск каждый запрос если файла нет
_reader_mtime: float | None = None  # для авто-перезагрузки после ежемесячного обновления


def _get_reader():
    """Лениво открывает GeoLite2/dbip Reader. Возвращает None если файла нет/ошибка."""
    global _reader, _reader_init_failed, _reader_mtime
    if _reader_init_failed:
        return None
    try:
        # Авто-перезагрузка если файл обновился (cron перезаписал)
        if _reader is not None:
            try:
                cur_mtime = os.path.getmtime(GEOIP_DB_PATH)
                if _reader_mtime is not None and cur_mtime != _reader_mtime:
                    try:
                        _reader.close()
                    except Exception:
                        pass
                    _reader = None
            except OSError:
                pass

        if _reader is None:
            if not os.path.exists(GEOIP_DB_PATH):
                _reader_init_failed = True
                logger.info("geoip: mmdb file not found at %s, geo lookup disabled", GEOIP_DB_PATH)
                return None
            import geoip2.database  # type: ignore
            _reader = geoip2.database.Reader(GEOIP_DB_PATH)
            try:
                _reader_mtime = os.path.getmtime(GEOIP_DB_PATH)
            except OSError:
                _reader_mtime = None
            logger.info("geoip: reader initialized from %s", GEOIP_DB_PATH)
        return _reader
    except Exception as e:
        _reader_init_failed = True
        logger.warning("geoip: reader init failed: %s", e)
        return None


def reset_reader() -> None:
    """Сбросить кешированный Reader — вызывать после обновления mmdb."""
    global _reader, _reader_init_failed, _reader_mtime
    if _reader is not None:
        try:
            _reader.close()
        except Exception:
            pass
    _reader = None
    _reader_init_failed = False
    _reader_mtime = None


def _is_lookupable(ip: str) -> bool:
    """Отсекаем приватные/локальные IP — для них geo бесполезен."""
    if not ip:
        return False
    if ip in ("127.0.0.1", "::1", "localhost"):
        return False
    # 10.x, 172.16-31, 192.168.x, fc00::/7
    if ip.startswith(("10.", "192.168.", "169.254.", "fc", "fd", "::ffff:")):
        return False
    if ip.startswith("172."):
        try:
            second = int(ip.split(".")[1])
            if 16 <= second <= 31:
                return False
        except (ValueError, IndexError):
            pass
    return True


def _lookup_sync(ip: str) -> Optional[dict]:
    """Синхронный lookup в mmdb. Возвращает dict или None."""
    reader = _get_reader()
    if reader is None:
        return None
    try:
        resp = reader.city(ip)
    except Exception:
        # AddressNotFoundError, ValueError для невалидного IP, etc.
        return None

    def _ru_or_en(names) -> str | None:
        if not names:
            return None
        return names.get("ru") or names.get("en")

    try:
        country_iso = (resp.country.iso_code or None) if resp.country else None
        country_name = _ru_or_en(resp.country.names) if resp.country else None
        # region — самая крупная subdivision
        region = None
        if resp.subdivisions and len(resp.subdivisions) > 0:
            region = _ru_or_en(resp.subdivisions.most_specific.names)
        city = _ru_or_en(resp.city.names) if resp.city else None
        lat = float(resp.location.latitude) if resp.location and resp.location.latitude is not None else None
        lon = float(resp.location.longitude) if resp.location and resp.location.longitude is not None else None
    except Exception:
        return None

    if not any([country_iso, country_name, city, region, lat, lon]):
        return None

    return {
        "country":      country_iso,
        "country_name": country_name,
        "region":       region,
        "city":         city,
        "lat":          lat,
        "lon":          lon,
    }


async def lookup(ip: str | None) -> Optional[dict]:
    """
    Асинхронный lookup IP. Кеш в Redis на 24 часа.
    Возвращает dict или None.
    """
    if not ip or not _is_lookupable(ip):
        return None

    # Redis cache (используем тот же lazy-клиент что и метрики)
    redis_client = None
    try:
        from app.utils.metrics import _get_redis as _get_metrics_redis  # type: ignore
        redis_client = _get_metrics_redis()
    except Exception:
        redis_client = None

    cache_key = f"geoip:{ip}"
    if redis_client is not None:
        try:
            cached = await redis_client.get(cache_key)
            if cached is not None:
                if cached == "":  # negative cache
                    return None
                try:
                    return json.loads(cached)
                except (TypeError, ValueError):
                    pass
        except Exception:
            pass

    # Уход с event loop — geoip2 синхронный, но один запрос — микросекунды
    try:
        import asyncio
        result = await asyncio.get_running_loop().run_in_executor(None, _lookup_sync, ip)
    except Exception:
        result = None

    if redis_client is not None:
        try:
            payload = json.dumps(result) if result is not None else ""
            await redis_client.set(cache_key, payload, ex=CACHE_TTL_SECONDS)
        except Exception:
            pass

    return result
