"""Cost Attribution — endpoints для super_admin.

prefix=/admin/cost-attribution
  GET    /            — топ-20 тенантов по est_cost за последний (или указанный) период.
  GET    /summary     — total cost платформы за period + avg + top.
  GET    /{tenant_id} — детали + история (12 периодов).
  POST   /snapshot    — запустить snapshot_all (для текущего месяца или указанного).

Все endpoints — require_super_admin.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_super_admin
from app.database import get_db
from app.models.cost_attribution import TenantCostSnapshot
from app.models.tenant import Tenant
from app.models.user import User
from app.services import cost_service

router = APIRouter(prefix="/admin/cost-attribution", tags=["admin-cost-attribution"])


# ─── helpers ───────────────────────────────────────────────────────────────


def _normalize_period(period: date | None) -> date:
    """Приводим period к 1-му числу месяца. Если не задан — текущий месяц."""
    if period is None:
        period = date.today()
    return period.replace(day=1)


async def _latest_snapshot_period(db: AsyncSession) -> date | None:
    """Найти самый свежий period, для которого есть хотя бы один snapshot."""
    res = await db.execute(select(func.max(TenantCostSnapshot.period)))
    return res.scalar_one_or_none()


def _serialize_snapshot(snap: TenantCostSnapshot, tenant: Tenant | None = None) -> dict:
    return {
        "id": str(snap.id),
        "tenant_id": str(snap.tenant_id),
        "tenant_name": tenant.name if tenant else None,
        "tenant_slug": tenant.slug if tenant else None,
        "period": snap.period.isoformat() if snap.period else None,
        "storage_mb": snap.storage_mb,
        "api_requests": int(snap.api_requests),
        "db_rows_estimate": int(snap.db_rows_estimate),
        "calls_minutes": snap.calls_minutes,
        "est_cost_rub": float(snap.est_cost_rub) if snap.est_cost_rub is not None else 0.0,
        "captured_at": snap.captured_at.isoformat() if snap.captured_at else None,
    }


# ─── GET / ─────────────────────────────────────────────────────────────────


@router.get("/", response_model=List[dict])
async def top_tenants(
    period: date | None = Query(None, description="Период (1-е число месяца)"),
    limit: int = Query(20, ge=1, le=200),
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Топ-N тенантов по est_cost за последний (или указанный) период."""
    target_period = _normalize_period(period) if period else None
    if target_period is None:
        target_period = await _latest_snapshot_period(db)
    if target_period is None:
        return []

    res = await db.execute(
        select(TenantCostSnapshot, Tenant)
        .join(Tenant, Tenant.id == TenantCostSnapshot.tenant_id)
        .where(TenantCostSnapshot.period == target_period)
        .order_by(desc(TenantCostSnapshot.est_cost_rub))
        .limit(limit)
    )
    out: list[dict] = []
    for snap, tenant in res.all():
        out.append(_serialize_snapshot(snap, tenant))
    return out


# ─── GET /summary ──────────────────────────────────────────────────────────


@router.get("/summary", response_model=dict)
async def summary(
    period: date | None = Query(None),
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Total cost платформы + avg + top heaviest tenant за period."""
    target_period = _normalize_period(period) if period else None
    if target_period is None:
        target_period = await _latest_snapshot_period(db)
    if target_period is None:
        return {
            "period": None,
            "total_cost_rub": 0.0,
            "avg_cost_rub": 0.0,
            "tenant_count": 0,
            "top_tenant": None,
        }

    agg_res = await db.execute(
        select(
            func.coalesce(func.sum(TenantCostSnapshot.est_cost_rub), 0),
            func.coalesce(func.avg(TenantCostSnapshot.est_cost_rub), 0),
            func.count(TenantCostSnapshot.id),
        ).where(TenantCostSnapshot.period == target_period)
    )
    total, avg, cnt = agg_res.one()

    top_res = await db.execute(
        select(TenantCostSnapshot, Tenant)
        .join(Tenant, Tenant.id == TenantCostSnapshot.tenant_id)
        .where(TenantCostSnapshot.period == target_period)
        .order_by(desc(TenantCostSnapshot.est_cost_rub))
        .limit(1)
    )
    top_row = top_res.first()
    top_tenant = None
    if top_row is not None:
        snap, tenant = top_row
        top_tenant = _serialize_snapshot(snap, tenant)

    return {
        "period": target_period.isoformat(),
        "total_cost_rub": float(total or 0),
        "avg_cost_rub": float(avg or 0),
        "tenant_count": int(cnt or 0),
        "top_tenant": top_tenant,
    }


# ─── GET /{tenant_id} ──────────────────────────────────────────────────────


@router.get("/{tenant_id}", response_model=dict)
async def tenant_detail(
    tenant_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Детали тенанта + история (последние 12 снимков по убыванию period)."""
    tenant_res = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_res.scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Тенант не найден")

    snaps_res = await db.execute(
        select(TenantCostSnapshot)
        .where(TenantCostSnapshot.tenant_id == tenant_id)
        .order_by(desc(TenantCostSnapshot.period))
        .limit(12)
    )
    snaps: list[TenantCostSnapshot] = list(snaps_res.scalars().all())

    return {
        "tenant_id": str(tenant.id),
        "tenant_name": tenant.name,
        "tenant_slug": tenant.slug,
        "current": _serialize_snapshot(snaps[0], tenant) if snaps else None,
        "history": [_serialize_snapshot(s, tenant) for s in snaps],
    }


# ─── POST /snapshot ────────────────────────────────────────────────────────


@router.post(
    "/snapshot",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def trigger_snapshot(
    period: date | None = Query(None),
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Запустить snapshot_all (для всех активных тенантов) на указанный период."""
    target_period = _normalize_period(period) if period else date.today().replace(day=1)
    created = await cost_service.snapshot_all(db, target_period)
    return {
        "period": target_period.isoformat(),
        "tenants_snapped": created,
    }
