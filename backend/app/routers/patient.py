"""
Public router for patient cabinet.
Protected by patient_token (JWT, 90 days) for /{ref}, или patient_session_token (1 год) для /session.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from pydantic import BaseModel
from datetime import datetime
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
            "to_clinic_name": r_clinic.name if r_clinic else "—",
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
                "status": apt.status.value if hasattr(apt.status, "value") else str(apt.status),
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

    other_refs = await _load_referrals_for_phone(db, ref.patient_phone, ref.tenant_id, exclude_id=referral_id)
    mis = await _load_mis_data(db, ref.patient_phone, ref.tenant_id)
    appointments = await _load_appointments_for_phone(db, ref.patient_phone, ref.tenant_id)

    return {
        "current": {
            **_format_referral(ref, include_qr=True),
            "service_name": service.name if service else "—",
            "to_clinic_name": to_clinic.name if to_clinic else "—",
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
            "to_clinic_name": to_clinic.name if to_clinic else "—",
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
