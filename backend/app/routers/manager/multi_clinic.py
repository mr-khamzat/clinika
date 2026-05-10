# ===== БЛОК: Manager Multi-Clinic View (Глава 4) =====
# GET /manager/multi-clinic-overview — панорамный обзор всех клиник менеджера.
#
# Возвращается массив клиник, к которым у пользователя есть доступ.
# Для каждой клиники:
#   • сегодня: appointments_count, completed_count, pending_count
#   • online_doctors: list[{id, full_name, presence_status?, today_load}]
#   • last_activity: ISO timestamp последнего ActivityLog
#   • alerts: [overtime, no_registrar, idle_long]
#
# Также есть POST /manager/multi-clinic/assign — для franchise_owner/super_admin
# назначения manager_clinic_access (multi-clinic права менеджеру).

import uuid
from datetime import date as _date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, and_, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_manager
from app.database import get_db
from app.models.activity_log import ActivityLog
from app.models.clinic import Clinic
from app.models.doctor import Appointment, AppointmentStatus, Doctor
from app.models.manager_clinic_access import ManagerClinicAccess
from app.models.user import User, UserRole
from app.routers.manager.clinics_access import get_user_clinic_ids
from app.services import audit_service

router = APIRouter(tags=["manager:multi-clinic"])


# ── GET /manager/multi-clinic-overview ─────────────────────────────────────
@router.get("/multi-clinic-overview")
async def multi_clinic_overview(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Возвращает обзор всех клиник, доступных менеджеру.

    Логика расширения доступа:
      • базовый список из get_user_clinic_ids (как и везде);
      • дополнительно учитываем manager_clinic_access (если есть).
    """
    base_ids = await get_user_clinic_ids(db, current_user)
    extra_ids = []
    if current_user.role in (UserRole.MANAGER,):
        rows = (await db.execute(
            select(ManagerClinicAccess.clinic_id)
            .where(ManagerClinicAccess.user_id == current_user.id)
        )).all()
        extra_ids = [r[0] for r in rows]

    clinic_ids = list({*base_ids, *extra_ids})
    if not clinic_ids:
        return {"clinics": [], "is_multi": False}

    # Загружаем клиники
    clinics = (await db.execute(
        select(Clinic).where(Clinic.id.in_(clinic_ids)).order_by(Clinic.name)
    )).scalars().all()

    today = _date.today()
    yesterday = today - timedelta(days=1)
    week_ago = today - timedelta(days=7)

    out = []
    for c in clinics:
        # ── Сегодня: счётчики приёмов ────────────────────────────────────
        appt_rows = (await db.execute(
            select(
                func.count(Appointment.id),
                func.sum(case(
                    (Appointment.status == AppointmentStatus.COMPLETED.value, 1),
                    else_=0,
                )),
                func.sum(case(
                    (Appointment.status == AppointmentStatus.PENDING.value, 1),
                    else_=0,
                )),
            ).where(and_(
                Appointment.clinic_id == c.id,
                Appointment.appointment_date == today,
            ))
        )).first()
        total_today    = int(appt_rows[0] or 0)
        completed_today = int(appt_rows[1] or 0)
        pending_today  = int(appt_rows[2] or 0)

        # ── Онлайн врачи (приём сегодня) ────────────────────────────────
        doc_rows = (await db.execute(
            select(Doctor.id, Doctor.full_name, Doctor.specialty,
                   func.count(Appointment.id).label("load"))
            .join(Appointment, Appointment.doctor_id == Doctor.id, isouter=True)
            .where(and_(
                Doctor.clinic_id == c.id,
                Doctor.is_active == True,
                Appointment.appointment_date == today,
            ))
            .group_by(Doctor.id, Doctor.full_name, Doctor.specialty)
            .order_by(func.count(Appointment.id).desc())
            .limit(20)
        )).all()
        online_doctors = [
            {
                "id": str(r[0]),
                "full_name": r[1],
                "specialty": r[2],
                "today_load": int(r[3] or 0),
            }
            for r in doc_rows
        ]

        # ── Последняя активность (ActivityLog не имеет clinic_id → ищем
        # по user_id ↔ users.clinic_id; берём максимум по таким записям).
        clinic_user_ids = (await db.execute(
            select(User.id).where(User.clinic_id == c.id)
        )).all()
        cu_ids = [r[0] for r in clinic_user_ids]
        last_activity = None
        if cu_ids:
            last_activity_row = (await db.execute(
                select(ActivityLog.created_at)
                .where(ActivityLog.user_id.in_(cu_ids))
                .order_by(ActivityLog.created_at.desc())
                .limit(1)
            )).first()
            if last_activity_row and last_activity_row[0]:
                last_activity = last_activity_row[0].isoformat()

        # ── Алёрты ───────────────────────────────────────────────────────
        alerts: list[str] = []

        # overtime: хотя бы один врач имеет >10 приёмов за сегодня
        if any(d["today_load"] > 10 for d in online_doctors):
            alerts.append("overtime")
        # no_registrar: нет ни одного reg-пользователя в клинике
        reg_count = (await db.execute(
            select(func.count(User.id)).where(and_(
                User.clinic_id == c.id, User.role == UserRole.REG,
                User.is_active == True,
            ))
        )).scalar() or 0
        if reg_count == 0:
            alerts.append("no_registrar")
        # idle_long: за последние 2 часа не было ни одного приёма со статусом
        # in_progress / completed (всё ещё работаем, но нет движения)
        two_hours_ago = datetime.utcnow() - timedelta(hours=2)
        recent_progress = (await db.execute(
            select(func.count(Appointment.id)).where(and_(
                Appointment.clinic_id == c.id,
                Appointment.appointment_date == today,
                Appointment.status.in_([
                    AppointmentStatus.IN_PROGRESS.value,
                    AppointmentStatus.COMPLETED.value,
                ]),
            ))
        )).scalar() or 0
        # Если день уже идёт (после 10:00) и нет ни одного активного приёма
        if datetime.utcnow().hour >= 10 and recent_progress == 0 and total_today > 0:
            alerts.append("idle_long")

        out.append({
            "id": str(c.id),
            "name": c.name,
            "city": c.city,
            "address": c.address,
            "today": {
                "appointments_count": total_today,
                "completed_count":   completed_today,
                "pending_count":     pending_today,
            },
            "online_doctors": online_doctors,
            "last_activity": last_activity,
            "alerts": alerts,
        })

    return {
        "clinics": out,
        "is_multi": len(out) > 1,
    }


# ── POST /manager/multi-clinic/assign — назначение менеджера на клинику ──
class AssignBody(BaseModel):
    user_id: uuid.UUID
    clinic_id: uuid.UUID


@router.post("/multi-clinic/assign", status_code=201)
async def assign_manager_clinic(
    body: AssignBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Назначает менеджеру дополнительный доступ к клинике.
    Доступно только franchise_owner и super_admin.
    """
    if current_user.role not in (UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
        raise HTTPException(status_code=403, detail="Только franchise_owner / super_admin")

    # Проверки tenant-scope
    target = (await db.execute(
        select(User).where(User.id == body.user_id)
    )).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if (current_user.tenant_id is not None
            and target.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=403, detail="Пользователь из другого тенанта")
    if target.role != UserRole.MANAGER:
        raise HTTPException(status_code=400, detail="Назначать можно только manager")

    clinic = (await db.execute(
        select(Clinic).where(Clinic.id == body.clinic_id)
    )).scalar_one_or_none()
    if not clinic:
        raise HTTPException(status_code=404, detail="Клиника не найдена")
    if (current_user.tenant_id is not None
            and clinic.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=403, detail="Клиника из другого тенанта")

    # Идемпотентность — если уже есть, не дублируем
    existing = (await db.execute(
        select(ManagerClinicAccess).where(and_(
            ManagerClinicAccess.user_id == body.user_id,
            ManagerClinicAccess.clinic_id == body.clinic_id,
        ))
    )).scalar_one_or_none()
    if existing:
        return {"id": str(existing.id), "already": True}

    rec = ManagerClinicAccess(
        user_id=body.user_id,
        clinic_id=body.clinic_id,
        granted_by_user_id=current_user.id,
    )
    db.add(rec)
    await db.flush()

    try:
        await audit_service.write_safe(
            db, "manager.clinic_access_granted",
            actor_id=current_user.id, actor_name=current_user.full_name,
            entity_type="user", entity_id=body.user_id,
            after={"clinic_id": str(body.clinic_id)},
        )
    except Exception:
        pass

    await db.commit()
    return {"id": str(rec.id), "already": False}


@router.delete("/multi-clinic/assign", status_code=204)
async def revoke_manager_clinic(
    user_id: uuid.UUID,
    clinic_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отозвать доступ менеджера к клинике. Доступно franchise_owner/super_admin."""
    if current_user.role not in (UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
        raise HTTPException(status_code=403, detail="Только franchise_owner / super_admin")

    rec = (await db.execute(
        select(ManagerClinicAccess).where(and_(
            ManagerClinicAccess.user_id == user_id,
            ManagerClinicAccess.clinic_id == clinic_id,
        ))
    )).scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Доступ не найден")

    await db.delete(rec)

    try:
        await audit_service.write_safe(
            db, "manager.clinic_access_revoked",
            actor_id=current_user.id, actor_name=current_user.full_name,
            entity_type="user", entity_id=user_id,
            before={"clinic_id": str(clinic_id)},
        )
    except Exception:
        pass

    await db.commit()
    return None
