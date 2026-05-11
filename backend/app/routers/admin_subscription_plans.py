"""
Админ-эндпоинты для управления каталогом тарифов подписки.

  super_admin            — CRUD по глобальным шаблонам
  super_admin/franchise  — CRUD по override для конкретного tenant_id

В FranchiseOwnerCabinet нельзя указать чужой tenant_id — обязательно свой.
"""
import uuid
from typing import Optional, List, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import (
    require_super_admin, require_franchise_owner, get_current_user,
)
from app.models.user import User, UserRole
from app.models.subscription import PatientSubscription
from app.models.subscription_plan import SubscriptionPlan
from app.services import subscription_plan_service as sps
from app.services.subscription_module_service import health_plus_module_active


router = APIRouter(prefix="/admin/subscription-plans", tags=["admin-subscription-plans"])


# ── Module gating ───────────────────────────────────────────────────────────
async def _require_module(db: AsyncSession, tenant_id) -> None:
    if not await health_plus_module_active(db, tenant_id):
        raise HTTPException(
            402,
            "Подключите модуль «Здоровье+» в маркетплейсе, чтобы управлять тарифами.",
        )


# ── Schemas ────────────────────────────────────────────────────────────────
class PlanFeatures(BaseModel):
    unlimited_chat: Optional[bool] = False
    discount_percent: Optional[int] = Field(default=0, ge=0, le=50)
    family_members_allowed: Optional[int] = Field(default=1, ge=0, le=10)
    telemedicine_unlimited: Optional[bool] = False
    priority_booking: Optional[bool] = False
    monthly_supply: Optional[bool] = False


class PlanCreateIn(BaseModel):
    plan_key: str = Field(min_length=2, max_length=40,
                          pattern=r"^[a-z][a-z0-9_]+$")
    title: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    price_monthly: float = Field(ge=0, le=1_000_000)
    price_annual: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    trial_days: int = Field(default=7, ge=0, le=90)
    benefits: List[str] = Field(default_factory=list, max_length=20)
    features: PlanFeatures = Field(default_factory=PlanFeatures)
    is_active: bool = True
    sort_order: int = 0


