"""
Public router for patient cabinet.
Protected by patient_token (JWT, 90 days) for /{ref}, или patient_session_token (1 год) для /session.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from pydantic import BaseModel
from datetime import datetime, timedelta, date as _date, time as _time
from typing import Optional
from app.database import get_db
from app.models.referral import Referral, ReferralStatus
from app.core.security import verify_patient_token, make_patient_token
from app.utils.phone import normalize_phone
from app.services.patient_session_service import (
    create_session as _create_session,
    restore_session as _restore_session,
    revoke_session as _revoke_session,
)
import uuid


router = APIRouter(prefix="/patient", tags=["patient"])

# Минимальное окно (часы) до приёма, в течение которого пациент уже не может
# отменить запись через кабинет (только через клинику).
MIN_CANCEL_HOURS = 6


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


class SessionRestoreRequest(BaseModel):
    session_token: str


class SessionLogoutRequest(BaseModel):
    session_token: str


class SessionFromTokenRequest(BaseModel):
    patient_token: str


async def _load_mis_data(db: AsyncSession, phone: str, tenant_id) -> dict:
    """Подтянуть из МИС: профиль пациента + историю визитов по всем клиникам тенанта."""
    out = {"mis_info": None, "mis_visits": [], "mis_analyses": []}
    if not tenant_id:
        return out
    try:
        from app.services.mis_client import find_patient_by_phone, _post as _mis_post
        from app.services.settings_service import get_setting as _get_s
        from app.models.clinic import Clinic as _ClinicM
        from datetime import datetime as _dt, timedelta as _td

        _api_url = await _get_s(db, "mis_api_url", "", tenant_id=tenant_id)
        _api_key = await _get_s(db, "mis_api_key", "", tenant_id=tenant_id)

        patient = await find_patient_by_phone(phone, api_url=_api_url, api_key=_api_key)
        mis_patient_id = None
        if patient:
            mis_patient_id = patient.get("patient_id") or patient.get("id")
            _fn = f"{patient.get('last_name', '')} {patient.get('first_name', '')}".strip()
            if patient.get('third_name'):
                _fn += f" {patient['third_name']}"
            out["mis_info"] = {
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

        if mis_patient_id:
            _clinics_r = await db.execute(
                select(_ClinicM).where(
                    _ClinicM.tenant_id == tenant_id,
                    _ClinicM.mis_id.isnot(None),
                    _ClinicM.is_active == True,
                )
            )
            _tenant_clinics = _clinics_r.scalars().all()
            _date_to = _dt.now().strftime("%d.%m.%Y")
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
                        out["mis_visits"].extend(_appts)
                except Exception:
                    continue
            out["mis_visits"].sort(key=lambda x: x.get("time_start", ""), reverse=True)
            out["mis_visits"] = out["mis_visits"][:50]
    except Exception:
        pass
    return out


async def _load_appointments_for_phone(db: AsyncSession, phone: str, tenant_id) -> list[dict]:
    """
    Все активные записи пациента к врачу (PENDING/CONFIRMED) — по нормализованному
    телефону, в рамках тенанта. Сортировка по дате (свежие сверху). Каждый item:
        {id, doctor_id, doctor_name, specialty, clinic_id, clinic_name,
         appointment_date, start_time, end_time, status, short_code, qr_code,
         patient_token}
    """
    from app.models.doctor import Appointment as _Apt, AppointmentStatus as _AS, Doctor as _Doc
    from app.models.clinic import Clinic as _Cl
    from app.core.security import make_appointment_token as _mk_apt_t

    phone_n = normalize_phone(phone)

    q = select(_Apt).where(
        _Apt.status.in_([_AS.PENDING, _AS.CONFIRMED]),
    )
    if tenant_id:
        q = q.where(_Apt.tenant_id == tenant_id)
    q = q.order_by(_Apt.appointment_date.desc(), _Apt.start_time.desc()).limit(50)
    rows = (await db.execute(q)).scalars().all()

    out: list[dict] = []
    for apt in rows:
        # фильтр по нормализованному телефону
        if normalize_phone(apt.patient_phone) != phone_n:
            continue
        doctor = (await db.execute(select(_Doc).where(_Doc.id == apt.doctor_id))).scalar_one_or_none()
        clinic = (await db.execute(select(_Cl).where(_Cl.id == apt.clinic_id))).scalar_one_or_none()
        try:
            token = _mk_apt_t(str(apt.id), apt.patient_phone)
        except Exception:
            token = None
        out.append({
            "id": str(apt.id),
            "doctor_id": str(apt.doctor_id),
            "doctor_name": doctor.full_name if doctor else "—",
            "specialty": doctor.specialty if doctor else None,
            "clinic_id": str(apt.clinic_id),
            "clinic_name": clinic.name if clinic else "—",
            "clinic_address": clinic.address if clinic else None,
            "clinic_phone": clinic.phone if clinic else None,
            "clinic_latitude": clinic.latitude if clinic else None,
            "clinic_longitude": clinic.longitude if clinic else None,
            "appointment_date": apt.appointment_date.isoformat() if apt.appointment_date else None,
            "start_time": str(apt.start_time)[:5] if apt.start_time else None,
            "end_time":   str(apt.end_time)[:5]   if apt.end_time   else None,
            "status": apt.status.value if hasattr(apt.status, "value") else str(apt.status),
            "short_code": apt.short_code,
            "qr_code": apt.qr_code,
            "patient_token": token,
        })
    return out


async def _load_referrals_for_phone(db: AsyncSession, phone: str, tenant_id, exclude_id: str | None = None) -> list[dict]:
    """Все направления пациента (по нормализованному телефону, в рамках тенанта)."""
    from app.models.clinic import Clinic
    from app.models.service import Service
    phone_n = normalize_phone(phone)
    q = select(Referral).where(Referral.patient_phone == phone)
    if tenant_id:
        q = q.where(Referral.tenant_id == tenant_id)
    q = q.order_by(Referral.created_at.desc()).limit(40)
    rows = (await db.execute(q)).scalars().all()
    out = []
    for r in rows:
        if normalize_phone(r.patient_phone) != phone_n:
            continue
        if exclude_id and str(r.id) == exclude_id:
            continue
        r_service = (await db.execute(select(Service).where(Service.id == r.service_id))).scalar_one_or_none()
        r_clinic = (await db.execute(select(Clinic).where(Clinic.id == r.to_clinic_id))).scalar_one_or_none()
        out.append({
            **_format_referral(r, include_qr=True),
            "service_name": r_service.name if r_service else "—",
            "service_prep_instructions": (r_service.prep_instructions if r_service else None) if r_service else None,
            "to_clinic_name": r_clinic.name if r_clinic else "—",
            "to_clinic_address": r_clinic.address if r_clinic else None,
            "to_clinic_phone": r_clinic.phone if r_clinic else None,
            "to_clinic_latitude": r_clinic.latitude if r_clinic else None,
            "to_clinic_longitude": r_clinic.longitude if r_clinic else None,
        })
    return out


def _pick_active_referral(rows: list[Referral]) -> Referral | None:
    """Из списка direction'ов выбрать активный (created/confirmed) самый свежий."""
    active = [r for r in rows if r.status in (ReferralStatus.CREATED, ReferralStatus.CONFIRMED)]
    if not active:
        return None
    active.sort(key=lambda r: r.created_at, reverse=True)
    return active[0]


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


