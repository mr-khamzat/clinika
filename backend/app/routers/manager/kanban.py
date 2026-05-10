# ===== БЛОК: Manager Kanban (Глава 4 — Manager productivity) =====
# Эндпоинты Kanban-доски расписания:
#   GET   /manager/appointments/kanban     — список приёмов 4 колонок + фильтры
#   PATCH /manager/appointments/{id}/status — drag-and-drop смена статуса
#
# Status mapping (UI → БД):
#   "scheduled"   → AppointmentStatus.PENDING
#   "confirmed"   → AppointmentStatus.CONFIRMED
#   "in_progress" → AppointmentStatus.IN_PROGRESS   (добавлен в mgr_templates01)
#   "completed"   → AppointmentStatus.COMPLETED
#
# Все ответы tenant-scope: фильтр Appointment.tenant_id = current_user.tenant_id
# Клиника-фильтр через resolve_clinic_filter_ids — manager видит свои,
# franchise_owner все клиники сети.

import uuid
from datetime import datetime, date as _date, time as _time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_manager
from app.database import get_db
from app.models.doctor import Appointment, AppointmentStatus, Doctor
from app.models.user import User, UserRole
from app.routers.manager.clinics_access import resolve_clinic_filter_ids
from app.services import audit_service
from app.services.audit_service import AuditAction

router = APIRouter(tags=["manager:kanban"])


# ── Маппинг UI ↔ БД ────────────────────────────────────────────────────────
_UI_TO_DB = {
    "scheduled":   AppointmentStatus.PENDING,
    "confirmed":   AppointmentStatus.CONFIRMED,
    "in_progress": AppointmentStatus.IN_PROGRESS,
    "completed":   AppointmentStatus.COMPLETED,
}
_DB_TO_UI = {v.value: k for k, v in _UI_TO_DB.items()}
_KANBAN_DB_STATUSES = [s.value for s in _UI_TO_DB.values()]


class StatusPatch(BaseModel):
    """Body для PATCH /manager/appointments/{id}/status."""
    status: str = Field(..., description="scheduled | confirmed | in_progress | completed")


