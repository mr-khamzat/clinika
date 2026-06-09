"""Сервисный слой для API Quotas.

Идея архитектуры:
  • Hot path (rate_limit_middleware на каждый запрос) пишет в Redis —
    sliding window и daily counter. БД не трогаем.
  • Periodic job (раз в N минут, scheduler.py) вызывает flush_to_db(),
    который перетекает счётчики из Redis в таблицу quota_usage
    (UPSERT по (tenant_id, period)).
  • Чтения для админки идут уже из БД (плюс «live» добавка из Redis для
    текущего дня в роутере /admin/quotas/{id}).

Ключи Redis:
  quota:rpm:<tenant_id>          — sliding window INCR с TTL=60s (для RPM)
  quota:rpd:<tenant_id>:<YYYY-MM-DD>   — счётчик за день (TTL=2 дня)
  quota:storage:<tenant_id>      — текущее использование диска в MB
  quota:calls:<tenant_id>:<YYYY-MM>    — минуты звонков за месяц
  quota:flush:pending            — SET tenant_id'ов с не сброшенными счётчиками
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, date, timedelta
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_quota import (
    TenantQuota,
    QuotaUsage,
    DEFAULT_REQUESTS_PER_MINUTE,
    DEFAULT_REQUESTS_PER_DAY,
    DEFAULT_STORAGE_MB_LIMIT,
    DEFAULT_USERS_LIMIT,
    DEFAULT_CALLS_MINUTES_PER_MONTH,
)

log = logging.getLogger("quota_service")


# ── Redis key helpers ───────────────────────────────────────────────────────


def k_rpm(tenant_id) -> str:
    return f"quota:rpm:{tenant_id}"


def k_rpd(tenant_id, day: Optional[date] = None) -> str:
    day = day or date.today()
    return f"quota:rpd:{tenant_id}:{day.isoformat()}"


def k_storage(tenant_id) -> str:
    return f"quota:storage:{tenant_id}"


def k_calls(tenant_id, month: Optional[date] = None) -> str:
    month = month or date.today()
    return f"quota:calls:{tenant_id}:{month.strftime('%Y-%m')}"


PENDING_SET = "quota:flush:pending"


# ── БД-уровень ──────────────────────────────────────────────────────────────


async def get_quota(db: AsyncSession, tenant_id: uuid.UUID) -> TenantQuota:
    """Возвращает квоту для tenant. Если её нет — создаёт с дефолтами и коммитит."""
    res = await db.execute(select(TenantQuota).where(TenantQuota.tenant_id == tenant_id))
    q = res.scalar_one_or_none()
    if q is not None:
        return q

    q = TenantQuota(
        tenant_id=tenant_id,
        requests_per_minute=DEFAULT_REQUESTS_PER_MINUTE,
        requests_per_day=DEFAULT_REQUESTS_PER_DAY,
        storage_mb_limit=DEFAULT_STORAGE_MB_LIMIT,
        users_limit=DEFAULT_USERS_LIMIT,
        calls_minutes_per_month=DEFAULT_CALLS_MINUTES_PER_MONTH,
        plan_default=True,
    )
    db.add(q)
    try:
        await db.commit()
        await db.refresh(q)
    except Exception:
        await db.rollback()
        # Гонка: кто-то параллельно создал. Перечитываем.
        res = await db.execute(select(TenantQuota).where(TenantQuota.tenant_id == tenant_id))
        q = res.scalar_one()
    return q


async def get_usage(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    period: Optional[date] = None,
) -> QuotaUsage:
    """Usage за конкретный день. Создаёт пустую строку если нет."""
    period = period or date.today()
    res = await db.execute(
        select(QuotaUsage).where(
            QuotaUsage.tenant_id == tenant_id,
            QuotaUsage.period == period,
        )
    )
    u = res.scalar_one_or_none()
    if u is not None:
        return u

    u = QuotaUsage(
        tenant_id=tenant_id,
        period=period,
        requests_count=0,
        storage_mb_used=0,
        calls_minutes_used=0,
    )
    db.add(u)
    try:
        await db.commit()
        await db.refresh(u)
    except Exception:
        await db.rollback()
        res = await db.execute(
            select(QuotaUsage).where(
                QuotaUsage.tenant_id == tenant_id,
                QuotaUsage.period == period,
            )
        )
        u = res.scalar_one()
    return u


# ── Redis-уровень ───────────────────────────────────────────────────────────


async def increment_usage(redis, tenant_id, field: str = "requests", n: int = 1) -> int:
    """Атомарно инкрементит счётчик в Redis. Возвращает новое значение.

    field:
       "requests" — общий счётчик за сегодня (для RPD)
       "storage"  — текущее storage в MB (set, не инкремент в семантике;
                    тут просто INCRBY — UI делает delta)
       "calls"    — минуты звонков за текущий месяц

    Также добавляет tenant_id в SET quota:flush:pending — чтобы flush_to_db
    знал кого процессить.
    """
    if redis is None:
        return 0

    tid = str(tenant_id)
    try:
        await redis.sadd(PENDING_SET, tid)
    except Exception as exc:  # pragma: no cover — Redis fail не должен ломать запрос
        log.warning(f"redis.sadd pending failed: {exc}")

    try:
        if field == "requests":
            key = k_rpd(tid)
            val = await redis.incrby(key, n)
            # TTL=2 дня — на случай если flush не сработал ровно в полночь.
            await redis.expire(key, 60 * 60 * 48)
            return int(val)
        elif field == "storage":
            val = await redis.incrby(k_storage(tid), n)
            return int(val)
        elif field == "calls":
            key = k_calls(tid)
            val = await redis.incrby(key, n)
            # TTL = 35 дней (на случай flush через границу месяца)
            await redis.expire(key, 60 * 60 * 24 * 35)
            return int(val)
        else:
            raise ValueError(f"unknown field {field!r}")
    except Exception as exc:  # pragma: no cover
        log.warning(f"increment_usage failed: {exc}")
        return 0


async def check_rpm(redis, tenant_id, limit: int) -> tuple[bool, int, int]:
    """Sliding-window RPM-проверка. Возвращает (allowed, current_count, retry_after_sec).

    Реализация: INCR ключа quota:rpm:<tid>; на первой инкрементации EXPIRE 60s.
    Это "fixed window" по сути — для production достаточно, точность ±60s.
    Retry-After ≈ оставшийся TTL ключа.
    """
    if redis is None:
        return True, 0, 0
    key = k_rpm(tenant_id)
    try:
        cur = await redis.incr(key)
        if cur == 1:
            await redis.expire(key, 60)
        cur = int(cur)
        if cur > limit:
            ttl = await redis.ttl(key)
            try:
                ttl = int(ttl)
            except Exception:
                ttl = 60
            if ttl < 0:
                ttl = 60
            return False, cur, ttl
        return True, cur, 0
    except Exception as exc:  # pragma: no cover
        log.warning(f"check_rpm failed: {exc}")
        return True, 0, 0


# ── Flush из Redis в БД ─────────────────────────────────────────────────────


async def flush_to_db(db: AsyncSession, redis) -> int:
    """Перетекает счётчики из Redis в quota_usage. Возвращает кол-во tenants.

    Запускается scheduler'ом раз в 5 минут.

    Для каждого pending tenant_id:
       1. GET quota:rpd:<tid>:<today>   → requests_count
       2. GET quota:storage:<tid>       → storage_mb_used
       3. GET quota:calls:<tid>:<YYYY-MM> → calls_minutes_used
       4. UPSERT quota_usage(tenant_id, period=today)  ← absolute values
          (не "delta", потому что Redis-ключ rpd сохраняет нарастающий total за день)
       5. SREM tenant_id из quota:flush:pending
    """
    if redis is None:
        return 0

    try:
        members = await redis.smembers(PENDING_SET)
    except Exception as exc:
        log.warning(f"flush_to_db: smembers failed: {exc}")
        return 0

    if not members:
        return 0

    today = date.today()
    processed = 0
    for tid_raw in members:
        tid_str = tid_raw if isinstance(tid_raw, str) else tid_raw.decode()
        try:
            tenant_id = uuid.UUID(tid_str)
        except Exception:
            await redis.srem(PENDING_SET, tid_str)
            continue

        try:
            rpd_val = await redis.get(k_rpd(tid_str)) or 0
            storage_val = await redis.get(k_storage(tid_str)) or 0
            calls_val = await redis.get(k_calls(tid_str)) or 0
            rpd_val = int(rpd_val)
            storage_val = int(storage_val)
            calls_val = int(calls_val)
        except Exception as exc:
            log.warning(f"flush_to_db: redis read failed for {tid_str}: {exc}")
            continue

        # Sanity check: tenant ещё существует?
        try:
            from sqlalchemy import text as _text
            exists = (await db.execute(
                _text("SELECT 1 FROM tenants WHERE id=:tid LIMIT 1"), {"tid": tenant_id}
            )).first()
            if not exists:
                # Тенант удалён — чистим redis от orphan-флага и пропускаем upsert.
                try:
                    await redis.srem(PENDING_SET, tid_str)
                except Exception:
                    pass
                continue
        except Exception as exc:
            log.warning(f"flush_to_db: tenant check failed for {tid_str}: {exc}")
            continue

        # UPSERT через ON CONFLICT (tenant_id, period)
        stmt = pg_insert(QuotaUsage).values(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            period=today,
            requests_count=rpd_val,
            storage_mb_used=storage_val,
            calls_minutes_used=calls_val,
            last_updated=datetime.utcnow(),
        ).on_conflict_do_update(
            constraint="uq_quota_usage_tenant_period",
            set_={
                "requests_count": rpd_val,
                "storage_mb_used": storage_val,
                "calls_minutes_used": calls_val,
                "last_updated": datetime.utcnow(),
            },
        )
        try:
            await db.execute(stmt)
            await db.commit()
            processed += 1
        except Exception as exc:
            await db.rollback()
            log.warning(f"flush_to_db: upsert failed for {tid_str}: {exc}")
            continue

        try:
            await redis.srem(PENDING_SET, tid_str)
        except Exception:
            pass

    return processed


async def reset_usage(db: AsyncSession, redis, tenant_id: uuid.UUID) -> None:
    """Сбрасывает все usage-счётчики tenant в ноль (Redis + БД за сегодня)."""
    today = date.today()
    tid = str(tenant_id)

    # БД: записываем нули в quota_usage за сегодня (UPSERT)
    stmt = pg_insert(QuotaUsage).values(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        period=today,
        requests_count=0,
        storage_mb_used=0,
        calls_minutes_used=0,
        last_updated=datetime.utcnow(),
    ).on_conflict_do_update(
        constraint="uq_quota_usage_tenant_period",
        set_={
            "requests_count": 0,
            "storage_mb_used": 0,
            "calls_minutes_used": 0,
            "last_updated": datetime.utcnow(),
        },
    )
    await db.execute(stmt)
    await db.commit()

    # Redis: дропаем все ключи tenant
    if redis is None:
        return
    try:
        await redis.delete(k_rpm(tid), k_rpd(tid), k_storage(tid), k_calls(tid))
        await redis.srem(PENDING_SET, tid)
    except Exception as exc:  # pragma: no cover
        log.warning(f"reset_usage redis cleanup failed: {exc}")


async def list_history(db: AsyncSession, tenant_id: uuid.UUID, days: int = 30) -> list[QuotaUsage]:
    """История usage за последние N дней (по убыванию даты)."""
    since = date.today() - timedelta(days=days)
    res = await db.execute(
        select(QuotaUsage)
        .where(QuotaUsage.tenant_id == tenant_id, QuotaUsage.period >= since)
        .order_by(QuotaUsage.period.desc())
    )
    return list(res.scalars().all())