@router.get("/{referral_id:uuid}", dependencies=_view_deps)
async def get_patient_referral(
    referral_id: uuid.UUID,
    t: str = Query(..., description="Patient JWT token"),
    db: AsyncSession = Depends(get_db),
):
    referral_id = str(referral_id)  # legacy code ниже ожидает str
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
                "status": apt.status.value if hasattr(apt.status, "value") else str(apt.status),
                "doctor_id": str(apt.doctor_id),
                "doctor_name": doctor.full_name if doctor else "—",
                "specialty": doctor.specialty if doctor else None,
                "clinic_id": str(apt.clinic_id),
                "clinic_name": clinic.name if clinic else "—",
                "clinic_address": clinic.address if clinic else None,
                "clinic_phone": clinic.phone if clinic else None,
                "clinic_latitude": clinic.latitude if clinic else None,
                "clinic_longitude": clinic.longitude if clinic else None,
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

    other_refs = await _load_referrals_for_phone(db, ref.patient_phone, ref.tenant_id, exclude_id=referral_id)
    mis = await _load_mis_data(db, ref.patient_phone, ref.tenant_id)
    appointments = await _load_appointments_for_phone(db, ref.patient_phone, ref.tenant_id)

    return {
        "current": {
            **_format_referral(ref, include_qr=True),
            "service_name": service.name if service else "—",
            "service_prep_instructions": service.prep_instructions if service else None,
            "to_clinic_name": to_clinic.name if to_clinic else "—",
            "to_clinic_address": to_clinic.address if to_clinic else None,
            "to_clinic_phone": to_clinic.phone if to_clinic else None,
            "to_clinic_latitude": to_clinic.latitude if to_clinic else None,
            "to_clinic_longitude": to_clinic.longitude if to_clinic else None,
            "from_clinic_name": from_clinic.name if from_clinic else None,
        },
        "other_referrals": other_refs,
        **mis,
        "appointments": appointments,
        "patient_token": t,
        "patient_phone": ref.patient_phone,
        "patient_name": ref.patient_name,
    }


