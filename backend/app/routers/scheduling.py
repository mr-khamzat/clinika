"""
Роутер расписания врачей: /doctors/* и /appointments/*
Требует feature "scheduling" (план enterprise).
"""
import uuid
from datetime import date, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user, require_manager
from app.core.tenant import require_feature
from app.models.user import User
from app.models.doctor import Doctor, DoctorSchedule, Appointment, AppointmentStatus
from app.services.scheduling_service import get_available_slots, book_slot

router = APIRouter(tags=["scheduling"])

_FEAT = [Depends(require_feature("scheduling"))]


# ── Схемы ────────────────────────────────────────────────────────────────────

class DoctorCreate(BaseModel):
    clinic_id: uuid.UUID
    full_name: str
    specialty: Optional[str] = None
    photo_url: Optional[str] = None
    bio: Optional[str] = None
    slot_duration: int = 30

class DoctorUpdate(BaseModel):
    full_name: Optional[str] = None
    specialty: Optional[str] = None
    photo_url: Optional[str] = None
    bio: Optional[str] = None
    slot_duration: Optional[int] = None
    is_active: Optional[bool] = None

class DoctorOut(BaseModel):
    id: uuid.UUID
    clinic_id: uuid.UUID
    full_name: str
    specialty: Optional[str]
    photo_url: Optional[str]
    bio: Optional[str]
    slot_duration: int
    is_active: bool
    class Config: from_attributes = True

class ScheduleDayIn(BaseModel):
    day_of_week: int   # 0=Пн, 6=Вс
    start_time: time
    end_time: time
    is_active: bool = True

class AppointmentCreate(BaseModel):
    doctor_id: uuid.UUID
    appointment_date: date
    start_time: time
    patient_phone: str
    patient_name: Optional[str] = None
    referral_id: Optional[uuid.UUID] = None
    notes: Optional[str] = None

class AppointmentStatusUpdate(BaseModel):
    status: AppointmentStatus

class AppointmentOut(BaseModel):
    id: uuid.UUID
    doctor_id: uuid.UUID
    clinic_id: uuid.UUID
    patient_phone: str
    patient_name: Optional[str]
    appointment_date: date
    start_time: time
    end_time: time
    status: AppointmentStatus
    notes: Optional[str]
    created_at: str
    class Config: from_attributes = True


# ── Врачи ─────────────────────────────────────────────────────────────────────

