"""
Реклама — API v3.
Добавлено: stats by day, sort_order, auto-pause, preview link, schedule.
"""
import uuid, hashlib
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func, cast, Date as SADate
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.database import get_db
from app.core.deps import get_current_user, require_manager
from app.core.tenant import require_feature
from app.models.user import User
from app.models.advertising import Ad, AdEvent, AdStatus, AdType, PricingModel
from app.services import billing_service
from app.utils.geo import get_client_ip

router = APIRouter(prefix="/ads", tags=["ads"])

_feat = Depends(require_feature("billing"))
_mgr  = Depends(require_manager)


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
    image_data: Optional[str] = None
    image_mime: Optional[str] = None
    banner_height: Optional[int] = None
    interval_seconds: Optional[int] = Field(5, ge=1, le=60)
    sort_order: Optional[int] = None
    # Расписание: {"hours": [9,10,...,21], "days": [0,1,2,3,4,5,6]}
    schedule: Optional[dict] = None
    # Цветовая схема из пресетов или кастомный градиент
    color_theme: Optional[str] = None


class UpdateAdRequest(BaseModel):
    status: Optional[str] = Field(None, pattern="^(draft|active|paused|completed|cancelled)$")
    title: Optional[str] = None
    body: Optional[str] = None
    link: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    price: Optional[float] = None
    impressions_limit: Optional[int] = None
    clicks_limit: Optional[int] = None
    image_data: Optional[str] = None
    image_mime: Optional[str] = None
    banner_height: Optional[int] = None
    interval_seconds: Optional[int] = Field(None, ge=1, le=60)
    sort_order: Optional[int] = None
    schedule: Optional[dict] = None
    color_theme: Optional[str] = None


class AdEventRequest(BaseModel):
    event_type: str = Field(..., pattern="^(impression|click|conversion)$")
    user_id: Optional[str] = None
    meta: Optional[dict] = None


def _ad_out(ad: Ad) -> dict:
    m = ad.meta or {}
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
        "image_data": m.get("image_data"),
        "image_mime": m.get("image_mime", "image/png"),
        "banner_height": m.get("banner_height", 80),
        "interval_seconds": m.get("interval_seconds", 5),
        "sort_order": m.get("sort_order", 0),
        "schedule": m.get("schedule"),
        "color_theme": m.get("color_theme"),
        "created_at": ad.created_at.isoformat() if ad.created_at else None,
    }


def _apply_meta_update(ad: Ad, fields: dict):
    """Обновляет meta-поля безопасно (не перетирает существующие)."""
    meta = dict(ad.meta or {})
    for k, v in fields.items():
        if v is not None:
            meta[k] = v
    ad.meta = meta


