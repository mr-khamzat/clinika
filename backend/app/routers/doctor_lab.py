"""
Глава 10 — Doctor endpoints для лабораторных заявок.

Доктор создаёт заявку (для своего пациента) → она автоматически отправляется
в лабораторию (фейк-имплементация). Через 30 секунд статус 'in_progress'.
Результаты приходят через webhook.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, AsyncSessionLocal
from app.core.deps import get_current_user, require_role
from app.models.user import User, UserRole
from app.models.lab import LabProvider, LabOrder, LabResult
from app.services import lab_service


router = APIRouter(prefix="/doctor/lab-orders", tags=["doctor-lab"])

_REQUIRE_DOCTOR = Depends(require_role(
    UserRole.DOCTOR, UserRole.LAB_CT, UserRole.LAB_XRAY, UserRole.MANAGER, UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN,
))


# ── Schemas ─────────────────────────────────────────────────────────────
class LabOrderIn(BaseModel):
    patient_id: uuid.UUID
    provider_id: uuid.UUID
    clinic_id: Optional[uuid.UUID] = None
    test_codes: list[str] = Field(default_factory=list)
    notes: Optional[str] = None


def _serialize_order(o: LabOrder, results: list[LabResult] | None = None) -> dict:
    out = {
        "id": str(o.id),
        "tenant_id": str(o.tenant_id),
        "patient_id": str(o.patient_id),
        "clinic_id": str(o.clinic_id) if o.clinic_id else None,
        "doctor_id": str(o.doctor_id) if o.doctor_id else None,
        "provider_id": str(o.provider_id),
        "external_order_id": o.external_order_id,
        "test_codes": o.test_codes or [],
        "status": o.status,
        "notes": o.notes,
        "requested_at": o.requested_at.isoformat() if o.requested_at else None,
        "sent_at": o.sent_at.isoformat() if o.sent_at else None,
        "results_at": o.results_at.isoformat() if o.results_at else None,
        "delivered_at": o.delivered_at.isoformat() if o.delivered_at else None,
        "error_message": o.error_message,
        "results_count": len(results) if results is not None else None,
    }
    if results is not None:
        out["results"] = [_serialize_result(r) for r in results]
    return out


def _serialize_result(r: LabResult) -> dict:
    return {
        "id": str(r.id),
        "order_id": str(r.order_id),
        "test_code": r.test_code,
        "test_name": r.test_name,
        "value": r.value,
        "unit": r.unit,
        "reference_range": r.reference_range,
        "flagged": r.flagged,
        "result_date": r.result_date.isoformat() if r.result_date else None,
    }


# ── Endpoints ───────────────────────────────────────────────────────────
@router.post("", status_code=201)
async def create_order(
    payload: LabOrderIn,
    user: User = _REQUIRE_DOCTOR,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.tenant_id:
        raise HTTPException(403, "User has no tenant")

    # Провайдер должен существовать в тенанте
    provider = (await db.execute(
        select(LabProvider).where(
            LabProvider.id == payload.provider_id,
            LabProvider.tenant_id == current_user.tenant_id,
            LabProvider.active == True,  # noqa: E712
        )
    )).scalar_one_or_none()
    if not provider:
        raise HTTPException(404, "Lab provider not found or inactive")

    clinic_id = payload.clinic_id or provider.default_clinic_id or current_user.clinic_id

    # Doctor_id — если пользователь врач, найдём его doctor-запись (если есть)
    doctor_id: uuid.UUID | None = None
    try:
        from app.models.doctor import Doctor
        d = (await db.execute(
            select(Doctor).where(Doctor.user_id == current_user.id)
        )).scalar_one_or_none()
        if d:
            doctor_id = d.id
    except Exception:
        pass

    order = LabOrder(
        tenant_id=current_user.tenant_id,
        patient_id=payload.patient_id,
        clinic_id=clinic_id,
        doctor_id=doctor_id,
        provider_id=provider.id,
        test_codes=payload.test_codes or [],
        notes=payload.notes,
        status="created",
        requested_at=datetime.utcnow(),
    )
    db.add(order)
    await db.flush()

    # Фейк-отправка: status → sent, asyncio.create_task → через 30с → in_progress
    await lab_service.send_order_to_provider(db, order, AsyncSessionLocal)
    await db.commit()
    await db.refresh(order)
    return _serialize_order(order)


@router.get("")
async def list_orders(
    patient_id: Optional[uuid.UUID] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    user: User = _REQUIRE_DOCTOR,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.tenant_id:
        raise HTTPException(403, "User has no tenant")
    q = select(LabOrder).where(LabOrder.tenant_id == current_user.tenant_id)
    if patient_id:
        q = q.where(LabOrder.patient_id == patient_id)
    if status:
        q = q.where(LabOrder.status == status)
    q = q.order_by(LabOrder.requested_at.desc()).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return {"items": [_serialize_order(o) for o in rows]}


@router.get("/{order_id}")
async def get_order(
    order_id: uuid.UUID,
    user: User = _REQUIRE_DOCTOR,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    o = (await db.execute(
        select(LabOrder).where(LabOrder.id == order_id)
    )).scalar_one_or_none()
    if not o or o.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Order not found")
    results = (await db.execute(
        select(LabResult).where(LabResult.order_id == o.id).order_by(LabResult.test_code.asc())
    )).scalars().all()
    return _serialize_order(o, list(results))


@router.get("/{order_id}/results")
async def get_order_results(
    order_id: uuid.UUID,
    user: User = _REQUIRE_DOCTOR,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    o = (await db.execute(
        select(LabOrder).where(LabOrder.id == order_id)
    )).scalar_one_or_none()
    if not o or o.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Order not found")
    results = (await db.execute(
        select(LabResult).where(LabResult.order_id == o.id).order_by(LabResult.test_code.asc())
    )).scalars().all()
    return {
        "order_id": str(o.id),
        "status": o.status,
        "results": [_serialize_result(r) for r in results],
    }


@router.post("/{order_id}/cancel")
async def cancel_order(
    order_id: uuid.UUID,
    user: User = _REQUIRE_DOCTOR,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    o = (await db.execute(
        select(LabOrder).where(LabOrder.id == order_id)
    )).scalar_one_or_none()
    if not o or o.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Order not found")
    if o.status in ("delivered", "cancelled"):
        raise HTTPException(400, "Order already finalized")
    o.status = "cancelled"
    await db.commit()
    return {"ok": True, "id": str(o.id), "status": o.status}
