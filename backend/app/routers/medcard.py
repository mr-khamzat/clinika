"""
Медкарта пациента: диагнозы, аллергии, прививки.

Public-эндпоинты для кабинета пациента (auth: patient_session_token):
  GET /patient/medcard/diagnoses
  GET /patient/medcard/allergies
  GET /patient/medcard/vaccinations

Manager-side CRUD (manager / doctor / admin / nurse):
  POST/PATCH/DELETE /medcard/diagnoses[/{id}]
  POST/PATCH/DELETE /medcard/allergies[/{id}]
  POST/PATCH/DELETE /medcard/vaccinations[/{id}]
"""
import uuid
from datetime import datetime
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.core.deps import (
    get_current_user,
    require_role,
    assert_same_tenant,
    assert_can_create_in_tenant,
    _is_super_admin,
)
from app.models.user import User
from app.models.medcard import PatientDiagnosis, PatientAllergy, PatientVaccination
from app.services.patient_session_service import restore_session
from app.utils.phone import normalize_phone


router = APIRouter(tags=["medcard"])


# ── Patient-side: чтение собственной медкарты ───────────────────────────────

async def _patient_session_or_401(
    db: AsyncSession,
    session_token: Optional[str] = None,
    x_patient_session: Optional[str] = None,
):
    """Достать сессию по токену из query (?session_token / ?t) или заголовку X-Patient-Session."""
    token = session_token or x_patient_session
    if not token:
        raise HTTPException(401, "Patient session required")
    sess = await restore_session(db, token)
    if not sess:
        raise HTTPException(401, "Session invalid or expired")
    return sess


