"""
Marketplace модулей — публичная витрина + тенант-операции (триал/активация/отписка).

Маршруты:
  GET  /marketplace/modules                                       — публичный каталог (без auth)
  GET  /marketplace/tenant/{tenant_id}/modules                    — что подключено + что доступно
  POST /marketplace/tenant/{tenant_id}/modules/{key}/start-trial  — триал на N дней (без оплаты)
  POST /marketplace/tenant/{tenant_id}/modules/{key}/activate     — активировать (после оплаты)
  POST /marketplace/tenant/{tenant_id}/modules/{key}/cancel       — отписаться

Доступ к tenant-эндпоинтам: super_admin ИЛИ franchise_owner (только своих тенантов).
Триал — нельзя повторно активировать для одного и того же модуля.

Этап Marketplace 01 (2026-05-10).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user, require_franchise_owner
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.franchise import Franchise
from app.models.commercial import (
    CommercialModule,
    TenantModuleSubscription,
    ModuleStatus,
)
from app.services import audit_service


router = APIRouter(prefix="/marketplace", tags=["marketplace"])


# ── Pydantic схемы ────────────────────────────────────────────────────────────

class StartTrialRequest(BaseModel):
    trial_days: Optional[int] = Field(None, ge=1, le=365)


class ActivateRequest(BaseModel):
    billing_cycle: str = Field(
        "monthly",
        pattern="^(monthly|quarterly|semi_annual|nine_months|annual|one_time)$",
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mod_full(m: CommercialModule, *, public: bool = True) -> dict:
    """Сериализация модуля для marketplace (вкл. поля витрины)."""
    out = {
        "key":                m.key,
        "name":                m.name,
        "description":         m.description,
        "category":            m.category,
        "price_monthly":       float(m.price_monthly) if m.price_monthly is not None else 0.0,
        "price_annual":        float(m.price_annual)  if m.price_annual  is not None else 0.0,
        "monthly_price_demo":  float(m.monthly_price_demo) if getattr(m, "monthly_price_demo", None) is not None else None,
        "screenshots":         (getattr(m, "screenshots", None) or []),
        "features_list":       (getattr(m, "features_list", None) or []),
        "default_trial_days":  getattr(m, "default_trial_days", 14) or 14,
        "popular":             bool(getattr(m, "popular", False)),
        "setup_complexity":    getattr(m, "setup_complexity", "easy") or "easy",
        "included_in_plans":   m.included_in_plans,
        "sort_order":          m.sort_order,
    }
    if not public:
        out["is_active"]     = m.is_active
        out["config_schema"] = m.config_schema
    return out


def _sub_out(s: TenantModuleSubscription | None) -> dict | None:
    if not s:
        return None
    return {
        "id":            str(s.id),
        "module_key":    s.module_key,
        "status":        s.status,
        "billing_cycle": s.billing_cycle,
        "trial_days":    s.trial_days,
        "started_at":    s.started_at.isoformat() if s.started_at else None,
        "trial_ends_at": s.trial_ends_at.isoformat() if s.trial_ends_at else None,
        "expires_at":    s.expires_at.isoformat() if s.expires_at else None,
        "cancelled_at":  s.cancelled_at.isoformat() if s.cancelled_at else None,
        "custom_price":  float(s.custom_price) if s.custom_price is not None else None,
        "notes":         s.notes,
    }


def _calc_expires(now: datetime, cycle: str) -> datetime | None:
    if cycle == "monthly":     return now + timedelta(days=30)
    if cycle == "quarterly":   return now + timedelta(days=90)
    if cycle == "semi_annual": return now + timedelta(days=180)
    if cycle == "nine_months": return now + timedelta(days=270)
    if cycle == "annual":      return now + timedelta(days=365)
    return None


async def _get_module(db: AsyncSession, key: str) -> CommercialModule:
    m = (await db.execute(
        select(CommercialModule).where(CommercialModule.key == key)
    )).scalar_one_or_none()
    if not m:
        raise HTTPException(404, f"Модуль '{key}' не найден")
    return m


async def _get_sub(
    db: AsyncSession, tenant_id: uuid.UUID, key: str
) -> TenantModuleSubscription | None:
    return (await db.execute(
        select(TenantModuleSubscription).where(
            TenantModuleSubscription.tenant_id == tenant_id,
            TenantModuleSubscription.module_key == key,
        )
    )).scalar_one_or_none()


async def _authorize_tenant(
    db: AsyncSession,
    user: User,
    tenant_id: uuid.UUID,
) -> Tenant:
    """super_admin — любой тенант. franchise_owner — только тенанты своей франшизы."""
    t = (await db.execute(
        select(Tenant).where(Tenant.id == tenant_id)
    )).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Тенант не найден")

    # super_admin — полный доступ
    if user.role == UserRole.SUPER_ADMIN:
        return t

    # franchise_owner — проверяем принадлежность тенанта к его франшизе
    if user.role == UserRole.FRANCHISE_OWNER:
        fr = (await db.execute(
            select(Franchise).where(Franchise.owner_user_id == user.id)
        )).scalar_one_or_none()
        if not fr:
            raise HTTPException(403, "У вас нет франшизы")
        if t.franchise_id != fr.id:
            raise HTTPException(403, "Тенант не относится к вашей франшизе")
        return t

    raise HTTPException(
        403, "Доступ только для super_admin или franchise_owner"
    )


# ── Публичная витрина ────────────────────────────────────────────────────────

@router.get("/modules")
async def public_list_modules(
    db: AsyncSession = Depends(get_db),
):
    """Публичная витрина — без auth. Только is_active=true модули."""
    rows = (await db.execute(
        select(CommercialModule)
        .where(CommercialModule.is_active == True)  # noqa: E712
        .order_by(
            CommercialModule.popular.desc().nullslast(),
            CommercialModule.sort_order,
            CommercialModule.name,
        )
    )).scalars().all()
    return [_mod_full(m, public=True) for m in rows]


# ── Тенант-операции ──────────────────────────────────────────────────────────

@router.get("/tenant/{tenant_id}/modules")
async def tenant_marketplace(
    tenant_id: uuid.UUID = Path(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Витрина marketplace для тенанта: все активные модули + статус подписок."""
    await _authorize_tenant(db, user, tenant_id)

    catalog = (await db.execute(
        select(CommercialModule)
        .where(CommercialModule.is_active == True)  # noqa: E712
        .order_by(
            CommercialModule.popular.desc().nullslast(),
            CommercialModule.sort_order,
            CommercialModule.name,
        )
    )).scalars().all()

    subs_rows = (await db.execute(
        select(TenantModuleSubscription).where(
            TenantModuleSubscription.tenant_id == tenant_id
        )
    )).scalars().all()
    subs = {s.module_key: s for s in subs_rows}

    return [
        {
            "module":       _mod_full(m, public=True),
            "subscription": _sub_out(subs.get(m.key)),
            # «trial_used» — флаг, что триал уже использован (даже если сейчас не trial)
            "trial_used":   bool(
                subs.get(m.key) and subs[m.key].trial_ends_at is not None
            ),
        }
        for m in catalog
    ]


