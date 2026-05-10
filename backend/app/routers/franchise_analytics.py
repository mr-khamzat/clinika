"""
Глава 3 ROADMAP — Франшиза-аналитика (премиум для franchise_owner).

Эндпоинты:
  GET  /admin/analytics/cohort-clinics    — cohort-анализ клиник франшизы
  GET  /admin/analytics/franchise-kpi     — KPI-дашборд по всей франшизе
  GET  /admin/analytics/recommendations   — multi-tenant рекомендации
  GET  /admin/franchise/tenants-pricing   — тенанты + текущие планы для bulk-редактора
  POST /admin/franchise/bulk-update-plans — транзакционно меняем план/модули у нескольких тенантов

Все ручки доступны только role=franchise_owner или super_admin.
Для franchise_owner проверяется владение франшизой (Franchise.owner_user_id).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.billing import Subscription, SubStatus
from app.models.commercial import (
    CommercialModule,
    ModuleStatus,
    TenantModuleSubscription,
)
from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services import audit_service
from app.services.cohort_service import ALLOWED_METRICS, get_cohort
from app.services.kpi_service import RANGES_DAYS, get_kpi
from app.services.recommendations_service import generate_recommendations

logger = logging.getLogger("franchise_analytics")

router = APIRouter(tags=["franchise-analytics"])


# ── Хелперы прав / резолва франшизы ──────────────────────────────────────────


async def _resolve_franchise_id(
    db: AsyncSession, user: User, franchise_id_param: uuid.UUID | None
) -> uuid.UUID:
    """Возвращает id франшизы, к которой имеет доступ пользователь.

    Правила:
      franchise_owner — только своя франшиза (по owner_user_id).
      super_admin     — может явно передать franchise_id; иначе берём первую активную.
    """
    if user.role == UserRole.FRANCHISE_OWNER:
        f = (
            await db.execute(
                select(Franchise).where(Franchise.owner_user_id == user.id, Franchise.is_active.is_(True))
            )
        ).scalar_one_or_none()
        if not f:
            raise HTTPException(403, "У вас нет привязанной франшизы")
        if franchise_id_param and franchise_id_param != f.id:
            raise HTTPException(403, "Чужая франшиза недоступна")
        return f.id
    if user.role == UserRole.SUPER_ADMIN:
        if franchise_id_param:
            f = (
                await db.execute(select(Franchise).where(Franchise.id == franchise_id_param))
            ).scalar_one_or_none()
            if not f:
                raise HTTPException(404, "Франшиза не найдена")
            return f.id
        first = (
            await db.execute(
                select(Franchise).where(Franchise.is_active.is_(True)).order_by(Franchise.name).limit(1)
            )
        ).scalar_one_or_none()
        if not first:
            raise HTTPException(404, "В системе нет активных франшиз")
        return first.id
    raise HTTPException(403, "Доступ только для franchise_owner / super_admin")


async def _require_franchise_role(user: User) -> User:
    if user.role not in (UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
        raise HTTPException(403, "Доступ только для franchise_owner / super_admin")
    return user


# ── 1. Cohort-анализ клиник ──────────────────────────────────────────────────


@router.get("/admin/analytics/cohort-clinics")
async def cohort_clinics(
    metric: str = Query("revenue", regex="^(revenue|appointments|referrals|patients)$"),
    period: str = Query("monthly", regex="^(monthly)$"),
    franchise_id: Optional[uuid.UUID] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _require_franchise_role(user)
    fid = await _resolve_franchise_id(db, user, franchise_id)
    if metric not in ALLOWED_METRICS:
        raise HTTPException(400, f"Неподдерживаемая метрика: {metric}")
    return await get_cohort(db, fid, metric=metric, period=period)


# ── 2. KPI-дашборд франшизы ──────────────────────────────────────────────────


@router.get("/admin/analytics/franchise-kpi")
async def franchise_kpi(
    range: str = Query("30d", regex="^(7d|30d|90d|365d)$"),
    franchise_id: Optional[uuid.UUID] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _require_franchise_role(user)
    fid = await _resolve_franchise_id(db, user, franchise_id)
    if range not in RANGES_DAYS:
        raise HTTPException(400, f"Неподдерживаемый диапазон: {range}")
    return await get_kpi(db, fid, range_key=range)


# ── 3. Рекомендации ──────────────────────────────────────────────────────────


@router.get("/admin/analytics/recommendations")
async def analytics_recommendations(
    franchise_id: Optional[uuid.UUID] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _require_franchise_role(user)
    fid = await _resolve_franchise_id(db, user, franchise_id)
    items = await generate_recommendations(db, fid)
    return {
        "franchise_id": str(fid),
        "count": len(items),
        "generated_at": datetime.utcnow().isoformat(),
        "items": items,
    }


# ── 4. Список тенантов франшизы для bulk-редактора ───────────────────────────


@router.get("/admin/franchise/tenants-pricing")
async def tenants_pricing(
    franchise_id: Optional[uuid.UUID] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _require_franchise_role(user)
    fid = await _resolve_franchise_id(db, user, franchise_id)

    tenants = (
        await db.execute(
            select(Tenant)
            .where(Tenant.franchise_id == fid)
            .order_by(Tenant.name)
        )
    ).scalars().all()

    # Каталог модулей (для UI выбора)
    modules = (
        await db.execute(
            select(CommercialModule).where(CommercialModule.is_active.is_(True)).order_by(CommercialModule.sort_order, CommercialModule.name)
        )
    ).scalars().all()
    modules_payload = [
        {
            "key": m.key,
            "name": m.name,
            "category": m.category,
            "price_monthly": float(m.price_monthly or 0),
        }
        for m in modules
    ]

    payload_tenants: list[dict[str, Any]] = []
    for t in tenants:
        sub = (
            await db.execute(
                select(Subscription)
                .where(Subscription.tenant_id == t.id, Subscription.status != SubStatus.CANCELLED)
                .order_by(Subscription.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        active_modules = (
            await db.execute(
                select(TenantModuleSubscription).where(
                    TenantModuleSubscription.tenant_id == t.id,
                    TenantModuleSubscription.status.in_(
                        [ModuleStatus.ACTIVE, ModuleStatus.TRIAL, ModuleStatus.GRACE]
                    ),
                )
            )
        ).scalars().all()
        payload_tenants.append(
            {
                "tenant_id": str(t.id),
                "name": t.name,
                "slug": t.slug,
                "is_active": bool(t.is_active),
                "current_plan": sub.plan if sub else None,
                "subscription_status": sub.status if sub else None,
                "amount_per_period": float(sub.amount_per_period) if sub else 0,
                "active_modules": [m.module_key for m in active_modules],
                "trial_ends_at": t.trial_ends_at.isoformat() if t.trial_ends_at else None,
            }
        )

    return {
        "franchise_id": str(fid),
        "tenants": payload_tenants,
        "modules_catalog": modules_payload,
    }


# ── 5. Bulk-обновление планов и модулей ──────────────────────────────────────


class BulkUpdateItem(BaseModel):
    tenant_id: uuid.UUID
    plan: Optional[str] = Field(None, pattern=r"^(basic|professional|enterprise|pro|starter)$")
    modules: Optional[list[str]] = None  # полный список ключей модулей, которые должны быть активны


class BulkUpdateRequest(BaseModel):
    updates: list[BulkUpdateItem]


# Маппинг внешних "lite" плановых имён в наши internal
_PLAN_ALIASES = {
    "starter": "basic",
    "pro": "professional",
}


@router.post("/admin/franchise/bulk-update-plans")
async def bulk_update_plans(
    body: BulkUpdateRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _require_franchise_role(user)
    if not body.updates:
        raise HTTPException(400, "Пустой список обновлений")
    fid = await _resolve_franchise_id(db, user, None)

    # Валидация: все тенанты принадлежат франшизе
    tenant_ids = [u.tenant_id for u in body.updates]
    tenants = (
        await db.execute(select(Tenant).where(Tenant.id.in_(tenant_ids)))
    ).scalars().all()
    tenant_map = {t.id: t for t in tenants}
    for tid in tenant_ids:
        t = tenant_map.get(tid)
        if not t:
            raise HTTPException(404, f"Тенант {tid} не найден")
        if t.franchise_id != fid and user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(403, f"Тенант {tid} не принадлежит вашей франшизе")

    # Каталог модулей для price lookup
    modules_catalog = {
        m.key: m
        for m in (
            await db.execute(select(CommercialModule).where(CommercialModule.is_active.is_(True)))
        ).scalars().all()
    }

    updated_summary: list[dict[str, Any]] = []
    try:
        for upd in body.updates:
            t = tenant_map[upd.tenant_id]
            before_state: dict[str, Any] = {}
            after_state: dict[str, Any] = {}

            # ── Plan ────────────────────────────────────────────────────────
            if upd.plan:
                plan_norm = _PLAN_ALIASES.get(upd.plan, upd.plan)
                sub = (
                    await db.execute(
                        select(Subscription)
                        .where(
                            Subscription.tenant_id == t.id,
                            Subscription.status != SubStatus.CANCELLED,
                        )
                        .order_by(Subscription.created_at.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()
                before_state["plan"] = sub.plan if sub else None
                if sub:
                    sub.plan = plan_norm
                    sub.status = SubStatus.ACTIVE
                else:
                    today = datetime.utcnow().date()
                    new_sub = Subscription(
                        tenant_id=t.id,
                        plan=plan_norm,
                        status=SubStatus.ACTIVE,
                        billing_cycle="monthly",
                        current_period_start=today,
                        current_period_end=today,
                        amount_per_period=Decimal("0"),
                    )
                    db.add(new_sub)
                after_state["plan"] = plan_norm

            # ── Модули ───────────────────────────────────────────────────────
            if upd.modules is not None:
                desired = set(upd.modules)
                # Текущее
                current_subs = (
                    await db.execute(
                        select(TenantModuleSubscription).where(
                            TenantModuleSubscription.tenant_id == t.id
                        )
                    )
                ).scalars().all()
                current_active = {
                    s.module_key
                    for s in current_subs
                    if s.status in (ModuleStatus.ACTIVE, ModuleStatus.TRIAL, ModuleStatus.GRACE)
                }
                before_state["modules"] = sorted(current_active)

                # Активируем недостающие
                to_enable = desired - current_active
                for key in to_enable:
                    if key not in modules_catalog:
                        # Незнакомый ключ — пропускаем
                        continue
                    existing = next((s for s in current_subs if s.module_key == key), None)
                    if existing:
                        existing.status = ModuleStatus.ACTIVE
                        existing.cancelled_at = None
                    else:
                        m = modules_catalog[key]
                        db.add(
                            TenantModuleSubscription(
                                tenant_id=t.id,
                                module_key=key,
                                status=ModuleStatus.ACTIVE,
                                billing_cycle="monthly",
                                custom_price=m.price_monthly,
                                started_at=datetime.utcnow(),
                            )
                        )
                # Отключаем лишние
                to_disable = current_active - desired
                for s in current_subs:
                    if s.module_key in to_disable:
                        s.status = ModuleStatus.CANCELLED
                        s.cancelled_at = datetime.utcnow()
                after_state["modules"] = sorted(desired)

            updated_summary.append(
                {
                    "tenant_id": str(t.id),
                    "tenant_name": t.name,
                    "before": before_state,
                    "after": after_state,
                }
            )

            # Аудит
            await audit_service.write(
                db,
                action="franchise.bulk_update_plans",
                actor_id=user.id,
                actor_name=user.full_name or user.username,
                entity_type="tenant",
                entity_id=t.id,
                before=before_state,
                after=after_state,
                request=request,
                tenant_id=t.id,
                comment=f"Bulk-обновление франшизы {fid}",
            )

        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("bulk_update_plans failed: %s", e)
        raise HTTPException(500, f"Ошибка bulk-обновления: {e}")

    # Сбрасываем кеш KPI/cohort/recommendations
    try:
        import redis.asyncio as aioredis
        from app.config import settings as app_settings

        r = aioredis.from_url(app_settings.redis_url, decode_responses=True)
        for prefix in ("kpi", "cohort", "recommendations"):
            async for key in r.scan_iter(f"{prefix}:{fid}*"):
                await r.delete(key)
        await r.aclose()
    except Exception as e:
        logger.warning("cache clear failed: %s", e)

    return {
        "ok": True,
        "franchise_id": str(fid),
        "updated_count": len(updated_summary),
        "items": updated_summary,
    }
