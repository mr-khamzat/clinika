"""
Роутер «Итоги приёма»: заключение врача, файлы, внутриклинические направления,
история приёмов пациента.

Эндпоинты:
  POST   /appointments/{id}/outcome
  GET    /appointments/{id}/outcome
  POST   /appointments/{id}/attachments
  GET    /appointments/{id}/attachments
  DELETE /appointments/{id}/attachments/{attachment_id}
  POST   /appointments/{id}/referrals
  GET    /appointments/{id}/referrals
  GET    /patients/{phone}/history
"""
import os
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.core.tenant import require_feature
from app.models.user import User
from app.models.doctor import Appointment, AppointmentStatus, Doctor
from app.models.appointment_outcome import (
    AppointmentOutcome,
    AppointmentAttachment,
    InternalReferral,
)


router = APIRouter(tags=["appointments-outcome"])

_FEAT = [Depends(require_feature("scheduling"))]

# ── Хранилище вложений ──────────────────────────────────────────────────────
ATTACH_ROOT = "/app/uploads/appointments"
_ALLOWED_MIMES = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
_MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 МБ


# ── Pydantic-схемы ─────────────────────────────────────────────────────────


class OutcomeIn(BaseModel):
    conclusion: str
    recommendations: Optional[str] = None


class OutcomeOut(BaseModel):
    id: uuid.UUID
    appointment_id: uuid.UUID
    conclusion: str
    recommendations: Optional[str]
    created_by_id: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AttachmentOut(BaseModel):
    id: uuid.UUID
    appointment_id: uuid.UUID
    file_url: str
    file_name: str
    mime_type: Optional[str]
    size_bytes: int
    uploaded_by_id: Optional[uuid.UUID]
    uploaded_at: datetime

    class Config:
        from_attributes = True


class ReferralIn(BaseModel):
    target_type: str  # doctor | ct | mri | xray | lab | procedure
    target_doctor_id: Optional[uuid.UUID] = None
    target_service: Optional[str] = None
    notes: Optional[str] = None


class ReferralOut(BaseModel):
    id: uuid.UUID
    source_appointment_id: uuid.UUID
    patient_phone: str
    patient_name: Optional[str]
    target_type: str
    target_doctor_id: Optional[uuid.UUID]
    target_doctor_name: Optional[str] = None
    target_service: Optional[str]
    notes: Optional[str]
    status: str
    scheduled_appointment_id: Optional[uuid.UUID]
    created_by_id: Optional[uuid.UUID]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Хелперы ─────────────────────────────────────────────────────────────────


async def _get_appt_or_404(db: AsyncSession, appt_id: uuid.UUID, user: User) -> Appointment:
    """Найти запись с проверкой tenant-изоляции."""
    appt = (await db.execute(select(Appointment).where(Appointment.id == appt_id))).scalar_one_or_none()
    if not appt:
        raise HTTPException(404, "Запись на приём не найдена")
    if user.tenant_id and appt.tenant_id and appt.tenant_id != user.tenant_id:
        raise HTTPException(403, "Чужой тенант")
    return appt


# ── Заключение врача ────────────────────────────────────────────────────────


