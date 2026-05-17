"""
Роутер расписания врачей: /doctors/* и /appointments/*
Требует feature "scheduling" (план enterprise).
"""
import os
import shutil
import time as _time
import uuid
from datetime import date, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user, require_manager
from app.core.tenant import require_feature
from app.models.user import User
from app.models.doctor import Doctor, DoctorSchedule, Appointment, AppointmentStatus
from app.services.scheduling_service import get_available_slots, book_slot
from app.services import subscription_service as ss

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
    experience_years: Optional[int] = None
    # bonusv2_01: бонус за направление к этому врачу (получает АВТОР направления)
    referral_bonus_type: Optional[str] = None  # none | fixed | percent
    referral_bonus_amount: Optional[float] = None
    referral_bonus_percent: Optional[float] = None
    visit_price: Optional[float] = None

class DoctorUpdate(BaseModel):
    full_name: Optional[str] = None
    specialty: Optional[str] = None
    photo_url: Optional[str] = None
    bio: Optional[str] = None
    slot_duration: Optional[int] = None
    experience_years: Optional[int] = None
    clinic_id: Optional[uuid.UUID] = None
    is_active: Optional[bool] = None
    referral_bonus_type: Optional[str] = None
    referral_bonus_amount: Optional[float] = None
    referral_bonus_percent: Optional[float] = None
    visit_price: Optional[float] = None

class DoctorOut(BaseModel):
    id: uuid.UUID
    clinic_id: uuid.UUID
    full_name: str
    specialty: Optional[str]
    photo_url: Optional[str]
    bio: Optional[str]
    slot_duration: int
    experience_years: Optional[int] = None
    is_active: bool
    referral_bonus_type: Optional[str] = None
    referral_bonus_amount: Optional[float] = None
    referral_bonus_percent: Optional[float] = None
    visit_price: Optional[float] = None
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
async def get_doctor(doctor_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    d = (await db.execute(select(Doctor).where(Doctor.id == doctor_id))).scalar_one_or_none()
    if not d or (current_user.tenant_id is not None and d.tenant_id != current_user.tenant_id):
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
    if not doctor or (current_user.tenant_id is not None and doctor.tenant_id != current_user.tenant_id):
        raise HTTPException(404, "Врач не найден")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(doctor, k, v)
    await db.commit()
    await db.refresh(doctor)
    return doctor


# ── Фото врача (загрузка / удаление / отдача файла) ──────────────────────────

DOCTOR_PHOTO_DIR = "/app/uploads/doctors"
_ALLOWED_PHOTO_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg":  "jpg",
    "image/png":  "png",
    "image/webp": "webp",
}
_MAX_PHOTO_SIZE = 5 * 1024 * 1024  # 5 MB


def _find_existing_photo(doctor_id: uuid.UUID) -> Optional[str]:
    """Найти файл фото врача в любом из поддерживаемых расширений."""
    if not os.path.isdir(DOCTOR_PHOTO_DIR):
        return None
    for ext in ("jpg", "jpeg", "png", "webp"):
        path = os.path.join(DOCTOR_PHOTO_DIR, f"{doctor_id}.{ext}")
        if os.path.isfile(path):
            return path
    return None


