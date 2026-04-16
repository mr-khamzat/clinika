"""
Реклама — API.
Управление рекламными объявлениями для тенантов.

Эндпоинты:
  GET  /ads           — список объявлений тенанта
  POST /ads           — создать объявление
  GET  /ads/{id}      — детали объявления
  PATCH /ads/{id}     — обновить (статус, даты)
  POST /ads/{id}/event — зарегистрировать событие (impression/click/conversion)
  GET  /ads/active    — активные объявления для показа (публичный, с пагинацией)
"""
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.database import get_db
from app.core.deps import get_current_user, require_manager
from app.core.tenant import require_feature
from app.models.user import User
from app.models.advertising import Ad, AdStatus, AdType, PricingModel
from app.services import billing_service
from app.utils.geo import get_client_ip

router = APIRouter(prefix="/ads", tags=["ads"])

_feat = Depends(require_feature("billing"))
_mgr = Depends(require_manager)


class CreateAdRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body: Optional[str] = None
    image_url: Optional[str] = None
    link: Optional[str] = None
    ad_type: str = Field("banner", pattern="^(banner|interstitial|native)$")
    pricing_model: str = Field("flat", pattern="^(flat|cpc|cpm)$")
    start_date: date
    end_date: date
    price: float = Field(..., ge=0)
    impressions_limit: Optional[int] = None
    clicks_limit: Optional[int] = None


class UpdateAdRequest(BaseModel):
    status: Optional[str] = Field(None, pattern="^(draft|active|paused|completed|cancelled)$")
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class AdEventRequest(BaseModel):
    event_type: str = Field(..., pattern="^(impression|click|conversion)$")
    user_id: Optional[str] = None
    meta: Optional[dict] = None


def _ad_out(ad: Ad) -> dict:
    return {
        "id": str(ad.id),
        "tenant_id": str(ad.tenant_id),
        "title": ad.title,
        "body": ad.body,
        "image_url": ad.image_url,
        "link": ad.link,
        "ad_type": ad.ad_type,
        "status": ad.status,
        "pricing_model": ad.pricing_model,
        "start_date": ad.start_date.isoformat() if ad.start_date else None,
        "end_date": ad.end_date.isoformat() if ad.end_date else None,
        "price": float(ad.price),
        "impressions_limit": ad.impressions_limit,
        "clicks_limit": ad.clicks_limit,
        "impressions_count": ad.impressions_count,
        "clicks_count": ad.clicks_count,
        "conversions_count": ad.conversions_count,
    }


@router.get("")
async def list_ads(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """Список рекламных объявлений тенанта."""
    filters = []
    if current_user.tenant_id:
        filters.append(Ad.tenant_id == current_user.tenant_id)
    if status:
        filters.append(Ad.status == status)

    q = await db.execute(
        select(Ad).where(*filters).order_by(Ad.created_at.desc()).limit(limit)
    )
    ads = q.scalars().all()
    return [_ad_out(a) for a in ads]


@router.post("", status_code=201)
async def create_ad(
    body: CreateAdRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Создать рекламное объявление с billing."""
    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Тенант не определён")

    ad = await billing_service.create_ad(
        db,
        tenant_id=current_user.tenant_id,
        title=body.title,
        body=body.body,
        image_url=body.image_url,
        link=body.link,
        ad_type=body.ad_type,
        pricing_model=body.pricing_model,
        start_date=body.start_date,
        end_date=body.end_date,
        price=Decimal(str(body.price)),
        impressions_limit=body.impressions_limit,
        clicks_limit=body.clicks_limit,
    )
    await db.commit()
    return _ad_out(ad)


@router.get("/active")
async def list_active_ads(
    db: AsyncSession = Depends(get_db),
    ad_type: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=50),
):
    """Активные объявления для показа пациентам (публичный endpoint)."""
    today = date.today()
    filters = [
        Ad.status == AdStatus.ACTIVE,
        Ad.start_date <= today,
        Ad.end_date >= today,
    ]
    if ad_type:
        filters.append(Ad.ad_type == ad_type)

    q = await db.execute(
        select(Ad).where(*filters).order_by(Ad.created_at.desc()).limit(limit)
    )
    ads = q.scalars().all()
    return [_ad_out(a) for a in ads]


@router.get("/{ad_id}")
async def get_ad(
    ad_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    q = await db.execute(select(Ad).where(Ad.id == ad_id))
    ad = q.scalar_one_or_none()
    if not ad:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    # IDOR: проверяем принадлежность тенанту
    if current_user.tenant_id and ad.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    return _ad_out(ad)


@router.patch("/{ad_id}")
async def update_ad(
    ad_id: uuid.UUID,
    body: UpdateAdRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    q = await db.execute(select(Ad).where(Ad.id == ad_id))
    ad = q.scalar_one_or_none()
    if not ad:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    if current_user.tenant_id and ad.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Объявление не найдено")

    if body.status is not None:
        ad.status = body.status
    if body.start_date is not None:
        ad.start_date = body.start_date
    if body.end_date is not None:
        ad.end_date = body.end_date

    await db.commit()
    await db.refresh(ad)
    return _ad_out(ad)


@router.post("/{ad_id}/event", status_code=201)
async def record_ad_event(
    ad_id: uuid.UUID,
    body: AdEventRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Зарегистрировать событие рекламы (impression/click/conversion)."""
    q = await db.execute(select(Ad).where(Ad.id == ad_id, Ad.status == AdStatus.ACTIVE))
    ad = q.scalar_one_or_none()
    if not ad:
        raise HTTPException(status_code=404, detail="Объявление не найдено или неактивно")

    ip = get_client_ip(request)
    user_id = uuid.UUID(body.user_id) if body.user_id else None

    event = await billing_service.record_ad_event(
        db,
        ad_id=ad_id,
        tenant_id=ad.tenant_id,
        event_type=body.event_type,
        user_id=user_id,
        ip=ip,
        meta=body.meta,
    )
    await db.commit()
    return {
        "ok": True,
        "event_id": str(event.id),
        "event_type": event.event_type,
    }
