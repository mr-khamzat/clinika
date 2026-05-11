"""
Wellness-сервис: список партнёров по тарифу пациента, запись клика.
"""
import uuid
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from app.models.wellness import WellnessPartner, WellnessPartnerClick


PLAN_RANK = {"health_plus": 1, "family_plus": 2, "pro": 3}


def plan_allows(user_plan: str | None, partner_min_plan: str) -> bool:
    """Тариф user_plan ≥ partner_min_plan?"""
    if not user_plan:
        return False
    return PLAN_RANK.get(user_plan, 0) >= PLAN_RANK.get(partner_min_plan, 99)


async def list_partners_for_plan(db: AsyncSession, plan: str | None) -> list[WellnessPartner]:
    q = select(WellnessPartner).where(WellnessPartner.active == True).order_by(  # noqa: E712
        WellnessPartner.sort_order.asc(), WellnessPartner.name.asc()
    )
    rows = (await db.execute(q)).scalars().all()
    if not plan:
        return []
    return [p for p in rows if plan_allows(plan, p.min_subscription_plan)]


async def record_click(
    db: AsyncSession, partner_id: uuid.UUID, patient_id: uuid.UUID
) -> WellnessPartnerClick:
    click = WellnessPartnerClick(partner_id=partner_id, patient_id=patient_id)
    db.add(click)
    await db.flush()
    return click


async def get_partner_analytics(db: AsyncSession, partner_id: uuid.UUID | None = None) -> dict:
    """Подсчёт кликов: всего, за 30 дней, за 7 дней, конверсия (заглушка)."""
    now = datetime.utcnow()
    d30 = now - timedelta(days=30)
    d7 = now - timedelta(days=7)

    q = select(
        WellnessPartnerClick.partner_id.label("partner_id"),
        func.count(WellnessPartnerClick.id).label("total"),
        func.sum(
            case((WellnessPartnerClick.clicked_at >= d30, 1), else_=0)
        ).label("last_30d"),
        func.sum(
            case((WellnessPartnerClick.clicked_at >= d7, 1), else_=0)
        ).label("last_7d"),
    ).group_by(WellnessPartnerClick.partner_id)

    if partner_id:
        q = q.where(WellnessPartnerClick.partner_id == partner_id)

    rows = (await db.execute(q)).all()

    return {
        "items": [
            {
                "partner_id": str(r.partner_id),
                "total": int(r.total or 0),
                "last_30d": int(r.last_30d or 0),
                "last_7d": int(r.last_7d or 0),
            }
            for r in rows
        ],
        "generated_at": now.isoformat(),
    }