def _diag_dict(d: PatientDiagnosis) -> dict:
    return {
        "id": str(d.id),
        "icd10_code": d.icd10_code,
        "name": d.name,
        "diagnosed_at": d.diagnosed_at.isoformat() if d.diagnosed_at else None,
        "is_chronic": d.is_chronic,
        "notes": d.notes,
        "doctor_name": d.doctor_name,
        "source": d.source,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


def _allergy_dict(a: PatientAllergy) -> dict:
    return {
        "id": str(a.id),
        "allergen": a.allergen,
        "severity": a.severity,
        "reaction": a.reaction,
        "noted_at": a.noted_at.isoformat() if a.noted_at else None,
        "source": a.source,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def _vacc_dict(v: PatientVaccination) -> dict:
    return {
        "id": str(v.id),
        "vaccine_name": v.vaccine_name,
        "given_at": v.given_at.isoformat() if v.given_at else None,
        "dose_number": v.dose_number,
        "expires_at": v.expires_at.isoformat() if v.expires_at else None,
        "batch_number": v.batch_number,
        "doctor_name": v.doctor_name,
        "source": v.source,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


@router.get("/patient/medcard/diagnoses")
async def patient_diagnoses(
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None, description="alias для session_token"),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    db: AsyncSession = Depends(get_db),
):
    sess = await _patient_session_or_401(db, session_token or t, x_patient_session)
    phone_n = normalize_phone(sess.phone)
    # Находка #7: строгий фильтр по tenant_id пациентской сессии всегда
    # (NULL==NULL включительно), без пропуска при NULL.
    q = select(PatientDiagnosis).where(
        PatientDiagnosis.patient_phone == phone_n,
        PatientDiagnosis.tenant_id == sess.tenant_id,
    )
    q = q.order_by(PatientDiagnosis.diagnosed_at.desc().nulls_last(),
                   PatientDiagnosis.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return [_diag_dict(d) for d in rows]


@router.get("/patient/medcard/allergies")
async def patient_allergies(
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    db: AsyncSession = Depends(get_db),
):
    sess = await _patient_session_or_401(db, session_token or t, x_patient_session)
    phone_n = normalize_phone(sess.phone)
    # Находка #7: строгий фильтр по tenant_id пациентской сессии всегда.
    q = select(PatientAllergy).where(
        PatientAllergy.patient_phone == phone_n,
        PatientAllergy.tenant_id == sess.tenant_id,
    )
    q = q.order_by(PatientAllergy.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return [_allergy_dict(a) for a in rows]


@router.get("/patient/medcard/vaccinations")
async def patient_vaccinations(
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    db: AsyncSession = Depends(get_db),
):
    sess = await _patient_session_or_401(db, session_token or t, x_patient_session)
    phone_n = normalize_phone(sess.phone)
    # Находка #7: строгий фильтр по tenant_id пациентской сессии всегда.
    q = select(PatientVaccination).where(
        PatientVaccination.patient_phone == phone_n,
        PatientVaccination.tenant_id == sess.tenant_id,
    )
    q = q.order_by(PatientVaccination.given_at.desc().nulls_last(),
                   PatientVaccination.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return [_vacc_dict(v) for v in rows]


# ── Manager / doctor / nurse / admin: CRUD ──────────────────────────────────

_staff_dep = Depends(require_role("manager", "doctor", "reg", "nurse"))


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


# ── Diagnoses ───────────────────────────────────────────────────────────────

class DiagnosisIn(BaseModel):
    patient_phone: str
    icd10_code: Optional[str] = None
    name: str
    diagnosed_at: Optional[str] = None
    is_chronic: bool = False
    notes: Optional[str] = None
    doctor_name: Optional[str] = None


class DiagnosisPatch(BaseModel):
    icd10_code: Optional[str] = None
    name: Optional[str] = None
    diagnosed_at: Optional[str] = None
    is_chronic: Optional[bool] = None
    notes: Optional[str] = None
    doctor_name: Optional[str] = None


@router.post("/medcard/diagnoses", dependencies=[_staff_dep])
async def staff_create_diagnosis(
    body: DiagnosisIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Находка #7: запрет рождения записи с tenant_id=NULL.
    assert_can_create_in_tenant(user)
    d = PatientDiagnosis(
        tenant_id=user.tenant_id,
        patient_phone=normalize_phone(body.patient_phone),
        icd10_code=body.icd10_code,
        name=body.name.strip(),
        diagnosed_at=_parse_dt(body.diagnosed_at),
        is_chronic=body.is_chronic,
        notes=body.notes,
        doctor_name=body.doctor_name or user.full_name,
        source="manual",
    )
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return _diag_dict(d)


@router.patch("/medcard/diagnoses/{diag_id}", dependencies=[_staff_dep])
async def staff_update_diagnosis(
    diag_id: str,
    body: DiagnosisPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        did = uuid.UUID(diag_id)
    except ValueError:
        raise HTTPException(404, "Не найдено")
    d = await db.get(PatientDiagnosis, did)
    if not d:
        raise HTTPException(404, "Не найдено")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, d)
    if body.icd10_code is not None:
        d.icd10_code = body.icd10_code
    if body.name is not None:
        d.name = body.name.strip()
    if body.diagnosed_at is not None:
        d.diagnosed_at = _parse_dt(body.diagnosed_at)
    if body.is_chronic is not None:
        d.is_chronic = body.is_chronic
    if body.notes is not None:
        d.notes = body.notes
    if body.doctor_name is not None:
        d.doctor_name = body.doctor_name
    await db.commit()
    await db.refresh(d)
    return _diag_dict(d)


@router.delete("/medcard/diagnoses/{diag_id}", dependencies=[_staff_dep])
async def staff_delete_diagnosis(
    diag_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        did = uuid.UUID(diag_id)
    except ValueError:
        raise HTTPException(404, "Не найдено")
    d = await db.get(PatientDiagnosis, did)
    if not d:
        raise HTTPException(404, "Не найдено")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, d)
    await db.delete(d)
    await db.commit()
    return {"ok": True}


@router.get("/medcard/diagnoses", dependencies=[_staff_dep])
async def staff_list_diagnoses(
    patient_phone: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    phone_n = normalize_phone(patient_phone)
    q = select(PatientDiagnosis).where(PatientDiagnosis.patient_phone == phone_n)
    # Находка #7: фильтр по tenant_id всегда для тенантного пользователя;
    # пропуск (все тенанты) — только super_admin по роли.
    if not _is_super_admin(user):
        q = q.where(PatientDiagnosis.tenant_id == user.tenant_id)
    q = q.order_by(PatientDiagnosis.diagnosed_at.desc().nulls_last(), PatientDiagnosis.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return [_diag_dict(d) for d in rows]


# ── Allergies ───────────────────────────────────────────────────────────────

class AllergyIn(BaseModel):
    patient_phone: str
    allergen: str
    severity: Literal["mild", "moderate", "severe"] = "mild"
    reaction: Optional[str] = None
    noted_at: Optional[str] = None


class AllergyPatch(BaseModel):
    allergen: Optional[str] = None
    severity: Optional[Literal["mild", "moderate", "severe"]] = None
    reaction: Optional[str] = None
    noted_at: Optional[str] = None


@router.post("/medcard/allergies", dependencies=[_staff_dep])
async def staff_create_allergy(
    body: AllergyIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Находка #7: запрет рождения записи с tenant_id=NULL.
    assert_can_create_in_tenant(user)
    a = PatientAllergy(
        tenant_id=user.tenant_id,
        patient_phone=normalize_phone(body.patient_phone),
        allergen=body.allergen.strip(),
        severity=body.severity,
        reaction=body.reaction,
        noted_at=_parse_dt(body.noted_at),
        source="manual",
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return _allergy_dict(a)


@router.patch("/medcard/allergies/{aid}", dependencies=[_staff_dep])
async def staff_update_allergy(
    aid: str,
    body: AllergyPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        au = uuid.UUID(aid)
    except ValueError:
        raise HTTPException(404, "Не найдено")
    a = await db.get(PatientAllergy, au)
    if not a:
        raise HTTPException(404, "Не найдено")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, a)
    if body.allergen is not None:
        a.allergen = body.allergen.strip()
    if body.severity is not None:
        a.severity = body.severity
    if body.reaction is not None:
        a.reaction = body.reaction
    if body.noted_at is not None:
        a.noted_at = _parse_dt(body.noted_at)
    await db.commit()
    await db.refresh(a)
    return _allergy_dict(a)


@router.delete("/medcard/allergies/{aid}", dependencies=[_staff_dep])
async def staff_delete_allergy(
    aid: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        au = uuid.UUID(aid)
    except ValueError:
        raise HTTPException(404, "Не найдено")
    a = await db.get(PatientAllergy, au)
    if not a:
        raise HTTPException(404, "Не найдено")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, a)
    await db.delete(a)
    await db.commit()
    return {"ok": True}


@router.get("/medcard/allergies", dependencies=[_staff_dep])
async def staff_list_allergies(
    patient_phone: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    phone_n = normalize_phone(patient_phone)
    q = select(PatientAllergy).where(PatientAllergy.patient_phone == phone_n)
    # Находка #7: фильтр по tenant_id всегда для тенантного пользователя;
    # пропуск (все тенанты) — только super_admin по роли.
    if not _is_super_admin(user):
        q = q.where(PatientAllergy.tenant_id == user.tenant_id)
    q = q.order_by(PatientAllergy.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return [_allergy_dict(a) for a in rows]


# ── Vaccinations ────────────────────────────────────────────────────────────

class VaccIn(BaseModel):
    patient_phone: str
    vaccine_name: str
    given_at: Optional[str] = None
    dose_number: Optional[int] = None
    expires_at: Optional[str] = None
    batch_number: Optional[str] = None
    doctor_name: Optional[str] = None


class VaccPatch(BaseModel):
    vaccine_name: Optional[str] = None
    given_at: Optional[str] = None
    dose_number: Optional[int] = None
    expires_at: Optional[str] = None
    batch_number: Optional[str] = None
    doctor_name: Optional[str] = None


@router.post("/medcard/vaccinations", dependencies=[_staff_dep])
async def staff_create_vaccination(
    body: VaccIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Находка #7: запрет рождения записи с tenant_id=NULL.
    assert_can_create_in_tenant(user)
    v = PatientVaccination(
        tenant_id=user.tenant_id,
        patient_phone=normalize_phone(body.patient_phone),
        vaccine_name=body.vaccine_name.strip(),
        given_at=_parse_dt(body.given_at),
        dose_number=body.dose_number,
        expires_at=_parse_dt(body.expires_at),
        batch_number=body.batch_number,
        doctor_name=body.doctor_name or user.full_name,
        source="manual",
    )
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return _vacc_dict(v)


@router.patch("/medcard/vaccinations/{vid}", dependencies=[_staff_dep])
async def staff_update_vaccination(
    vid: str,
    body: VaccPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        vu = uuid.UUID(vid)
    except ValueError:
        raise HTTPException(404, "Не найдено")
    v = await db.get(PatientVaccination, vu)
    if not v:
        raise HTTPException(404, "Не найдено")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, v)
    if body.vaccine_name is not None:
        v.vaccine_name = body.vaccine_name.strip()
    if body.given_at is not None:
        v.given_at = _parse_dt(body.given_at)
    if body.dose_number is not None:
        v.dose_number = body.dose_number
    if body.expires_at is not None:
        v.expires_at = _parse_dt(body.expires_at)
    if body.batch_number is not None:
        v.batch_number = body.batch_number
    if body.doctor_name is not None:
        v.doctor_name = body.doctor_name
    await db.commit()
    await db.refresh(v)
    return _vacc_dict(v)


@router.delete("/medcard/vaccinations/{vid}", dependencies=[_staff_dep])
async def staff_delete_vaccination(
    vid: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        vu = uuid.UUID(vid)
    except ValueError:
        raise HTTPException(404, "Не найдено")
    v = await db.get(PatientVaccination, vu)
    if not v:
        raise HTTPException(404, "Не найдено")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, v)
    await db.delete(v)
    await db.commit()
    return {"ok": True}


@router.get("/medcard/vaccinations", dependencies=[_staff_dep])
async def staff_list_vaccinations(
    patient_phone: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    phone_n = normalize_phone(patient_phone)
    q = select(PatientVaccination).where(PatientVaccination.patient_phone == phone_n)
    # Находка #7: фильтр по tenant_id всегда для тенантного пользователя;
    # пропуск (все тенанты) — только super_admin по роли.
    if not _is_super_admin(user):
        q = q.where(PatientVaccination.tenant_id == user.tenant_id)
    q = q.order_by(PatientVaccination.given_at.desc().nulls_last(),
                   PatientVaccination.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return [_vacc_dict(v) for v in rows]


# ── Уровень 1: Timeline приёмов (автоматически из Referral + Appointment + МИС) ──

@router.get("/patient/medcard/timeline")
async def patient_medcard_timeline(
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    days: int = Query(365, ge=30, le=3650),
    db: AsyncSession = Depends(get_db),
):
    """Хронология медицинских событий пациента (Уровень 1).

    Агрегирует:
    - Подтверждённые/завершённые направления (Referral.status=confirmed)
    - Записи к врачу (Appointment.status=completed)
    - МИС-визиты (через find_patient_by_phone + getAppointments)

    Сортировка по дате (новые сверху).
    """
    from app.models.referral import Referral, ReferralStatus
    from app.models.doctor import Appointment, AppointmentStatus, Doctor
    from app.models.clinic import Clinic
    from app.models.service import Service
    from app.models.user import User
    from datetime import timedelta

    session = await _patient_session_or_401(db, session_token or t, x_patient_session)
    phone = normalize_phone(session.phone)
    since = datetime.utcnow() - timedelta(days=days)
    items: list[dict] = []

    # 1) Подтверждённые направления
    refs = (await db.execute(
        select(Referral).where(
            Referral.patient_phone.in_([phone, "+" + phone, "8" + phone[1:]]),
            Referral.confirmed_at.isnot(None),
            Referral.confirmed_at >= since,
        ).order_by(Referral.confirmed_at.desc())
    )).scalars().all()

    for r in refs:
        # Подгружаем clinic и service / doctor для отображения
        to_clinic_name = None
        if r.to_clinic_id:
            cl = await db.get(Clinic, r.to_clinic_id)
            to_clinic_name = cl.name if cl else None
        service_name = None
        if r.service_id:
            sv = await db.get(Service, r.service_id)
            service_name = sv.name if sv else None
        target_doctor_name = None
        if getattr(r, "target_doctor_id", None):
            d = await db.get(Doctor, r.target_doctor_id)
            target_doctor_name = d.full_name if d else None

        items.append({
            "type": "referral",
            "date": r.confirmed_at.isoformat() if r.confirmed_at else None,
            "title": service_name or target_doctor_name or (r.lab_tests[:80] if r.lab_tests else "Направление"),
            "subtitle": to_clinic_name or "Клиника",
            "referral_type": getattr(r, "referral_type", "service"),
            "referral_id": str(r.id),
            "icon": "assignment_turned_in",
            "category": "Направление",
        })

    # 2) Завершённые записи к врачу
    apts = (await db.execute(
        select(Appointment).where(
            Appointment.patient_phone.in_([phone, "+" + phone]),
            Appointment.status == AppointmentStatus.COMPLETED,
            Appointment.appointment_date >= since.date(),
        ).order_by(Appointment.appointment_date.desc())
    )).scalars().all()

    for a in apts:
        doc_name = None
        if a.doctor_id:
            doc = await db.get(Doctor, a.doctor_id)
            doc_name = doc.full_name if doc else None
        items.append({
            "type": "appointment",
            "date": a.appointment_date.isoformat() if a.appointment_date else None,
            "title": doc_name or "Приём",
            "subtitle": (a.notes[:120] if a.notes else None) or "Завершённый приём",
            "appointment_id": str(a.id),
            "icon": "stethoscope",
            "category": "Приём врача",
            "price": float(a.price) if a.price is not None else None,
            "payment_method": getattr(a, "payment_method", None),
        })

    # 3) МИС-визиты (если у тенанта подключён МИС)
    if session.tenant_id:
        try:
            from app.services.mis_client import find_patient_by_phone, _post as _mis_post
            from app.services.settings_service import get_setting as _get_s
            api_url = await _get_s(db, "mis_api_url", "", tenant_id=session.tenant_id)
            api_key = await _get_s(db, "mis_api_key", "", tenant_id=session.tenant_id)
            if api_url and api_key:
                mp = await find_patient_by_phone(session.phone, api_url=api_url, api_key=api_key)
                if mp and (mp.get("patient_id") or mp.get("id")):
                    mis_pid = mp.get("patient_id") or mp.get("id")
                    # Получим все клиники тенанта с mis_id
                    clinics = (await db.execute(
                        select(Clinic).where(
                            Clinic.tenant_id == session.tenant_id,
                            Clinic.mis_id.isnot(None),
                            Clinic.is_active == True,
                        )
                    )).scalars().all()
                    date_from = since.strftime("%d.%m.%Y")
                    date_to = datetime.now().strftime("%d.%m.%Y")
                    for c in clinics:
                        try:
                            r = await _mis_post(
                                "getAppointments",
                                api_url=api_url, api_key=api_key,
                                clinic_id=c.mis_id,
                                date_from=date_from, date_to=date_to,
                                patient_id=mis_pid,
                            )
                            data = r.get("data") or []
                            if isinstance(data, list):
                                for v in data[:30]:
                                    items.append({
                                        "type": "mis_visit",
                                        "date": v.get("time_start"),
                                        "title": (v.get("doctor_name") or v.get("specialty") or "Визит"),
                                        "subtitle": v.get("services_name") or v.get("comment") or c.name,
                                        "icon": "medical_information",
                                        "category": "Визит в МИС",
                                        "mis_appointment_id": v.get("id"),
                                        "clinic_name": c.name,
                                    })
                        except Exception:
                            continue
        except Exception:
            pass

    # Сортировка по дате (новые сверху). Items без даты — в конец.
    def _sort_key(it):
        d = it.get("date")
        if not d: return ""
        return str(d)
    items.sort(key=_sort_key, reverse=True)

    return {"items": items[:200], "total": len(items)}