class PlanPatchIn(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    price_monthly: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    price_annual: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    trial_days: Optional[int] = Field(default=None, ge=0, le=90)
    benefits: Optional[List[str]] = Field(default=None, max_length=20)
    features: Optional[PlanFeatures] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class OverrideIn(PlanCreateIn):
    tenant_id: uuid.UUID


# ── Helpers ────────────────────────────────────────────────────────────────
async def _count_active(db: AsyncSession, plan_key: str) -> int:
    r = await db.execute(
        select(func.count()).select_from(PatientSubscription)
        .where(PatientSubscription.plan == plan_key,
               PatientSubscription.status.in_(("active", "trial")))
    )
    return int(r.scalar() or 0)


async def _serialize_with_count(db: AsyncSession,
                                  row: SubscriptionPlan) -> dict:
    data = sps.serialize_plan(row)
    data["subscribers_count"] = await _count_active(db, row.plan_key)
    return data


# ── Global plans (super_admin only) ────────────────────────────────────────
@router.get("/global")
async def list_global(
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = await sps.list_global_plans(db)
    return {"plans": [await _serialize_with_count(db, r) for r in rows]}


async def _global_plans_exist(db: AsyncSession) -> bool:
    """Возвращает True если хотя бы один глобальный шаблон уже создан (seeded)."""
    r = await db.execute(
        select(func.count()).select_from(SubscriptionPlan)
        .where(SubscriptionPlan.tenant_id.is_(None))
    )
    return int(r.scalar() or 0) > 0


@router.post("/global", status_code=201)
async def create_or_update_global(
    body: PlanCreateIn,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Создание глобального шаблона разрешено ТОЛЬКО если seed ещё не был
    запущен (БД пустая). После seed глобальные шаблоны immutable — управление
    тарифами переходит к франшизе через override."""
    if await _global_plans_exist(db):
        raise HTTPException(
            403,
            "Глобальные шаблоны уже созданы и immutable. Используйте override для тенанта."
        )
    payload = body.model_dump()
    payload["features"] = body.features.model_dump()
    row = await sps.upsert_global(db, payload)
    await db.commit()
    return await _serialize_with_count(db, row)


@router.patch("/global/{plan_id}")
async def patch_global(
    plan_id: uuid.UUID,
    body: PlanPatchIn,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Глобальные шаблоны immutable — только просмотр.
    Менять тариф можно только через override на тенант."""
    raise HTTPException(
        403,
        "Глобальные шаблоны immutable. Создайте override на тенант, чтобы изменить тариф."
    )


@router.delete("/global/{plan_id}", status_code=204)
async def delete_global(
    plan_id: uuid.UUID,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Глобальные шаблоны immutable — удаление запрещено."""
    raise HTTPException(403, "Глобальные шаблоны immutable.")


# ── Effective plans (читают все) ───────────────────────────────────────────
@router.get("/effective")
async def get_effective(
    tenant_id: Optional[uuid.UUID] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # franchise_owner / manager / reg видит только свой tenant
    is_sa = (user.role == UserRole.SUPER_ADMIN)
    target = tenant_id
    if not is_sa:
        target = user.tenant_id
        if not target:
            raise HTTPException(403, "Нет привязки к тенанту")
    plans = await sps.get_effective_plans(db, target)
    return {"tenant_id": str(target) if target else None, "plans": plans}


# ── Overrides ──────────────────────────────────────────────────────────────
@router.get("/overrides")
async def list_all_overrides(
    tenant_id: Optional[uuid.UUID] = Query(None),
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = await sps.list_overrides(db, tenant_id=tenant_id)
    return {"overrides": [sps.serialize_plan(r) for r in rows]}


@router.post("/override", status_code=201)
async def upsert_override(
    body: OverrideIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    is_sa = (user.role == UserRole.SUPER_ADMIN)
    is_owner = (user.role == UserRole.FRANCHISE_OWNER)
    if not (is_sa or is_owner):
        raise HTTPException(403, "Доступ только для franchise_owner / super_admin")
    target = body.tenant_id
    if is_owner and target != user.tenant_id:
        raise HTTPException(403, "Можно править только override своего тенанта")
    # Module gating: только при активном модуле health_plus_module
    await _require_module(db, target)
    payload = body.model_dump()
    payload["features"] = body.features.model_dump()
    payload.pop("tenant_id", None)
    row = await sps.upsert_override(db, target, payload)
    await db.commit()
    return sps.serialize_plan(row)


@router.patch("/override/{plan_id}")
async def patch_override(
    plan_id: uuid.UUID,
    body: PlanPatchIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    is_sa = (user.role == UserRole.SUPER_ADMIN)
    is_owner = (user.role == UserRole.FRANCHISE_OWNER)
    if not (is_sa or is_owner):
        raise HTTPException(403, "Доступ только для franchise_owner / super_admin")
    r = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == plan_id)
    )
    existing = r.scalars().first()
    if not existing or existing.tenant_id is None:
        raise HTTPException(404, "Override not found")
    if is_owner and existing.tenant_id != user.tenant_id:
        raise HTTPException(403, "Чужой override")
    # Module gating
    await _require_module(db, existing.tenant_id)
    payload = body.model_dump(exclude_none=True)
    if "features" in payload and payload["features"] is not None:
        payload["features"] = body.features.model_dump() if body.features else None
    row = await sps.update_plan(db, plan_id, payload)
    await db.commit()
    return sps.serialize_plan(row)


@router.get("/kpi")
async def kpi_for_tenant(
    tenant_id: Optional[uuid.UUID] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """KPI по подпискам: count, ARPU, churn (для tenant_id или для платформы)."""
    is_sa = (user.role == UserRole.SUPER_ADMIN)
    target = tenant_id
    if not is_sa:
        target = user.tenant_id
        if not target:
            raise HTTPException(403, "Нет привязки к тенанту")

    active_q = select(
        func.count().label("cnt"),
        func.coalesce(func.sum(PatientSubscription.price_monthly), 0).label("mrr"),
    ).select_from(PatientSubscription).where(
        PatientSubscription.status.in_(("active", "trial"))
    )
    if target:
        active_q = active_q.where(PatientSubscription.tenant_id == target)
    active = await db.execute(active_q)
    row = active.first()
    active_cnt = int(row.cnt or 0)
    mrr = float(row.mrr or 0)
    arpu = round(mrr / active_cnt, 2) if active_cnt else 0.0

    # Cancelled за последние 30 дней — churn
    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(days=30)
    q = select(func.count()).select_from(PatientSubscription).where(
        PatientSubscription.status == "cancelled",
        PatientSubscription.updated_at >= cutoff,
    )
    if target:
        q = q.where(PatientSubscription.tenant_id == target)
    cancelled30 = (await db.execute(q)).scalar() or 0
    churn_pct = round(100 * float(cancelled30) / max(active_cnt + int(cancelled30), 1), 1)

    return {
        "tenant_id": str(target) if target else None,
        "active_count": active_cnt,
        "mrr": round(mrr, 2),
        "arpu": arpu,
        "cancelled_30d": int(cancelled30),
        "churn_pct_30d": churn_pct,
    }


@router.delete("/override/{plan_id}", status_code=204)
async def delete_override(
    plan_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    is_sa = (user.role == UserRole.SUPER_ADMIN)
    is_owner = (user.role == UserRole.FRANCHISE_OWNER)
    if not (is_sa or is_owner):
        raise HTTPException(403, "Доступ только для franchise_owner / super_admin")
    r = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == plan_id)
    )
    existing = r.scalars().first()
    if not existing or existing.tenant_id is None:
        raise HTTPException(404, "Override not found")
    if is_owner and existing.tenant_id != user.tenant_id:
        raise HTTPException(403, "Чужой override")
    await sps.delete_plan(db, plan_id)
    await db.commit()
    return None
