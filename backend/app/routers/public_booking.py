"""
Публичные эндпоинты онлайн-записи пациентов — без авторизации.
"""
import uuid
import random
from datetime import date, time, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.tenant import Tenant
from app.models.clinic import Clinic
from app.models.doctor import Doctor, DoctorSchedule, Appointment, AppointmentStatus
from app.services.scheduling_service import get_available_slots, book_slot
from app.services.qr_service import generate_qr_image_base64
from app.core.security import make_appointment_token
from app.utils.phone import normalize_phone

router = APIRouter(prefix="/public", tags=["public-booking"])


async def _get_tenant(slug: str, db: AsyncSession) -> Tenant:
    """Возвращает активного тенанта по slug или 404."""
    t = (await db.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one_or_none()
    if not t or not t.is_active:
        raise HTTPException(404, "Клиника не найдена")
    return t


async def _gen_apt_code(db: AsyncSession) -> int:
    """Генерирует уникальный 5-значный код записи."""
    for _ in range(20):
        code = random.randint(10000, 99999)
        ex = (await db.execute(select(Appointment).where(Appointment.short_code == code))).scalar_one_or_none()
        if not ex:
            return code
    raise HTTPException(500, "Не удалось сгенерировать код")


@router.get("/{slug}/doctors")
async def public_list_doctors(slug: str, db: AsyncSession = Depends(get_db)):
    """Список активных врачей тенанта с расписанием (без авторизации)."""
    tenant = await _get_tenant(slug, db)

    rows = (await db.execute(
        select(Doctor, Clinic)
        .join(Clinic, Doctor.clinic_id == Clinic.id)
        .where(
            Doctor.is_active == True,
            Clinic.tenant_id == tenant.id,
            Clinic.is_active == True,
        )
        .order_by(Doctor.full_name)
    )).all()

    # Определяем у каких врачей есть активное расписание
    doctor_ids = [r.Doctor.id for r in rows]
    has_schedule = set()
    if doctor_ids:
        has_schedule = set((await db.execute(
            select(DoctorSchedule.doctor_id).where(
                DoctorSchedule.doctor_id.in_(doctor_ids),
                DoctorSchedule.is_active == True,
            ).distinct()
        )).scalars().all())

    result = []
    for r in rows:
        doc, clinic = r.Doctor, r.Clinic
        # Показываем только врачей с настроенным расписанием
        if doc.id not in has_schedule:
            continue
        result.append({
            "id": str(doc.id),
            "full_name": doc.full_name,
            "specialty": doc.specialty,
            "photo_url": doc.photo_url,
            "bio": doc.bio,
            "slot_duration": doc.slot_duration,
            "clinic_id": str(clinic.id),
            "clinic_name": clinic.name,
        })
    return result


@router.get("/{slug}/doctors/{doctor_id}/slots")
async def public_get_slots(
    slug: str,
    doctor_id: str,
    date: str = Query(..., description="YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db),
):
    """Свободные слоты врача на конкретную дату (без авторизации)."""
    await _get_tenant(slug, db)
    try:
        did = uuid.UUID(doctor_id)
        target = datetime.strptime(date, "%Y-%m-%d").date()
    except (ValueError, AttributeError):
        raise HTTPException(400, "Неверный формат")
    from datetime import date as _date
    if target < _date.today():
        raise HTTPException(400, "Нельзя записаться на прошедшую дату")
    return await get_available_slots(db, did, target)


class BookRequest(BaseModel):
    doctor_id: uuid.UUID
    appointment_date: str   # "YYYY-MM-DD"
    start_time: str         # "HH:MM"
    patient_name: str
    patient_phone: str


@router.post("/{slug}/book")
async def public_book(slug: str, body: BookRequest, db: AsyncSession = Depends(get_db)):
    """Создать запись к врачу (без авторизации). Возвращает короткий код и QR."""
    tenant = await _get_tenant(slug, db)

    # Проверяем что врач принадлежит тенанту
    row = (await db.execute(
        select(Doctor, Clinic)
        .join(Clinic, Doctor.clinic_id == Clinic.id)
        .where(
            Doctor.id == body.doctor_id,
            Doctor.is_active == True,
            Clinic.tenant_id == tenant.id,
        )
    )).first()
    if not row:
        raise HTTPException(404, "Врач не найден")

    try:
        h, m = body.start_time.split(":")
        st = time(int(h), int(m))
        apt_date = datetime.strptime(body.appointment_date, "%Y-%m-%d").date()
    except (ValueError, AttributeError):
        raise HTTPException(400, "Неверный формат")

    phone = normalize_phone(body.patient_phone)

    # Создаём запись через сервис (проверяет конфликты)
    apt = await book_slot(
        db=db,
        doctor_id=body.doctor_id,
        appointment_date=apt_date,
        start_time=st,
        patient_phone=phone,
        patient_name=body.patient_name.strip() or None,
        tenant_id=tenant.id,
    )
    apt.short_code = await _gen_apt_code(db)
    apt.qr_code = generate_qr_image_base64(str(apt.id))

    await db.commit()
    await db.refresh(apt)

    token = make_appointment_token(str(apt.id), apt.patient_phone)
    return {
        "id": str(apt.id),
        "doctor_name": row.Doctor.full_name,
        "specialty": row.Doctor.specialty,
        "clinic_name": row.Clinic.name,
        "appointment_date": apt.appointment_date.isoformat(),
        "start_time": str(apt.start_time)[:5],
        "end_time": str(apt.end_time)[:5],
        "short_code": apt.short_code,
        "qr_code": apt.qr_code,
        "patient_token": token,
        "cabinet_url": f"/{slug}/p/{apt.id}?t={token}",
    }
