"""Реклама — workflow (Phase D): approval, sharing между филиалами франшизы, фильтр по тегам.

Отдельный router. Не пересекается с routers/ads.py и routers/ads_ai.py — параллельные
агенты пишут в свои файлы, итоговая регистрация в main.py.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import (
    get_current_user,
    require_manager,
    require_director_or_owner,
)
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.advertising import Ad, AdStatus
from app.routers.ads import _mod, _ad_out

router = APIRouter(prefix="/ads", tags=["ads-workflow"])


async def _get_ad_in_tenant(db: AsyncSession, ad_id: uuid.UUID, tenant_id: uuid.UUID) -> Ad:
    ad = (
        await db.execute(select(Ad).where(Ad.id == ad_id, Ad.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if not ad:
        raise HTTPException(404, "ad not found")
    return ad


# ============================================================
# Approval workflow
# ============================================================

class ApproveRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=2000)


class RejectRequest(BaseModel):
    note: str = Field(..., min_length=3, max_length=2000)


@router.post("/{ad_id}/approve")
async def ad_approve(
    ad_id: uuid.UUID,
    body: ApproveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_director_or_owner),
):
    """Одобряет рекламу. Доступно director/deputy/franchise_owner/super_admin."""
    ad = await _get_ad_in_tenant(db, ad_id, current_user.tenant_id)
    ad.approval_status = "approved"
    ad.approval_note = body.note
    ad.approved_at = datetime.utcnow()
    ad.approved_by_id = current_user.id
    await db.commit()
    await db.refresh(ad)
    return _ad_out(ad)


@router.post("/{ad_id}/reject")
async def ad_reject(
    ad_id: uuid.UUID,
    body: RejectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_director_or_owner),
):
    """Отклоняет рекламу. Note обязателен."""
    ad = await _get_ad_in_tenant(db, ad_id, current_user.tenant_id)
    ad.approval_status = "rejected"
    ad.approval_note = body.note
    ad.approved_at = datetime.utcnow()
    ad.approved_by_id = current_user.id
    if ad.status == AdStatus.ACTIVE:
        ad.status = AdStatus.PAUSED
    await db.commit()
    await db.refresh(ad)
    return _ad_out(ad)


@router.get("/pending-approval", dependencies=[_mod])
async def list_pending_approval(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
    limit: int = Query(100, ge=1, le=500),
):
    """Список объявлений на approval в текущем тенанте."""
    stmt = (
        select(Ad)
        .where(Ad.tenant_id == current_user.tenant_id, Ad.approval_status == "pending")
        .order_by(Ad.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_ad_out(a) for a in rows]


# ============================================================
# Sharing между филиалами франшизы
# ============================================================

class ShareRequest(BaseModel):
    tenant_id: str
    activate: bool = False


@router.get("/franchise-siblings", dependencies=[_mod])
async def franchise_siblings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Список тенантов в той же франшизе (для UI выбора целевого филиала при share)."""
    me = (
        await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    ).scalar_one_or_none()
    if not me or not me.franchise_id:
        return []
    rows = (
        await db.execute(
            select(Tenant).where(
                Tenant.franchise_id == me.franchise_id,
                Tenant.id != me.id,
            )
        )
    ).scalars().all()
    return [
        {
            "id": str(t.id),
            "name": getattr(t, "name", None) or getattr(t, "slug", "?"),
            "slug": getattr(t, "slug", None),
        }
        for t in rows
    ]


@router.post("/{ad_id}/share", dependencies=[_mod])
async def share_ad(
    ad_id: uuid.UUID,
    body: ShareRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Копирует объявление в другой тенант той же франшизы.

    - Если activate=True → новый ad ставит status=active+approval_status=pending
      (для повторной проверки в новом филиале).
    - Если activate=False → status=draft+approval_status=approved.
    """
    try:
        target_id = uuid.UUID(body.tenant_id)
    except ValueError:
        raise HTTPException(400, "invalid target tenant_id")

    me = (
        await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    ).scalar_one_or_none()
    if not me or not me.franchise_id:
        raise HTTPException(403, "current tenant is not part of any franchise")

    target = (
        await db.execute(
            select(Tenant).where(Tenant.id == target_id, Tenant.franchise_id == me.franchise_id)
        )
    ).scalar_one_or_none()
    if not target:
        raise HTTPException(403, "target tenant is not a franchise sibling")

    src = await _get_ad_in_tenant(db, ad_id, current_user.tenant_id)
    new_status = AdStatus.ACTIVE if body.activate else AdStatus.DRAFT
    new_approval = "pending" if body.activate else "approved"
    copy = Ad(
        tenant_id=target_id,
        title=src.title,
        body=src.body,
        image_url=src.image_url,
        link=src.link,
        ad_type=src.ad_type,
        status=new_status,
        start_date=src.start_date,
        end_date=src.end_date,
        price=src.price,
        pricing_model=src.pricing_model,
        impressions_limit=src.impressions_limit,
        clicks_limit=src.clicks_limit,
        budget_total=src.budget_total,
        freq_per_day=src.freq_per_day,
        freq_per_hour=src.freq_per_hour,
        auto_pause_idle_days=src.auto_pause_idle_days,
        audience=src.audience,
        attribution_window_days=src.attribution_window_days,
        category=src.category,
        tags=src.tags,
        meta=src.meta,
        share_origin_ad_id=src.id,
        approval_status=new_approval,
    )
    db.add(copy)
    await db.commit()
    await db.refresh(copy)
    return _ad_out(copy)


# ============================================================
# Tags filter
# ============================================================

@router.get("/by-tags", dependencies=[_mod])
async def list_by_tags(
    tags: str = Query(..., description="Comma-separated tags"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
    limit: int = Query(200, ge=1, le=500),
):
    """Список объявлений у которых хотя бы один из переданных тегов."""
    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    if not tag_list:
        raise HTTPException(400, "tags required")
    stmt = (
        select(Ad)
        .where(
            Ad.tenant_id == current_user.tenant_id,
            Ad.tags.op("?|")(tag_list),  # postgres jsonb ?| array — any-of-keys
        )
        .order_by(Ad.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_ad_out(a) for a in rows]