# ── GET /manager/appointments/kanban ──────────────────────────────────────
@router.get("/appointments/kanban")
async def get_kanban(
    clinic_id: Optional[uuid.UUID] = Query(None),
    doctor_id: Optional[uuid.UUID] = Query(None),
    date_from: Optional[_date] = Query(None, description="ISO date YYYY-MM-DD"),
    date_to:   Optional[_date] = Query(None, description="ISO date YYYY-MM-DD"),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Возвращает 4 колонки Kanban (scheduled/confirmed/in_progress/completed)
    с массивами карточек для drag-and-drop. По умолчанию — сегодня.
    """
    # 1. Дефолтный период — сегодня
    if date_from is None:
        date_from = _date.today()
    if date_to is None:
        date_to = date_from

    filters = [
        Appointment.appointment_date >= date_from,
        Appointment.appointment_date <= date_to,
        Appointment.status.in_(_KANBAN_DB_STATUSES),
    ]
    if current_user.tenant_id is not None:
        filters.append(Appointment.tenant_id == current_user.tenant_id)

    # Per-clinic scope через общий helper (manager / franchise_owner / super_admin)
    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    if filter_ids == []:
        return {
            "columns": {k: [] for k in _UI_TO_DB.keys()},
            "doctors": [],
            "filter": {
                "clinic_id": str(clinic_id) if clinic_id else None,
                "doctor_id": str(doctor_id) if doctor_id else None,
                "date_from": date_from.isoformat(),
                "date_to":   date_to.isoformat(),
            },
        }
    if filter_ids is not None:
        filters.append(Appointment.clinic_id.in_(filter_ids))

    if doctor_id is not None:
        filters.append(Appointment.doctor_id == doctor_id)

    # 2. Загружаем записи + врачей
    rows = (await db.execute(
        select(Appointment, Doctor)
        .join(Doctor, Doctor.id == Appointment.doctor_id)
        .where(and_(*filters))
        .order_by(Appointment.appointment_date, Appointment.start_time)
    )).all()

    # 3. Группировка по колонкам
    columns: dict[str, list[dict]] = {k: [] for k in _UI_TO_DB.keys()}
    doctors_seen: dict[uuid.UUID, dict] = {}

    for appt, doc in rows:
        ui_status = _DB_TO_UI.get(
            appt.status.value if hasattr(appt.status, "value") else str(appt.status),
            None,
        )
        if ui_status is None:
            continue
        card = {
            "id": str(appt.id),
            "status": ui_status,
            "patient_name": appt.patient_name or "Без имени",
            "patient_phone": appt.patient_phone,
            "doctor_id": str(doc.id),
            "doctor_name": doc.full_name,
            "doctor_specialty": doc.specialty,
            "date": appt.appointment_date.isoformat(),
            "start_time": appt.start_time.strftime("%H:%M"),
            "end_time":   appt.end_time.strftime("%H:%M"),
            "priority": appt.priority or "normal",
            "service_type": (
                "doctor" if appt.referral_id is None else "referral"
            ),
            "notes": appt.notes,
            "clinic_id": str(appt.clinic_id),
            "price": float(appt.price) if appt.price is not None else None,
        }
        columns[ui_status].append(card)

        # Список врачей для фильтра
        if doc.id not in doctors_seen:
            doctors_seen[doc.id] = {
                "id": str(doc.id),
                "full_name": doc.full_name,
                "specialty": doc.specialty,
            }

    return {
        "columns": columns,
        "doctors": sorted(doctors_seen.values(), key=lambda d: d["full_name"]),
        "filter": {
            "clinic_id": str(clinic_id) if clinic_id else None,
            "doctor_id": str(doctor_id) if doctor_id else None,
            "date_from": date_from.isoformat(),
            "date_to":   date_to.isoformat(),
        },
    }


# ── PATCH /manager/appointments/{id}/status ───────────────────────────────
@router.patch("/appointments/{appointment_id}/status")
async def patch_appointment_status(
    appointment_id: uuid.UUID,
    body: StatusPatch,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Drag-and-drop смены статуса записи (Kanban-доска).
    Логируется в audit_log.
    """
    target = _UI_TO_DB.get(body.status)
    if target is None:
        raise HTTPException(
            status_code=400,
            detail=f"Неподдерживаемый статус: {body.status}. "
                   f"Разрешено: {list(_UI_TO_DB.keys())}",
        )

    res = await db.execute(
        select(Appointment).where(Appointment.id == appointment_id)
    )
    appt = res.scalar_one_or_none()
    if appt is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")

    # Tenant isolation
    if (
        current_user.tenant_id is not None
        and appt.tenant_id is not None
        and appt.tenant_id != current_user.tenant_id
    ):
        raise HTTPException(status_code=403, detail="Запись из другого тенанта")

    # Per-clinic check: используем resolve_clinic_filter_ids чтобы переиспользовать
    # общую логику (manager-without-clinic → все клиники тенанта).
    accessible = await resolve_clinic_filter_ids(db, current_user, None)
    if accessible is not None and appt.clinic_id not in accessible:
        raise HTTPException(status_code=403, detail="Нет доступа к этой клинике")

    before_status = appt.status.value if hasattr(appt.status, "value") else str(appt.status)
    appt.status = target

    # Audit log
    try:
        await audit_service.write_safe(
            db,
            "appointment.status_changed",
            actor_id=current_user.id,
            actor_name=current_user.full_name,
            entity_type="appointment",
            entity_id=appt.id,
            before={"status": before_status},
            after={"status": target.value},
        )
    except Exception:
        # audit не должен ломать основное действие
        pass

    await db.commit()

    return {
        "id": str(appt.id),
        "status": body.status,
        "before": _DB_TO_UI.get(before_status, before_status),
    }
