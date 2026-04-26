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
_limit_code = _get_limiter(20, 60)
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
    # Проверяем тип токена — appointment или referral
    try:
        from app.core.security import decode_patient_token as _decode
        payload = _decode(t)
        if payload.get("type") == "appointment":
            # Это токен записи к приезжему врачу
            from app.models.doctor import Appointment as Apt, Doctor
            from app.models.clinic import Clinic
            from app.core.security import verify_appointment_token
            try:
                aid = uuid.UUID(referral_id)
            except ValueError:
                raise HTTPException(404, "Запись не найдена")
            apt = await db.get(Apt, aid)
            if not apt:
                raise HTTPException(404, "Запись не найдена")
            if not verify_appointment_token(str(apt.id), apt.patient_phone, t):
                raise HTTPException(403, "Токен недействителен или истёк")
            doctor = await db.get(Doctor, apt.doctor_id)
            clinic = await db.get(Clinic, apt.clinic_id)
            return {
                "type": "appointment",
                "id": str(apt.id),
                "patient_name": apt.patient_name,
                "patient_phone": apt.patient_phone,
                "appointment_date": apt.appointment_date.isoformat(),
                "start_time": str(apt.start_time),
                "end_time": str(apt.end_time),
                "status": str(apt.status),
                "doctor_name": doctor.full_name if doctor else "—",
                "clinic_name": clinic.name if clinic else "—",
                "short_code": apt.short_code,
                "qr_code": apt.qr_code,
                "patient_token": t,
                "patient_phone": apt.patient_phone,
                "patient_name": apt.patient_name,
            }
    except Exception as e:
        if "appointment" in str(e):
            raise
        pass  # Продолжаем как обычно для referral

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
        from app.services.mis_client import find_patient_by_phone, _post as _mis_post
        from app.services.settings_service import get_setting as _get_s
        from app.models.clinic import Clinic as _ClinicM
        from datetime import datetime as _dt, timedelta as _td

        # Настройки МИС тенанта
        _api_url = await _get_s(db, "mis_api_url", "", tenant_id=ref.tenant_id) if ref.tenant_id else ""
        _api_key = await _get_s(db, "mis_api_key", "", tenant_id=ref.tenant_id) if ref.tenant_id else ""

        patient = await find_patient_by_phone(ref.patient_phone, api_url=_api_url, api_key=_api_key)
        if patient:
            mis_patient_id = patient.get("patient_id") or patient.get("id")
            _fn = f"{patient.get('last_name', '')} {patient.get('first_name', '')}".strip()
            if patient.get('third_name'):
                _fn += f" {patient['third_name']}"
            mis_info = {
                "patient_id": mis_patient_id,
                "card_number": patient.get("number"),
                "birth_date": patient.get("birth_date"),
                "age": patient.get("age"),
                "gender": patient.get("gender"),
                "has_account": patient.get("has_account", False),
                "full_name": _fn or patient.get("full_name", ""),
                "email": patient.get("email"),
                "send_sms": patient.get("send_sms"),
                "date_created": patient.get("date_created"),
            }

        # История визитов через getAppointments по всем клиникам тенанта
        if mis_patient_id and ref.tenant_id:
            _clinics_r = await db.execute(
                select(_ClinicM).where(
                    _ClinicM.tenant_id == ref.tenant_id,
                    _ClinicM.mis_id.isnot(None),
                    _ClinicM.is_active == True,
                )
            )
            _tenant_clinics = _clinics_r.scalars().all()
            _date_to  = _dt.now().strftime("%d.%m.%Y")
            _date_from = (_dt.now() - _td(days=730)).strftime("%d.%m.%Y")
            for _c in _tenant_clinics:
                try:
                    _res = await _mis_post(
                        "getAppointments",
                        api_url=_api_url, api_key=_api_key,
                        clinic_id=_c.mis_id,
                        date_from=_date_from,
                        date_to=_date_to,
                        patient_id=mis_patient_id,
                    )
                    _appts = _res.get("data") or []
                    if isinstance(_appts, list):
                        mis_visits.extend(_appts)
                except Exception:
                    continue
            mis_visits.sort(key=lambda x: x.get("time_start", ""), reverse=True)
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
        "mis_visits": mis_visits[:50],
        "mis_analyses": [],
        "patient_token": t,
        "patient_phone": ref.patient_phone,
        "patient_name": ref.patient_name,
    }


