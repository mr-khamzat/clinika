"""
Глава 10 — Admin endpoints для партнёрской программы агрегаторам.

Менеджер/владелец франшизы управляют партнёрствами с DocDoc/ProDoctorov/...,
обрабатывают входящие лиды, видят статистику.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user, get_tenant_db, require_role
from app.models.user import User, UserRole
from app.models.aggregator import AggregatorPartnership, AggregatorLead
from app.services import aggregator_service


router = APIRouter(prefix="/admin/aggregator", tags=["admin-aggregator"])

_REQUIRE_MANAGER = Depends(require_role(
    UserRole.MANAGER, UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN,
))


# ── Schemas ─────────────────────────────────────────────────────────────
class PartnershipIn(BaseModel):
    partner_name: str = Field(min_length=1, max_length=80)
    commission_pct: Decimal = Field(default=Decimal("0.00"), ge=0, le=100)


class PartnershipPatch(BaseModel):
    commission_pct: Optional[Decimal] = Field(default=None, ge=0, le=100)
    status: Optional[str] = None  # active | suspended | terminated


class LeadStatusPatch(BaseModel):
    status: str = Field(..., max_length=20)
    appointment_id: Optional[uuid.UUID] = None
    commission_amount: Optional[Decimal] = Field(default=None, ge=0)


def _serialize_partnership(p: AggregatorPartnership, *, plaintext_key: str | None = None) -> dict:
    out = {
        "id": str(p.id),
        "tenant_id": str(p.tenant_id),
        "partner_name": p.partner_name,
        "key_prefix": p.key_prefix,
        "commission_pct": float(p.commission_pct) if p.commission_pct else 0.0,
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }
    if plaintext_key:
        out["api_key_plaintext"] = plaintext_key
        out["api_key_warning"] = "Сохраните ключ — он показывается ОДИН раз!"
    return out


def _serialize_lead(l: AggregatorLead) -> dict:
    return {
        "id": str(l.id),
        "partnership_id": str(l.partnership_id),
        "patient_phone": l.patient_phone,
        "patient_full_name": l.patient_full_name,
        "clinic_id": str(l.clinic_id) if l.clinic_id else None,
        "service_requested": l.service_requested,
        "desired_date": l.desired_date.isoformat() if l.desired_date else None,
        "status": l.status,
        "commission_amount": float(l.commission_amount) if l.commission_amount else None,
        "appointment_id": str(l.appointment_id) if l.appointment_id else None,
        "created_at": l.created_at.isoformat() if l.created_at else None,
        "updated_at": l.updated_at.isoformat() if l.updated_at else None,
    }


# ── Partnerships CRUD ───────────────────────────────────────────────────
@router.get("/partnerships")
async def list_partnerships(
    _: User = _REQUIRE_MANAGER,
    db: AsyncSession = Depends(get_tenant_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.tenant_id:
        raise HTTPException(403, "User has no tenant")
    rows = (await db.execute(
        select(AggregatorPartnership).where(
            AggregatorPartnership.tenant_id == current_user.tenant_id
        ).order_by(AggregatorPartnership.created_at.desc())
    )).scalars().all()
    return {"items": [_serialize_partnership(p) for p in rows]}


@router.post("/partnerships", status_code=201)
async def create_partnership(
    payload: PartnershipIn,
    _: User = _REQUIRE_MANAGER,
    db: AsyncSession = Depends(get_tenant_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.tenant_id:
        raise HTTPException(403, "User has no tenant")

    plaintext, key_hash, key_display = aggregator_service.generate_api_key()
    p = AggregatorPartnership(
        tenant_id=current_user.tenant_id,
        partner_name=payload.partner_name,
        api_key_hash=key_hash,
        key_prefix=key_display,
        commission_pct=payload.commission_pct,
        status="active",
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _serialize_partnership(p, plaintext_key=plaintext)


@router.patch("/partnerships/{partnership_id}")
async def update_partnership(
    partnership_id: uuid.UUID,
    payload: PartnershipPatch,
    _: User = _REQUIRE_MANAGER,
    db: AsyncSession = Depends(get_tenant_db),
    current_user: User = Depends(get_current_user),
):
    p = (await db.execute(
        select(AggregatorPartnership).where(
            AggregatorPartnership.id == partnership_id
        )
    )).scalar_one_or_none()
    if not p or p.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Partnership not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    await db.commit()
    await db.refresh(p)
    return _serialize_partnership(p)


@router.delete("/partnerships/{partnership_id}", status_code=204)
async def delete_partnership(
    partnership_id: uuid.UUID,
    _: User = _REQUIRE_MANAGER,
    db: AsyncSession = Depends(get_tenant_db),
    current_user: User = Depends(get_current_user),
):
    p = (await db.execute(
        select(AggregatorPartnership).where(
            AggregatorPartnership.id == partnership_id
        )
    )).scalar_one_or_none()
    if not p or p.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Partnership not found")
    await db.delete(p)
    await db.commit()
    return None


# ── Leads ───────────────────────────────────────────────────────────────
@router.get("/leads")
async def list_leads(
    status: Optional[str] = Query(None),
    partner: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    _: User = _REQUIRE_MANAGER,
    db: AsyncSession = Depends(get_tenant_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.tenant_id:
        raise HTTPException(403, "User has no tenant")

    # Получаем partnership_ids тенанта
    partnerships_q = select(AggregatorPartnership.id, AggregatorPartnership.partner_name).where(
        AggregatorPartnership.tenant_id == current_user.tenant_id
    )
    if partner:
        partnerships_q = partnerships_q.where(AggregatorPartnership.partner_name == partner)
    rows = (await db.execute(partnerships_q)).all()
    partnership_ids = [r.id for r in rows]
    if not partnership_ids:
        return {"items": []}

    q = select(AggregatorLead).where(AggregatorLead.partnership_id.in_(partnership_ids))
    if status:
        q = q.where(AggregatorLead.status == status)
    q = q.order_by(AggregatorLead.created_at.desc()).limit(limit)
    leads = (await db.execute(q)).scalars().all()
    return {"items": [_serialize_lead(l) for l in leads]}


@router.patch("/leads/{lead_id}/status")
async def patch_lead_status(
    lead_id: uuid.UUID,
    payload: LeadStatusPatch,
    _: User = _REQUIRE_MANAGER,
    db: AsyncSession = Depends(get_tenant_db),
    current_user: User = Depends(get_current_user),
):
    if payload.status not in {"received", "contacted", "scheduled", "completed", "lost"}:
        raise HTTPException(400, "Invalid status")
    lead = (await db.execute(
        select(AggregatorLead).where(AggregatorLead.id == lead_id)
    )).scalar_one_or_none()
    if not lead:
        raise HTTPException(404, "Lead not found")

    # Проверка тенанта через partnership
    pship = (await db.execute(
        select(AggregatorPartnership).where(AggregatorPartnership.id == lead.partnership_id)
    )).scalar_one_or_none()
    if not pship or pship.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Lead not found")

    await aggregator_service.update_lead_status(
        db, lead, payload.status,
        appointment_id=payload.appointment_id,
        commission_amount=payload.commission_amount,
    )
    await db.commit()
    await db.refresh(lead)
    return _serialize_lead(lead)


@router.get("/stats")
async def aggregator_stats(
    period: str = Query("30d", description="Период: '7d', '30d', '90d'"),
    _: User = _REQUIRE_MANAGER,
    db: AsyncSession = Depends(get_tenant_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.tenant_id:
        raise HTTPException(403, "User has no tenant")
    return await aggregator_service.stats_for_period(
        db, current_user.tenant_id, period
    )
