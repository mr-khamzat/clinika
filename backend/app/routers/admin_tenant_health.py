"""Tenant Health — endpoints для super_admin.

prefix=/admin/tenant-health
  GET    /                       — текущее состояние всех тенантов (последний snapshot).
  GET    /alerts                 — только тенанты с alert_level in (yellow|red).
  GET    /{tenant_id}            — детали тенанта + история (последние 90 снимков).
  POST   /{tenant_id}/recompute  — пересчитать сейчас и записать новый snapshot.

Все endpoints — require_super_admin.
"""
from __future__ import annotations

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_super_admin
from app.database import get_db
from app.models.tenant import Tenant
from app.models.tenant_health import TenantHealthAlertLevel, TenantHealthSnapshot
from app.models.user import User
from app.services import tenant_health_service as ths

router = APIRouter(prefix="/admin/tenant-health", tags=["admin-tenant-health"])


# ─── serializers ───────────────────────────────────────────────────────────


def _serialize_snapshot(snap: TenantHealthSnapshot) -> dict:
    return {
        "id": str(snap.id),
        "tenant_id": str(snap.tenant_id),
        "captured_at": snap.captured_at.isoformat() if snap.captured_at else None,
        "score": snap.score,
        "alert_level": (
            snap.alert_level.value
            if hasattr(snap.alert_level, "value")
            else snap.alert_level
        ),
        "factors": snap.factors or {},
    }


async def _latest_for_each_tenant(
    db: AsyncSession,
) -> list[tuple[Tenant, TenantHealthSnapshot | None]]:
    """Возвращает все активные тенанты + их последний snapshot (может быть None)."""
    tenants_res = await db.execute(
        select(Tenant).where(Tenant.is_active.is_(True)).order_by(Tenant.name)
    )
    tenants: list[Tenant] = list(tenants_res.scalars().all())

    out: list[tuple[Tenant, TenantHealthSnapshot | None]] = []
    for t in tenants:
        snap_res = await db.execute(
            select(TenantHealthSnapshot)
            .where(TenantHealthSnapshot.tenant_id == t.id)
            .order_by(desc(TenantHealthSnapshot.captured_at))
            .limit(1)
        )
        snap = snap_res.scalar_one_or_none()
        out.append((t, snap))
    return out


# ─── GET / ─────────────────────────────────────────────────────────────────


@router.get("/", response_model=List[dict])
async def list_health(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Текущее состояние всех тенантов — последний snapshot каждого."""
    rows = await _latest_for_each_tenant(db)
    out: list[dict] = []
    for tenant, snap in rows:
        item = {
            "tenant_id": str(tenant.id),
            "tenant_name": tenant.name,
            "tenant_slug": tenant.slug,
        }
        if snap is None:
            item.update(
                {
                    "score": None,
                    "alert_level": None,
                    "factors": None,
                    "captured_at": None,
                }
            )
        else:
            item.update(
                {
                    "score": snap.score,
                    "alert_level": (
                        snap.alert_level.value
                        if hasattr(snap.alert_level, "value")
                        else snap.alert_level
                    ),
                    "factors": snap.factors or {},
                    "captured_at": snap.captured_at.isoformat()
                    if snap.captured_at
                    else None,
                }
            )
        out.append(item)
    return out


# ─── GET /alerts ───────────────────────────────────────────────────────────


@router.get("/alerts", response_model=List[dict])
async def list_alerts(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Только тенанты с alert_level in (yellow|red) — для мониторинга."""
    rows = await _latest_for_each_tenant(db)
    out: list[dict] = []
    for tenant, snap in rows:
        if snap is None:
            continue
        level = snap.alert_level.value if hasattr(snap.alert_level, "value") else snap.alert_level
        if level not in ("yellow", "red"):
            continue
        out.append(
            {
                "tenant_id": str(tenant.id),
                "tenant_name": tenant.name,
                "tenant_slug": tenant.slug,
                "score": snap.score,
                "alert_level": level,
                "factors": snap.factors or {},
                "captured_at": snap.captured_at.isoformat()
                if snap.captured_at
                else None,
            }
        )
    # Отсортировать по убыванию серьёзности: red → yellow.
    out.sort(key=lambda r: (0 if r["alert_level"] == "red" else 1, r["score"] or 0))
    return out


# ─── GET /{tenant_id} ──────────────────────────────────────────────────────


@router.get("/{tenant_id}", response_model=dict)
async def tenant_detail(
    tenant_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Детали тенанта + история (последние 90 снимков по убыванию captured_at)."""
    tenant_res = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_res.scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Тенант не найден")

    snaps_res = await db.execute(
        select(TenantHealthSnapshot)
        .where(TenantHealthSnapshot.tenant_id == tenant_id)
        .order_by(desc(TenantHealthSnapshot.captured_at))
        .limit(90)
    )
    snaps: list[TenantHealthSnapshot] = list(snaps_res.scalars().all())

    return {
        "tenant_id": str(tenant.id),
        "tenant_name": tenant.name,
        "tenant_slug": tenant.slug,
        "current": _serialize_snapshot(snaps[0]) if snaps else None,
        "history": [_serialize_snapshot(s) for s in snaps],
    }


# ─── POST /{tenant_id}/recompute ───────────────────────────────────────────


@router.post(
    "/{tenant_id}/recompute",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def recompute(
    tenant_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Пересчитать score сейчас и записать новый snapshot."""
    tenant_res = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_res.scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Тенант не найден")

    snap = await ths.snapshot_tenant(db, tenant_id)
    await db.commit()
    await db.refresh(snap)
    return _serialize_snapshot(snap)
