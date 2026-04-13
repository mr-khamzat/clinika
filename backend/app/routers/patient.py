"""
Public router for patient cabinet.
Protected by patient_token (JWT, 90 days).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.models.referral import Referral, ReferralStatus
from app.core.security import verify_patient_token
from app.utils.phone import normalize_phone
import uuid


router = APIRouter(prefix="/patient", tags=["patient"])


def _get_limiter(times: int, seconds: int):
    try:
        from fastapi_limiter.depends import RateLimiter
        return Depends(RateLimiter(times=times, seconds=seconds))
    except Exception:
        return None


_limit_view = _get_limiter(60, 60)
_limit_code = _get_limiter(5, 900)
_view_deps = [_limit_view] if _limit_view else []
_code_deps = [_limit_code] if _limit_code else []


class CodeSearchRequest(BaseModel):
    code: int
    phone: str


async def _referral_or_404(referral_id: str, db: AsyncSession) -> Referral:
    try:
        rid = uuid.UUID(referral_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Referral not found")
    result = await db.execute(select(Referral).where(Referral.id == rid))
    ref = result.scalar_one_or_none()
    if not ref:
        raise HTTPException(status_code=404, detail="Referral not found")
    return ref


def _format_referral(ref: Referral, include_qr: bool = True) -> dict:
    return {
        "id": str(ref.id),
        "short_code": ref.short_code,
        "patient_name": ref.patient_name,
        "patient_phone": ref.patient_phone,
        "status": ref.status.value,
        "service_id": str(ref.service_id),
        "to_clinic_id": str(ref.to_clinic_id),
        "from_clinic_id": str(ref.from_clinic_id) if ref.from_clinic_id else None,
        "notes": ref.notes,
        "appointment_at": ref.appointment_at.isoformat() if ref.appointment_at else None,
        "created_at": ref.created_at.isoformat(),
        "expires_at": ref.expires_at.isoformat(),
        "confirmed_at": ref.confirmed_at.isoformat() if ref.confirmed_at else None,
        "qr_code": ref.qr_code if (include_qr and ref.status == ReferralStatus.CREATED) else None,
    }


@router.get("/{referral_id}", dependencies=_view_deps)
async def get_patient_referral(
    referral_id: str,
    t: str = Query(..., description="Patient JWT token"),
    db: AsyncSession = Depends(get_db),
):
    ref = await _referral_or_404(referral_id, db)

    if not verify_patient_token(str(ref.id), ref.patient_phone, t):
        raise HTTPException(status_code=403, detail="Token invalid or expired")

    from app.models.clinic import Clinic
    from app.models.service import Service

    to_clinic = (await db.execute(select(Clinic).where(Clinic.id == ref.to_clinic_id))).scalar_one_or_none()
    from_clinic = (
        (await db.execute(select(Clinic).where(Clinic.id == ref.from_clinic_id))).scalar_one_or_none()
        if ref.from_clinic_id else None
    )
    service = (await db.execute(select(Service).where(Service.id == ref.service_id))).scalar_one_or_none()

    # All referrals for this patient (by phone)
    all_refs_result = await db.execute(
        select(Referral)
        .where(Referral.patient_phone == ref.patient_phone)
        .order_by(Referral.created_at.desc())
        .limit(20)
    )
    all_refs = all_refs_result.scalars().all()

    other_refs = []
    for r in all_refs:
        if str(r.id) == referral_id:
            continue
        r_service = (await db.execute(select(Service).where(Service.id == r.service_id))).scalar_one_or_none()
        r_clinic = (await db.execute(select(Clinic).where(Clinic.id == r.to_clinic_id))).scalar_one_or_none()
        other_refs.append({
            **_format_referral(r, include_qr=True),
            "service_name": r_service.name if r_service else "—",
            "to_clinic_name": r_clinic.name if r_clinic else "—",
        })

    # MIS patient data
    mis_info = None
    mis_visits = []
    mis_analyses = []
    mis_patient_id = None

    try:
        from app.services.mis_client import find_patient_by_phone, get_patient_visits, get_patient_analyses
        patient = await find_patient_by_phone(ref.patient_phone)
        if patient:
            mis_patient_id = patient.get("patient_id") or patient.get("id")
            mis_info = {
                "patient_id": mis_patient_id,
                "card_number": patient.get("number"),
                "birth_date": patient.get("birth_date"),
                "gender": "М" if patient.get("gender") == 1 else ("Ж" if patient.get("gender") == 2 else None),
                "has_account": patient.get("has_account", False),
                "full_name": patient.get("full_name") or f"{patient.get('last_name', '')} {patient.get('first_name', '')}".strip(),
                "email": patient.get("email"),
            }
            if mis_patient_id:
                mis_visits = await get_patient_visits(int(mis_patient_id))
                mis_analyses = await get_patient_analyses(int(mis_patient_id))
    except Exception:
        pass

    return {
        "current": {
            **_format_referral(ref, include_qr=True),
            "service_name": service.name if service else "—",
            "to_clinic_name": to_clinic.name if to_clinic else "—",
            "from_clinic_name": from_clinic.name if from_clinic else None,
        },
        "other_referrals": other_refs,
        "mis_info": mis_info,
        "mis_visits": mis_visits[:20],
        "mis_analyses": mis_analyses[:20],
        "patient_token": t,
        "patient_phone": ref.patient_phone,
        "patient_name": ref.patient_name,
    }


@router.post("/by-code", dependencies=_code_deps)
async def get_by_short_code(
    body: CodeSearchRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Referral).where(Referral.short_code == body.code))
    ref = result.scalar_one_or_none()
    if not ref:
        raise HTTPException(status_code=404, detail="Referral not found")

    if normalize_phone(body.phone) != normalize_phone(ref.patient_phone):
        raise HTTPException(status_code=403, detail="Phone number does not match")

    from app.core.security import make_patient_token
    token = make_patient_token(str(ref.id), ref.patient_phone)

    return {
        "referral_id": str(ref.id),
        "patient_token": token,
        "found": True,
    }