@router.post("/tenant/{tenant_id}/modules/{key}/start-trial")
async def start_trial(
    tenant_id: uuid.UUID = Path(...),
    key: str = Path(...),
    body: StartTrialRequest = StartTrialRequest(),
    request: Request = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Начать триал на N дней. status=trial, trial_ends_at=now+N.

    Триал нельзя активировать повторно для одного модуля.
    """
    await _authorize_tenant(db, user, tenant_id)
    m = await _get_module(db, key)
    if not m.is_active:
        raise HTTPException(400, "Модуль недоступен")

    sub = await _get_sub(db, tenant_id, key)
    # Запрет повторного триала
    if sub and sub.trial_ends_at is not None:
        raise HTTPException(
            409,
            "Триал для этого модуля уже использовался ранее. "
            "Доступна только платная активация.",
        )
    # Запрет если уже активен (платный или триал)
    if sub and sub.status in (ModuleStatus.ACTIVE, ModuleStatus.TRIAL):
        raise HTTPException(409, "Модуль уже подключён")

    days = body.trial_days or getattr(m, "default_trial_days", 14) or 14
    now = datetime.utcnow()

    if sub:
        sub.status        = ModuleStatus.TRIAL
        sub.billing_cycle = "monthly"
        sub.trial_days    = days
        sub.started_at    = now
        sub.trial_ends_at = now + timedelta(days=days)
        sub.expires_at    = None
        sub.cancelled_at  = None
        sub.updated_at    = now
    else:
        sub = TenantModuleSubscription(
            tenant_id=tenant_id,
            module_key=key,
            status=ModuleStatus.TRIAL,
            billing_cycle="monthly",
            trial_days=days,
            started_at=now,
            trial_ends_at=now + timedelta(days=days),
        )
        db.add(sub)

    await db.flush()

    # Запись в billing_ledger как триал (0₽)
    try:
        from app.services.billing_service import record_billing_ledger
        from app.models.billing_ledger import EntryType, Direction
        await record_billing_ledger(
            db,
            tenant_id=tenant_id,
            entry_type=EntryType.SUBSCRIPTION_TRIAL,
            direction=Direction.CREDIT,
            amount=Decimal("0"),
            reference_id=sub.id,
            reference_type="tenant_module_subscription",
            description=f"Marketplace trial: {m.name} ({days} дн.)",
            meta={
                "module_key": m.key,
                "trial_days": days,
                "source": "marketplace",
            },
        )
    except Exception:
        pass

    # Audit log
    await audit_service.write_safe(
        db,
        "module.trial_started",
        actor_id=user.id,
        actor_name=user.username or str(user.id),
        entity_type="tenant_module_subscription",
        entity_id=sub.id,
        after={"module_key": m.key, "trial_days": days},
        comment=f"Marketplace: triggered trial для {m.name}",
        request=request,
        tenant_id=tenant_id,
    )

    await db.commit()
    await db.refresh(sub)
    return _sub_out(sub)


@router.post("/tenant/{tenant_id}/modules/{key}/activate")
async def activate_module(
    tenant_id: uuid.UUID = Path(...),
    key: str = Path(...),
    body: ActivateRequest = ActivateRequest(),
    request: Request = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Активировать модуль (после оплаты). status=active, expires_at=now+период."""
    await _authorize_tenant(db, user, tenant_id)
    m = await _get_module(db, key)
    if not m.is_active:
        raise HTTPException(400, "Модуль недоступен")

    sub = await _get_sub(db, tenant_id, key)
    now = datetime.utcnow()

    if sub:
        sub.status        = ModuleStatus.ACTIVE
        sub.billing_cycle = body.billing_cycle
        sub.started_at    = sub.started_at or now
        sub.expires_at    = _calc_expires(now, body.billing_cycle)
        sub.cancelled_at  = None
        sub.updated_at    = now
    else:
        sub = TenantModuleSubscription(
            tenant_id=tenant_id,
            module_key=key,
            status=ModuleStatus.ACTIVE,
            billing_cycle=body.billing_cycle,
            trial_days=0,
            started_at=now,
            expires_at=_calc_expires(now, body.billing_cycle),
        )
        db.add(sub)

    await db.flush()

    # Billing ledger: plugin_charge + revenue_split
    try:
        from app.services.billing_service import record_billing_ledger, _apply_revenue_split
        from app.models.billing_ledger import EntryType, Direction
        price = sub.custom_price if sub.custom_price is not None else m.price_monthly
        if price and price > 0:
            charge = await record_billing_ledger(
                db,
                tenant_id=tenant_id,
                entry_type=EntryType.PLUGIN_CHARGE,
                direction=Direction.DEBIT,
                amount=price,
                reference_id=sub.id,
                reference_type="tenant_module_subscription",
                description=f"Marketplace: активация {m.name} ({sub.billing_cycle})",
                meta={
                    "module_key": m.key,
                    "billing_cycle": sub.billing_cycle,
                    "source": "marketplace",
                },
            )
            await _apply_revenue_split(
                db,
                tenant_id=tenant_id,
                gross_amount=price,
                source_entry=charge,
                split_type="plugin",
            )
    except Exception:
        pass

    await audit_service.write_safe(
        db,
        "module.activated",
        actor_id=user.id,
        actor_name=user.username or str(user.id),
        entity_type="tenant_module_subscription",
        entity_id=sub.id,
        after={
            "module_key":    m.key,
            "billing_cycle": body.billing_cycle,
        },
        comment=f"Marketplace: активация {m.name}",
        request=request,
        tenant_id=tenant_id,
    )

    await db.commit()
    await db.refresh(sub)
    return _sub_out(sub)


@router.post("/tenant/{tenant_id}/modules/{key}/cancel")
async def cancel_module(
    tenant_id: uuid.UUID = Path(...),
    key: str = Path(...),
    request: Request = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отписаться от модуля. status=cancelled, cancelled_at=now."""
    await _authorize_tenant(db, user, tenant_id)
    sub = await _get_sub(db, tenant_id, key)
    if not sub:
        raise HTTPException(404, "Модуль не подключён")
    if sub.status == ModuleStatus.CANCELLED:
        return _sub_out(sub)

    now = datetime.utcnow()
    sub.status       = ModuleStatus.CANCELLED
    sub.cancelled_at = now
    sub.updated_at   = now

    await audit_service.write_safe(
        db,
        "module.cancelled",
        actor_id=user.id,
        actor_name=user.username or str(user.id),
        entity_type="tenant_module_subscription",
        entity_id=sub.id,
        after={"module_key": key},
        comment=f"Marketplace: отписка от {key}",
        request=request,
        tenant_id=tenant_id,
    )

    await db.commit()
    return _sub_out(sub)
