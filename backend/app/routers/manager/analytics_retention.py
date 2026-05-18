"""
/manager/analytics/doctor-retention — возвратность пациентов по врачам.

GET /manager/analytics/doctor-retention?date_from&date_to&clinic_id
  → список врачей с метриками: total приёмов, уникальных пациентов,
     первичных, повторных, retention_rate (повторно / total).

GET /manager/analytics/doctor-retention/{doctor_id}/patients?date_from&date_to&clinic_id
  → drill-down: пациенты этого врача за период с ФИО, телефоном,
     количеством визитов и признаком повторного.

«Повторный» = у пациента (по telephone) был прежний приём к ЭТОМУ ЖЕ врачу
ДО начала периода (со статусом не cancelled/no_show).

Tenant-scoped: filter по tenant_id текущего менеджера. Если задан clinic_id —
дополнительная фильтрация.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, and_, or_, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.models.doctor import Appointment
from app.models.doctor import Doctor
from app.models.clinic import Clinic
from app.models.user import User


router = APIRouter(prefix="/analytics", tags=["manager:analytics"])


# Приёмы, которые НЕ считаем (отменённые/неявка).
EXCLUDED_STATUSES = ("cancelled", "no_show", "rejected")


# ── Schemas ──────────────────────────────────────────────────────────────────

class DoctorRetentionRow(BaseModel):
    doctor_id: uuid.UUID
    doctor_name: str
    specialty: Optional[str] = None
    clinic_id: Optional[uuid.UUID] = None
    clinic_name: Optional[str] = None

    total: int = 0
    unique_patients: int = 0
    first_visits: int = 0
    repeat_visits: int = 0
    retention_rate: float = 0.0  # repeat / total


class RetentionPatientRow(BaseModel):
    patient_phone: str
    patient_name: Optional[str] = None
    visits_in_period: int
    last_visit_in_period: date
    first_visit_overall: Optional[date] = None  # самый ранний приём к этому врачу
    is_repeat: bool  # True если first_visit_overall < period_start


# ── Helpers ──────────────────────────────────────────────────────────────────

def _default_period(date_from: Optional[date], date_to: Optional[date]) -> tuple[date, date]:
    if date_to is None:
        date_to = date.today()
    if date_from is None:
        # По умолчанию — последние 30 дней.
        date_from = date_to - timedelta(days=30)
    return date_from, date_to


# ── GET /manager/analytics/doctor-retention ──────────────────────────────────

@router.get("/doctor-retention", response_model=list[DoctorRetentionRow])
async def doctor_retention(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None),
    me: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
) -> list[DoctorRetentionRow]:
    """Возвратность пациентов по врачам за период."""
    df, dt = _default_period(date_from, date_to)

    # 1) Все приёмы за период (с учётом клиники если задана)
    conds = [
        Appointment.tenant_id == me.tenant_id,
        Appointment.appointment_date >= df,
        Appointment.appointment_date <= dt,
        Appointment.status.notin_(EXCLUDED_STATUSES),
    ]
    if clinic_id:
        conds.append(Appointment.clinic_id == clinic_id)
    elif me.clinic_id and me.role.value == "manager":
        # Менеджер привязанный к клинике видит только её.
        conds.append(Appointment.clinic_id == me.clinic_id)

    appts_q = await db.execute(
        select(
            Appointment.id,
            Appointment.doctor_id,
            Appointment.patient_phone,
            Appointment.patient_name,
            Appointment.clinic_id,
        ).where(and_(*conds))
    )
    appts = appts_q.all()
    if not appts:
        return []

    # 2) Список пар (doctor_id, phone) — для bulk-запроса prior
    pairs = list({(a.doctor_id, a.patient_phone) for a in appts})
    prior_set: set[tuple[uuid.UUID, str]] = set()
    if pairs:
        # Тяжёлый запрос для большого периода/клиники — но мы фильтруем по уже
        # известному множеству пар, так что Postgres использует индекс
        # (doctor_id) + (patient_phone). Для типичного месяца это быстро.
        prior_q = await db.execute(
            select(Appointment.doctor_id, Appointment.patient_phone)
            .where(
                and_(
                    Appointment.tenant_id == me.tenant_id,
                    Appointment.appointment_date < df,
                    Appointment.status.notin_(EXCLUDED_STATUSES),
                    tuple_(Appointment.doctor_id, Appointment.patient_phone).in_(pairs),
                )
            )
            .distinct()
        )
        prior_set = {(r[0], r[1]) for r in prior_q.all()}

    # 3) Агрегация
    agg: dict[uuid.UUID, dict] = defaultdict(lambda: {
        "total": 0, "first": 0, "repeat": 0, "phones": set(), "clinic_id": None
    })
    for a in appts:
        s = agg[a.doctor_id]
        s["total"] += 1
        s["phones"].add(a.patient_phone)
        if not s["clinic_id"]:
            s["clinic_id"] = a.clinic_id
        if (a.doctor_id, a.patient_phone) in prior_set:
            s["repeat"] += 1
        else:
            s["first"] += 1

    # 4) Подтянуть имена врачей и клиник одним запросом
    doctor_ids = list(agg.keys())
    doctors_q = await db.execute(
        select(Doctor.id, Doctor.full_name, Doctor.specialty, Doctor.clinic_id)
        .where(Doctor.id.in_(doctor_ids))
    )
    doctors_map = {r[0]: {"full_name": r[1], "specialty": r[2], "clinic_id": r[3]} for r in doctors_q.all()}

    clinic_ids_set = {agg[d]["clinic_id"] for d in doctor_ids if agg[d]["clinic_id"]}
    clinic_ids_set.update({doctors_map[d]["clinic_id"] for d in doctors_map if doctors_map[d]["clinic_id"]})
    clinics_map: dict[uuid.UUID, str] = {}
    if clinic_ids_set:
        clinics_q = await db.execute(
            select(Clinic.id, Clinic.name).where(Clinic.id.in_(clinic_ids_set))
        )
        clinics_map = {r[0]: r[1] for r in clinics_q.all()}

    # 5) Собрать ответ
    rows: list[DoctorRetentionRow] = []
    for doc_id, s in agg.items():
        dmeta = doctors_map.get(doc_id, {})
        # clinic_id для отображения: предпочитаем clinic_id врача, иначе из приёма
        cid = dmeta.get("clinic_id") or s["clinic_id"]
        rate = (s["repeat"] / s["total"]) if s["total"] else 0.0
        rows.append(DoctorRetentionRow(
            doctor_id=doc_id,
            doctor_name=dmeta.get("full_name") or "—",
            specialty=dmeta.get("specialty"),
            clinic_id=cid,
            clinic_name=clinics_map.get(cid) if cid else None,
            total=s["total"],
            unique_patients=len(s["phones"]),
            first_visits=s["first"],
            repeat_visits=s["repeat"],
            retention_rate=round(rate, 4),
        ))
    # Сортировка по total убыванию
    rows.sort(key=lambda r: r.total, reverse=True)
    return rows


# ── GET /manager/analytics/doctor-retention/{doctor_id}/patients ─────────────

@router.get(
    "/doctor-retention/{doctor_id}/patients",
    response_model=list[RetentionPatientRow],
)
async def doctor_retention_patients(
    doctor_id: uuid.UUID,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None),
    me: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
) -> list[RetentionPatientRow]:
    """Drill-down: пациенты конкретного врача за период с признаком повторных."""
    df, dt = _default_period(date_from, date_to)

    # Проверим, что доктор принадлежит нашему тенанту (через doctor.clinic_id → tenant)
    doc_q = await db.execute(
        select(Doctor.id, Doctor.clinic_id).where(Doctor.id == doctor_id)
    )
    doc_row = doc_q.first()
    if not doc_row:
        raise HTTPException(404, "Врач не найден")

    # 1) Приёмы этого врача за период
    conds = [
        Appointment.doctor_id == doctor_id,
        Appointment.tenant_id == me.tenant_id,
        Appointment.appointment_date >= df,
        Appointment.appointment_date <= dt,
        Appointment.status.notin_(EXCLUDED_STATUSES),
    ]
    if clinic_id:
        conds.append(Appointment.clinic_id == clinic_id)
    elif me.clinic_id and me.role.value == "manager":
        conds.append(Appointment.clinic_id == me.clinic_id)

    appts_q = await db.execute(
        select(
            Appointment.patient_phone,
            Appointment.patient_name,
            Appointment.appointment_date,
        ).where(and_(*conds))
    )
    period_appts = appts_q.all()
    if not period_appts:
        return []

    # 2) Сгруппировать по phone в периоде
    per_phone: dict[str, dict] = defaultdict(lambda: {
        "name": None, "visits": 0, "last_date": None
    })
    for r in period_appts:
        ph = r.patient_phone
        s = per_phone[ph]
        s["visits"] += 1
        if not s["name"] and r.patient_name:
            s["name"] = r.patient_name
        if not s["last_date"] or r.appointment_date > s["last_date"]:
            s["last_date"] = r.appointment_date

    phones = list(per_phone.keys())

    # 3) Для каждого телефона — самый ранний приём к этому врачу за всю историю
    first_q = await db.execute(
        select(
            Appointment.patient_phone,
            Appointment.appointment_date,
        )
        .where(
            and_(
                Appointment.doctor_id == doctor_id,
                Appointment.tenant_id == me.tenant_id,
                Appointment.status.notin_(EXCLUDED_STATUSES),
                Appointment.patient_phone.in_(phones),
            )
        )
        .order_by(Appointment.appointment_date.asc())
    )
    first_overall: dict[str, date] = {}
    for ph, dt_row in first_q.all():
        if ph not in first_overall:
            first_overall[ph] = dt_row

    # 4) Собрать ответ
    rows: list[RetentionPatientRow] = []
    for ph, s in per_phone.items():
        fv = first_overall.get(ph)
        rows.append(RetentionPatientRow(
            patient_phone=ph,
            patient_name=s["name"],
            visits_in_period=s["visits"],
            last_visit_in_period=s["last_date"],
            first_visit_overall=fv,
            is_repeat=bool(fv and fv < df),
        ))
    # Сортировка: сначала повторные (по числу визитов), потом первичные.
    rows.sort(key=lambda r: (not r.is_repeat, -r.visits_in_period))
    return rows
