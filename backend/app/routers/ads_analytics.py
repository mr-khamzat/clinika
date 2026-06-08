"""Реклама — расширенная аналитика (Phase A).

Отдельный router, чтобы не пересекаться с базовым routers/ads.py.
Подключается в main.py через app.include_router(...prefix="/api/ads"...).
"""
import uuid
from datetime import datetime, timedelta, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, cast, Date as SADate
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.advertising import Ad, AdEvent, AdEventType
from app.models.referral import Referral
from app.models.user import User
from app.routers.ads import _mod
from app.core.deps import require_manager, get_tenant_db
from app.services.ads_analytics import funnel_for_ad, heatmap_for_ad, forecast_for_ad

router = APIRouter(prefix="/ads", tags=["ads-analytics"])


async def _get_ad_or_404(db: AsyncSession, ad_id: uuid.UUID, tenant_id: Optional[uuid.UUID]) -> Ad:
    """Загружает Ad с проверкой принадлежности тенанту. 404 если нет/чужой."""
    ad = (await db.execute(select(Ad).where(Ad.id == ad_id))).scalar_one_or_none()
    if not ad:
        raise HTTPException(404, "ad not found")
    if tenant_id is not None and ad.tenant_id != tenant_id:
        raise HTTPException(404, "ad not found")
    return ad


@router.get("/compare", dependencies=[_mod])
async def compare_ads(
    ids: str = Query(..., description="Список ad_id через запятую (до 8)"),
    metric: str = Query("clicks"),
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    if metric not in ("clicks", "impressions", "conversions", "revenue"):
        raise HTTPException(400, "invalid metric")
    raw_ids = [s.strip() for s in (ids or "").split(",") if s.strip()]
    if not raw_ids:
        raise HTTPException(400, "ids is required")
    if len(raw_ids) > 8:
        raise HTTPException(400, "max 8 ads to compare")
    try:
        ad_uuids = [uuid.UUID(s) for s in raw_ids]
    except ValueError:
        raise HTTPException(400, "invalid uuid in ids")
    where = [Ad.id.in_(ad_uuids)]
    if current_user.tenant_id is not None:
        where.append(Ad.tenant_id == current_user.tenant_id)
    ads = (await db.execute(select(Ad).where(*where))).scalars().all()
    if len(ads) != len(ad_uuids):
        raise HTTPException(404, "one or more ads not found")
    ad_by_id = {a.id: a for a in ads}
    since = datetime.utcnow() - timedelta(days=days)
    day_col = cast(AdEvent.created_at, SADate).label("d")
    if metric == "revenue":
        agg_col = func.coalesce(func.sum(AdEvent.revenue), 0).label("v")
        type_filter = AdEvent.event_type == AdEventType.CONVERSION
    else:
        type_map = {"clicks": AdEventType.CLICK, "impressions": AdEventType.IMPRESSION, "conversions": AdEventType.CONVERSION}
        agg_col = func.count().label("v")
        type_filter = AdEvent.event_type == type_map[metric]
    stmt = (
        select(AdEvent.ad_id, day_col, agg_col)
        .where(AdEvent.ad_id.in_(ad_uuids), type_filter, AdEvent.created_at >= since)
        .group_by(AdEvent.ad_id, day_col)
        .order_by(AdEvent.ad_id, day_col)
    )
    rows = (await db.execute(stmt)).all()
    series: dict[str, dict] = {}
    for aid in ad_uuids:
        ad = ad_by_id.get(aid)
        series[str(aid)] = {"title": ad.title if ad else None, "points": []}
    for r in rows:
        key = str(r.ad_id)
        val = float(r.v) if metric == "revenue" else int(r.v)
        series[key]["points"].append({"date": r.d.isoformat() if r.d else None, "value": val})
    return {"metric": metric, "days": days, "series": series}


@router.get("/{ad_id}/funnel", dependencies=[_mod])
async def ad_funnel(
    ad_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    ad = await _get_ad_or_404(db, ad_id, current_user.tenant_id)
    return await funnel_for_ad(db, ad)


@router.get("/{ad_id}/heatmap", dependencies=[_mod])
async def ad_heatmap(
    ad_id: uuid.UUID,
    event_type: str = Query("click"),
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    if event_type not in ("impression", "click", "conversion", "schedule_book"):
        raise HTTPException(400, "invalid event_type")
    ad = await _get_ad_or_404(db, ad_id, current_user.tenant_id)
    cells = await heatmap_for_ad(db, ad.id, event_type=event_type, days=days)
    return {"event_type": event_type, "days": days, "cells": cells}


@router.get("/{ad_id}/forecast", dependencies=[_mod])
async def ad_forecast(
    ad_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    ad = await _get_ad_or_404(db, ad_id, current_user.tenant_id)
    return await forecast_for_ad(db, ad)


@router.get("/{ad_id}/conversions", dependencies=[_mod])
async def ad_conversions(
    ad_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=500),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Последние конверсии по объявлению с временем до конверсии и данными пациента."""
    ad = await _get_ad_or_404(db, ad_id, current_user.tenant_id)
    stmt = (
        select(AdEvent, Referral)
        .outerjoin(Referral, Referral.id == AdEvent.referral_id)
        .where(AdEvent.ad_id == ad.id, AdEvent.event_type == AdEventType.CONVERSION)
        .order_by(AdEvent.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    items = []
    for ev, ref in rows:
        days_to_convert: Optional[float] = None
        if ev.ip_hash:
            first_click = (await db.execute(
                select(AdEvent.created_at)
                .where(
                    AdEvent.ad_id == ad.id,
                    AdEvent.event_type == AdEventType.CLICK,
                    AdEvent.ip_hash == ev.ip_hash,
                    AdEvent.created_at <= ev.created_at,
                )
                .order_by(AdEvent.created_at.asc())
                .limit(1)
            )).scalar_one_or_none()
            if first_click:
                days_to_convert = round((ev.created_at - first_click).total_seconds() / 86400.0, 3)
        patient = None
        service = None
        if ref is not None:
            patient = getattr(ref, "patient_name", None) or getattr(ref, "patient_phone", None)
            svc = getattr(ref, "service", None)
            service = getattr(svc, "name", None) if svc is not None else None
        items.append({
            "event_id": str(ev.id),
            "created_at": ev.created_at.isoformat() if ev.created_at else None,
            "revenue": float(ev.revenue or 0),
            "days_to_convert": days_to_convert,
            "patient": patient,
            "service": service,
        })
    return {"items": items, "count": len(items)}
