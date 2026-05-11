"""
Глава 8 — Эндпоинты программы лояльности для пациента.

Все требуют:
  • patient_session_token;
  • активный модуль loyalty_pro у тенанта (иначе 402).
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from pydantic import BaseModel
from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.loyalty_ext import LoyaltyAccountExt, LoyaltyEvent, LoyaltyClaim
from app.models.loyalty import LoyaltyReward
from app.models.patient_session import PatientSession
from app.services import loyalty_ext_service as ls
from app.services import family_service as fs
from app.services.patient_session_service import restore_session


router = APIRouter(prefix="/patient/loyalty", tags=["patient-loyalty"])


# ── Helpers ────────────────────────────────────────────────────────────────
async def _get_session(
    db: AsyncSession,
    request: Request,
    authorization: Optional[str],
    x_patient_session: Optional[str],
    session_token: Optional[str],
) -> PatientSession:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
    token = token or x_patient_session or session_token or request.cookies.get("clinika_patient_session")
    if not token:
        raise HTTPException(401, "Patient session required")
    sess = await restore_session(db, token)
    if not sess:
        raise HTTPException(401, "Session invalid or expired")
    return sess


async def _require_module_and_account(
    db: AsyncSession, sess: PatientSession,
) -> tuple[uuid.UUID, LoyaltyAccountExt]:
    if not sess.tenant_id:
        raise HTTPException(404, "No tenant context")
    if not await ls.is_module_active(db, sess.tenant_id):
        raise HTTPException(402, "Модуль loyalty_pro не подключён")
    pa = await fs.get_account_by_phone(db, sess.phone)
    if not pa:
        pa, _ = await fs.get_or_create_account_by_phone(db, sess.phone)
        await db.commit()
    acc = await ls.get_or_create_account(db, sess.tenant_id, pa)
    await db.commit()
    return sess.tenant_id, acc


# ── Schemas ────────────────────────────────────────────────────────────────
class ClaimIn(BaseModel):
    reward_id: uuid.UUID


# ── Endpoints ─────────────────────────────────────────────────────────────
@router.get("/account")
async def get_account(
    request: Request,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
):
    sess = await _get_session(db, request, authorization, x_patient_session, session_token)
    _, acc = await _require_module_and_account(db, sess)
    nxt_name, nxt_pts = ls.next_tier_threshold(acc.points)
    return {
        "points": acc.points,
        "tier": acc.tier,
        "next_tier": nxt_name,
        "next_tier_at": nxt_pts,
        "total_spent": float(acc.total_spent or 0),
        "joined_at": acc.joined_at.isoformat(),
        "last_activity_at": acc.last_activity_at.isoformat() if acc.last_activity_at else None,
    }


@router.get("/transactions")
async def get_transactions(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
):
    sess = await _get_session(db, request, authorization, x_patient_session, session_token)
    _, acc = await _require_module_and_account(db, sess)

    r = await db.execute(
        select(LoyaltyEvent)
        .where(LoyaltyEvent.account_id == acc.id)
        .order_by(desc(LoyaltyEvent.created_at))
        .limit(limit)
    )
    rows = r.scalars().all()
    return {
        "items": [
            {
                "id": str(e.id),
                "delta": e.delta,
                "reason": e.reason,
                "note": e.note,
                "appointment_id": str(e.appointment_id) if e.appointment_id else None,
                "referral_id": str(e.referral_id) if e.referral_id else None,
                "created_at": e.created_at.isoformat(),
            }
            for e in rows
        ],
        "total": len(rows),
    }


@router.get("/rewards")
async def get_rewards(
    request: Request,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
):
    """Каталог доступных наград (фильтр по тиру и stock)."""
    sess = await _get_session(db, request, authorization, x_patient_session, session_token)
    tenant_id, acc = await _require_module_and_account(db, sess)

    r = await db.execute(
        select(LoyaltyReward).where(
            and_(
                LoyaltyReward.tenant_id == tenant_id,
                LoyaltyReward.is_active.is_(True),
            )
        ).order_by(LoyaltyReward.sort_order.asc(), LoyaltyReward.cost_points.asc())
    )
    items = []
    for rw in r.scalars().all():
        ok, err = await ls.can_claim(rw, acc)
        # Показываем все награды, но помечаем доступность
        items.append({
            "id": str(rw.id),
            "name": rw.name,
            "description": rw.description,
            "reward_type": rw.reward_type,
            "cost_points": rw.cost_points,
            "discount_percent": float(rw.discount_percent) if rw.discount_percent is not None else None,
            "service_ref": rw.service_ref,
            "icon": rw.icon,
            "min_tier": getattr(rw, "min_tier", "bronze") or "bronze",
            "stock": getattr(rw, "stock", None),
            "available": ok,
            "unavailable_reason": err,
        })
    return {"items": items}


@router.post("/claim", status_code=201)
async def claim_reward(
    request: Request,
    body: ClaimIn,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
):
    sess = await _get_session(db, request, authorization, x_patient_session, session_token)
    tenant_id, acc = await _require_module_and_account(db, sess)

    rw = await db.get(LoyaltyReward, body.reward_id)
    if not rw or rw.tenant_id != tenant_id:
        raise HTTPException(404, "Reward not found")

    ok, err = await ls.can_claim(rw, acc)
    if not ok:
        raise HTTPException(409, err or "Cannot claim")

    claim = await ls.create_claim(db, acc, rw)
    await db.commit()
    return {
        "claim_id": str(claim.id),
        "status": claim.status,
        "points_spent": claim.points_spent,
        "points_balance": acc.points,
        "tier": acc.tier,
    }
