"""
Super Admin API — управление платформой.
Доступно только role=super_admin.
/admin/tenants, /admin/metrics, /admin/billing
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from pydantic import BaseModel, Field
from typing import Optional
import uuid
from datetime import datetime, date

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.tenant import Tenant, TenantLicense, TenantBranding, TenantModule, TenantPlugin
from app.models.billing import Subscription, SubStatus
from app.models.clinic import Clinic
from app.models.referral import Referral
from app.services.tenant_onboarding_service import onboard_tenant

router = APIRouter(prefix="/admin", tags=["super-admin"])


# ── Зависимость: только super_admin ──────────────────────────────────────────

async def require_super_admin(current_user: User = Depends(get_current_user)) -> User:
    from app.config import settings
    is_sa = (current_user.role == UserRole.SUPER_ADMIN or
             (current_user.username and current_user.username == settings.superadmin_username))
    if not is_sa:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только для super_admin")
    return current_user


# ── Схемы ────────────────────────────────────────────────────────────────────

class TenantCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=2, max_length=100, pattern=r'^[a-z0-9-]+$')
    plan: str = Field("basic", pattern=r'^(basic|professional|enterprise)$')
    admin_name: str = Field(..., min_length=2)
    admin_username: str = Field(..., min_length=3, max_length=100)
    admin_password: Optional[str] = None
    primary_color: str = "#0097A7"
    sidebar_color: str = "#004D5F"
    city: Optional[str] = None


class TenantBriefOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    is_active: bool
    plan: Optional[str]
    clinics_count: int
    users_count: int
    subscription_status: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class TenantDetailOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    domain: Optional[str]
    is_active: bool
    plan: Optional[str]
    max_clinics: int
    max_users: int
    valid_until: Optional[date]
    subscription_status: Optional[str]
    created_at: datetime
    brand_name: Optional[str]
    primary_color: Optional[str]

    class Config:
        from_attributes = True


class ModuleUpdate(BaseModel):
    module: str
    enabled: bool
    config: Optional[dict] = None


class PluginUpdate(BaseModel):
    plugin: str
    enabled: bool
    config: Optional[dict] = None


class TenantToggle(BaseModel):
    is_active: bool


# ── Эндпоинты: Тенанты ───────────────────────────────────────────────────────

@router.get("/tenants")
async def list_tenants(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Список всех тенантов с агрегированной статистикой."""
    tenants_result = await db.execute(
        select(Tenant).order_by(Tenant.created_at.desc())
    )
    tenants = tenants_result.scalars().all()

    result = []
    for t in tenants:
        # Лицензия
        lic_r = await db.execute(select(TenantLicense).where(TenantLicense.tenant_id == t.id))
        lic = lic_r.scalar_one_or_none()

        # Подписка
        sub_r = await db.execute(
            select(Subscription).where(Subscription.tenant_id == t.id)
            .order_by(Subscription.created_at.desc()).limit(1)
        )
        sub = sub_r.scalar_one_or_none()

        # Кол-во клиник
        cl_r = await db.execute(
            select(func.count()).where(Clinic.tenant_id == t.id, Clinic.is_active == True)
        )
        clinics_count = cl_r.scalar() or 0

        # Кол-во пользователей
        from app.models.user import User as UserModel
        us_r = await db.execute(
            select(func.count()).where(UserModel.tenant_id == t.id, UserModel.is_active == True)
        )
        users_count = us_r.scalar() or 0

        result.append({
            "id": str(t.id),
            "name": t.name,
            "slug": t.slug,
            "is_active": t.is_active,
            "plan": lic.plan if lic else None,
            "clinics_count": clinics_count,
            "users_count": users_count,
            "subscription_status": sub.status if sub else None,
            "created_at": t.created_at.isoformat(),
        })

    return result