@router.post("/by-code", dependencies=_code_deps)
async def get_by_short_code(
    body: CodeSearchRequest,
    db: AsyncSession = Depends(get_db),
):
    from app.core.security import make_patient_token

    # Сначала ищем направление
    result = await db.execute(select(Referral).where(Referral.short_code == body.code))
    ref = result.scalar_one_or_none()
    if ref:
        if normalize_phone(body.phone) != normalize_phone(ref.patient_phone):
            raise HTTPException(status_code=403, detail="Номер телефона не совпадает")
        token = make_patient_token(str(ref.id), ref.patient_phone)
        return {"referral_id": str(ref.id), "patient_token": token, "found": True}

    # Потом ищем запись к приезжему врачу
    from app.models.doctor import Appointment as Apt
    from app.core.security import make_appointment_token
    apt_res = await db.execute(select(Apt).where(Apt.short_code == body.code))
    apt = apt_res.scalar_one_or_none()
    if apt:
        if normalize_phone(body.phone) != normalize_phone(apt.patient_phone):
            raise HTTPException(status_code=403, detail="Номер телефона не совпадает")
        token = make_appointment_token(str(apt.id), apt.patient_phone)
        return {"referral_id": str(apt.id), "patient_token": token, "found": True, "type": "appointment"}

    raise HTTPException(status_code=404, detail="Запись не найдена")


# ── Кабинет пациента для записи к приезжему врачу ────────────────────────────

@router.get("/appointment/{apt_id}")
async def get_patient_appointment(
    apt_id: str,
    t: str = Query(..., description="Appointment JWT token"),
    db: AsyncSession = Depends(get_db),
):
    """Публичный endpoint для пациента — посмотреть запись и получить QR."""
    try:
        aid = uuid.UUID(apt_id)
    except ValueError:
        raise HTTPException(404, "Запись не найдена")

    from app.models.doctor import Appointment as Apt, Doctor, AppointmentStatus
    from app.models.clinic import Clinic
    from app.core.security import verify_appointment_token

    apt = await db.get(Apt, aid)
    if not apt:
        raise HTTPException(404, "Запись не найдена")

    if not verify_appointment_token(str(apt.id), apt.patient_phone, t):
        raise HTTPException(403, "Токен недействителен или истёк")

    doctor = await db.get(Doctor, apt.doctor_id)
    clinic = await db.get(Clinic, apt.clinic_id)

    return {
        "id": str(apt.id),
        "patient_name": apt.patient_name,
        "patient_phone": apt.patient_phone,
        "appointment_date": apt.appointment_date.isoformat(),
        "start_time": str(apt.start_time),
        "end_time": str(apt.end_time),
        "status": str(apt.status),
        "doctor_name": doctor.full_name if doctor else "—",
        "clinic_name": clinic.name if clinic else "—",
        "short_code": apt.short_code,
        "qr_code": apt.qr_code,
    }


@router.post("/appointment/by-code")
async def get_appointment_by_code(
    body: CodeSearchRequest,
    db: AsyncSession = Depends(get_db),
):
    """Найти запись по short_code + телефону."""
    from app.models.doctor import Appointment as Apt
    from app.core.security import make_appointment_token
    from app.utils.phone import normalize_phone

    result = await db.execute(
        select(Apt).where(Apt.short_code == body.code)
    )
    apt = result.scalar_one_or_none()
    if not apt:
        raise HTTPException(404, "Запись не найдена")

    if normalize_phone(body.phone) != normalize_phone(apt.patient_phone):
        raise HTTPException(403, "Номер телефона не совпадает")

    token = make_appointment_token(str(apt.id), apt.patient_phone)
    return {
        "appointment_id": str(apt.id),
        "patient_token": token,
        "found": True,
    }