@router.post("/by-code", dependencies=_code_deps)
async def get_by_short_code(
    body: CodeSearchRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    # Сначала ищем направление
    result = await db.execute(select(Referral).where(Referral.short_code == body.code))
    ref = result.scalar_one_or_none()
    device = request.headers.get("user-agent", "")[:500] if request else None
    if ref:
        if normalize_phone(body.phone) != normalize_phone(ref.patient_phone):
            raise HTTPException(status_code=403, detail="Номер телефона не совпадает")
        token = make_patient_token(str(ref.id), ref.patient_phone)
        _, session_token = await _create_session(db, ref.patient_phone, ref.tenant_id, device_info=device)
        await db.commit()
        return {
            "referral_id": str(ref.id),
            "patient_token": token,
            "session_token": session_token,
            "found": True,
        }

    # Потом ищем запись к приезжему врачу
    from app.models.doctor import Appointment as Apt
    from app.core.security import make_appointment_token
    apt_res = await db.execute(select(Apt).where(Apt.short_code == body.code))
    apt = apt_res.scalar_one_or_none()
    if apt:
        if normalize_phone(body.phone) != normalize_phone(apt.patient_phone):
            raise HTTPException(status_code=403, detail="Номер телефона не совпадает")
        token = make_appointment_token(str(apt.id), apt.patient_phone)
        tenant_id = getattr(apt, "tenant_id", None)
        _, session_token = await _create_session(db, apt.patient_phone, tenant_id, device_info=device)
        await db.commit()
        return {
            "referral_id": str(apt.id),
            "patient_token": token,
            "session_token": session_token,
            "found": True,
            "type": "appointment",
        }

    raise HTTPException(status_code=404, detail="Запись не найдена")


# ── Patient session: long-lived автологин для PWA-ярлыка ─────────────────────

@router.post("/session/restore", dependencies=_view_deps)
async def restore_patient_session(
    body: SessionRestoreRequest,
    db: AsyncSession = Depends(get_db),
):
    """Принять session_token, отдать данные кабинета (как /patient/{ref})."""
    session = await _restore_session(db, body.session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Session invalid or expired")

    phone = session.phone
    tenant_id = session.tenant_id

    # Найти все направления пациента (для выбора активного и истории)
    q = select(Referral).where(Referral.patient_phone == phone)
    if tenant_id:
        q = q.where(Referral.tenant_id == tenant_id)
    q = q.order_by(Referral.created_at.desc()).limit(40)
    refs = (await db.execute(q)).scalars().all()
    active = _pick_active_referral(refs)

    mis = await _load_mis_data(db, phone, tenant_id)
    other_refs = await _load_referrals_for_phone(
        db, phone, tenant_id, exclude_id=str(active.id) if active else None
    )
    appointments = await _load_appointments_for_phone(db, phone, tenant_id)

    payload = {
        "current": None,
        "other_referrals": other_refs,
        **mis,
        "appointments": appointments,
        "patient_phone": phone,
        "patient_name": active.patient_name if active else (mis.get("mis_info") or {}).get("full_name") or "",
        "session_token": body.session_token,  # клиент ничего не сохраняет нового — токен тот же
    }

    if active:
        from app.models.clinic import Clinic
        from app.models.service import Service
        to_clinic = (await db.execute(select(Clinic).where(Clinic.id == active.to_clinic_id))).scalar_one_or_none()
        from_clinic = (
            (await db.execute(select(Clinic).where(Clinic.id == active.from_clinic_id))).scalar_one_or_none()
            if active.from_clinic_id else None
        )
        service = (await db.execute(select(Service).where(Service.id == active.service_id))).scalar_one_or_none()
        token = make_patient_token(str(active.id), active.patient_phone)
        payload["current"] = {
            **_format_referral(active, include_qr=True),
            "service_name": service.name if service else "—",
            "service_prep_instructions": service.prep_instructions if service else None,
            "to_clinic_name": to_clinic.name if to_clinic else "—",
            "to_clinic_address": to_clinic.address if to_clinic else None,
            "to_clinic_phone": to_clinic.phone if to_clinic else None,
            "to_clinic_latitude": to_clinic.latitude if to_clinic else None,
            "to_clinic_longitude": to_clinic.longitude if to_clinic else None,
            "from_clinic_name": from_clinic.name if from_clinic else None,
        }
        payload["patient_token"] = token
        payload["referral_id"] = str(active.id)

    await db.commit()
    return payload


@router.post("/session/from-token", dependencies=_view_deps)
async def session_from_token(
    body: SessionFromTokenRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Из валидного patient_token (QR-вход) создать long-lived session для PWA."""
    from app.core.security import decode_patient_token as _decode
    try:
        payload = _decode(body.patient_token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Token invalid")
    phone = payload.get("sub")
    ref_id = payload.get("ref") or payload.get("apt")
    ttype = payload.get("type")
    if not phone or not ref_id:
        raise HTTPException(status_code=401, detail="Token invalid")

    tenant_id = None
    if ttype == "patient":
        try:
            ref = await db.get(Referral, uuid.UUID(ref_id))
            if ref:
                if not verify_patient_token(str(ref.id), ref.patient_phone, body.patient_token):
                    raise HTTPException(status_code=401, detail="Token invalid")
                tenant_id = ref.tenant_id
        except (ValueError, TypeError):
            raise HTTPException(status_code=401, detail="Token invalid")
    elif ttype == "appointment":
        from app.models.doctor import Appointment as Apt
        from app.core.security import verify_appointment_token
        try:
            apt = await db.get(Apt, uuid.UUID(ref_id))
            if apt:
                if not verify_appointment_token(str(apt.id), apt.patient_phone, body.patient_token):
                    raise HTTPException(status_code=401, detail="Token invalid")
                tenant_id = getattr(apt, "tenant_id", None)
        except (ValueError, TypeError):
            raise HTTPException(status_code=401, detail="Token invalid")
    else:
        raise HTTPException(status_code=401, detail="Token invalid")

    device = request.headers.get("user-agent", "")[:500] if request else None
    _, session_token = await _create_session(db, phone, tenant_id, device_info=device)
    await db.commit()
    return {"session_token": session_token}


@router.post("/session/logout")
async def logout_patient_session(
    body: SessionLogoutRequest,
    db: AsyncSession = Depends(get_db),
):
    """Отозвать session_token при выходе из кабинета."""
    from app.core.security import decode_patient_session_token
    try:
        payload = decode_patient_session_token(body.session_token)
    except ValueError:
        return {"ok": True}
    sid = payload.get("sid")
    if sid:
        try:
            await _revoke_session(db, uuid.UUID(sid))
            await db.commit()
        except Exception:
            pass
    return {"ok": True}


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
        "status": apt.status.value if hasattr(apt.status, "value") else str(apt.status),
        "doctor_id": str(apt.doctor_id),
        "doctor_name": doctor.full_name if doctor else "—",
        "specialty": doctor.specialty if doctor else None,
        "clinic_id": str(apt.clinic_id),
        "clinic_name": clinic.name if clinic else "—",
        "clinic_address": clinic.address if clinic else None,
        "clinic_phone": clinic.phone if clinic else None,
        "clinic_latitude": clinic.latitude if clinic else None,
        "clinic_longitude": clinic.longitude if clinic else None,
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


# ── Отмена записи пациентом ──────────────────────────────────────────────────

class CancelBody(BaseModel):
    reason: Optional[str] = None


def _hours_until(apt) -> float:
    """Часов до начала приёма (отрицательно — уже прошло)."""
    try:
        dt = datetime.combine(apt.appointment_date, apt.start_time)
        return (dt - datetime.utcnow()).total_seconds() / 3600.0
    except Exception:
        return 0.0


@router.post("/appointment/{apt_id}/cancel")
async def patient_cancel_appointment(
    apt_id: str,
    t: str = Query(..., description="Appointment JWT token"),
    body: CancelBody | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Пациент сам отменяет свою запись (через QR-токен или session)."""
    from app.models.doctor import Appointment as Apt, AppointmentStatus
    from app.core.security import verify_appointment_token

    try:
        aid = uuid.UUID(apt_id)
    except ValueError:
        raise HTTPException(404, "Запись не найдена")

    apt = await db.get(Apt, aid)
    if not apt:
        raise HTTPException(404, "Запись не найдена")

    if not verify_appointment_token(str(apt.id), apt.patient_phone, t):
        raise HTTPException(403, "Токен недействителен или истёк")

    if apt.status == AppointmentStatus.CANCELLED:
        return {"id": str(apt.id), "status": "cancelled"}

    if apt.status not in (AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED):
        raise HTTPException(400, "Эту запись уже нельзя отменить")

    # Окно отмены — за 6 часов до приёма (настраивается константой)
    if _hours_until(apt) < MIN_CANCEL_HOURS:
        raise HTTPException(
            status_code=400,
            detail="Слишком поздно для отмены, позвоните в клинику",
        )

    apt.status = AppointmentStatus.CANCELLED
    apt.cancel_reason = (body.reason if body else None) or "Отменено пациентом"
    apt.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": str(apt.id), "status": "cancelled"}


# ── Перенос записи (атомарно: новая → отмена старой) ─────────────────────────

class RescheduleBody(BaseModel):
    appointment_date: str   # YYYY-MM-DD
    start_time: str         # HH:MM


@router.post("/appointment/{apt_id}/reschedule")
async def patient_reschedule_appointment(
    apt_id: str,
    body: RescheduleBody,
    t: str = Query(..., description="Appointment JWT token"),
    db: AsyncSession = Depends(get_db),
):
    """Пациент переносит свою запись на новый слот к тому же врачу."""
    from app.models.doctor import Appointment as Apt, AppointmentStatus, Doctor
    from app.models.clinic import Clinic
    from app.core.security import verify_appointment_token, make_appointment_token
    from app.services.scheduling_service import book_slot
    from app.services.qr_service import generate_qr_image_base64
    import random

    try:
        aid = uuid.UUID(apt_id)
    except ValueError:
        raise HTTPException(404, "Запись не найдена")

    apt = await db.get(Apt, aid)
    if not apt:
        raise HTTPException(404, "Запись не найдена")

    if not verify_appointment_token(str(apt.id), apt.patient_phone, t):
        raise HTTPException(403, "Токен недействителен или истёк")

    if apt.status not in (AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED):
        raise HTTPException(400, "Эту запись уже нельзя перенести")

    if _hours_until(apt) < MIN_CANCEL_HOURS:
        raise HTTPException(400, "Слишком поздно для переноса, позвоните в клинику")

    try:
        h, m = body.start_time.split(":")
        new_st = _time(int(h), int(m))
        new_date = datetime.strptime(body.appointment_date, "%Y-%m-%d").date()
    except (ValueError, AttributeError):
        raise HTTPException(400, "Неверный формат даты/времени")

    # Создаём новую запись (book_slot валидирует свободность слота → 409)
    new_apt = await book_slot(
        db,
        doctor_id=apt.doctor_id,
        appointment_date=new_date,
        start_time=new_st,
        patient_phone=apt.patient_phone,
        patient_name=apt.patient_name,
        referral_id=apt.referral_id,
        notes=apt.notes,
        tenant_id=apt.tenant_id,
    )
    # Генерируем уникальный short_code
    for _ in range(20):
        code = random.randint(10000, 99999)
        ex = (await db.execute(
            select(Apt).where(Apt.short_code == code)
        )).scalar_one_or_none()
        if not ex:
            new_apt.short_code = code
            break
    new_apt.qr_code = generate_qr_image_base64(str(new_apt.id))

    # Атомарно: гасим старую
    apt.status = AppointmentStatus.CANCELLED
    apt.cancel_reason = "Перенесено пациентом"
    apt.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(new_apt)

    new_token = make_appointment_token(str(new_apt.id), new_apt.patient_phone)

    doctor = await db.get(Doctor, new_apt.doctor_id)
    clinic = await db.get(Clinic, new_apt.clinic_id)

    return {
        "id": str(new_apt.id),
        "doctor_name": doctor.full_name if doctor else "—",
        "specialty": doctor.specialty if doctor else None,
        "clinic_name": clinic.name if clinic else "—",
        "appointment_date": new_apt.appointment_date.isoformat(),
        "start_time": str(new_apt.start_time)[:5],
        "end_time": str(new_apt.end_time)[:5],
        "short_code": new_apt.short_code,
        "qr_code": new_apt.qr_code,
        "patient_token": new_token,
        "old_id": str(apt.id),
    }


# ── Семейный аккаунт ─────────────────────────────────────────────────────────

class FamilyAddBody(BaseModel):
    phone: str
    name: Optional[str] = None
    relation: Optional[str] = None


class FamilySwitchBody(BaseModel):
    phone: str
    short_code: int   # код активного направления / записи члена семьи (proof)


async def _session_or_401(db: AsyncSession, t: str):
    """Достать активную PatientSession по токену (или 401)."""
    session = await _restore_session(db, t)
    if not session:
        raise HTTPException(401, "Session invalid or expired")
    return session


# ── Записи пациента (все: активные + завершённые) ────────────────────────────

@router.get("/appointments")
async def list_patient_appointments(
    t: str = Query(..., description="patient_session_token"),
    include_past: bool = Query(True),
    db: AsyncSession = Depends(get_db),
):
    """
    Все записи пациента к врачу (активные и прошлые), отсортированы по дате (свежие сверху).
    Используется во вкладке «Записи» PatientCabinet.
    """
    from app.models.doctor import Appointment as _Apt, AppointmentStatus as _AS, Doctor as _Doc
    from app.models.clinic import Clinic as _Cl

    session = await _session_or_401(db, t)
    phone_n = normalize_phone(session.phone)

    statuses = [_AS.PENDING, _AS.CONFIRMED]
    if include_past:
        statuses += [_AS.COMPLETED, _AS.CANCELLED, _AS.NO_SHOW]

    q = select(_Apt).where(_Apt.status.in_(statuses))
    if session.tenant_id:
        q = q.where(_Apt.tenant_id == session.tenant_id)
    q = q.order_by(_Apt.appointment_date.desc(), _Apt.start_time.desc()).limit(100)
    rows = (await db.execute(q)).scalars().all()

    out: list[dict] = []
    for apt in rows:
        if normalize_phone(apt.patient_phone) != phone_n:
            continue
        doctor = (await db.execute(select(_Doc).where(_Doc.id == apt.doctor_id))).scalar_one_or_none()
        clinic = (await db.execute(select(_Cl).where(_Cl.id == apt.clinic_id))).scalar_one_or_none()
        # Признак прошедшего приёма
        try:
            apt_dt = datetime.combine(apt.appointment_date, apt.start_time)
            is_past = apt_dt < datetime.utcnow()
        except Exception:
            is_past = False
        out.append({
            "id": str(apt.id),
            "doctor_id": str(apt.doctor_id),
            "doctor_name": doctor.full_name if doctor else "—",
            "specialty": doctor.specialty if doctor else None,
            "doctor_photo": doctor.photo_url if doctor else None,
            "clinic_id": str(apt.clinic_id),
            "clinic_name": clinic.name if clinic else "—",
            "clinic_address": clinic.address if clinic else None,
            "clinic_phone": clinic.phone if clinic else None,
            "appointment_date": apt.appointment_date.isoformat() if apt.appointment_date else None,
            "start_time": str(apt.start_time)[:5] if apt.start_time else None,
            "end_time":   str(apt.end_time)[:5]   if apt.end_time   else None,
            "status": apt.status.value if hasattr(apt.status, "value") else str(apt.status),
            "short_code": apt.short_code,
            "qr_code": apt.qr_code,
            "is_past": is_past,
            "notes": apt.notes,
        })
    return out


@router.get("/family")
async def family_list(
    t: str = Query(..., description="patient_session_token"),
    db: AsyncSession = Depends(get_db),
):
    """Список членов семьи, привязанных к owner_phone сессии."""
    from app.models.patient_family import PatientFamilyMember
    session = await _session_or_401(db, t)
    rows = (await db.execute(
        select(PatientFamilyMember)
        .where(PatientFamilyMember.owner_phone == normalize_phone(session.phone))
        .order_by(PatientFamilyMember.created_at)
    )).scalars().all()
    await db.commit()
    return [
        {
            "id": str(m.id),
            "phone": m.member_phone,
            "name": m.member_name,
            "relation": m.relation,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in rows
    ]


@router.get("/family/mis-suggestions")
async def family_mis_suggestions(
    t: str = Query(..., description="patient_session_token"),
    db: AsyncSession = Depends(get_db),
):
    """Подтянуть потенциальных членов семьи из МИС Renovatio.

    Логика:
    1. По телефону текущего пациента получаем его карточку в МИС → patient_id, parent_id, last_name
    2. Если есть parent_id — запрашиваем родителя (getPatient by id)
    3. По last_name ищем всех однофамильцев — фильтруем тех, у кого parent_id == self.id (дети)
       или parent_id == self.parent_id (братья/сёстры, исключая self).
    4. Возвращаем уже-существующих в нашем family list — пометкой already_added=true
    """
    from app.models.patient_family import PatientFamilyMember
    from app.services.mis_client import _post as _mis_post, find_patient_by_phone as _mis_find
    from app.services.settings_service import get_setting as _get_s

    session = await _session_or_401(db, t)
    owner_phone = normalize_phone(session.phone)
    tenant_id = session.tenant_id

    # Список уже добавленных, чтобы пометить already_added=true
    existing = (await db.execute(
        select(PatientFamilyMember).where(PatientFamilyMember.owner_phone == owner_phone)
    )).scalars().all()
    existing_phones = {normalize_phone(m.member_phone) for m in existing}

    suggestions: list[dict] = []
    try:
        _api_url = await _get_s(db, "mis_api_url", "", tenant_id=tenant_id) if tenant_id else ""
        _api_key = await _get_s(db, "mis_api_key", "", tenant_id=tenant_id) if tenant_id else ""

        self_p = await _mis_find(session.phone, api_url=_api_url, api_key=_api_key)
        if not self_p:
            return {"suggestions": [], "info": "В МИС не найден ваш профиль"}

        self_id = self_p.get("patient_id") or self_p.get("id")
        self_parent_id = self_p.get("parent_id")
        self_last = (self_p.get("last_name") or "").strip()

        seen_ids = {self_id}

        def _normalize_mis_mobile(m: str | None) -> str:
            if not m: return ""
            digits = "".join(ch for ch in m if ch.isdigit())
            return digits

        def _add_candidate(p: dict, relation: str):
            pid = p.get("patient_id") or p.get("id")
            if not pid or pid in seen_ids:
                return
            seen_ids.add(pid)
            mobile = p.get("mobile") or ""
            mobile_digits = _normalize_mis_mobile(mobile)
            if not mobile_digits:
                return
            # Не предлагать самого себя
            if mobile_digits.lstrip("78") == owner_phone.lstrip("78"):
                return
            full_name = " ".join(filter(None, [
                p.get("last_name"), p.get("first_name"), p.get("third_name"),
            ])).strip()
            suggestions.append({
                "mis_patient_id": pid,
                "name": full_name or p.get("full_name", ""),
                "phone": mobile,
                "relation_guess": relation,
                "birth_date": p.get("birth_date"),
                "age": p.get("age"),
                "already_added": (mobile_digits in existing_phones
                                  or ("+" + mobile_digits) in existing_phones),
            })

        # 1) Родитель
        if self_parent_id:
            try:
                r = await _mis_post("getPatient", api_url=_api_url, api_key=_api_key, id=self_parent_id)
                if r.get("error") == 0 and r.get("data"):
                    d = r["data"]
                    if isinstance(d, list): d = d[0] if d else None
                    if d:
                        _add_candidate(d, "родитель")
            except Exception:
                pass

        # 2) Однофамильцы — дети/братья/сёстры
        if self_last:
            try:
                r = await _mis_post("getPatient", api_url=_api_url, api_key=_api_key, last_name=self_last)
                if r.get("error") == 0 and r.get("data"):
                    items = r["data"] if isinstance(r["data"], list) else [r["data"]]
                    for d in items[:50]:
                        if not isinstance(d, dict): continue
                        ppid = d.get("parent_id")
                        # Дети self
                        if ppid == self_id:
                            _add_candidate(d, "ребёнок")
                        # Братья/сёстры (общий родитель)
                        elif self_parent_id and ppid == self_parent_id:
                            _add_candidate(d, "брат/сестра")
            except Exception:
                pass

    except Exception:
        return {"suggestions": [], "info": "МИС недоступна"}

    return {"suggestions": suggestions, "found_self": True}


@router.post("/family/add")
async def family_add(
    body: FamilyAddBody,
    t: str = Query(..., description="patient_session_token"),
    db: AsyncSession = Depends(get_db),
):
    """Добавить члена семьи. Без верификации — verify будет на switch."""
    from app.models.patient_family import PatientFamilyMember
    session = await _session_or_401(db, t)
    owner_n = normalize_phone(session.phone)
    member_n = normalize_phone(body.phone)
    if member_n == owner_n:
        raise HTTPException(400, "Нельзя добавить себя")

    # Уникальный (owner, member)
    exists = (await db.execute(
        select(PatientFamilyMember).where(
            PatientFamilyMember.owner_phone == owner_n,
            PatientFamilyMember.member_phone == member_n,
        )
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "Уже добавлен")

    m = PatientFamilyMember(
        owner_phone=owner_n,
        member_phone=member_n,
        member_name=(body.name or "").strip() or None,
        relation=(body.relation or "").strip() or None,
        tenant_id=session.tenant_id,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return {
        "id": str(m.id),
        "phone": m.member_phone,
        "name": m.member_name,
        "relation": m.relation,
    }


@router.delete("/family/{member_id}")
async def family_delete(
    member_id: str,
    t: str = Query(..., description="patient_session_token"),
    db: AsyncSession = Depends(get_db),
):
    from app.models.patient_family import PatientFamilyMember
    session = await _session_or_401(db, t)
    try:
        mid = uuid.UUID(member_id)
    except ValueError:
        raise HTTPException(404, "Член семьи не найден")
    m = await db.get(PatientFamilyMember, mid)
    if not m or normalize_phone(m.owner_phone) != normalize_phone(session.phone):
        raise HTTPException(404, "Член семьи не найден")
    await db.delete(m)
    await db.commit()
    return {"ok": True}


@router.post("/session/switch")
async def session_switch(
    body: FamilySwitchBody,
    request: Request,
    t: str = Query(..., description="patient_session_token (текущая сессия owner)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Переключиться на профиль члена семьи. Безопасность: требуется подтверждение
    через short_code активного направления / записи целевого профиля.
    """
    from app.models.patient_family import PatientFamilyMember
    from app.models.doctor import Appointment as Apt

    session = await _session_or_401(db, t)
    owner_n = normalize_phone(session.phone)
    target_n = normalize_phone(body.phone)

    # Проверяем, что target есть в семейном списке owner'а
    fm = (await db.execute(
        select(PatientFamilyMember).where(
            PatientFamilyMember.owner_phone == owner_n,
            PatientFamilyMember.member_phone == target_n,
        )
    )).scalar_one_or_none()
    if not fm:
        raise HTTPException(403, "Этот номер не в вашем семейном списке")

    # Проверяем short_code: либо это направление target'а, либо его запись
    proof_ok = False
    proof_tenant = session.tenant_id

    ref = (await db.execute(select(Referral).where(Referral.short_code == body.short_code))).scalar_one_or_none()
    if ref and normalize_phone(ref.patient_phone) == target_n:
        proof_ok = True
        proof_tenant = ref.tenant_id
    if not proof_ok:
        apt = (await db.execute(select(Apt).where(Apt.short_code == body.short_code))).scalar_one_or_none()
        if apt and normalize_phone(apt.patient_phone) == target_n:
            proof_ok = True
            proof_tenant = getattr(apt, "tenant_id", None)

    if not proof_ok:
        raise HTTPException(403, "Код подтверждения неверный")

    device = request.headers.get("user-agent", "")[:500] if request else None
    _, new_session = await _create_session(db, target_n, proof_tenant, device_info=device)
    await db.commit()
    return {"session_token": new_session}


# ─────────────────────────────────────────────────────────────────────────────
# 152-ФЗ ст. 14, 21 — Право пациента на доступ к своим ПД и удаление
# ─────────────────────────────────────────────────────────────────────────────
import json as _json
import io as _io


def _serialize_obj(o):
    """Универсальный JSON-serializer для UUID/datetime/date/time/Decimal/Enum."""
    from datetime import datetime as _dt2, date as _dt_date, time as _dt_time
    from decimal import Decimal as _Dec
    import enum as _enum

    if o is None:
        return None
    if isinstance(o, (str, int, float, bool)):
        return o
    if isinstance(o, uuid.UUID):
        return str(o)
    if isinstance(o, (_dt2, _dt_date, _dt_time)):
        return o.isoformat()
    if isinstance(o, _Dec):
        return float(o)
    if isinstance(o, _enum.Enum):
        return o.value if hasattr(o, "value") else str(o)
    if isinstance(o, (list, tuple, set)):
        return [_serialize_obj(x) for x in o]
    if isinstance(o, dict):
        return {str(k): _serialize_obj(v) for k, v in o.items()}
    # SQLAlchemy ORM-объекты с __table__: вытащим колонки
    try:
        cols = o.__table__.columns.keys()  # type: ignore[attr-defined]
        return {c: _serialize_obj(getattr(o, c, None)) for c in cols}
    except Exception:
        return str(o)


@router.get("/export-personal-data")
async def export_personal_data(
    request: Request,
    t: str = Query(..., description="patient_session_token"),
    format: str = Query("json", description="json | pdf"),
    db: AsyncSession = Depends(get_db),
):
    """
    152-ФЗ ст. 14 — Право субъекта ПД на доступ к своим данным.

    Собирает ВСЕ данные пациента в одну структуру:
      - PatientAccount (профиль)
      - ConsentRecord (история согласий, если связан User)
      - Referral (направления по patient_phone)
      - Appointment (записи к врачу)
      - PatientFamilyMember (семья, owner_phone)
      - AiConversation + AiMessage (диалоги с AI)
      - PatientDocument (метаданные, без файлов)
      - PatientChat + PatientChatMessage (чаты с операторами)
      - RecruiterBonus (если пациент = пользователь и фигурирует как recruiter/doctor)

    Поддерживает format=json (по умолчанию) и format=pdf (через reportlab,
    fallback на JSON если reportlab не установлен).
    """
    from fastapi.responses import StreamingResponse, JSONResponse
    from sqlalchemy import select as _sel
    from app.models.patient_account import PatientAccount
    from app.models.consent import ConsentRecord
    from app.models.user import User
    from app.models.doctor import Appointment as _Apt
    from app.models.patient_family import PatientFamilyMember
    from app.models.ai_assistant import AiConversation, AiMessage
    from app.models.patient_document import PatientDocument
    from app.models.patient_chat import PatientChat, PatientChatMessage
    from app.models.recruiter_bonus import RecruiterBonus
    from app.services import audit_service

    session = await _session_or_401(db, t)
    phone_n = normalize_phone(session.phone)

    # [#18] DSAR ограничен данными ТЕНАНТА сессии (152-ФЗ + изоляция справочника):
    # экспорт по A не должен раскрывать приёмы/чаты/документы пациента из клиники B.
    # _scoped(model, q) добавляет фильтр tenant_id == session.tenant_id, если тенант
    # известен; иначе (None — глобальный/легаси контекст) фильтр не накладывается.
    _sess_tid = session.tenant_id

    def _scoped(model, q):
        if _sess_tid is not None and hasattr(model, "tenant_id"):
            return q.where(model.tenant_id == _sess_tid)
        return q

    # ── Профиль PatientAccount ────────────────────────────────────────────────
    pa = (await db.execute(
        _sel(PatientAccount).where(PatientAccount.phone == phone_n)
    )).scalar_one_or_none()
    profile = _serialize_obj(pa) if pa else {"phone": phone_n}

    # ── Согласия (consent_records) — через User, если связан по phone ─────────
    consents: list[dict] = []
    user_id_for_audit: uuid.UUID | None = None
    try:
        u = (await db.execute(
            _sel(User).where(User.phone_number == phone_n)
        )).scalar_one_or_none()
        if u:
            user_id_for_audit = u.id
            cons = (await db.execute(
                _sel(ConsentRecord)
                .where(ConsentRecord.user_id == u.id)
                .order_by(ConsentRecord.created_at.desc())
            )).scalars().all()
            consents = [_serialize_obj(c) for c in cons]
    except Exception:
        consents = []

    # ── Направления ───────────────────────────────────────────────────────────
    refs = (await db.execute(
        _scoped(Referral, _sel(Referral).where(Referral.patient_phone == phone_n)).order_by(Referral.created_at.desc())
    )).scalars().all()
    referrals_data = [_serialize_obj(r) for r in refs]

    # ── Записи к врачу ────────────────────────────────────────────────────────
    apts = (await db.execute(
        _scoped(_Apt, _sel(_Apt).where(_Apt.patient_phone == phone_n)).order_by(_Apt.appointment_date.desc())
    )).scalars().all()
    appointments_data = [_serialize_obj(a) for a in apts]

    # ── Семья ─────────────────────────────────────────────────────────────────
    family = (await db.execute(
        _scoped(PatientFamilyMember, _sel(PatientFamilyMember).where(PatientFamilyMember.owner_phone == phone_n))
    )).scalars().all()
    family_data = [_serialize_obj(f) for f in family]

    # ── Диалоги с AI ──────────────────────────────────────────────────────────
    convs = (await db.execute(
        _scoped(AiConversation, _sel(AiConversation).where(AiConversation.patient_phone == phone_n)).order_by(AiConversation.created_at.desc())
    )).scalars().all()
    ai_dialogs: list[dict] = []
    for cv in convs:
        msgs = (await db.execute(
            _sel(AiMessage).where(AiMessage.conversation_id == cv.id).order_by(AiMessage.created_at)
        )).scalars().all()
        ai_dialogs.append({
            "conversation": _serialize_obj(cv),
            "messages": [_serialize_obj(m) for m in msgs],
        })

    # ── Документы ─────────────────────────────────────────────────────────────
    docs = (await db.execute(
        _scoped(PatientDocument, _sel(PatientDocument).where(PatientDocument.patient_phone == phone_n)).order_by(PatientDocument.created_at.desc())
    )).scalars().all()
    documents_data = []
    for d in docs:
        item = _serialize_obj(d)
        # Ссылка на скачивание (фактический эндпоинт может отличаться — даём guidance)
        item["download_hint"] = f"/patient/documents/{d.id}/download?t=<session>"
        documents_data.append(item)

    # ── Чаты с операторами ────────────────────────────────────────────────────
    chats = (await db.execute(
        _scoped(PatientChat, _sel(PatientChat).where(PatientChat.patient_phone == phone_n)).order_by(PatientChat.created_at.desc())
    )).scalars().all()
    chats_data: list[dict] = []
    for ch in chats:
        cmsgs = (await db.execute(
            _sel(PatientChatMessage).where(PatientChatMessage.chat_id == ch.id).order_by(PatientChatMessage.created_at)
        )).scalars().all()
        chats_data.append({
            "chat": _serialize_obj(ch),
            "messages": [_serialize_obj(m) for m in cmsgs],
        })

    # ── Бонусы рекрутёра (если пациент = пользователь, может фигурировать) ────
    recruiter_bonuses_data: list[dict] = []
    try:
        if user_id_for_audit is not None:
            rb = (await db.execute(
                _sel(RecruiterBonus).where(
                    or_(
                        RecruiterBonus.recruiter_id == user_id_for_audit,
                        RecruiterBonus.doctor_id == user_id_for_audit,
                    )
                ).order_by(RecruiterBonus.created_at.desc())
            )).scalars().all()
            recruiter_bonuses_data = [_serialize_obj(b) for b in rb]
    except Exception:
        recruiter_bonuses_data = []

    payload = {
        "exported_at": datetime.utcnow().isoformat(),
        "legal_basis": "152-ФЗ ст. 14 — Право субъекта ПД на доступ к своим данным",
        "patient_phone": phone_n,
        "profile": profile,
        "consents": consents,
        "referrals": referrals_data,
        "appointments": appointments_data,
        "family": family_data,
        "ai_conversations": ai_dialogs,
        "documents": documents_data,
        "operator_chats": chats_data,
        "recruiter_bonuses": recruiter_bonuses_data,
    }

    # ── Audit log ─────────────────────────────────────────────────────────────
    try:
        await audit_service.write(
            db,
            action="patient.data_exported",
            actor_id=user_id_for_audit,
            actor_name=phone_n,
            entity_type="patient_data",
            entity_id=(pa.id if pa else None),
            comment=f"152-FZ Art.14 export, format={format}",
            request=request,
            tenant_id=session.tenant_id,
        )
        await db.commit()
    except Exception:
        await db.rollback()

    body_bytes = _json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    fname_base = f"clinika-personal-data-{phone_n}-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"

    if format.lower() == "pdf":
        try:
            from reportlab.lib.pagesizes import A4  # type: ignore
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak  # type: ignore
            from reportlab.lib import colors  # type: ignore
            from reportlab.pdfbase import pdfmetrics  # type: ignore
            from reportlab.pdfbase.ttfonts import TTFont  # type: ignore

            buf = _io.BytesIO()
            doc = SimpleDocTemplate(buf, pagesize=A4, title="Личные данные пациента")
            styles = getSampleStyleSheet()
            # Попытка зарегистрировать кириллический шрифт (DejaVu)
            try:
                pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
                base_font = "DejaVu"
            except Exception:
                base_font = "Helvetica"
            styles["Normal"].fontName = base_font
            styles["Title"].fontName = base_font
            styles["Heading1"].fontName = base_font

            story = []
            story.append(Paragraph("Экспорт персональных данных пациента", styles["Title"]))
            story.append(Paragraph(payload["legal_basis"], styles["Normal"]))
            story.append(Paragraph(f"Дата выгрузки: {payload['exported_at']}", styles["Normal"]))
            story.append(Paragraph(f"Телефон: {phone_n}", styles["Normal"]))
            story.append(Spacer(1, 12))

            sections = [
                ("Профиль", [profile] if profile else []),
                ("Согласия (152-ФЗ)", consents),
                ("Направления", referrals_data),
                ("Записи к врачу", appointments_data),
                ("Семья", family_data),
                ("Диалоги с AI (свёрнуто)", [{"id": d["conversation"].get("id"), "messages_count": len(d["messages"])} for d in ai_dialogs]),
                ("Документы", documents_data),
                ("Чаты с операторами (свёрнуто)", [{"id": c["chat"].get("id"), "messages_count": len(c["messages"])} for c in chats_data]),
                ("Бонусы рекрутёра", recruiter_bonuses_data),
            ]
            for title, rows in sections:
                story.append(Paragraph(title, styles["Heading1"]))
                if not rows:
                    story.append(Paragraph("— нет данных —", styles["Normal"]))
                    story.append(Spacer(1, 8))
                    continue
                # Берём union ключей
                keys = sorted({k for r in rows for k in (r or {}).keys()})
                table_data = [keys] + [[str(r.get(k, ""))[:80] for k in keys] for r in rows[:50]]
                tbl = Table(table_data, repeatRows=1)
                tbl.setStyle(TableStyle([
                    ("FONT", (0, 0), (-1, -1), base_font, 7),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]))
                story.append(tbl)
                story.append(Spacer(1, 12))

            doc.build(story)
            buf.seek(0)
            return StreamingResponse(
                buf,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{fname_base}.pdf"'},
            )
        except ImportError:
            # reportlab не установлен — fallback на JSON
            pass
        except Exception:
            pass

    # JSON-ответ (default + fallback)
    return StreamingResponse(
        _io.BytesIO(body_bytes),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname_base}.json"'},
    )


@router.delete("/forget-personal-data")
async def forget_personal_data(
    request: Request,
    t: str = Query(..., description="patient_session_token"),
    db: AsyncSession = Depends(get_db),
):
    """
    152-ФЗ ст. 21 — Право на удаление персональных данных.

    [#18] «Забвение» выполняется В РАМКАХ ТЕНАНТА сессии: сначала снимается
    связь TenantPatient(этот тенант, пациент). Глобальную идентичность
    (PatientAccount.phone/name + связанный User) обнуляем ТОЛЬКО когда не
    осталось ни одной TenantPatient-связи (пациент больше нигде не лечится).
    Если пациент остаётся в других клиниках — глобальная запись сохраняется,
    отзываются лишь сессии этого тенанта.

    При полном забвении: PatientAccount.name/birth_date → null,
    phone → "anon_<hash>", связанный User анонимизируется, все сессии отзываются.
    В audit_log пишется patient.data_forgotten, в consent_records — "forgotten".

    Медкарта в МИС НЕ затрагивается (внешняя система).
    """
    import hashlib
    from sqlalchemy import update as _upd, delete as _del, func as _func
    from app.models.patient_account import PatientAccount
    from app.models.patient_session import PatientSession
    from app.models.tenant_patient import TenantPatient
    from app.models.consent import ConsentRecord
    from app.models.user import User
    from app.services import audit_service

    session = await _session_or_401(db, t)
    phone_n = normalize_phone(session.phone)
    sess_tid = session.tenant_id
    anon_id = hashlib.sha256(f"{phone_n}-{session.id}".encode()).hexdigest()[:12]
    anon_phone = f"anon_{anon_id}"

    # ── PatientAccount ────────────────────────────────────────────────────────
    pa = (await db.execute(
        select(PatientAccount).where(PatientAccount.phone == phone_n)
    )).scalar_one_or_none()
    pa_id = pa.id if pa else None

    # [#18] «Забвение» в рамках тенанта: сначала снимаем связь пациента с этой
    # клиникой. Глобальную идентичность (phone/name на PatientAccount + связанный
    # User) обнуляем ТОЛЬКО если не осталось ни одной TenantPatient-связи —
    # иначе мы бы стёрли пациента, который лечится и в других клиниках.
    remaining_links = 0
    if pa:
        if sess_tid is not None:
            await db.execute(
                _del(TenantPatient).where(
                    TenantPatient.tenant_id == sess_tid,
                    TenantPatient.patient_id == pa.id,
                )
            )
            await db.flush()
            remaining_links = (await db.execute(
                select(_func.count())
                .select_from(TenantPatient)
                .where(TenantPatient.patient_id == pa.id)
            )).scalar_one() or 0

    wipe_global = (pa is not None) and (sess_tid is None or remaining_links == 0)

    if pa and wipe_global:
        await db.execute(
            _upd(PatientAccount)
            .where(PatientAccount.id == pa.id)
            .values(
                phone=anon_phone,
                name=None,
                # [#18] зачищаем и shadow-колонки шифрования ФИО (иначе ciphertext
                # ФИО переживёт «забвение»). Прямой UPDATE минует setter — чистим явно.
                name_encrypted=None,
                name_hash=None,
                email=None,
                birth_date=None,
                is_active=False,
                password_hash=None,
            )
        )

    # ── User (если связан) — только при полном (глобальном) забвении ───────────
    user_id_for_audit: uuid.UUID | None = None
    try:
        u = (await db.execute(
            select(User).where(User.phone_number == phone_n)
        )).scalar_one_or_none()
        if u:
            user_id_for_audit = u.id
            if wipe_global:
                await db.execute(
                    _upd(User)
                    .where(User.id == u.id)
                    .values(
                        full_name=f"Anonymized_{anon_id}",
                        phone_number=None,
                        telegram_id=None,
                        date_of_birth=None,
                        consent_given=False,
                        is_active=False,
                    )
                )
            db.add(ConsentRecord(
                user_id=u.id,
                event="forgotten",
                ip=(request.headers.get("x-real-ip")
                    or (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or None)
                    or (request.client.host if request.client else None)),
                user_agent=request.headers.get("user-agent"),
                policy_version="1.0",
                note="152-ФЗ ст. 21 — patient self-service erase",
            ))
    except Exception:
        pass

    # ── Сессии: при полном забвении — все по телефону; иначе только этого ──────
    #    тенанта (пациент остаётся залогинен в других клиниках).
    try:
        sess_q = _upd(PatientSession).where(PatientSession.phone == phone_n)
        if not wipe_global and sess_tid is not None:
            sess_q = sess_q.where(PatientSession.tenant_id == sess_tid)
        await db.execute(sess_q.values(revoked=True))
    except Exception:
        pass

    # ── Audit log ─────────────────────────────────────────────────────────────
    try:
        await audit_service.write(
            db,
            action="patient.data_forgotten",
            actor_id=user_id_for_audit,
            actor_name=phone_n,
            entity_type="patient_data",
            entity_id=pa_id,
            before={"phone": phone_n},
            after={"phone": (anon_phone if wipe_global else phone_n)},
            comment=("152-FZ Art.21 erase (global)" if wipe_global
                     else "152-FZ Art.21 erase (tenant-scoped, patient retained in other tenants)"),
            request=request,
            tenant_id=session.tenant_id,
        )
    except Exception:
        pass

    await db.commit()
    return {
        "ok": True,
        "message": (
            "Данные анонимизированы согласно 152-ФЗ ст. 21. Все сессии отозваны."
            if wipe_global else
            "Связь с клиникой удалена согласно 152-ФЗ ст. 21. "
            "Идентичность сохранена, т.к. вы обслуживаетесь в других клиниках; "
            "сессии этой клиники отозваны."
        ),
        "anon_id": anon_id,
        "global_erase": wipe_global,
    }