@router.get("/tenants/{tenant_id}")
async def get_tenant_detail(
    tenant_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Детальная информация о тенанте."""
    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Тенант не найден")

    lic_r = await db.execute(select(TenantLicense).where(TenantLicense.tenant_id == t.id))
    lic = lic_r.scalar_one_or_none()

    brand_r = await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == t.id))
    brand = brand_r.scalar_one_or_none()

    sub_r = await db.execute(
        select(Subscription).where(Subscription.tenant_id == t.id)
        .order_by(Subscription.created_at.desc()).limit(1)
    )
    sub = sub_r.scalar_one_or_none()

    # Модули
    mods_r = await db.execute(select(TenantModule).where(TenantModule.tenant_id == t.id))
    modules = [{"module": m.module, "enabled": m.enabled, "config": m.config} for m in mods_r.scalars()]

    # Плагины
    plugs_r = await db.execute(select(TenantPlugin).where(TenantPlugin.tenant_id == t.id))
    plugins = [{"plugin": p.plugin, "enabled": p.enabled, "config": p.config} for p in plugs_r.scalars()]

    return {
        "id": str(t.id),
        "name": t.name,
        "slug": t.slug,
        "domain": t.domain,
        "is_active": t.is_active,
        "plan": lic.plan if lic else None,
        "max_clinics": lic.max_clinics if lic else 0,
        "max_users": lic.max_users if lic else 0,
        "valid_until": lic.valid_until.isoformat() if (lic and lic.valid_until) else None,
        "subscription_status": sub.status if sub else None,
        "created_at": t.created_at.isoformat(),
        "brand_name": brand.brand_name if brand else None,
        "primary_color": brand.primary_color if brand else None,
        "modules": modules,
        "plugins": plugins,
    }


@router.post("/tenants", status_code=201)
async def create_tenant(
    data: TenantCreateRequest,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Онбординг нового тенанта — создаёт всё за одну транзакцию."""
    try:
        result = await onboard_tenant(
            db,
            name=data.name,
            slug=data.slug,
            city=data.city,
            plan=data.plan,
            admin_name=data.admin_name,
            admin_username=data.admin_username,
            admin_password=data.admin_password,
            primary_color=data.primary_color,
            sidebar_color=data.sidebar_color,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/tenants/{tenant_id}/toggle")
async def toggle_tenant(
    tenant_id: uuid.UUID,
    data: TenantToggle,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Активировать / деактивировать тенант."""
    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Тенант не найден")
    t.is_active = data.is_active
    await db.commit()
    return {"id": str(t.id), "is_active": t.is_active}


@router.put("/tenants/{tenant_id}/modules")
async def upsert_tenant_module(
    tenant_id: uuid.UUID,
    data: ModuleUpdate,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Включить/выключить модуль для тенанта (переопределяет план)."""
    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Тенант не найден")

    r = await db.execute(
        select(TenantModule).where(
            TenantModule.tenant_id == tenant_id,
            TenantModule.module == data.module,
        )
    )
    mod = r.scalar_one_or_none()
    if mod:
        mod.enabled = data.enabled
        mod.config = data.config
        mod.updated_at = datetime.utcnow()
    else:
        mod = TenantModule(tenant_id=tenant_id, module=data.module, enabled=data.enabled, config=data.config)
        db.add(mod)

    await db.commit()
    return {"tenant_id": str(tenant_id), "module": data.module, "enabled": data.enabled}


@router.put("/tenants/{tenant_id}/plugins")
async def upsert_tenant_plugin(
    tenant_id: uuid.UUID,
    data: PluginUpdate,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Включить/выключить плагин для тенанта."""
    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Тенант не найден")

    r = await db.execute(
        select(TenantPlugin).where(
            TenantPlugin.tenant_id == tenant_id,
            TenantPlugin.plugin == data.plugin,
        )
    )
    plug = r.scalar_one_or_none()
    if plug:
        plug.enabled = data.enabled
        plug.config = data.config
        plug.updated_at = datetime.utcnow()
    else:
        plug = TenantPlugin(tenant_id=tenant_id, plugin=data.plugin, enabled=data.enabled, config=data.config)
        db.add(plug)

    await db.commit()
    return {"tenant_id": str(tenant_id), "plugin": data.plugin, "enabled": data.enabled}


# ── Эндпоинты: Метрики платформы ────────────────────────────────────────────

@router.get("/metrics")
async def platform_metrics(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Сводные метрики всей платформы."""
    from app.models.user import User as UserModel

    tenants_total = (await db.execute(select(func.count(Tenant.id)))).scalar() or 0
    tenants_active = (await db.execute(select(func.count(Tenant.id)).where(Tenant.is_active == True))).scalar() or 0
    users_total = (await db.execute(select(func.count(UserModel.id)).where(UserModel.is_active == True))).scalar() or 0
    clinics_total = (await db.execute(select(func.count(Clinic.id)).where(Clinic.is_active == True))).scalar() or 0
    referrals_total = (await db.execute(select(func.count(Referral.id)))).scalar() or 0

    # Подписки по статусу
    subs_r = await db.execute(
        select(Subscription.status, func.count(Subscription.id)).group_by(Subscription.status)
    )
    subs_by_status = {row[0]: row[1] for row in subs_r.fetchall()}

    # Планы
    plans_r = await db.execute(
        select(TenantLicense.plan, func.count(TenantLicense.id)).group_by(TenantLicense.plan)
    )
    plans = {row[0]: row[1] for row in plans_r.fetchall()}

    return {
        "tenants_total": tenants_total,
        "tenants_active": tenants_active,
        "users_total": users_total,
        "clinics_total": clinics_total,
        "referrals_total": referrals_total,
        "subscriptions_by_status": subs_by_status,
        "tenants_by_plan": plans,
    }


# ── Эндпоинты: Биллинг платформы ────────────────────────────────────────────

@router.get("/billing")
async def platform_billing(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Все подписки и финансовая сводка платформы."""
    from app.models.billing import Invoice, Payment

    subs_r = await db.execute(
        select(Subscription, Tenant.name, Tenant.slug)
        .join(Tenant, Tenant.id == Subscription.tenant_id)
        .order_by(Subscription.created_at.desc())
    )
    rows = subs_r.fetchall()

    subscriptions = []
    for sub, tenant_name, tenant_slug in rows:
        subscriptions.append({
            "id": str(sub.id),
            "tenant_name": tenant_name,
            "tenant_slug": tenant_slug,
            "plan": sub.plan,
            "status": sub.status,
            "billing_cycle": sub.billing_cycle,
            "amount_per_period": float(sub.amount_per_period),
            "current_period_end": sub.current_period_end.isoformat(),
            "trial_ends_at": sub.trial_ends_at.isoformat() if sub.trial_ends_at else None,
            "created_at": sub.created_at.isoformat(),
        })

    # MRR (Monthly Recurring Revenue)
    mrr_r = await db.execute(
        select(func.sum(Subscription.amount_per_period))
        .where(Subscription.status == SubStatus.ACTIVE)
    )
    mrr = float(mrr_r.scalar() or 0)

    return {
        "mrr": mrr,
        "subscriptions_count": len(subscriptions),
        "subscriptions": subscriptions,
    }

# ── Управление подпиской тенанта (super_admin) ───────────────────────────────

class TenantSubscriptionRequest(BaseModel):
    plan: str = Field(..., pattern="^(basic|professional|enterprise)$")
    billing_cycle: str = Field("monthly", pattern="^(monthly|annual)$")
    trial_days: int = Field(0, ge=0, le=90)


@router.post("/tenants/{tenant_id}/subscription")
async def set_tenant_subscription(
    tenant_id: uuid.UUID,
    body: TenantSubscriptionRequest,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Активировать или обновить подписку тенанта. Доступно только super_admin."""
    from app.models.billing import Subscription, PLAN_PRICES, SubStatus
    from decimal import Decimal
    from datetime import timedelta

    # Проверяем что тенант существует
    tenant_r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_r.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Тенант не найден")

    prices = PLAN_PRICES.get(body.plan, {})
    amount = prices.get("annual" if body.billing_cycle == "annual" else "monthly", Decimal("0"))

    now = datetime.utcnow()
    if body.billing_cycle == "annual":
        period_end = now.replace(year=now.year + 1)
    else:
        import calendar
        month = now.month + 1 if now.month < 12 else 1
        year = now.year if now.month < 12 else now.year + 1
        day = min(now.day, calendar.monthrange(year, month)[1])
        period_end = now.replace(year=year, month=month, day=day)

    trial_end = (now + timedelta(days=body.trial_days)) if body.trial_days > 0 else None
    sub_status = SubStatus.TRIAL if body.trial_days > 0 else SubStatus.ACTIVE

    # Ищем существующую подписку
    existing_r = await db.execute(
        select(Subscription).where(Subscription.tenant_id == tenant_id)
        .order_by(Subscription.created_at.desc()).limit(1)
    )
    existing = existing_r.scalar_one_or_none()

    if existing:
        existing.plan = body.plan
        existing.billing_cycle = body.billing_cycle
        existing.amount_per_period = amount
        existing.status = sub_status
        existing.trial_ends_at = trial_end
        existing.current_period_start = now
        existing.current_period_end = period_end
        existing.next_invoice_date = period_end
        existing.auto_renew = True
        existing.cancelled_at = None
        sub = existing
    else:
        sub = Subscription(
            tenant_id=tenant_id,
            plan=body.plan,
            billing_cycle=body.billing_cycle,
            status=sub_status,
            amount_per_period=amount,
            trial_ends_at=trial_end,
            current_period_start=now,
            current_period_end=period_end,
            next_invoice_date=period_end,
            auto_renew=True,
        )
        db.add(sub)

    # Обновляем план в tenant_licenses тоже
    tl_r = await db.execute(select(TenantLicense).where(TenantLicense.tenant_id == tenant_id))
    tl = tl_r.scalar_one_or_none()
    if tl:
        tl.plan = body.plan
    else:
        db.add(TenantLicense(tenant_id=tenant_id, plan=body.plan))

    await db.commit()
    await db.refresh(sub)

    return {
        "status": "ok",
        "subscription_id": str(sub.id),
        "plan": sub.plan,
        "billing_status": sub.status,
        "trial_ends_at": sub.trial_ends_at.isoformat() if sub.trial_ends_at else None,
        "period_end": sub.current_period_end.isoformat(),
        "amount_per_period": float(sub.amount_per_period),
    }



@router.post("/tenants/{tenant_id}/reset-password")
async def reset_tenant_admin_password(
    tenant_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    import secrets, string
    from app.core.security import hash_password

    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Тенант не найден")

    r = await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.role.in_([UserRole.MANAGER, UserRole.ADMIN]),
            User.is_active == True,
        ).order_by(User.created_at.asc()).limit(1)
    )
    admin = r.scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=404, detail="Администратор тенанта не найден")

    alphabet = string.ascii_letters + string.digits + "!@#$%"
    new_password = "".join(secrets.choice(alphabet) for _ in range(12))
    admin.password_hash = hash_password(new_password)
    await db.commit()

    return {
        "username": admin.username,
        "new_password": new_password,
        "url": f"https://xn--e1afagcdp8ak4h.xn--p1ai/{t.slug}",
        "admin_panel": f"https://xn--e1afagcdp8ak4h.xn--p1ai/{t.slug}/admin",
        "note": "Пароль показан единожды — сохраните его перед закрытием",
    }


@router.get("/tenants/{tenant_id}/credentials")
async def get_tenant_credentials(
    tenant_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Тенант не найден")

    r = await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.role.in_([UserRole.MANAGER, UserRole.ADMIN]),
            User.is_active == True,
        ).order_by(User.created_at.asc()).limit(1)
    )
    admin = r.scalar_one_or_none()

    return {
        "tenant_id": str(t.id),
        "tenant_name": t.name,
        "slug": t.slug,
        "admin_username": admin.username if admin else None,
        "url": f"https://xn--e1afagcdp8ak4h.xn--p1ai/{t.slug}",
        "admin_panel": f"https://xn--e1afagcdp8ak4h.xn--p1ai/{t.slug}/admin",
    }