@router.post("/doctors/{doctor_id}/photo", dependencies=_FEAT)
async def upload_doctor_photo(
    doctor_id: uuid.UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Загрузить фото врача (multipart). Принимает jpeg/png/webp ≤ 5 MB."""
    doctor = (await db.execute(select(Doctor).where(Doctor.id == doctor_id))).scalar_one_or_none()
    if not doctor or (current_user.tenant_id is not None and doctor.tenant_id != current_user.tenant_id):
        raise HTTPException(404, "Врач не найден")

    # Проверка MIME-типа
    ctype = (file.content_type or "").lower()
    if ctype not in _ALLOWED_PHOTO_TYPES:
        raise HTTPException(400, "Допустимые форматы: JPEG, PNG, WEBP")
    ext = _ALLOWED_PHOTO_TYPES[ctype]

    # Читаем содержимое и проверяем размер
    contents = await file.read()
    if len(contents) > _MAX_PHOTO_SIZE:
        raise HTTPException(400, "Размер файла превышает 5 МБ")
    if not contents:
        raise HTTPException(400, "Пустой файл")

    # Удаляем старый файл (если есть с другим расширением)
    old_path = _find_existing_photo(doctor_id)
    if old_path and not old_path.endswith(f".{ext}"):
        try:
            os.remove(old_path)
        except OSError:
            pass

    # Сохраняем новый
    os.makedirs(DOCTOR_PHOTO_DIR, exist_ok=True)
    target_path = os.path.join(DOCTOR_PHOTO_DIR, f"{doctor_id}.{ext}")
    with open(target_path, "wb") as f:
        f.write(contents)

    ts = int(_time.time())
    photo_url = f"/uploads/doctors/{doctor_id}.{ext}?v={ts}"
    doctor.photo_url = photo_url
    await db.commit()
    return {"photo_url": photo_url}


@router.delete("/doctors/{doctor_id}/photo", dependencies=_FEAT)
async def delete_doctor_photo(
    doctor_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Удалить фото врача (файл + photo_url)."""
    doctor = (await db.execute(select(Doctor).where(Doctor.id == doctor_id))).scalar_one_or_none()
    if not doctor or (current_user.tenant_id is not None and doctor.tenant_id != current_user.tenant_id):
        raise HTTPException(404, "Врач не найден")
    path = _find_existing_photo(doctor_id)
    if path:
        try:
            os.remove(path)
        except OSError:
            pass
    doctor.photo_url = None
    await db.commit()
    return {"ok": True}


@router.get("/uploads/doctors/{filename}")
async def serve_doctor_photo(filename: str):
    """Отдача файла фото врача (публичный endpoint, без auth — фото публичны)."""
    # защита от path-traversal
    if "/" in filename or ".." in filename or "\\" in filename:
        raise HTTPException(400, "Некорректное имя файла")
    path = os.path.join(DOCTOR_PHOTO_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Фото не найдено")
    return FileResponse(path)


# ── Расписание врача (шаблон) ──────────────────────────────────────────────

@router.get("/doctors/{doctor_id}/schedule", dependencies=_FEAT)
async def get_doctor_schedule(
    doctor_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Шаблонное расписание врача по дням недели."""
    # Tenant isolation
    doctor = (await db.execute(select(Doctor).where(Doctor.id == doctor_id))).scalar_one_or_none()
    if not doctor or (current_user.tenant_id is not None and doctor.tenant_id != current_user.tenant_id):
        raise HTTPException(404, "Врач не найден")
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
    # Tenant isolation
    doctor = (await db.execute(select(Doctor).where(Doctor.id == doctor_id))).scalar_one_or_none()
    if not doctor or (current_user.tenant_id is not None and doctor.tenant_id != current_user.tenant_id):
        raise HTTPException(404, "Врач не найден")
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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Свободные и занятые слоты врача на конкретную дату."""
    if target_date < date.today():
        raise HTTPException(400, "Нельзя смотреть слоты в прошлом")
    # Tenant isolation
    doctor = (await db.execute(select(Doctor).where(Doctor.id == doctor_id))).scalar_one_or_none()
    if not doctor or (current_user.tenant_id is not None and doctor.tenant_id != current_user.tenant_id):
        raise HTTPException(404, "Врач не найден")
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
    # ── Применяем скидку по активной подписке пациента (если есть) ─────────
    try:
        if appt.price is not None:
            disc = await ss.compute_discount_for(
                db, appt.patient_phone,
                base_price=appt.price,
                tenant_id=current_user.tenant_id,
            )
            if disc.get("applied_subscription_id"):
                appt.applied_subscription_id = uuid.UUID(disc["applied_subscription_id"])
                appt.discount_percent = disc.get("discount_percent") or 0
                appt.discount_amount = disc.get("discount_amount") or 0
        # Priority booking marker если у пациента priority_booking feature
        bens = None
        if appt.applied_subscription_id:
            sub = await ss.get_active_subscription_by_phone(db, appt.patient_phone)
            if sub:
                bens = await ss.benefits_for_db(db, sub.plan,
                                                  tenant_id=current_user.tenant_id)
        if bens and bens.get("priority_booking"):
            if (appt.priority or "normal") == "normal":
                appt.priority = "high"
    except Exception:
        # Не критично — без скидки нельзя ломать запись
        pass
    await db.commit()
    return {
        "id": str(appt.id),
        "doctor_id": str(appt.doctor_id),
        "appointment_date": appt.appointment_date.isoformat(),
        "start_time": appt.start_time.strftime("%H:%M"),
        "end_time": appt.end_time.strftime("%H:%M"),
        "status": appt.status,
        "price": float(appt.price) if appt.price is not None else None,
        "applied_subscription_id": str(appt.applied_subscription_id) if appt.applied_subscription_id else None,
        "discount_percent": float(appt.discount_percent or 0),
        "discount_amount": float(appt.discount_amount or 0),
        "priority": appt.priority,
    }


@router.get("/appointments", dependencies=_FEAT)
async def list_appointments(
    doctor_id: Optional[uuid.UUID] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None),
    appointment_date: Optional[date] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    status: Optional[AppointmentStatus] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список записей. Фильтры: врач, клиника, дата, диапазон, статус. Изолировано по тенанту."""
    q = select(Appointment)
    if current_user.tenant_id is not None:
        q = q.where(Appointment.tenant_id == current_user.tenant_id)
    if doctor_id:
        q = q.where(Appointment.doctor_id == doctor_id)
    if clinic_id:
        q = q.where(Appointment.clinic_id == clinic_id)
    if appointment_date:
        q = q.where(Appointment.appointment_date == appointment_date)
    if from_date:
        q = q.where(Appointment.appointment_date >= from_date)
    if to_date:
        q = q.where(Appointment.appointment_date <= to_date)
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
    if not appt or (current_user.tenant_id is not None and appt.tenant_id != current_user.tenant_id):
        raise HTTPException(404, "Запись не найдена")
    before_status_val = appt.status.value if hasattr(appt.status, "value") else str(appt.status)
    appt.status = data.status
    from datetime import datetime
    appt.updated_at = datetime.utcnow()

    # Этап 2-3 INVENTORY_COST_PLAN: hooks при смене статуса (best-effort).
    new_status_val = data.status.value if hasattr(data.status, "value") else str(data.status)
    try:
        if new_status_val == "completed" and before_status_val != "completed":
            from app.services.appointment_costing import on_appointment_completed
            await on_appointment_completed(db, appt.id, current_user.id)
        elif before_status_val == "completed" and new_status_val != "completed":
            from app.services.appointment_costing import on_appointment_uncomplete
            if appt.tenant_id:
                await on_appointment_uncomplete(db, appt.id, appt.tenant_id)
    except Exception as _e:  # noqa: BLE001
        import logging as _logging
        _logging.getLogger("appointments").warning(
            "inventory hook (scheduling) failed: %s", _e
        )

    await db.commit()
    return {"id": str(appt.id), "status": appt.status}


# ── Перенос/редактирование записи ────────────────────────────────────────────

class AppointmentMove(BaseModel):
    appointment_date: Optional[date] = None
    start_time: Optional[time] = None
    notes: Optional[str] = None
    patient_name: Optional[str] = None
    priority: Optional[str] = None  # normal | high | urgent


@router.patch("/appointments/{appointment_id}", dependencies=_FEAT)
async def move_appointment(
    appointment_id: uuid.UUID,
    data: AppointmentMove,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Перенос записи на другое время/дату или редактирование примечаний.
    Проверяет, что новый слот свободен (если дата/время изменены).
    """
    appt = (await db.execute(select(Appointment).where(Appointment.id == appointment_id))).scalar_one_or_none()
    if not appt:
        raise HTTPException(404, "Запись не найдена")
    if current_user.tenant_id and appt.tenant_id != current_user.tenant_id:
        raise HTTPException(403, "Чужой тенант")

    new_date = data.appointment_date or appt.appointment_date
    new_start = data.start_time or appt.start_time

    # Если меняется дата или время — проверяем конфликт
    if (data.appointment_date and data.appointment_date != appt.appointment_date) or \
       (data.start_time and data.start_time != appt.start_time):
        conflict = (await db.execute(
            select(Appointment).where(
                Appointment.doctor_id == appt.doctor_id,
                Appointment.appointment_date == new_date,
                Appointment.start_time == new_start,
                Appointment.id != appointment_id,
                Appointment.status.in_([AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED]),
            )
        )).scalar_one_or_none()
        if conflict:
            raise HTTPException(409, "Этот слот уже занят")

        # Пересчёт end_time из slot_duration врача
        doctor = (await db.execute(select(Doctor).where(Doctor.id == appt.doctor_id))).scalar_one_or_none()
        if doctor:
            from datetime import datetime as _dt, timedelta as _td
            new_end_dt = _dt.combine(new_date, new_start) + _td(minutes=doctor.slot_duration)
            appt.end_time = new_end_dt.time()

        appt.appointment_date = new_date
        appt.start_time = new_start

    if data.notes is not None:
        appt.notes = data.notes
    if data.patient_name is not None:
        appt.patient_name = data.patient_name
    if data.priority is not None:
        if data.priority not in ('normal', 'high', 'urgent'):
            raise HTTPException(400, 'Некорректный приоритет (normal|high|urgent)')
        appt.priority = data.priority

    from datetime import datetime
    appt.updated_at = datetime.utcnow()
    await db.commit()
    return {
        "id": str(appt.id),
        "doctor_id": str(appt.doctor_id),
        "appointment_date": appt.appointment_date.isoformat(),
        "start_time": appt.start_time.strftime("%H:%M"),
        "end_time": appt.end_time.strftime("%H:%M"),
        "status": appt.status,
    }


# ── Неделя расписания врача (агрегированно) ──────────────────────────────────

@router.get("/doctors/{doctor_id}/week", dependencies=_FEAT)
async def get_doctor_week(
    doctor_id: uuid.UUID,
    start_date: date = Query(..., description="Понедельник недели, YYYY-MM-DD"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Вернёт расписание врача на неделю (7 дней начиная с start_date).
    Каждый день: рабочие часы из шаблона + слоты с признаком занятости.
    Для занятых слотов — данные пациента и id записи.
    """
    from datetime import timedelta as _td
    from sqlalchemy import select as _sel
    DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

    doctor = (await db.execute(select(Doctor).where(Doctor.id == doctor_id))).scalar_one_or_none()
    if not doctor or (current_user.tenant_id is not None and doctor.tenant_id != current_user.tenant_id):
        raise HTTPException(404, "Врач не найден")

    # Шаблон расписания
    sched_rows = (await db.execute(
        select(DoctorSchedule).where(DoctorSchedule.doctor_id == doctor_id, DoctorSchedule.is_active == True)
    )).scalars().all()
    sched_by_dow = {s.day_of_week: s for s in sched_rows}

    # Все записи на эту неделю
    end_date = start_date + _td(days=6)
    appts = (await db.execute(
        select(Appointment).where(
            Appointment.doctor_id == doctor_id,
            Appointment.appointment_date >= start_date,
            Appointment.appointment_date <= end_date,
            Appointment.status.in_([AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW]),
        )
    )).scalars().all()
    appts_by_key: dict = {}
    for a in appts:
        k = (a.appointment_date.isoformat(), a.start_time.strftime("%H:%M"))
        appts_by_key[k] = a

    # ── Чипы «есть заключение» / «N направлений» — обогащаем слоты ──────────
    # Подгружаем outcome+referrals одним запросом для всей недели
    appt_ids = [a.id for a in appts]
    has_outcome_set: set = set()
    referrals_count: dict = {}
    if appt_ids:
        from app.models.appointment_outcome import AppointmentOutcome, InternalReferral
        outcomes = (await db.execute(
            select(AppointmentOutcome.appointment_id).where(AppointmentOutcome.appointment_id.in_(appt_ids))
        )).scalars().all()
        has_outcome_set = set(outcomes)
        ref_rows = (await db.execute(
            select(InternalReferral.source_appointment_id).where(
                InternalReferral.source_appointment_id.in_(appt_ids)
            )
        )).scalars().all()
        for rid in ref_rows:
            referrals_count[rid] = referrals_count.get(rid, 0) + 1

    # Сборка дней
    days_out = []
    for i in range(7):
        d = start_date + _td(days=i)
        dow = d.weekday()
        sched = sched_by_dow.get(dow)
        slots = []
        if sched:
            from datetime import datetime as _dt
            current = _dt.combine(d, sched.start_time)
            finish = _dt.combine(d, sched.end_time)
            from datetime import timedelta as _td2
            step = _td2(minutes=doctor.slot_duration)
            while current + step <= finish:
                t = current.time().strftime("%H:%M")
                key = (d.isoformat(), t)
                a = appts_by_key.get(key)
                slot = {
                    "start_time": t,
                    "end_time": (current + step).time().strftime("%H:%M"),
                    "available": a is None,
                }
                if a:
                    slot["appointment"] = {
                        "id": str(a.id),
                        "patient_name": a.patient_name,
                        "patient_phone": a.patient_phone,
                        "status": a.status.value if hasattr(a.status, "value") else a.status, "priority": getattr(a, "priority", "normal"),
                        "notes": a.notes,
                        "has_outcome": a.id in has_outcome_set,
                        "referrals_count": int(referrals_count.get(a.id, 0)),
                    }
                slots.append(slot)
                current += step
        days_out.append({
            "date": d.isoformat(),
            "day_of_week": dow,
            "day_name": DAY_NAMES[dow],
            "is_working": sched is not None,
            "start_time": sched.start_time.strftime("%H:%M") if sched else None,
            "end_time": sched.end_time.strftime("%H:%M") if sched else None,
            "slots": slots,
        })

    return {
        "doctor_id": str(doctor_id),
        "doctor_name": doctor.full_name,
        "slot_duration": doctor.slot_duration,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "days": days_out,
    }


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


@router.get("/appointments/stats", dependencies=_FEAT)
async def appointments_stats(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Статистика записей: кол-во по статусам и по каждому врачу за N дней.

    Доступно: supervisor, manager, franchise_owner, super_admin (по тенанту).
    """
    from datetime import date, timedelta
    from sqlalchemy import select, func, and_

    today = date.today()
    period_start = today - timedelta(days=days)

    base_q = select(Appointment).where(
        Appointment.appointment_date >= period_start,
    )
    if current_user.tenant_id:
        # Фильтр через doctor.tenant_id (если у doctor есть это поле) или через clinic
        base_q = base_q.join(Doctor, Doctor.id == Appointment.doctor_id).where(
            Doctor.tenant_id == current_user.tenant_id
        )

    # Общая разбивка по статусам
    status_q = select(Appointment.status, func.count(Appointment.id)).group_by(Appointment.status)
    if current_user.tenant_id:
        status_q = status_q.join(Doctor, Doctor.id == Appointment.doctor_id).where(
            Doctor.tenant_id == current_user.tenant_id,
        )
    status_q = status_q.where(Appointment.appointment_date >= period_start)
    status_rows = (await db.execute(status_q)).all()
    by_status = {str(r[0].value if hasattr(r[0], "value") else r[0]): r[1] for r in status_rows}

    # По врачам
    by_doctor_q = (
        select(Doctor.id, Doctor.full_name, Appointment.status, func.count(Appointment.id))
        .join(Appointment, Appointment.doctor_id == Doctor.id)
        .where(Appointment.appointment_date >= period_start)
        .group_by(Doctor.id, Doctor.full_name, Appointment.status)
    )
    if current_user.tenant_id:
        by_doctor_q = by_doctor_q.where(Doctor.tenant_id == current_user.tenant_id)

    rows = (await db.execute(by_doctor_q)).all()
    doctors_map: dict = {}
    for did, name, status, cnt in rows:
        d = doctors_map.setdefault(str(did), {"id": str(did), "name": name, "total": 0, "by_status": {}})
        sval = status.value if hasattr(status, "value") else status
        d["by_status"][sval] = cnt
        d["total"] += cnt

    today_count = (await db.execute(
        select(func.count(Appointment.id))
        .join(Doctor, Doctor.id == Appointment.doctor_id)
        .where(Appointment.appointment_date == today)
        .where(Doctor.tenant_id == current_user.tenant_id) if current_user.tenant_id else
        select(func.count(Appointment.id)).where(Appointment.appointment_date == today)
    )).scalar_one()

    return {
        "period_days": days,
        "total": sum(by_status.values()),
        "today": int(today_count or 0),
        "by_status": by_status,
        "doctors": sorted(doctors_map.values(), key=lambda d: -d["total"]),
    }

