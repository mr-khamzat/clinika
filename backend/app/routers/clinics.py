from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db
from app.models.clinic import Clinic
from app.models.clinic_schedule import ClinicSchedule
from app.models.service import Service
from app.models.tenant import Tenant
from app.schemas.clinic import ClinicResponse
from app.core.deps import get_current_user, require_reports_access
from app.core.region_lock import enforce_region_lock
from app.models.user import User
import uuid
from typing import Optional
from pydantic import BaseModel

router = APIRouter(prefix="/clinics", tags=["clinics"])


async def _franchise_tenant_ids(user: User, db: AsyncSession) -> set[uuid.UUID]:
    """Множество tenant_id, доступных пользователю.

    Если у тенанта пользователя задан franchise_id — возвращаем все tenant_id
    франшизы (для cross-clinic направлений между клиниками одной сети).
    Иначе — только свой tenant_id (классическая изоляция).
    """
    if user.tenant_id is None:
        return set()
    own_tenant = await db.get(Tenant, user.tenant_id)
    if not own_tenant or not own_tenant.franchise_id:
        return {user.tenant_id}
    rows = (await db.execute(
        select(Tenant.id).where(Tenant.franchise_id == own_tenant.franchise_id)
    )).all()
    ids = {r[0] for r in rows}
    ids.add(user.tenant_id)
    return ids


@router.get("/")
async def list_clinics(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Список клиник для текущего пользователя.

    Включает все клиники тенантов той же франшизы, чтобы регистратор/менеджер
    одной клиники мог создать направление в другую клинику сети.
    """
    q = select(Clinic, Tenant).join(Tenant, Tenant.id == Clinic.tenant_id, isouter=True).where(Clinic.is_active == True)
    if current_user.tenant_id is not None:
        allowed = await _franchise_tenant_ids(current_user, db)
        if allowed:
            q = q.where(Clinic.tenant_id.in_(allowed))
    rows = (await db.execute(q)).all()
    return [
        {
            "id": str(c.id),
            "name": c.name,
            "address": c.address,
            "phone": c.phone,
            "is_active": c.is_active,
            "mis_id": c.mis_id,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "tenant_id": str(c.tenant_id) if c.tenant_id else None,
            "tenant_name": (t.name if t else None),
            "tenant_slug": (t.slug if t else None),
            "is_own_tenant": (c.tenant_id == current_user.tenant_id) if current_user.tenant_id else True,
        }
        for c, t in rows
    ]


@router.get("/{clinic_id}/services")
async def get_clinic_services(
    clinic_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Услуги клиники для формы создания направления.
    Фильтр: is_active=True AND visible_for_referrals=True.
    Доступ: своя клиника или клиника другой клиники той же франшизы.
    """
    clinic_obj = (await db.execute(select(Clinic).where(Clinic.id == clinic_id))).scalar_one_or_none()
    if not clinic_obj:
        raise HTTPException(status_code=404, detail="Клиника не найдена")
    if current_user.tenant_id is not None:
        allowed = await _franchise_tenant_ids(current_user, db)
        if allowed and clinic_obj.tenant_id not in allowed:
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
            # Финансовая модель: что увидит создающий направление в качестве своей выплаты.
            "referral_payout": float(s.referral_payout) if s.referral_payout is not None else None,
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
    clinic_obj = (await db.execute(select(Clinic).where(Clinic.id == clinic_id))).scalar_one_or_none()
    if not clinic_obj:
        raise HTTPException(status_code=404, detail="Клиника не найдена")
    if current_user.tenant_id is not None:
        allowed = await _franchise_tenant_ids(current_user, db)
        if allowed and clinic_obj.tenant_id not in allowed:
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