@router.post("/appointments/{appointment_id}/outcome", response_model=OutcomeOut, dependencies=_FEAT)
async def upsert_outcome(
    appointment_id: uuid.UUID,
    data: OutcomeIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Создать или обновить заключение по приёму (1:1)."""
    appt = await _get_appt_or_404(db, appointment_id, current_user)

    existing = (await db.execute(
        select(AppointmentOutcome).where(AppointmentOutcome.appointment_id == appt.id)
    )).scalar_one_or_none()

    if existing:
        existing.conclusion = data.conclusion
        existing.recommendations = data.recommendations
        existing.updated_at = datetime.utcnow()
        outcome = existing
    else:
        outcome = AppointmentOutcome(
            appointment_id=appt.id,
            conclusion=data.conclusion,
            recommendations=data.recommendations,
            created_by_id=current_user.id,
        )
        db.add(outcome)

    # Если приём ещё не помечен как состоявшийся — переводим в COMPLETED
    was_just_completed = False
    if appt.status in (AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED):
        appt.status = AppointmentStatus.COMPLETED
        appt.updated_at = datetime.utcnow()
        was_just_completed = True

    # Глава 8: начисление баллов лояльности (+50) при закрытии приёма
    if was_just_completed and appt.tenant_id:
        try:
            from app.services import loyalty_ext_service as _ls
            await _ls.award_appointment(
                db, appt.tenant_id, appt.patient_phone, appt.id, appt.price,
            )
        except Exception:
            pass  # лояльность не должна ломать закрытие приёма

    await db.commit()
    await db.refresh(outcome)
    return outcome


@router.get("/appointments/{appointment_id}/outcome", dependencies=_FEAT)
async def get_outcome(
    appointment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Получить заключение по приёму. Возвращает 200 с null если нет."""
    appt = await _get_appt_or_404(db, appointment_id, current_user)
    outcome = (await db.execute(
        select(AppointmentOutcome).where(AppointmentOutcome.appointment_id == appt.id)
    )).scalar_one_or_none()
    if not outcome:
        return None
    return OutcomeOut.model_validate(outcome)


# ── Файлы (вложения) ────────────────────────────────────────────────────────


@router.post("/appointments/{appointment_id}/attachments", response_model=AttachmentOut, dependencies=_FEAT)
async def upload_attachment(
    appointment_id: uuid.UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Загрузить файл (PDF/JPG/PNG/WEBP, ≤25 МБ) к приёму."""
    appt = await _get_appt_or_404(db, appointment_id, current_user)

    ctype = (file.content_type or "").lower()
    if ctype not in _ALLOWED_MIMES:
        raise HTTPException(400, "Допустимые форматы: PDF, JPG, PNG, WEBP")
    ext = _ALLOWED_MIMES[ctype]

    contents = await file.read()
    if not contents:
        raise HTTPException(400, "Пустой файл")
    if len(contents) > _MAX_FILE_SIZE:
        raise HTTPException(400, "Размер файла превышает 25 МБ")

    # Сохраняем под уникальным именем в каталоге приёма
    folder = os.path.join(ATTACH_ROOT, str(appt.id))
    os.makedirs(folder, exist_ok=True)
    file_id = uuid.uuid4()
    target_path = os.path.join(folder, f"{file_id}.{ext}")
    with open(target_path, "wb") as f:
        f.write(contents)

    file_url = f"/api/appointments/{appt.id}/attachments/{file_id}/raw"

    att = AppointmentAttachment(
        id=file_id,
        appointment_id=appt.id,
        file_url=file_url,
        file_name=file.filename or f"file.{ext}",
        mime_type=ctype,
        size_bytes=len(contents),
        uploaded_by_id=current_user.id,
    )
    db.add(att)
    await db.commit()
    await db.refresh(att)
    return att


@router.get("/appointments/{appointment_id}/attachments", response_model=list[AttachmentOut], dependencies=_FEAT)
async def list_attachments(
    appointment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список файлов приёма."""
    appt = await _get_appt_or_404(db, appointment_id, current_user)
    rows = (await db.execute(
        select(AppointmentAttachment)
        .where(AppointmentAttachment.appointment_id == appt.id)
        .order_by(AppointmentAttachment.uploaded_at.desc())
    )).scalars().all()
    return rows


@router.delete("/appointments/{appointment_id}/attachments/{attachment_id}", dependencies=_FEAT)
async def delete_attachment(
    appointment_id: uuid.UUID,
    attachment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Удалить файл приёма (запись + физический файл)."""
    appt = await _get_appt_or_404(db, appointment_id, current_user)
    att = (await db.execute(
        select(AppointmentAttachment).where(
            AppointmentAttachment.id == attachment_id,
            AppointmentAttachment.appointment_id == appt.id,
        )
    )).scalar_one_or_none()
    if not att:
        raise HTTPException(404, "Файл не найден")
    # Удаляем физический файл (best-effort, не падаем если уже нет)
    folder = os.path.join(ATTACH_ROOT, str(appt.id))
    if os.path.isdir(folder):
        for fname in os.listdir(folder):
            if fname.startswith(str(att.id) + "."):
                try:
                    os.remove(os.path.join(folder, fname))
                except OSError:
                    pass
    await db.delete(att)
    await db.commit()
    return {"ok": True}


@router.get("/appointments/{appointment_id}/attachments/{attachment_id}/raw", dependencies=_FEAT)
async def serve_attachment(
    appointment_id: uuid.UUID,
    attachment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Скачать/просмотреть файл приёма (требует авторизацию)."""
    appt = await _get_appt_or_404(db, appointment_id, current_user)
    att = (await db.execute(
        select(AppointmentAttachment).where(
            AppointmentAttachment.id == attachment_id,
            AppointmentAttachment.appointment_id == appt.id,
        )
    )).scalar_one_or_none()
    if not att:
        raise HTTPException(404, "Файл не найден")
    folder = os.path.join(ATTACH_ROOT, str(appt.id))
    if not os.path.isdir(folder):
        raise HTTPException(404, "Файл отсутствует на диске")
    found = None
    for fname in os.listdir(folder):
        if fname.startswith(str(att.id) + "."):
            found = os.path.join(folder, fname)
            break
    if not found or not os.path.isfile(found):
        raise HTTPException(404, "Файл отсутствует на диске")
    return FileResponse(found, media_type=att.mime_type or "application/octet-stream", filename=att.file_name)


# ── Внутриклинические направления ──────────────────────────────────────────


_VALID_TARGETS = {"doctor", "ct", "mri", "xray", "lab", "procedure"}


@router.post("/appointments/{appointment_id}/referrals", response_model=ReferralOut, dependencies=_FEAT)
async def create_internal_referral(
    appointment_id: uuid.UUID,
    data: ReferralIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Создать внутриклиническое направление по итогу приёма."""
    appt = await _get_appt_or_404(db, appointment_id, current_user)

    target_type = (data.target_type or "").strip().lower()
    if target_type not in _VALID_TARGETS:
        raise HTTPException(400, f"Недопустимый target_type. Разрешённые: {sorted(_VALID_TARGETS)}")

    if target_type == "doctor" and not data.target_doctor_id:
        raise HTTPException(400, "Для направления к врачу необходимо указать target_doctor_id")
    if target_type != "doctor" and not (data.target_service or "").strip():
        raise HTTPException(400, "Для не-врачебного направления необходимо указать target_service")

    target_doctor_name = None
    if data.target_doctor_id:
        d = (await db.execute(select(Doctor).where(Doctor.id == data.target_doctor_id))).scalar_one_or_none()
        if not d:
            raise HTTPException(404, "Целевой врач не найден")
        if current_user.tenant_id and d.tenant_id and d.tenant_id != current_user.tenant_id:
            raise HTTPException(403, "Чужой тенант")
        target_doctor_name = d.full_name

    ref = InternalReferral(
        tenant_id=appt.tenant_id,
        source_appointment_id=appt.id,
        patient_phone=appt.patient_phone,
        patient_name=appt.patient_name,
        target_type=target_type,
        target_doctor_id=data.target_doctor_id,
        target_service=data.target_service,
        notes=data.notes,
        status="pending",
        created_by_id=current_user.id,
    )
    db.add(ref)
    await db.commit()
    await db.refresh(ref)

    out = ReferralOut.model_validate(ref)
    out.target_doctor_name = target_doctor_name
    return out


@router.get("/appointments/{appointment_id}/referrals", response_model=list[ReferralOut], dependencies=_FEAT)
async def list_internal_referrals(
    appointment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Все направления, созданные из этого приёма."""
    appt = await _get_appt_or_404(db, appointment_id, current_user)
    rows = (await db.execute(
        select(InternalReferral)
        .where(InternalReferral.source_appointment_id == appt.id)
        .order_by(InternalReferral.created_at.desc())
    )).scalars().all()

    # Подгружаем имена целевых врачей одним запросом
    doctor_ids = [r.target_doctor_id for r in rows if r.target_doctor_id]
    name_by_id: dict[uuid.UUID, str] = {}
    if doctor_ids:
        docs = (await db.execute(select(Doctor).where(Doctor.id.in_(doctor_ids)))).scalars().all()
        name_by_id = {d.id: d.full_name for d in docs}

    out_list: list[ReferralOut] = []
    for r in rows:
        m = ReferralOut.model_validate(r)
        if r.target_doctor_id and r.target_doctor_id in name_by_id:
            m.target_doctor_name = name_by_id[r.target_doctor_id]
        out_list.append(m)
    return out_list


# ── История приёмов пациента ───────────────────────────────────────────────


@router.get("/patients/{phone}/history", dependencies=_FEAT)
async def patient_appointment_history(
    phone: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """История приёмов пациента (по телефону) — последние 50 визитов с заключениями.

    Поиск делается по нескольким нормализованным вариантам телефона: исходный,
    +7-формат и 8-формат, чтобы расхождения в денормализации не теряли историю.
    """
    raw = (phone or "").strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    candidates = {raw}
    if digits:
        candidates.add(digits)
        if len(digits) == 11 and digits.startswith("7"):
            candidates.add("+" + digits)
            candidates.add("8" + digits[1:])
        elif len(digits) == 11 and digits.startswith("8"):
            candidates.add("+7" + digits[1:])
            candidates.add("8" + digits[1:])
        elif len(digits) == 10:
            candidates.add("+7" + digits)
            candidates.add("8" + digits)

    q = select(Appointment).where(Appointment.patient_phone.in_(list(candidates)))
    if current_user.tenant_id:
        q = q.where(Appointment.tenant_id == current_user.tenant_id)
    q = q.order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc()).limit(50)
    appts = (await db.execute(q)).scalars().all()
    if not appts:
        return []

    appt_ids = [a.id for a in appts]
    doctor_ids = list({a.doctor_id for a in appts})

    outcomes = (await db.execute(
        select(AppointmentOutcome).where(AppointmentOutcome.appointment_id.in_(appt_ids))
    )).scalars().all()
    outcome_by_appt = {o.appointment_id: o for o in outcomes}

    docs = (await db.execute(select(Doctor).where(Doctor.id.in_(doctor_ids)))).scalars().all()
    doctor_by_id = {d.id: d for d in docs}

    refs = (await db.execute(
        select(InternalReferral).where(InternalReferral.source_appointment_id.in_(appt_ids))
    )).scalars().all()
    ref_count_by_appt: dict[uuid.UUID, int] = {}
    for r in refs:
        ref_count_by_appt[r.source_appointment_id] = ref_count_by_appt.get(r.source_appointment_id, 0) + 1

    result = []
    for a in appts:
        d = doctor_by_id.get(a.doctor_id)
        o = outcome_by_appt.get(a.id)
        result.append({
            "id": str(a.id),
            "appointment_date": a.appointment_date.isoformat(),
            "start_time": a.start_time.strftime("%H:%M"),
            "end_time": a.end_time.strftime("%H:%M"),
            "status": a.status.value if hasattr(a.status, "value") else a.status,
            "doctor_id": str(a.doctor_id) if a.doctor_id else None,
            "doctor_name": d.full_name if d else None,
            "doctor_specialty": d.specialty if d else None,
            "patient_name": a.patient_name,
            "patient_phone": a.patient_phone,
            "notes": a.notes,
            "has_outcome": o is not None,
            "conclusion": (o.conclusion if o else None),
            "recommendations": (o.recommendations if o else None),
            "outcome_created_at": (o.created_at.isoformat() if o else None),
            "referrals_count": ref_count_by_appt.get(a.id, 0),
        })
    return result
