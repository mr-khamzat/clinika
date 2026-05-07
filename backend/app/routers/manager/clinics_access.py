# ===== БЛОК: Доступные клиники (Manager Scope) =====
# Эндпоинт возвращает список клиник, доступных текущему пользователю,
# для использования в селекторе клиники в аналитике (LTV + reports/analytics).
#
# Логика прав:
#   • super_admin без выбранного тенанта → пусто (UI отдельно показывает выбор тенанта)
#   • super_admin с tenant_id (query)    → все клиники указанного тенанта
#   • franchise_owner                    → все клиники всех тенантов своей франшизы
#   • manager без user.clinic_id         → все клиники своего tenant_id
#   • manager с user.clinic_id           → ТОЛЬКО эта клиника (расширяемо через ManagerClinicAccess)
#   • остальные роли (reg/nurse/...)     → только своя clinic_id
#
# is_default=true:
#   • для user.clinic_id если он задан
#   • иначе для первой по алфавиту

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.clinic import Clinic
from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.user import User, UserRole

router = APIRouter(tags=["manager:clinics-access"])


async def get_user_clinic_ids(
    db: AsyncSession,
    user: User,
    tenant_id_param: Optional[uuid.UUID] = None,
) -> list[uuid.UUID]:
    """
    Возвращает список UUID клиник, к которым у пользователя есть доступ.
    Используется для проверки прав в LTV/analytics-эндпоинтах.

    tenant_id_param — опциональный override для super_admin (query ?tenant_id).
    """
    # super_admin
    if user.role == UserRole.SUPER_ADMIN:
        target_tid = tenant_id_param or user.tenant_id
        if target_tid is None:
            return []
        rows = (await db.execute(
            select(Clinic.id).where(Clinic.tenant_id == target_tid)
        )).all()
        return [r[0] for r in rows]

    # franchise_owner — все клиники всех тенантов своей франшизы
    if user.role == UserRole.FRANCHISE_OWNER:
        f = (await db.execute(
            select(Franchise).where(Franchise.owner_user_id == user.id)
        )).scalar_one_or_none()
        if not f:
            return []
        tids = (await db.execute(
            select(Tenant.id).where(Tenant.franchise_id == f.id)
        )).scalars().all()
        if not tids:
            return []
        rows = (await db.execute(
            select(Clinic.id).where(Clinic.tenant_id.in_(tids))
        )).all()
        return [r[0] for r in rows]

    # manager
    if user.role == UserRole.MANAGER:
        # У главного manager'а сети нет clinic_id → видит все клиники тенанта
        if user.clinic_id is None:
            if user.tenant_id is None:
                return []
            rows = (await db.execute(
                select(Clinic.id).where(Clinic.tenant_id == user.tenant_id)
            )).all()
            return [r[0] for r in rows]
        # Manager привязан к клинике → только эта клиника
        return [user.clinic_id]

    # Остальные роли (reg/nurse/doctor/etc) — только своя клиника
    if user.clinic_id is not None:
        return [user.clinic_id]
    return []


async def resolve_clinic_filter_ids(
    db: AsyncSession,
    user: User,
    clinic_id: Optional[uuid.UUID],
) -> Optional[list[uuid.UUID]]:
    """
    Универсальный helper: возвращает список clinic_id для применения SQL-фильтра
    WHERE clinic_id IN (...) во всех аналитических endpoints.

    Логика:
      • clinic_id передан → проверяем доступ через get_user_clinic_ids().
        Если клиника недоступна — 403. Возвращаем [clinic_id].
      • clinic_id не передан:
          super_admin / franchise_owner       → None (видят всё в скоупе);
          manager без user.clinic_id          → все клиники тенанта (список);
          manager с clinic_id и прочие роли   → [user.clinic_id].

    Возврат:
      • None  — фильтр не накладывать (все клиники в скоупе видны);
      • []    — нет доступа ни к одной клинике (вернуть пустой результат);
      • [...] — список clinic_id, применить WHERE clinic_id IN (...).
    """
    # Передан явный clinic_id → проверяем права доступа
    if clinic_id is not None:
        accessible = await get_user_clinic_ids(db, user)
        # super_admin без выбранного тенанта — пробуем расширить через user.tenant_id
        if user.role == UserRole.SUPER_ADMIN and not accessible:
            if user.tenant_id is None:
                raise HTTPException(status_code=403, detail="Тенант не выбран")
            accessible = await get_user_clinic_ids(db, user, tenant_id_param=user.tenant_id)
        if clinic_id not in accessible:
            raise HTTPException(status_code=403, detail="Нет доступа к этой клинике")
        return [clinic_id]

    # clinic_id не передан
    if user.role in (UserRole.SUPER_ADMIN, UserRole.FRANCHISE_OWNER):
        # Видят всё → не накладываем clinic-фильтр (None означает «без фильтра»)
        return None

    # manager без clinic_id (главный manager сети) → все клиники тенанта
    if user.role == UserRole.MANAGER and user.clinic_id is None:
        ids = await get_user_clinic_ids(db, user)
        return ids if ids else []

    # manager с clinic_id или другие роли с clinic_id → только своя клиника
    if user.clinic_id is not None:
        return [user.clinic_id]

    # Без clinic_id и без манагерских прав
    return []


@router.get("/clinics-accessible")
async def list_accessible_clinics(
    tenant_id: Optional[uuid.UUID] = Query(None, description="Override для super_admin"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Возвращает массив доступных клиник для селектора.
    Формат: [{id, name, mis_id, is_default}]
    """
    ids = await get_user_clinic_ids(db, user, tenant_id_param=tenant_id)
    if not ids:
        return []

    rows = (await db.execute(
        select(Clinic).where(Clinic.id.in_(ids)).order_by(Clinic.name)
    )).scalars().all()

    # Определяем default-клинику:
    #   1) если у user задан clinic_id и он входит в список — он default
    #   2) иначе — первая по алфавиту
    default_id: Optional[uuid.UUID] = None
    if user.clinic_id is not None and user.clinic_id in ids:
        default_id = user.clinic_id
    elif rows:
        default_id = rows[0].id

    return [
        {
            "id": str(c.id),
            "name": c.name,
            "mis_id": c.mis_id,
            "is_default": (c.id == default_id),
        }
        for c in rows
    ]
