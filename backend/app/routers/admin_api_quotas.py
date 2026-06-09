"""Админ-эндпоинты для управления API-квотами тенантов.

Доступ — только super_admin (require_super_admin).

Маршруты:
   GET    /admin/quotas                 — список tenant'ов с квотами + текущим usage
   GET    /admin/quotas/alerts          — те, кто близко к лимитам (>80%)
   GET    /admin/quotas/{tenant_id}     — детали квоты + история (30 дней)
   PUT    /admin/quotas/{tenant_id}     — обновить квоты
   POST   /admin/quotas/{tenant_id}/reset  — сбросить usage в ноль
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import Optional, List

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import settings
from app.core.deps import require_super_admin
from app.models.user import User
from app.models.tenant import Tenant
from app.models.api_quota import (
    TenantQuota,
    QuotaUsage,
    DEFAULT_REQUESTS_PER_MINUTE,
    DEFAULT_REQUESTS_PER_DAY,
    DEFAULT_STORAGE_MB_LIMIT,
    DEFAULT_USERS_LIMIT,
    DEFAULT_CALLS_MINUTES_PER_MONTH,
)
from app.services import quota_service


router = APIRouter(prefix="/admin/quotas", tags=["admin-quotas"])


# ── Schemas ─────────────────────────────────────────────────────────────────


class QuotaOut(BaseModel):
    tenant_id: uuid.UUID
    requests_per_minute: int
    requests_per_day: int
    storage_mb_limit: int
    users_limit: int
    calls_minutes_per_month: int
    plan_default: bool

    class Config:
        from_attributes = True


class UsageOut(BaseModel):
    period: date
    requests_count: int
    storage_mb_used: int
    calls_minutes_used: int

    class Config:
        from_attributes = True


class TenantQuotaRow(BaseModel):
    """Строка для GET / — tenant + квота + today usage."""
    tenant_id: uuid.UUID
    tenant_name: str
    quota: QuotaOut
    today_usage: UsageOut


class QuotaPatchIn(BaseModel):
    requests_per_minute: Optional[int] = Field(default=None, ge=1, le=10_000_000)
    requests_per_day: Optional[int] = Field(default=None, ge=1, le=1_000_000_000)
    storage_mb_limit: Optional[int] = Field(default=None, ge=1, le=10_000_000)
    users_limit: Optional[int] = Field(default=None, ge=1, le=1_000_000)
    calls_minutes_per_month: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    plan_default: Optional[bool] = None


class QuotaDetailsOut(BaseModel):
    quota: QuotaOut
    today_usage: UsageOut
    history: List[UsageOut]


class QuotaAlertOut(BaseModel):
    tenant_id: uuid.UUID
    tenant_name: str
    metric: str           # "requests_per_day" | "storage_mb" | "users" | "calls_minutes"
    usage: int
    limit: int
    percent: float


# ── Helpers ─────────────────────────────────────────────────────────────────


def _empty_usage(period: date) -> UsageOut:
    return UsageOut(
        period=period,
        requests_count=0,
        storage_mb_used=0,
        calls_minutes_used=0,
    )


def _usage_to_out(u: Optional[QuotaUsage], period: date) -> UsageOut:
    if u is None:
        return _empty_usage(period)
    return UsageOut(
        period=u.period,
        requests_count=u.requests_count,
        storage_mb_used=u.storage_mb_used,
        calls_minutes_used=u.calls_minutes_used,
    )


# ── Endpoints ───────────────────────────────────────────────────────────────


@router.get("", response_model=List[TenantQuotaRow])
async def list_quotas(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_super_admin),
) -> List[TenantQuotaRow]:
    """Все тенанты с их квотами и сегодняшним usage.

    Если у tenant'а нет строки в tenant_quotas — отдаём дефолты.
    """
    today = date.today()

    res_t = await db.execute(select(Tenant).order_by(Tenant.name))
    tenants = list(res_t.scalars().all())

    if not tenants:
        return []

    tenant_ids = [t.id for t in tenants]
    res_q = await db.execute(select(TenantQuota).where(TenantQuota.tenant_id.in_(tenant_ids)))
    quotas_by_tid = {q.tenant_id: q for q in res_q.scalars().all()}

    res_u = await db.execute(
        select(QuotaUsage).where(
            QuotaUsage.tenant_id.in_(tenant_ids),
            QuotaUsage.period == today,
        )
    )
    usage_by_tid = {u.tenant_id: u for u in res_u.scalars().all()}

    rows: List[TenantQuotaRow] = []
    for t in tenants:
        q = quotas_by_tid.get(t.id)
        if q is None:
            q_out = QuotaOut(
                tenant_id=t.id,
                requests_per_minute=DEFAULT_REQUESTS_PER_MINUTE,
                requests_per_day=DEFAULT_REQUESTS_PER_DAY,
                storage_mb_limit=DEFAULT_STORAGE_MB_LIMIT,
                users_limit=DEFAULT_USERS_LIMIT,
                calls_minutes_per_month=DEFAULT_CALLS_MINUTES_PER_MONTH,
                plan_default=True,
            )
        else:
            q_out = QuotaOut.model_validate(q)
        rows.append(TenantQuotaRow(
            tenant_id=t.id,
            tenant_name=t.name,
            quota=q_out,
            today_usage=_usage_to_out(usage_by_tid.get(t.id), today),
        ))
    return rows


@router.get("/alerts", response_model=List[QuotaAlertOut])
async def list_alerts(
    threshold: float = 0.8,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_super_admin),
) -> List[QuotaAlertOut]:
    """Тенанты, у которых сегодняшний usage превышает threshold (по умолчанию 80%) лимита.

    Считаем по daily-метрикам (requests_per_day, storage_mb_limit, users — N/A здесь,
    calls_minutes_per_month — за текущий месяц). Если у tenant нет квоты — дефолты.
    """
    today = date.today()
    month_start = today.replace(day=1)

    # Все tenant'ы.
    res_t = await db.execute(select(Tenant))
    tenants = {t.id: t for t in res_t.scalars().all()}
    if not tenants:
        return []

    res_q = await db.execute(
        select(TenantQuota).where(TenantQuota.tenant_id.in_(list(tenants.keys())))
    )
    quotas_by_tid = {q.tenant_id: q for q in res_q.scalars().all()}

    # Сегодняшние usage (для requests + storage).
    res_u = await db.execute(
        select(QuotaUsage).where(
            QuotaUsage.tenant_id.in_(list(tenants.keys())),
            QuotaUsage.period == today,
        )
    )
    today_usage = {u.tenant_id: u for u in res_u.scalars().all()}

    # Месячная сумма звонков (sum по quota_usage за период [month_start, today]).
    from sqlalchemy import func
    res_calls = await db.execute(
        select(
            QuotaUsage.tenant_id,
            func.coalesce(func.sum(QuotaUsage.calls_minutes_used), 0).label("total"),
        )
        .where(
            QuotaUsage.tenant_id.in_(list(tenants.keys())),
            QuotaUsage.period >= month_start,
        )
        .group_by(QuotaUsage.tenant_id)
    )
    monthly_calls = {row.tenant_id: int(row.total) for row in res_calls.all()}

    out: List[QuotaAlertOut] = []
    for tid, t in tenants.items():
        q = quotas_by_tid.get(tid)
        rpd_limit = q.requests_per_day if q else DEFAULT_REQUESTS_PER_DAY
        storage_limit = q.storage_mb_limit if q else DEFAULT_STORAGE_MB_LIMIT
        calls_limit = q.calls_minutes_per_month if q else DEFAULT_CALLS_MINUTES_PER_MONTH

        u = today_usage.get(tid)
        req_used = u.requests_count if u else 0
        storage_used = u.storage_mb_used if u else 0
        calls_used = monthly_calls.get(tid, 0)

        for metric, used, limit in (
            ("requests_per_day", req_used, rpd_limit),
            ("storage_mb", storage_used, storage_limit),
            ("calls_minutes", calls_used, calls_limit),
        ):
            if limit <= 0:
                continue
            pct = used / limit
            if pct >= threshold:
                out.append(QuotaAlertOut(
                    tenant_id=tid,
                    tenant_name=t.name,
                    metric=metric,
                    usage=used,
                    limit=limit,
                    percent=round(pct * 100, 2),
                ))

    out.sort(key=lambda r: r.percent, reverse=True)
    return out


@router.get("/{tenant_id}", response_model=QuotaDetailsOut)
async def get_quota_details(
    tenant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_super_admin),
) -> QuotaDetailsOut:
    """Детали квоты + история за 30 дней."""
    # Проверка существования tenant.
    res_t = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    if res_t.scalar_one_or_none() is None:
        raise HTTPException(404, "Tenant не найден")

    q = await quota_service.get_quota(db, tenant_id)
    today = date.today()
    u_today = await quota_service.get_usage(db, tenant_id, today)
    history = await quota_service.list_history(db, tenant_id, days=30)

    return QuotaDetailsOut(
        quota=QuotaOut.model_validate(q),
        today_usage=_usage_to_out(u_today, today),
        history=[_usage_to_out(h, h.period) for h in history],
    )


@router.put("/{tenant_id}", response_model=QuotaOut)
async def update_quota(
    tenant_id: uuid.UUID,
    payload: QuotaPatchIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_super_admin),
) -> QuotaOut:
    """Обновить квоты. Создаёт строку если её не было."""
    res_t = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    if res_t.scalar_one_or_none() is None:
        raise HTTPException(404, "Tenant не найден")

    q = await quota_service.get_quota(db, tenant_id)

    data = payload.model_dump(exclude_unset=True)
    if not data:
        return QuotaOut.model_validate(q)

    # Любое явное изменение значений сбрасывает plan_default=False,
    # если клиент сам не задал plan_default.
    has_value_changes = any(k != "plan_default" for k in data.keys())
    if has_value_changes and "plan_default" not in data:
        q.plan_default = False

    for k, v in data.items():
        setattr(q, k, v)

    await db.commit()
    await db.refresh(q)
    return QuotaOut.model_validate(q)


@router.post("/{tenant_id}/reset")
async def reset_quota_usage(
    tenant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_super_admin),
) -> dict:
    """Сбрасывает все usage-счётчики tenant в ноль (Redis + сегодняшнюю строку quota_usage)."""
    res_t = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    if res_t.scalar_one_or_none() is None:
        raise HTTPException(404, "Tenant не найден")

    redis = None
    try:
        redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    except Exception:
        redis = None

    try:
        await quota_service.reset_usage(db, redis, tenant_id)
    finally:
        if redis is not None:
            try:
                await redis.close()
            except Exception:
                pass

    return {"ok": True, "tenant_id": str(tenant_id), "reset_at": date.today().isoformat()}