@router.get("/doctors", response_model=list[DoctorOut], dependencies=_FEAT)
async def list_doctors(
    clinic_id: Optional[uuid.UUID] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список врачей. Фильтр по клинике. Изолировано по тенанту."""
    q = select(Doctor).where(Doctor.is_active == True)
    if current_user.tenant_id is not None:
        from app.models.clinic import Clinic
        # Врачи тенанта = врачи, чья клиника принадлежит тенанту
        tenant_clinic_ids = (await db.execute(
            select(Clinic.id).where(Clinic.tenant_id == current_user.tenant_id)
        )).scalars().all()
        q = q.where(Doctor.clinic_id.in_(tenant_clinic_ids))
    if clinic_id:
        q = q.where(Doctor.clinic_id == clinic_id)
    return (await db.execute(q.order_by(Doctor.full_name))).scalars().all()


@router.get("/doctors/{doctor_id}", response_model=DoctorOut, dependencies=_FEAT)
async def get_doctor(doctor_id: uuid.UUID, _=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    d = (await db.execute(select(Doctor).where(Doctor.id == doctor_id))).scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Врач не найден")
    return d


@router.post("/doctors", response_model=DoctorOut, status_code=201, dependencies=_FEAT)
async def create_doctor(
    data: DoctorCreate,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    doctor = Doctor(**data.model_dump())
    db.add(doctor)
    await db.commit()
    await db.refresh(doctor)
    return doctor


@router.patch("/doctors/{doctor_id}", response_model=DoctorOut, dependencies=_FEAT)
async def update_doctor(
    doctor_id: uuid.UUID,
    data: DoctorUpdate,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    doctor = (await db.execute(select(Doctor).where(Doctor.id == doctor_id))).scalar_one_or_none()
    if not doctor:
        raise HTTPException(404, "Врач не найден")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(doctor, k, v)
    await db.commit()
    await db.refresh(doctor)
    return doctor


# ── Расписание врача (шаблон) ──────────────────────────────────────────────

@router.get("/doctors/{doctor_id}/schedule", dependencies=_FEAT)
async def get_doctor_schedule(
    doctor_id: uuid.UUID, _=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Шаблонное расписание врача по дням недели."""
    rows = (await db.execute(
        select(DoctorSchedule).where(DoctorSchedule.doctor_id == doctor_id).order_by(DoctorSchedule.day_of_week)
    )).scalars().all()
    DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    sched_map = {r.day_of_week: r for r in rows}
    return [
        {
            "day_of_week": d,
            "day_name": DAY_NAMES[d],
            "is_active": sched_map[d].is_active if d in sched_map else False,
            "start_time": sched_map[d].start_time.strftime("%H:%M") if d in sched_map else "09:00",
            "end_time":   sched_map[d].end_time.strftime("%H:%M")   if d in sched_map else "18:00",
        }
        for d in range(7)
    ]


@router.put("/doctors/{doctor_id}/schedule", dependencies=_FEAT)
async def update_doctor_schedule(
    doctor_id: uuid.UUID,
    days: list[ScheduleDayIn],
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Полная замена шаблона расписания врача."""
    from sqlalchemy import delete
    await db.execute(delete(DoctorSchedule).where(DoctorSchedule.doctor_id == doctor_id))
    for day in days:
        if day.is_active:
            db.add(DoctorSchedule(
                doctor_id=doctor_id,
                day_of_week=day.day_of_week,
                start_time=day.start_time,
                end_time=day.end_time,
                is_active=True,
            ))
    await db.commit()
    return {"status": "ok"}


# ── Слоты на дату ─────────────────────────────────────────────────────────────

@router.get("/doctors/{doctor_id}/slots", dependencies=_FEAT)
async def get_slots(
    doctor_id: uuid.UUID,
    target_date: date = Query(..., description="Дата в формате YYYY-MM-DD"),
    _=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Свободные и занятые слоты врача на конкретную дату."""
    if target_date < date.today():
        raise HTTPException(400, "Нельзя смотреть слоты в прошлом")
    return await get_available_slots(db, doctor_id, target_date)


# ── Записи на приём ───────────────────────────────────────────────────────────

@router.post("/appointments", status_code=201, dependencies=_FEAT)
async def create_appointment(
    data: AppointmentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Записать пациента на слот."""
    appt = await book_slot(
        db,
        doctor_id=data.doctor_id,
        appointment_date=data.appointment_date,
        start_time=data.start_time,
        patient_phone=data.patient_phone,
        patient_name=data.patient_name,
        created_by_id=current_user.id,
        referral_id=data.referral_id,
        notes=data.notes,
        tenant_id=current_user.tenant_id,
    )
    await db.commit()
    return {
        "id": str(appt.id),
        "doctor_id": str(appt.doctor_id),
        "appointment_date": appt.appointment_date.isoformat(),
        "start_time": appt.start_time.strftime("%H:%M"),
        "end_time": appt.end_time.strftime("%H:%M"),
        "status": appt.status,
    }


@router.get("/appointments", dependencies=_FEAT)
async def list_appointments(
    doctor_id: Optional[uuid.UUID] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None),
    appointment_date: Optional[date] = Query(None),
    status: Optional[AppointmentStatus] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список записей. Фильтры: врач, клиника, дата, статус. Изолировано по тенанту."""
    q = select(Appointment)
    if current_user.tenant_id is not None:
        q = q.where(Appointment.tenant_id == current_user.tenant_id)
    if doctor_id:
        q = q.where(Appointment.doctor_id == doctor_id)
    if clinic_id:
        q = q.where(Appointment.clinic_id == clinic_id)
    if appointment_date:
        q = q.where(Appointment.appointment_date == appointment_date)
    if status:
        q = q.where(Appointment.status == status)
    q = q.order_by(Appointment.appointment_date, Appointment.start_time)
    rows = (await db.execute(q)).scalars().all()
    return [
        {
            "id": str(a.id),
            "doctor_id": str(a.doctor_id),
            "clinic_id": str(a.clinic_id),
            "patient_phone": a.patient_phone,
            "patient_name": a.patient_name,
            "appointment_date": a.appointment_date.isoformat(),
            "start_time": a.start_time.strftime("%H:%M"),
            "end_time": a.end_time.strftime("%H:%M"),
            "status": a.status,
            "notes": a.notes,
            "created_at": a.created_at.isoformat(),
        }
        for a in rows
    ]


@router.patch("/appointments/{appointment_id}/status", dependencies=_FEAT)
async def update_appointment_status(
    appointment_id: uuid.UUID,
    data: AppointmentStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Изменить статус записи (подтвердить / отменить / завершить)."""
    appt = (await db.execute(select(Appointment).where(Appointment.id == appointment_id))).scalar_one_or_none()
    if not appt:
        raise HTTPException(404, "Запись не найдена")
    appt.status = data.status
    from datetime import datetime
    appt.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": str(appt.id), "status": appt.status}


@router.get("/my-doctor")
async def get_my_doctor(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Получить запись Doctor, привязанную к текущему пользователю (роль doctor)."""
    from app.models.clinic import Clinic
    result = await db.execute(select(Doctor).where(Doctor.user_id == current_user.id))
    doctor = result.scalar_one_or_none()
    if not doctor:
        raise HTTPException(404, "Профиль врача не найден")
    clinic = None
    if doctor.clinic_id:
        clinic = (await db.execute(select(Clinic).where(Clinic.id == doctor.clinic_id))).scalar_one_or_none()
    return {
        "id": str(doctor.id),
        "full_name": doctor.full_name,
        "specialty": doctor.specialty,
        "clinic_id": str(doctor.clinic_id) if doctor.clinic_id else None,
        "clinic_name": clinic.name if clinic else None,
        "mis_id": doctor.mis_id,
        "user_id": str(current_user.id),
        "username": current_user.username,
    }
