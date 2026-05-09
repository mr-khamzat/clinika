from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db
from app.models.clinic import Clinic
from app.models.clinic_schedule import ClinicSchedule
from app.models.service import Service
from app.schemas.clinic import ClinicResponse
from app.core.deps import get_current_user, require_reports_access
from app.core.region_lock import enforce_region_lock
from app.models.user import User
import uuid
from typing import Optional
from pydantic import BaseModel

router = APIRouter(prefix="/clinics", tags=["clinics"])


@router.get("/", response_model=list[ClinicResponse])
async def list_clinics(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Tenant isolation: фильтруем по tenant_id текущего пользователя
    q = select(Clinic).where(Clinic.is_active == True)
    if current_user.tenant_id is not None:
        q = q.where(Clinic.tenant_id == current_user.tenant_id)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/{clinic_id}/services")
async def get_clinic_services(
    clinic_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Услуги клиники для формы создания направления.
    Фильтр: is_active=True AND visible_for_referrals=True
    (раньше — bonus_amount>0, что мешало показывать услуги без бонуса).
    """
    # Tenant isolation: проверяем что клиника принадлежит тенанту пользователя
    clinic_obj = (await db.execute(select(Clinic).where(Clinic.id == clinic_id))).scalar_one_or_none()
    if not clinic_obj or (current_user.tenant_id is not None and clinic_obj.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Клиника не найдена")
    result = await db.execute(
        select(Service).where(
            Service.clinic_id == clinic_id,
            Service.is_active == True,
            Service.visible_for_referrals == True,
        ).order_by(Service.category.nulls_last(), Service.name)
    )
    services = result.scalars().all()
    return [
        {
            "id": str(s.id),
            "name": s.name,
            "code": s.code,
            "category": s.category,
            "bonus_amount": float(s.bonus_amount),
            "price": float(s.price) if s.price is not None else None,
            "original_price": float(s.original_price) if s.original_price else None,
        }
        for s in services
    ]


# ---------------------------------------------------------------------------
# Feature 10: Расписание клиники
# ---------------------------------------------------------------------------

@router.get("/{clinic_id}/schedule")
async def get_clinic_schedule(
    clinic_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Возвращает расписание клиники (7 дней). Отсутствующие дни — выходные."""
    # Tenant isolation
    clinic_obj = (await db.execute(select(Clinic).where(Clinic.id == clinic_id))).scalar_one_or_none()
    if not clinic_obj or (current_user.tenant_id is not None and clinic_obj.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Клиника не найдена")
    result = await db.execute(
        select(ClinicSchedule)
        .where(ClinicSchedule.clinic_id == clinic_id)
        .order_by(ClinicSchedule.day_of_week)
    )
    rows = result.scalars().all()
    schedule_map = {r.day_of_week: r for r in rows}

    DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
    return [
        {
            "day_of_week": d,
            "day_name": DAY_NAMES[d],
            "is_active": schedule_map[d].is_active if d in schedule_map else False,
            "open_time": schedule_map[d].open_time if d in schedule_map else "09:00",
            "close_time": schedule_map[d].close_time if d in schedule_map else "18:00",
        }
        for d in range(7)
    ]


class ScheduleDayInput(BaseModel):
    day_of_week: int
    is_active: bool
    open_time: str = "09:00"
    close_time: str = "18:00"


@router.put("/{clinic_id}/schedule", dependencies=[Depends(enforce_region_lock)])
async def update_clinic_schedule(
    clinic_id: uuid.UUID,
    days: list[ScheduleDayInput],
    current_user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db)
):
    """Полная замена расписания клиники (только менеджер)."""
    clinic = (await db.execute(select(Clinic).where(Clinic.id == clinic_id))).scalar_one_or_none()
    if not clinic or (current_user.tenant_id is not None and clinic.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Клиника не найдена")

    await db.execute(delete(ClinicSchedule).where(ClinicSchedule.clinic_id == clinic_id))

    for day in days:
        db.add(ClinicSchedule(
            clinic_id=clinic_id,
            day_of_week=day.day_of_week,
            is_active=day.is_active,
            open_time=day.open_time,
            close_time=day.close_time,
        ))

    await db.commit()
    return {"status": "ok"}
