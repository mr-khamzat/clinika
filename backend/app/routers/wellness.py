"""
Глава 10 — Wellness партнёрки.

Patient endpoints:
  GET  /patient/wellness/partners              — список по тарифу
  POST /patient/wellness/partners/{id}/click   — запись клика

Admin (super_admin) endpoints:
  GET    /admin/wellness/partners              — список всех (включая выключенные)
  POST   /admin/wellness/partners              — создать
  PATCH  /admin/wellness/partners/{id}         — изменить
  DELETE /admin/wellness/partners/{id}         — удалить
  GET    /admin/wellness/analytics             — аналитика
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.user import User, UserRole
from app.models.patient_account import PatientAccount
from app.models.patient_session import PatientSession
from app.models.subscription import PatientSubscription
from app.models.wellness import WellnessPartner, WellnessPartnerClick
from app.services import wellness_service
from app.services import family_service as fs
from app.services.patient_session_service import restore_session


router = APIRouter(tags=["wellness"])

_REQUIRE_ADMIN = Depends(require_role(
    UserRole.MANAGER, UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN,
))


# ── Auth helpers ─────────────────────────────────────────────────────────
async def _get_session(
    db: AsyncSession,
    request: Request,
    authorization: Optional[str] = None,
    x_patient_session: Optional[str] = None,
    session_token: Optional[str] = None,
) -> PatientSession:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
    token = token or x_patient_session or session_token
    if not token:
        token = request.cookies.get("clinika_patient_session")
    if not token:
        raise HTTPException(401, "Patient session required")
    sess = await restore_session(db, token)
    if not sess:
        raise HTTPException(401, "Session invalid or expired")
    return sess


async def _account(db: AsyncSession, sess: PatientSession) -> PatientAccount:
    acc = await fs.get_account_by_phone(db, sess.phone)
    if not acc:
        acc, _ = await fs.get_or_create_account_by_phone(db, sess.phone)
        await db.commit()
    return acc


async def _patient_plan(db: AsyncSession, patient_id: uuid.UUID) -> str | None:
    q = select(PatientSubscription).where(
        PatientSubscription.patient_id == patient_id,
        PatientSubscription.status.in_(("active", "trial")),
    ).order_by(PatientSubscription.created_at.desc()).limit(1)
    sub = (await db.execute(q)).scalar_one_or_none()
    return sub.plan if sub else None


# ── Schemas ──────────────────────────────────────────────────────────────
class PartnerIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=40)
    description: Optional[str] = None
    logo_url: Optional[str] = None
    discount_text: str = ""
    promo_code: str = ""
    link_url: str = ""
    min_subscription_plan: str = "health_plus"
    active: bool = True
    sort_order: int = 0


class PartnerPatch(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    discount_text: Optional[str] = None
    promo_code: Optional[str] = None
    link_url: Optional[str] = None
    min_subscription_plan: Optional[str] = None
    active: Optional[bool] = None
    sort_order: Optional[int] = None


def _serialize(p: WellnessPartner, *, include_admin: bool = False) -> dict:
    base = {
        "id": str(p.id),
        "name": p.name,
        "category": p.category,
        "description": p.description,
        "logo_url": p.logo_url,
        "discount_text": p.discount_text,
        "min_subscription_plan": p.min_subscription_plan,
        "sort_order": p.sort_order,
    }
    if include_admin:
        base["promo_code"] = p.promo_code
        base["link_url"] = p.link_url
        base["active"] = p.active
        base["created_at"] = p.created_at.isoformat() if p.created_at else None
    return base


# ── Patient endpoints ─────────────────────────────────────────────────────
@router.get("/patient/wellness/partners")
async def list_partners_for_patient(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(
        db, request, authorization, x_patient_session, session_token or t
    )
    acc = await _account(db, sess)
    plan = await _patient_plan(db, acc.id)
    if not plan:
        return {"items": [], "plan": None, "message": "Подписка не активна"}
    partners = await wellness_service.list_partners_for_plan(db, plan)
    return {
        "items": [_serialize(p) for p in partners],
        "plan": plan,
        "total": len(partners),
    }


@router.post("/patient/wellness/partners/{partner_id}/click")
async def click_partner(
    partner_id: uuid.UUID,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(
        db, request, authorization, x_patient_session, session_token or t
    )
    acc = await _account(db, sess)
    plan = await _patient_plan(db, acc.id)

    partner = (await db.execute(
        select(WellnessPartner).where(WellnessPartner.id == partner_id)
    )).scalar_one_or_none()
    if not partner or not partner.active:
        raise HTTPException(404, "Partner not found or inactive")
    if not wellness_service.plan_allows(plan, partner.min_subscription_plan):
        raise HTTPException(403, "Этот партнёр недоступен на вашем тарифе")

    await wellness_service.record_click(db, partner_id, acc.id)
    await db.commit()
    return {
        "ok": True,
        "link_url": partner.link_url,
        "promo_code": partner.promo_code,
    }


# ── Admin endpoints ──────────────────────────────────────────────────────
@router.get("/admin/wellness/partners")
async def admin_list_partners(
    db: AsyncSession = Depends(get_db),
    _: User = _REQUIRE_ADMIN,
    current_user: User = Depends(get_current_user),
    only_active: bool = Query(False),
):
    q = select(WellnessPartner).order_by(
        WellnessPartner.sort_order.asc(), WellnessPartner.name.asc()
    )
    if only_active:
        q = q.where(WellnessPartner.active == True)  # noqa: E712
    rows = (await db.execute(q)).scalars().all()
    return {"items": [_serialize(p, include_admin=True) for p in rows]}


@router.post("/admin/wellness/partners", status_code=201)
async def admin_create_partner(
    payload: PartnerIn,
    db: AsyncSession = Depends(get_db),
    _: User = _REQUIRE_ADMIN,
):
    p = WellnessPartner(
        name=payload.name.strip(),
        category=payload.category,
        description=payload.description,
        logo_url=payload.logo_url,
        discount_text=payload.discount_text or "",
        promo_code=payload.promo_code or "",
        link_url=payload.link_url or "",
        min_subscription_plan=payload.min_subscription_plan or "health_plus",
        active=payload.active,
        sort_order=payload.sort_order or 0,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _serialize(p, include_admin=True)


@router.patch("/admin/wellness/partners/{partner_id}")
async def admin_update_partner(
    partner_id: uuid.UUID,
    payload: PartnerPatch,
    db: AsyncSession = Depends(get_db),
    _: User = _REQUIRE_ADMIN,
):
    p = (await db.execute(
        select(WellnessPartner).where(WellnessPartner.id == partner_id)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Partner not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    await db.commit()
    await db.refresh(p)
    return _serialize(p, include_admin=True)


@router.delete("/admin/wellness/partners/{partner_id}", status_code=204)
async def admin_delete_partner(
    partner_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = _REQUIRE_ADMIN,
):
    p = (await db.execute(
        select(WellnessPartner).where(WellnessPartner.id == partner_id)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Partner not found")
    await db.delete(p)
    await db.commit()
    return None


@router.get("/admin/wellness/analytics")
async def admin_wellness_analytics(
    partner_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = _REQUIRE_ADMIN,
):
    return await wellness_service.get_partner_analytics(db, partner_id)