@router.get("")
async def list_ads(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    filters = []
    if current_user.tenant_id:
        filters.append(Ad.tenant_id == current_user.tenant_id)
    if status:
        filters.append(Ad.status == status)
    q = await db.execute(
        select(Ad).where(*filters).order_by(Ad.created_at.desc()).limit(limit)
    )
    ads = q.scalars().all()
    # Сортируем по sort_order если есть
    ads_out = [_ad_out(a) for a in ads]
    ads_out.sort(key=lambda x: x.get("sort_order") or 999)
    return ads_out


@router.post("", status_code=201)
async def create_ad(
    body: CreateAdRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Тенант не определён")
    ad = await billing_service.create_ad(
        db,
        tenant_id=current_user.tenant_id,
        title=body.title, body=body.body, image_url=body.image_url, link=body.link,
        ad_type=body.ad_type, pricing_model=body.pricing_model,
        start_date=body.start_date, end_date=body.end_date,
        price=Decimal(str(body.price)),
        impressions_limit=body.impressions_limit, clicks_limit=body.clicks_limit,
    )
    ad.meta = {
        "image_data": body.image_data,
        "image_mime": body.image_mime or "image/png",
        "banner_height": body.banner_height or 80,
        "interval_seconds": body.interval_seconds or 5,
        "sort_order": body.sort_order or 0,
        "schedule": body.schedule,
        "color_theme": body.color_theme,
    }
    await db.commit()
    await db.refresh(ad)
    return _ad_out(ad)


@router.get("/active")
async def list_active_ads(
    db: AsyncSession = Depends(get_db),
    ad_type: Optional[str] = Query(None),
    slug: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=50),
):
    today = date.today()
    now_hour = datetime.now().hour
    now_weekday = datetime.now().weekday()  # 0=пн, 6=вс

    filters = [
        Ad.status == AdStatus.ACTIVE,
        Ad.start_date <= today,
        Ad.end_date >= today,
    ]
    if ad_type:
        filters.append(Ad.ad_type == ad_type)

    from app.models.tenant import Tenant
    stmt = select(Ad)
    if slug:
        stmt = stmt.join(Tenant, Ad.tenant_id == Tenant.id).where(Tenant.slug == slug)
    stmt = stmt.where(*filters).order_by(Ad.created_at.asc()).limit(limit)
    q = await db.execute(stmt)
    ads = q.scalars().all()

    # Фильтруем по расписанию
    result = []
    for ad in ads:
        m = ad.meta or {}
        schedule = m.get("schedule")
        if schedule:
            hours = schedule.get("hours")
            days  = schedule.get("days")
            if hours and now_hour not in hours:
                continue
            if days and now_weekday not in days:
                continue
        result.append(ad)

    out = [_ad_out(a) for a in result]
    out.sort(key=lambda x: x.get("sort_order") or 999)
    return out


@router.get("/{ad_id}/stats")
async def get_ad_stats(
    ad_id: uuid.UUID,
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Статистика по дням: показы / клики / конверсии."""
    q = await db.execute(select(Ad).where(Ad.id == ad_id))
    ad = q.scalar_one_or_none()
    if not ad or (current_user.tenant_id and ad.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404)

    since = datetime.utcnow() - timedelta(days=days)

    # Агрегируем события по дате
    rows = await db.execute(
        select(
            cast(AdEvent.created_at, SADate).label("day"),
            AdEvent.event_type,
            func.count().label("cnt"),
        )
        .where(AdEvent.ad_id == ad_id, AdEvent.created_at >= since)
        .group_by(cast(AdEvent.created_at, SADate), AdEvent.event_type)
        .order_by(cast(AdEvent.created_at, SADate))
    )
    rows = rows.all()

    # Собираем в dict day → {impression, click, conversion}
    by_day: dict = {}
    for row in rows:
        d = row.day.isoformat()
        if d not in by_day:
            by_day[d] = {"date": d, "impressions": 0, "clicks": 0, "conversions": 0}
        if row.event_type == "impression":
            by_day[d]["impressions"] = row.cnt
        elif row.event_type == "click":
            by_day[d]["clicks"] = row.cnt
        elif row.event_type == "conversion":
            by_day[d]["conversions"] = row.cnt

    # Заполняем пропущенные дни нулями
    result = []
    for i in range(days):
        d = (datetime.utcnow() - timedelta(days=days - 1 - i)).date().isoformat()
        result.append(by_day.get(d, {"date": d, "impressions": 0, "clicks": 0, "conversions": 0}))

    return {
        "ad": _ad_out(ad),
        "days": days,
        "series": result,
        "totals": {
            "impressions": ad.impressions_count,
            "clicks": ad.clicks_count,
            "conversions": ad.conversions_count,
            "ctr": round(ad.clicks_count / ad.impressions_count * 100, 2) if ad.impressions_count else 0,
        },
    }


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
    if current_user.tenant_id and ad.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    return _ad_out(ad)

@router.patch("/reorder", status_code=200)
async def reorder_ads(
    body: list[dict],  # [{"id": "...", "sort_order": 0}, ...]
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Обновить порядок показа баннеров в карусели."""
    for item in body:
        q = await db.execute(select(Ad).where(Ad.id == uuid.UUID(item["id"])))
        ad = q.scalar_one_or_none()
        if ad and (not current_user.tenant_id or ad.tenant_id == current_user.tenant_id):
            _apply_meta_update(ad, {"sort_order": item["sort_order"]})
    await db.commit()
    return {"ok": True}


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

    if body.status is not None:   ad.status = body.status
    if body.title is not None:    ad.title = body.title
    if body.body is not None:     ad.body = body.body
    if body.link is not None:     ad.link = body.link
    if body.start_date is not None: ad.start_date = body.start_date
    if body.end_date is not None:   ad.end_date = body.end_date
    if body.price is not None:    ad.price = Decimal(str(body.price))
    if body.impressions_limit is not None: ad.impressions_limit = body.impressions_limit
    if body.clicks_limit is not None:      ad.clicks_limit = body.clicks_limit

    _apply_meta_update(ad, {
        "image_data": body.image_data,
        "image_mime": body.image_mime,
        "banner_height": body.banner_height,
        "interval_seconds": body.interval_seconds,
        "sort_order": body.sort_order,
        "schedule": body.schedule,
        "color_theme": body.color_theme,
    })

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
    q = await db.execute(select(Ad).where(Ad.id == ad_id, Ad.status == AdStatus.ACTIVE))
    ad = q.scalar_one_or_none()
    if not ad:
        raise HTTPException(status_code=404, detail="Объявление не найдено или неактивно")

    ip = get_client_ip(request)
    user_id = uuid.UUID(body.user_id) if body.user_id else None

    event = await billing_service.record_ad_event(
        db, ad_id=ad_id, tenant_id=ad.tenant_id,
        event_type=body.event_type, user_id=user_id, ip=ip, meta=body.meta,
    )

    # Авто-пауза при исчерпании лимитов
    await db.refresh(ad)
    if (ad.impressions_limit and ad.impressions_count >= ad.impressions_limit) or \
       (ad.clicks_limit and ad.clicks_count >= ad.clicks_limit):
        ad.status = AdStatus.PAUSED

    await db.commit()
    return {"ok": True, "event_id": str(event.id), "event_type": event.event_type}


@router.post("/{ad_id}/duplicate", status_code=201)
async def duplicate_ad(
    ad_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Дублировать объявление (создаёт копию в статусе draft)."""
    q = await db.execute(select(Ad).where(Ad.id == ad_id))
    src = q.scalar_one_or_none()
    if not src or (current_user.tenant_id and src.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404)

    copy = Ad(
        tenant_id=src.tenant_id,
        title=src.title + " (копия)",
        body=src.body, image_url=src.image_url, link=src.link,
        ad_type=src.ad_type, status=AdStatus.DRAFT,
        pricing_model=src.pricing_model,
        start_date=date.today(),
        end_date=date.today() + timedelta(days=7),
        price=src.price,
        impressions_limit=src.impressions_limit,
        clicks_limit=src.clicks_limit,
        meta=dict(src.meta or {}),
    )
    db.add(copy)
    await db.commit()
    await db.refresh(copy)
    return _ad_out(copy)

