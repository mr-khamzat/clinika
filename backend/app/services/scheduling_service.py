"""
Сервис расписания: генерация свободных слотов для врача на дату.
"""
from datetime import date, time, datetime, timedelta
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.doctor import Doctor, DoctorSchedule, Appointment, AppointmentStatus


def _time_slots(start: time, end: time, duration_min: int) -> list[tuple[time, time]]:
    """Генерирует список (start, end) слотов между start и end с шагом duration_min."""
    slots = []
    current = datetime.combine(date.today(), start)
    finish  = datetime.combine(date.today(), end)
    delta   = timedelta(minutes=duration_min)
    while current + delta <= finish:
        slots.append((current.time(), (current + delta).time()))
        current += delta
    return slots


async def get_available_slots(
    db: AsyncSession,
    doctor_id,
    target_date: date,
) -> list[dict]:
    """
    Возвращает список свободных слотов врача на дату.
    Занятые слоты (confirmed/pending) исключаются.
    """
    # Врач
    doctor = (await db.execute(
        select(Doctor).where(Doctor.id == doctor_id, Doctor.is_active == True)
    )).scalar_one_or_none()
    if not doctor:
        return []

    # Шаблон для этого дня недели (0=Пн)
    day_of_week = target_date.weekday()
    sched = (await db.execute(
        select(DoctorSchedule).where(
            DoctorSchedule.doctor_id == doctor_id,
            DoctorSchedule.day_of_week == day_of_week,
            DoctorSchedule.is_active == True,
        )
    )).scalar_one_or_none()
    if not sched:
        return []  # Врач не работает в этот день

    # Все слоты из шаблона
    all_slots = _time_slots(sched.start_time, sched.end_time, doctor.slot_duration)

    # Уже занятые на эту дату
    booked = (await db.execute(
        select(Appointment.start_time).where(
            Appointment.doctor_id == doctor_id,
            Appointment.appointment_date == target_date,
            Appointment.status.in_([AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED]),
        )
    )).scalars().all()
    booked_set = set(booked)

    return [
        {
            "start_time": s.strftime("%H:%M"),
            "end_time":   e.strftime("%H:%M"),
            "available":  s not in booked_set,
        }
        for s, e in all_slots
    ]


async def book_slot(
    db: AsyncSession,
    doctor_id,
    appointment_date: date,
    start_time: time,
    patient_phone: str,
    patient_name: str | None,
    created_by_id=None,
    referral_id=None,
    notes: str | None = None,
    tenant_id=None,
) -> Appointment:
    """Создаёт запись на слот. Проверяет что слот свободен."""
    # Проверка — слот свободен
    conflict = (await db.execute(
        select(Appointment).where(
            Appointment.doctor_id == doctor_id,
            Appointment.appointment_date == appointment_date,
            Appointment.start_time == start_time,
            Appointment.status.in_([AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED]),
        )
    )).scalar_one_or_none()
    if conflict:
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail="Этот слот уже занят")

    # Определяем end_time из шаблона врача
    doctor = (await db.execute(select(Doctor).where(Doctor.id == doctor_id))).scalar_one_or_none()
    if not doctor:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Врач не найден")

    end_dt = datetime.combine(date.today(), start_time) + timedelta(minutes=doctor.slot_duration)
    end_time = end_dt.time()

    appointment = Appointment(
        tenant_id=tenant_id,
        doctor_id=doctor_id,
        clinic_id=doctor.clinic_id,
        referral_id=referral_id,
        created_by_id=created_by_id,
        patient_phone=patient_phone,
        patient_name=patient_name,
        appointment_date=appointment_date,
        start_time=start_time,
        end_time=end_time,
        notes=notes,
        status=AppointmentStatus.PENDING,
    )
    db.add(appointment)
    await db.flush()
    return appointment
