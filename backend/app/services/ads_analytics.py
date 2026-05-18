"""Реклама — сервис аналитики (Phase A).

Чистые функции, не привязанные к FastAPI:
  - funnel_for_ad  — воронка показ -> клик -> конверсия + revenue/cpa/roas
  - heatmap_for_ad — тепловая карта событий по дням недели и часам
  - forecast_for_ad — прогноз исчерпания бюджета / календаря
"""
import uuid
from datetime import datetime, date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import select, func, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.advertising import Ad, AdEvent, AdEventType, PricingModel


def _f(v) -> float:
    """Безопасная конвертация Decimal/None -> float."""
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


async def funnel_for_ad(db: AsyncSession, ad: Ad) -> dict:
    """Воронка показ -> клик -> конверсия по денормализованным счётчикам Ad."""
    imps = int(ad.impressions_count or 0)
    clks = int(ad.clicks_count or 0)
    convs = int(ad.conversions_count or 0)
    revenue = _f(ad.revenue_attributed)
    spent = _f(ad.spent_total)

    def _rate(curr: int, prev: int) -> Optional[float]:
        if prev <= 0:
            return None
        return round(curr * 100.0 / prev, 2)

    stages = [
        {"key": "impressions", "label": "Показы",    "value": imps,  "rate_from_prev": None},
        {"key": "clicks",      "label": "Клики",     "value": clks,  "rate_from_prev": _rate(clks, imps)},
        {"key": "conversions", "label": "Конверсии", "value": convs, "rate_from_prev": _rate(convs, clks)},
    ]

    cpa = round(spent / convs, 2) if convs > 0 and spent > 0 else None
    roas = round(revenue / spent, 3) if spent > 0 else None

    return {
        "stages": stages,
        "revenue": revenue,
        "spent": spent,
        "cpa": cpa,
        "roas": roas,
    }


async def heatmap_for_ad(
    db: AsyncSession,
    ad_id: uuid.UUID,
    event_type: str = "click",
    days: int = 30,
) -> list[dict]:
    """Тепловая карта: dow x hour за N дней. Postgres dow 0=вс..6=сб -> 0=пн..6=вс."""
    if days <= 0:
        days = 30
    if days > 365:
        days = 365
    since = datetime.utcnow() - timedelta(days=days)

    dow = extract("dow", AdEvent.created_at)
    hour = extract("hour", AdEvent.created_at)

    stmt = (
        select(dow.label("dow"), hour.label("hour"), func.count().label("cnt"))
        .where(
            AdEvent.ad_id == ad_id,
            AdEvent.event_type == event_type,
            AdEvent.created_at >= since,
        )
        .group_by(dow, hour)
    )
    rows = (await db.execute(stmt)).all()

    cells = []
    for r in rows:
        d_raw = int(r.dow) if r.dow is not None else 0
        h = int(r.hour) if r.hour is not None else 0
        d_norm = (d_raw + 6) % 7
        cells.append({"day": d_norm, "hour": h, "count": int(r.cnt)})
    return cells


async def forecast_for_ad(db: AsyncSession, ad: Ad) -> dict:
    """Прогноз: avg imp/clk за 7 дней -> spend/day -> days_left_budget vs calendar."""
    since = datetime.utcnow() - timedelta(days=7)

    stmt = select(
        AdEvent.event_type,
        func.count().label("cnt"),
    ).where(
        AdEvent.ad_id == ad.id,
        AdEvent.created_at >= since,
    ).group_by(AdEvent.event_type)
    rows = (await db.execute(stmt)).all()

    by_type = {r.event_type: int(r.cnt) for r in rows}
    imp_per_day = by_type.get(AdEventType.IMPRESSION, 0) / 7.0
    clk_per_day = by_type.get(AdEventType.CLICK, 0) / 7.0

    price = _f(ad.price)
    pm = ad.pricing_model or PricingModel.FLAT

    if pm == PricingModel.CPC:
        spend_per_day: Optional[float] = round(price * clk_per_day, 2)
    elif pm == PricingModel.CPM:
        spend_per_day = round(price * imp_per_day / 1000.0, 2)
    else:
        spend_per_day = None

    budget_total = _f(ad.budget_total) if ad.budget_total is not None else None
    spent_total = _f(ad.spent_total)
    budget_left = (budget_total - spent_total) if budget_total is not None else None

    days_left_budget: Optional[float] = None
    if spend_per_day and spend_per_day > 0 and budget_left is not None:
        days_left_budget = round(budget_left / spend_per_day, 1)

    today = date.today()
    days_left_calendar: Optional[int] = None
    if ad.end_date:
        days_left_calendar = max(0, (ad.end_date - today).days)

    verdict = "ok"
    if imp_per_day == 0 and clk_per_day == 0:
        verdict = "no_data"
    elif days_left_budget is not None and days_left_calendar is not None and days_left_calendar > 0:
        if days_left_budget < days_left_calendar * 0.5:
            verdict = "budget_exhausting"
        elif days_left_budget > days_left_calendar * 2:
            verdict = "budget_underspent"

    return {
        "imp_per_day": round(imp_per_day, 2),
        "clk_per_day": round(clk_per_day, 2),
        "spend_per_day": spend_per_day,
        "budget_left": budget_left,
        "days_left_budget": days_left_budget,
        "days_left_calendar": days_left_calendar,
        "verdict": verdict,
        "pricing_model": pm,
    }
