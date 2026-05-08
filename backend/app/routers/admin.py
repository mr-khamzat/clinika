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
from app.models.franchise import Franchise
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
        select(Tenant).where(Tenant.is_active == True).order_by(Tenant.created_at.desc())
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
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Активировать / деактивировать тенант (переключает текущее состояние)."""
    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Тенант не найден")
    t.is_active = not t.is_active
    await db.commit()
    return {"id": str(t.id), "is_active": t.is_active}


@router.delete("/tenants/{tenant_id}")
async def delete_tenant(
    tenant_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Удалить тенант: деактивировать + пометить deleted_at (мягкое удаление)."""
    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Тенант не найден")
    if t.slug in ("arc",):
        raise HTTPException(status_code=400, detail="Нельзя удалить системный тенант")
    t.is_active = False
    # Отзываем все токены пользователей тенанта
    from app.models.refresh_token import RefreshToken
    from app.models.user import User as UserModel
    user_ids_r = await db.execute(select(UserModel.id).where(UserModel.tenant_id == tenant_id))
    user_ids = user_ids_r.scalars().all()
    for uid in user_ids:
        tokens_r = await db.execute(
            select(RefreshToken).where(RefreshToken.user_id == uid, RefreshToken.revoked == False)
        )
        for tok in tokens_r.scalars().all():
            tok.revoked = True
    await db.commit()
    return {"status": "deleted", "tenant_id": str(tenant_id)}


@router.patch("/tenants/{tenant_id}/plan")
async def change_tenant_plan(
    tenant_id: uuid.UUID,
    body: dict,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Сменить тариф тенанта (суперадмин). Обновляет TenantLicense + Subscription."""
    plan = (body.get("plan") or "").strip()
    if plan not in ("basic", "professional", "enterprise"):
        raise HTTPException(status_code=400, detail="Неверный тариф")
    days = int(body.get("days", 30))

    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Тенант не найден")

    # Обновить TenantLicense
    tl_r = await db.execute(select(TenantLicense).where(TenantLicense.tenant_id == tenant_id))
    tl = tl_r.scalar_one_or_none()
    if tl:
        tl.plan = plan
    else:
        db.add(TenantLicense(tenant_id=tenant_id, plan=plan, is_active=True))

    # Обновить Subscription
    from app.models.billing import Subscription, SubStatus
    from datetime import timedelta
    now = datetime.utcnow()
    period_end = now + timedelta(days=days)

    sub_r = await db.execute(
        select(Subscription).where(Subscription.tenant_id == tenant_id)
        .order_by(Subscription.created_at.desc()).limit(1)
    )
    sub = sub_r.scalar_one_or_none()
    if sub:
        sub.plan = plan
        sub.status = SubStatus.ACTIVE
        sub.current_period_start = now
        sub.current_period_end = period_end
        sub.trial_ends_at = None
        sub.cancelled_at = None
    else:
        from decimal import Decimal
        sub = Subscription(
            tenant_id=tenant_id, plan=plan, billing_cycle="monthly",
            status=SubStatus.ACTIVE, amount_per_period=Decimal("0"),
            current_period_start=now, current_period_end=period_end,
            auto_renew=True,
        )
        db.add(sub)

    await db.commit()

    # Уведомить тенанта через его support_bot_token
    import httpx
    from app.services.settings_service import get_setting
    tenant_bot = await get_setting(db, "support_bot_token", "", tenant_id=tenant_id)
    tenant_chat = await get_setting(db, "support_admin_chat_id", "", tenant_id=tenant_id)
    PLAN_LABELS = {"basic": "Базовый", "professional": "Профессиональный", "enterprise": "Корпоративный"}
    notify_text = (
        f"Tarif izmenyon na: {PLAN_LABELS.get(plan, plan)}. Aktiven {days} dney do {period_end.strftime('%d.%m.%Y')}"
    
    )
    if tenant_bot and tenant_chat:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                await client.post(
                    f"https://api.telegram.org/bot{tenant_bot}/sendMessage",
                    json={"chat_id": int(tenant_chat), "text": notify_text},
                )
        except Exception:
            pass

    return {"status": "ok", "plan": plan, "period_end": period_end.isoformat(), "days": days}


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

    tenants_total = (await db.execute(select(func.count(Tenant.id)).where(Tenant.is_active == True))).scalar() or 0
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
            User.role.in_([UserRole.MANAGER, UserRole.REG]),
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




@router.get("/billing/ledger")
async def platform_ledger(
    days: int = 30,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Доходы платформы из BillingLedger — для суперадмина."""
    from datetime import timedelta
    from app.services import billing_service
    from app.models.billing_ledger import BillingLedger, EntryType, Direction

    # Общая платформенная сводка
    summary = await billing_service.get_billing_ledger_summary(db, tenant_id=None, days=days)

    # Разбивка по тенантам: один запрос
    since = datetime.utcnow() - timedelta(days=days)

    per_q = (
        select(
            BillingLedger.tenant_id,
            Tenant.name.label("tenant_name"),
            Tenant.slug,
            BillingLedger.entry_type,
            BillingLedger.direction,
            func.sum(BillingLedger.amount).label("total"),
        )
        .join(Tenant, Tenant.id == BillingLedger.tenant_id)
        .where(BillingLedger.created_at >= since)
        .where(BillingLedger.is_split == False)
        .group_by(
            BillingLedger.tenant_id, Tenant.name, Tenant.slug,
            BillingLedger.entry_type, BillingLedger.direction,
        )
        .order_by(Tenant.name)
    )
    per_rows = (await db.execute(per_q)).all()

    # platform_income per tenant (is_split=True, PLATFORM_INCOME, CREDIT)
    plat_q = (
        select(
            BillingLedger.tenant_id,
            func.sum(BillingLedger.amount).label("platform_income"),
        )
        .where(
            BillingLedger.entry_type == EntryType.PLATFORM_INCOME,
            BillingLedger.direction == Direction.CREDIT,
            BillingLedger.created_at >= since,
        )
        .group_by(BillingLedger.tenant_id)
    )
    plat_rows = (await db.execute(plat_q)).all()
    # Фильтруем None (PLATFORM_INCOME пишется без tenant_id — это доход самой платформы)
    plat_by_tid = {
        str(r.tenant_id): float(r.platform_income)
        for r in plat_rows
        if r.tenant_id is not None
    }

    tenants_data: dict = {}
    for row in per_rows:
        tid = str(row.tenant_id) if row.tenant_id else None
        if not tid:
            continue
        if tid not in tenants_data:
            tenants_data[tid] = {
                "tenant_id": tid,
                "tenant_name": row.tenant_name,
                "slug": row.slug,
                "total_credit": 0.0,
                "total_debit": 0.0,
                "platform_income": plat_by_tid.get(tid, 0.0),
                "breakdown": {},
            }
        key = f"{row.entry_type}_{row.direction}"
        tenants_data[tid]["breakdown"][key] = float(row.total)
        if row.direction == Direction.CREDIT:
            tenants_data[tid]["total_credit"] += float(row.total)
        else:
            tenants_data[tid]["total_debit"] += float(row.total)

    # Для тенантов, у которых есть только split (платформенный) доход
    for tid, pi in plat_by_tid.items():
        if not tid or tid == "None":
            continue
        if tid not in tenants_data:
            try:
                r_q = await db.execute(select(Tenant.name, Tenant.slug).where(Tenant.id == uuid.UUID(tid)))
                row = r_q.first()
                if row:
                    tenants_data[tid] = {
                        "tenant_id": tid,
                        "tenant_name": row[0],
                        "slug": row[1],
                        "total_credit": 0.0,
                        "total_debit": 0.0,
                        "platform_income": pi,
                        "breakdown": {},
                    }
            except Exception:
                pass

    # Разбивка по модулям
    from app.models.commercial import CommercialModule, TenantModuleSubscription
    mod_q = (
        select(
            BillingLedger.reference_id,
            BillingLedger.entry_type,
            BillingLedger.direction,
            func.sum(BillingLedger.amount).label("total"),
        )
        .where(
            BillingLedger.created_at >= since,
            BillingLedger.is_split == False,
            BillingLedger.reference_type == "tenant_module_subscription",
        )
        .group_by(BillingLedger.reference_id, BillingLedger.entry_type, BillingLedger.direction)
    )
    mod_rows = (await db.execute(mod_q)).all()

    module_breakdown = []
    for row in mod_rows:
        sub_row = None
        mod_name = "?"
        mod_key = "unknown"
        mod_cat = "?"
        if row.reference_id:
            sub_r = await db.execute(
                select(TenantModuleSubscription).where(TenantModuleSubscription.id == row.reference_id)
            )
            sub_row = sub_r.scalar_one_or_none()
        if sub_row:
            mod_key = sub_row.module_key
            mod_r = await db.execute(select(CommercialModule).where(CommercialModule.key == sub_row.module_key))
            m = mod_r.scalar_one_or_none()
            if m:
                mod_name = m.name
                mod_cat = m.category
            else:
                mod_name = sub_row.module_key
        module_breakdown.append({
            "module_key":  mod_key,
            "module_name": mod_name,
            "category":    mod_cat,
            "entry_type":  row.entry_type,
            "direction":   row.direction,
            "amount":      float(row.total),
        })

    return {
        "summary": summary,
        "tenants": list(tenants_data.values()),
        "period_days": days,
        "module_breakdown": sorted(module_breakdown, key=lambda x: -x["amount"]),
    }




@router.get("/billing/ledger/entries")
async def platform_ledger_entries(
    days: int = 30,
    entry_type: str = None,
    tenant_id: uuid.UUID = None,
    limit: int = 100,
    offset: int = 0,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Список отдельных записей billing_ledger (для журнала реестра)."""
    from datetime import timedelta
    from app.models.billing_ledger import BillingLedger

    since = datetime.utcnow() - timedelta(days=days)
    filters = [BillingLedger.created_at >= since, BillingLedger.is_split == False]
    if entry_type:
        filters.append(BillingLedger.entry_type == entry_type)
    if tenant_id:
        filters.append(BillingLedger.tenant_id == tenant_id)

    rows = (await db.execute(
        select(BillingLedger)
        .where(*filters)
        .order_by(BillingLedger.created_at.desc())
        .limit(limit).offset(offset)
    )).scalars().all()

    total_q = await db.execute(
        select(func.count(BillingLedger.id)).where(*filters)
    )
    total = total_q.scalar() or 0

    def _out(e):
        return {
            "id":             str(e.id),
            "tenant_id":      str(e.tenant_id) if e.tenant_id else None,
            "entry_type":     e.entry_type,
            "direction":      e.direction,
            "amount":         float(e.amount),
            "currency":       e.currency,
            "reference_id":   str(e.reference_id) if e.reference_id else None,
            "reference_type": e.reference_type,
            "description":    e.description,
            "meta":           e.meta,
            "created_at":     e.created_at.isoformat(),
        }

    return {"total": total, "items": [_out(r) for r in rows]}
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
            User.role.in_([UserRole.MANAGER, UserRole.REG]),
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


# ── Платформенные секции для super_admin ─────────────────────────────────────
# Эти эндпоинты агрегируют данные ПО ВСЕМ ТЕНАНТАМ (без tenant_id фильтра)
# Используются в PlatformBillingSection / PlatformAnalyticsSection / PaymentGatewaysSection.

@router.get("/billing/overview")
async def platform_billing_overview(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Платформенная сводка биллинга: MRR, ARR, инвойсы, churn, ARPU."""
    from datetime import timedelta
    from app.models.billing import Invoice, InvoiceStatus

    # MRR: сумма amount_per_period активных подписок (нормализованная к месяцу).
    # Для annual делим на 12.
    subs_r = await db.execute(
        select(Subscription.billing_cycle, Subscription.amount_per_period)
        .where(Subscription.status == SubStatus.ACTIVE)
    )
    mrr = 0.0
    active_subs = 0
    for cycle, amt in subs_r.fetchall():
        amt_f = float(amt or 0)
        active_subs += 1
        if cycle == "annual":
            mrr += amt_f / 12.0
        else:
            mrr += amt_f
    arr = mrr * 12.0

    # ARPU = MRR / active_subs
    arpu = (mrr / active_subs) if active_subs > 0 else 0.0

    # Invoices summary
    total_inv_r = await db.execute(select(func.count(Invoice.id)))
    total_invoices = total_inv_r.scalar() or 0

    paid_inv_r = await db.execute(
        select(func.count(Invoice.id)).where(Invoice.status == InvoiceStatus.PAID)
    )
    paid_invoices = paid_inv_r.scalar() or 0

    overdue_inv_r = await db.execute(
        select(func.count(Invoice.id)).where(Invoice.status == InvoiceStatus.OVERDUE)
    )
    overdue_invoices = overdue_inv_r.scalar() or 0

    # Churn: cancelled последние 30 дней / active
    since = datetime.utcnow() - timedelta(days=30)
    cancelled_r = await db.execute(
        select(func.count(Subscription.id)).where(
            Subscription.status == SubStatus.CANCELLED,
            Subscription.cancelled_at >= since,
        )
    )
    cancelled_30d = cancelled_r.scalar() or 0
    churn_rate = (cancelled_30d / active_subs * 100.0) if active_subs > 0 else 0.0

    return {
        "mrr": round(mrr, 2),
        "arr": round(arr, 2),
        "arpu": round(arpu, 2),
        "active_subscriptions": active_subs,
        "total_invoices": total_invoices,
        "paid_invoices": paid_invoices,
        "overdue_invoices": overdue_invoices,
        "cancelled_30d": cancelled_30d,
        "churn_rate": round(churn_rate, 2),
    }


@router.get("/billing/subscriptions")
async def platform_billing_subscriptions(
    status: Optional[str] = None,
    days: Optional[int] = None,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Все подписки тенантов с join на tenant.name. Фильтры: status, days (по created_at)."""
    from datetime import timedelta

    q = (
        select(Subscription, Tenant.name, Tenant.slug)
        .join(Tenant, Tenant.id == Subscription.tenant_id)
        .order_by(Subscription.created_at.desc())
    )
    if status:
        q = q.where(Subscription.status == status)
    if days:
        since = datetime.utcnow() - timedelta(days=int(days))
        q = q.where(Subscription.created_at >= since)

    rows = (await db.execute(q)).fetchall()
    out = []
    for sub, t_name, t_slug in rows:
        out.append({
            "id": str(sub.id),
            "tenant_id": str(sub.tenant_id),
            "tenant_name": t_name,
            "tenant_slug": t_slug,
            "plan": sub.plan,
            "billing_cycle": sub.billing_cycle,
            "status": sub.status,
            "amount_per_period": float(sub.amount_per_period or 0),
            "current_period_start": sub.current_period_start.isoformat() if sub.current_period_start else None,
            "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
            "trial_ends_at": sub.trial_ends_at.isoformat() if sub.trial_ends_at else None,
            "cancelled_at": sub.cancelled_at.isoformat() if sub.cancelled_at else None,
            "created_at": sub.created_at.isoformat(),
        })
    return {"items": out, "count": len(out)}


@router.get("/billing/invoices")
async def platform_billing_invoices(
    status: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Все инвойсы платформы с join на tenant.name."""
    from app.models.billing import Invoice

    q = (
        select(Invoice, Tenant.name, Tenant.slug)
        .join(Tenant, Tenant.id == Invoice.tenant_id)
        .order_by(Invoice.created_at.desc())
    )
    if status:
        q = q.where(Invoice.status == status)
    if from_date:
        try:
            d_from = datetime.fromisoformat(from_date)
            q = q.where(Invoice.created_at >= d_from)
        except Exception:
            pass
    if to_date:
        try:
            d_to = datetime.fromisoformat(to_date)
            q = q.where(Invoice.created_at <= d_to)
        except Exception:
            pass

    rows = (await db.execute(q.limit(500))).fetchall()
    out = []
    for inv, t_name, t_slug in rows:
        # Пытаемся вытащить план из связанной подписки (lazy)
        plan = None
        try:
            sub_r = await db.execute(select(Subscription.plan).where(Subscription.id == inv.subscription_id))
            plan = sub_r.scalar()
        except Exception:
            pass
        out.append({
            "id": str(inv.id),
            "invoice_number": inv.invoice_number,
            "tenant_id": str(inv.tenant_id),
            "tenant_name": t_name,
            "tenant_slug": t_slug,
            "plan": plan,
            "amount": float(inv.amount or 0),
            "status": inv.status,
            "period_start": inv.period_start.isoformat() if inv.period_start else None,
            "period_end": inv.period_end.isoformat() if inv.period_end else None,
            "due_date": inv.due_date.isoformat() if inv.due_date else None,
            "paid_at": inv.paid_at.isoformat() if inv.paid_at else None,
            "created_at": inv.created_at.isoformat(),
        })
    return {"items": out, "count": len(out)}


@router.get("/billing/payments")
async def platform_billing_payments(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Все платежи платформы (последние 500)."""
    from app.models.billing import Payment

    q = (
        select(Payment, Tenant.name, Tenant.slug)
        .join(Tenant, Tenant.id == Payment.tenant_id)
        .order_by(Payment.created_at.desc())
        .limit(500)
    )
    rows = (await db.execute(q)).fetchall()
    out = []
    for p, t_name, t_slug in rows:
        out.append({
            "id": str(p.id),
            "tenant_id": str(p.tenant_id),
            "tenant_name": t_name,
            "tenant_slug": t_slug,
            "amount": float(p.amount or 0),
            "status": p.status,
            "method": p.method,
            "gateway": p.gateway,
            "transaction_id": p.transaction_id,
            "processed_at": p.processed_at.isoformat() if p.processed_at else None,
            "created_at": p.created_at.isoformat(),
        })
    return {"items": out, "count": len(out)}


@router.get("/analytics/platform")
async def platform_analytics(
    days: int = 30,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Платформенные KPI: новые тенанты, активные/total, отток, среднее, гео-распределение."""
    from datetime import timedelta
    from app.models.user import User as UserModel

    since = datetime.utcnow() - timedelta(days=days)

    # Тенанты
    total_tenants = (await db.execute(select(func.count(Tenant.id)))).scalar() or 0
    active_tenants = (await db.execute(
        select(func.count(Tenant.id)).where(Tenant.is_active == True)
    )).scalar() or 0
    new_tenants = (await db.execute(
        select(func.count(Tenant.id)).where(Tenant.created_at >= since)
    )).scalar() or 0

    # Отток: cancelled подписки за период
    churned = (await db.execute(
        select(func.count(Subscription.id)).where(
            Subscription.status == SubStatus.CANCELLED,
            Subscription.cancelled_at >= since,
        )
    )).scalar() or 0

    # Среднее количество клиник на тенант
    clinics_total = (await db.execute(
        select(func.count(Clinic.id)).where(Clinic.is_active == True)
    )).scalar() or 0
    avg_clinics_per_tenant = round(clinics_total / active_tenants, 2) if active_tenants > 0 else 0

    # Среднее количество direction-ов на клинику
    # direction = категория услуг (Service.category или Service.parent_id NULL)
    avg_directions_per_clinic = 0
    try:
        from app.models.service import Service
        # количество уникальных direction (category) на клинику
        dirs_r = await db.execute(
            select(func.count(func.distinct(Service.category)))
            .where(Service.is_active == True)
        )
        total_dirs = dirs_r.scalar() or 0
        if clinics_total > 0:
            avg_directions_per_clinic = round(total_dirs / clinics_total, 2)
    except Exception:
        pass

    # Гео-распределение: топ-городов из audit_log по super_admin/franchise_owner входам
    geo_distribution = []
    try:
        from app.models.audit import AuditEntry
        geo_q = (
            select(
                AuditEntry.geo_country,
                AuditEntry.geo_country_name,
                AuditEntry.geo_city,
                func.count(AuditEntry.id).label("hits"),
            )
            .where(
                AuditEntry.geo_country.isnot(None),
                AuditEntry.created_at >= since,
            )
            .group_by(AuditEntry.geo_country, AuditEntry.geo_country_name, AuditEntry.geo_city)
            .order_by(func.count(AuditEntry.id).desc())
            .limit(20)
        )
        rows = (await db.execute(geo_q)).fetchall()
        geo_distribution = [
            {
                "country": r.geo_country,
                "country_name": r.geo_country_name,
                "city": r.geo_city,
                "hits": int(r.hits),
            }
            for r in rows
        ]
    except Exception:
        geo_distribution = []

    # Top тенанты по выручке (за период) — через invoices.paid
    top_revenue = []
    try:
        from app.models.billing import Invoice, InvoiceStatus
        rev_q = (
            select(
                Invoice.tenant_id,
                Tenant.name,
                Tenant.slug,
                func.sum(Invoice.amount).label("revenue"),
            )
            .join(Tenant, Tenant.id == Invoice.tenant_id)
            .where(
                Invoice.status == InvoiceStatus.PAID,
                Invoice.paid_at >= since,
            )
            .group_by(Invoice.tenant_id, Tenant.name, Tenant.slug)
            .order_by(func.sum(Invoice.amount).desc())
            .limit(10)
        )
        rows = (await db.execute(rev_q)).fetchall()
        top_revenue = [
            {
                "tenant_id": str(r.tenant_id),
                "tenant_name": r.name,
                "slug": r.slug,
                "revenue": float(r.revenue or 0),
            }
            for r in rows
        ]
    except Exception:
        top_revenue = []

    # Динамика подписок: новые подписки по дням
    sub_dynamics = []
    try:
        # количество созданных подписок по дням
        dyn_q = (
            select(
                func.date_trunc('day', Subscription.created_at).label("day"),
                func.count(Subscription.id).label("count"),
            )
            .where(Subscription.created_at >= since)
            .group_by(func.date_trunc('day', Subscription.created_at))
            .order_by(func.date_trunc('day', Subscription.created_at))
        )
        rows = (await db.execute(dyn_q)).fetchall()
        sub_dynamics = [
            {"day": r.day.isoformat() if r.day else None, "count": int(r.count)}
            for r in rows
        ]
    except Exception:
        sub_dynamics = []

    return {
        "period_days": days,
        "tenants_total": total_tenants,
        "tenants_active": active_tenants,
        "tenants_new": new_tenants,
        "churned": churned,
        "avg_clinics_per_tenant": avg_clinics_per_tenant,
        "avg_directions_per_clinic": avg_directions_per_clinic,
        "geo_distribution": geo_distribution,
        "top_revenue": top_revenue,
        "subscription_dynamics": sub_dynamics,
    }


# ── Платёжные шлюзы ──────────────────────────────────────────────────────────

class PaymentGatewayUpdate(BaseModel):
    public_key: Optional[str] = None
    secret_key: Optional[str] = None
    options: Optional[dict] = None


_PAYMENT_PROVIDERS = ("stripe", "yookassa")


@router.get("/payment-gateways")
async def list_payment_gateways(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Список платёжных шлюзов с признаком наличия ключей."""
    from app.services.settings_service import get_setting

    out = []
    for provider in _PAYMENT_PROVIDERS:
        pub = await get_setting(db, f"payment_gateway_{provider}_public_key", "")
        sec = await get_setting(db, f"payment_gateway_{provider}_secret_key", "")
        opts = await get_setting(db, f"payment_gateway_{provider}_options", "")
        out.append({
            "provider": provider,
            "configured": bool(pub or sec),
            "public_key_present": bool(pub),
            "secret_key_present": bool(sec),
            # сам public_key не скрываем — он публичный
            "public_key": pub or "",
            "options": opts or "",
        })
    return out


@router.post("/payment-gateways/{provider}")
async def update_payment_gateway(
    provider: str,
    body: PaymentGatewayUpdate,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Сохранить ключи платёжного шлюза в system_settings."""
    if provider not in _PAYMENT_PROVIDERS:
        raise HTTPException(status_code=400, detail="Неизвестный провайдер")

    from app.services.settings_service import set_setting

    if body.public_key is not None:
        await set_setting(db, f"payment_gateway_{provider}_public_key", body.public_key or "")
    if body.secret_key is not None:
        await set_setting(db, f"payment_gateway_{provider}_secret_key", body.secret_key or "")
    if body.options is not None:
        import json
        await set_setting(db, f"payment_gateway_{provider}_options", json.dumps(body.options or {}))

    return {"status": "ok", "provider": provider}


# ── Эндпоинты: Пользователи (super_admin) ────────────────────────────────────
# Минимальный CRUD пользователей платформы для управления владельцами франшиз.

class PlatformUserCreate(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=200)
    username: str = Field(..., min_length=3, max_length=100)
    password: Optional[str] = None
    email: Optional[str] = None
    phone_number: Optional[str] = None
    role: str = Field("franchise_owner")


@router.get("/users")
async def list_platform_users(
    role: Optional[str] = None,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Список пользователей платформы. С фильтром по role (например ?role=franchise_owner)."""
    q = select(User).where(User.is_active == True)
    if role:
        q = q.where(User.role == role)
    q = q.order_by(User.full_name)
    rows = (await db.execute(q)).scalars().all()
    return [
        {
            "id": str(u.id),
            "username": u.username,
            "full_name": u.full_name,
            "email": u.email,
            "phone_number": u.phone_number,
            "role": u.role.value if hasattr(u.role, "value") else str(u.role),
            "tenant_id": str(u.tenant_id) if u.tenant_id else None,
        }
        for u in rows
    ]


@router.post("/users", status_code=201)
async def create_platform_user(
    body: PlatformUserCreate,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Создаёт пользователя платформенного уровня (без tenant_id)."""
    import secrets, string
    from app.core.security import hash_password

    # Уникальность username
    dup = await db.execute(select(User).where(User.username == body.username))
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Логин уже занят")

    raw_password = body.password
    if not raw_password:
        alphabet = string.ascii_letters + string.digits + "!@#$%"
        raw_password = "".join(secrets.choice(alphabet) for _ in range(12))

    # Маппим строку роли в enum
    try:
        role_enum = UserRole(body.role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Неизвестная роль: {body.role}")

    u = User(
        username=body.username,
        password_hash=hash_password(raw_password),
        full_name=body.full_name,
        email=body.email,
        phone_number=body.phone_number,
        role=role_enum,
        is_active=True,
        tenant_id=None,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)

    return {
        "id": str(u.id),
        "username": u.username,
        "full_name": u.full_name,
        "role": u.role.value if hasattr(u.role, "value") else str(u.role),
        "password": raw_password,  # показываем единожды
    }


# ── Эндпоинты: Франшизы (super_admin) ────────────────────────────────────────
# Иерархия: Платформа → Франшиза → Тенант → Клиника.
# super_admin создаёт франшизу + назначает владельца. Дальше владелец сам
# создаёт тенантов внутри своей франшизы (POST /franchise-owner/tenants).

class FranchiseCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=2, max_length=50, pattern=r"^[a-z0-9-]+$")
    owner_user_id: uuid.UUID
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    brand_color: Optional[str] = None
    logo_url: Optional[str] = None
    notes: Optional[str] = None
    # Region Lock — задаётся при создании франшизы (можно и потом через PATCH)
    allowed_region: Optional[str] = Field(None, max_length=100)
    region_strict: Optional[bool] = False


class FranchiseUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=200)
    slug: Optional[str] = Field(None, min_length=2, max_length=50, pattern=r"^[a-z0-9-]+$")
    owner_user_id: Optional[uuid.UUID] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    brand_color: Optional[str] = None
    logo_url: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    # Region Lock
    allowed_region: Optional[str] = Field(None, max_length=100)
    region_strict: Optional[bool] = None


def _serialize_franchise(f: Franchise, owner: Optional[User], tenant_count: int, mrr_sum: float) -> dict:
    """Единое представление франшизы для API."""
    return {
        "id": str(f.id),
        "name": f.name,
        "slug": f.slug,
        "owner_user_id": str(f.owner_user_id) if f.owner_user_id else None,
        "owner_full_name": owner.full_name if owner else None,
        "owner_username": owner.username if owner else None,
        "contact_email": f.contact_email,
        "contact_phone": f.contact_phone,
        "brand_color": f.brand_color,
        "logo_url": f.logo_url,
        "notes": f.notes,
        "is_active": f.is_active,
        "allowed_region": f.allowed_region,
        "region_strict": f.region_strict,
        "is_blocked": f.is_blocked,
        "blocked_until": f.blocked_until.isoformat() if f.blocked_until else None,
        "block_reason": f.block_reason,
        "blocked_at": f.blocked_at.isoformat() if f.blocked_at else None,
        "tenant_count": tenant_count,
        "mrr_sum": mrr_sum,
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "updated_at": f.updated_at.isoformat() if f.updated_at else None,
    }


@router.get("/franchises")
async def list_franchises(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Список всех франшиз с агрегатами: tenant_count и mrr_sum."""
    result = await db.execute(select(Franchise).order_by(Franchise.created_at.desc()))
    franchises = result.scalars().all()

    out = []
    for f in franchises:
        owner = None
        if f.owner_user_id:
            owner_r = await db.execute(select(User).where(User.id == f.owner_user_id))
            owner = owner_r.scalar_one_or_none()

        # Кол-во тенантов франшизы (только активные)
        tc_r = await db.execute(
            select(func.count(Tenant.id)).where(Tenant.franchise_id == f.id)
        )
        tenant_count = tc_r.scalar() or 0

        # Суммарный MRR по активным подпискам тенантов франшизы
        mrr_r = await db.execute(
            select(func.coalesce(func.sum(Subscription.amount_per_period), 0))
            .join(Tenant, Tenant.id == Subscription.tenant_id)
            .where(
                Tenant.franchise_id == f.id,
                Subscription.status == SubStatus.ACTIVE,
            )
        )
        mrr_sum = float(mrr_r.scalar() or 0)

        out.append(_serialize_franchise(f, owner, tenant_count, mrr_sum))

    return out


@router.get("/franchises/{franchise_id}")
async def get_franchise(
    franchise_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Детали одной франшизы."""
    f = await db.get(Franchise, franchise_id)
    if not f:
        raise HTTPException(status_code=404, detail="Франшиза не найдена")
    owner = None
    if f.owner_user_id:
        owner = (await db.execute(select(User).where(User.id == f.owner_user_id))).scalar_one_or_none()
    tc = (await db.execute(
        select(func.count(Tenant.id)).where(Tenant.franchise_id == f.id)
    )).scalar() or 0
    mrr = float((await db.execute(
        select(func.coalesce(func.sum(Subscription.amount_per_period), 0))
        .join(Tenant, Tenant.id == Subscription.tenant_id)
        .where(Tenant.franchise_id == f.id, Subscription.status == SubStatus.ACTIVE)
    )).scalar() or 0)
    return _serialize_franchise(f, owner, tc, mrr)


@router.post("/franchises", status_code=201)
async def create_franchise(
    body: FranchiseCreateRequest,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Создать новую франшизу + назначить владельца (повышаем role до franchise_owner)."""
    # Проверяем уникальность slug
    exists = await db.execute(select(Franchise).where(Franchise.slug == body.slug))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Slug уже занят")

    # Проверяем владельца
    owner_r = await db.execute(select(User).where(User.id == body.owner_user_id))
    owner = owner_r.scalar_one_or_none()
    if not owner:
        raise HTTPException(status_code=404, detail="Пользователь-владелец не найден")

    # Если ещё не franchise_owner — повышаем
    if owner.role != UserRole.FRANCHISE_OWNER:
        owner.role = UserRole.FRANCHISE_OWNER

    f = Franchise(
        name=body.name,
        slug=body.slug,
        owner_user_id=owner.id,
        contact_email=body.contact_email,
        contact_phone=body.contact_phone,
        brand_color=body.brand_color,
        logo_url=body.logo_url,
        notes=body.notes,
        is_active=True,
        allowed_region=body.allowed_region,
        region_strict=bool(body.region_strict),
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _serialize_franchise(f, owner, 0, 0.0)


@router.patch("/franchises/{franchise_id}")
async def update_franchise(
    franchise_id: uuid.UUID,
    body: FranchiseUpdateRequest,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Редактировать франшизу."""
    f = await db.get(Franchise, franchise_id)
    if not f:
        raise HTTPException(status_code=404, detail="Франшиза не найдена")

    if body.slug is not None and body.slug != f.slug:
        dup = await db.execute(select(Franchise).where(Franchise.slug == body.slug, Franchise.id != f.id))
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Slug уже занят")
        f.slug = body.slug

    if body.name is not None: f.name = body.name
    if body.contact_email is not None: f.contact_email = body.contact_email
    if body.contact_phone is not None: f.contact_phone = body.contact_phone
    if body.brand_color is not None: f.brand_color = body.brand_color
    if body.logo_url is not None: f.logo_url = body.logo_url
    if body.notes is not None: f.notes = body.notes
    if body.is_active is not None: f.is_active = body.is_active
    # Region Lock — пустую строку трактуем как «снять регион» (NULL)
    if body.allowed_region is not None:
        f.allowed_region = body.allowed_region.strip() or None
    if body.region_strict is not None: f.region_strict = body.region_strict

    if body.owner_user_id is not None and body.owner_user_id != f.owner_user_id:
        owner_r = await db.execute(select(User).where(User.id == body.owner_user_id))
        owner = owner_r.scalar_one_or_none()
        if not owner:
            raise HTTPException(status_code=404, detail="Новый владелец не найден")
        if owner.role != UserRole.FRANCHISE_OWNER:
            owner.role = UserRole.FRANCHISE_OWNER
        f.owner_user_id = owner.id

    f.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(f)

    owner = None
    if f.owner_user_id:
        owner = (await db.execute(select(User).where(User.id == f.owner_user_id))).scalar_one_or_none()
    return _serialize_franchise(f, owner, 0, 0.0)


@router.delete("/franchises/{franchise_id}")
async def delete_franchise(
    franchise_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Удалить франшизу. Связанные тенанты остаются, но franchise_id обнуляется (ON DELETE SET NULL)."""
    f = await db.get(Franchise, franchise_id)
    if not f:
        raise HTTPException(status_code=404, detail="Франшиза не найдена")
    await db.delete(f)
    await db.commit()
    return {"status": "deleted", "franchise_id": str(franchise_id)}


@router.get("/franchises/{franchise_id}/tenants")
async def list_franchise_tenants(
    franchise_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Список тенантов конкретной франшизы."""
    f = await db.get(Franchise, franchise_id)
    if not f:
        raise HTTPException(status_code=404, detail="Франшиза не найдена")

    rows = await db.execute(
        select(Tenant).where(Tenant.franchise_id == franchise_id).order_by(Tenant.created_at.desc())
    )
    out = []
    for t in rows.scalars().all():
        lic = (await db.execute(select(TenantLicense).where(TenantLicense.tenant_id == t.id))).scalar_one_or_none()
        sub = (await db.execute(
            select(Subscription).where(Subscription.tenant_id == t.id)
            .order_by(Subscription.created_at.desc()).limit(1)
        )).scalar_one_or_none()
        out.append({
            "id": str(t.id),
            "name": t.name,
            "slug": t.slug,
            "is_active": t.is_active,
            "plan": lic.plan if lic else None,
            "subscription_status": sub.status if sub else None,
            "mrr": float(sub.amount_per_period) if sub else 0.0,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })
    return out

class FranchiseBillingIn(BaseModel):
    platform_fee_per_bonus: float | None = None
    min_bonus_amount: float | None = None
    refund_fee_on_cancel: bool | None = None
    billing_period_days: int | None = None


@router.patch("/franchises/{franchise_id}/billing")
async def update_franchise_billing(
    franchise_id: uuid.UUID,
    body: FranchiseBillingIn,
    current: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Изменение тарифной политики франшизы: % fee, минимум бонуса, refund-флаг, период."""
    from decimal import Decimal
    from app.models.franchise import Franchise
    fr = (await db.execute(select(Franchise).where(Franchise.id == franchise_id))).scalar_one_or_none()
    if not fr:
        raise HTTPException(404, "Franchise not found")
    if body.platform_fee_per_bonus is not None:
        fr.platform_fee_per_bonus = Decimal(str(body.platform_fee_per_bonus))
    if body.min_bonus_amount is not None:
        fr.min_bonus_amount = Decimal(str(body.min_bonus_amount))
    if body.refund_fee_on_cancel is not None:
        fr.refund_fee_on_cancel = body.refund_fee_on_cancel
    if body.billing_period_days is not None:
        fr.billing_period_days = max(1, int(body.billing_period_days))
    await db.commit()
    return {"ok": True, "franchise_id": str(franchise_id)}


# ===== БЛОК: Region Lock Phase 2 v2 — manual block + IP allowlist =====
# Все эндпоинты — только super_admin. Действия пишутся в audit_log.

class FranchiseBlockRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)
    blocked_until: Optional[datetime] = None  # null — бессрочно


@router.post("/franchises/{franchise_id}/block")
async def block_franchise(
    franchise_id: uuid.UUID,
    body: FranchiseBlockRequest,
    current: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Ручная блокировка франшизы. Срабатывает enforce_region_lock на защищённых endpoint'ах.
    blocked_until=null — бессрочно. Чтобы снять — POST /unblock."""
    f = await db.get(Franchise, franchise_id)
    if not f:
        raise HTTPException(status_code=404, detail="Франшиза не найдена")

    f.is_blocked = True
    f.block_reason = (body.reason or "").strip() or None
    f.blocked_until = body.blocked_until
    f.blocked_by = current.id
    f.blocked_at = datetime.utcnow()

    from app.services import audit_service
    await audit_service.write_safe(
        db, "franchise.blocked",
        actor_id=current.id, actor_name=current.full_name,
        entity_type="franchise", entity_id=f.id,
        after={
            "franchise_id": str(f.id), "franchise_name": f.name,
            "reason": f.block_reason,
            "blocked_until": f.blocked_until.isoformat() if f.blocked_until else None,
        },
        comment=f"Ручная блокировка франшизы «{f.name}»",
    )
    await db.commit()
    return {
        "ok": True,
        "is_blocked": True,
        "blocked_until": f.blocked_until.isoformat() if f.blocked_until else None,
        "block_reason": f.block_reason,
    }


@router.post("/franchises/{franchise_id}/unblock")
async def unblock_franchise(
    franchise_id: uuid.UUID,
    current: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Снять ручную блокировку франшизы."""
    f = await db.get(Franchise, franchise_id)
    if not f:
        raise HTTPException(status_code=404, detail="Франшиза не найдена")
    f.is_blocked = False
    f.blocked_until = None
    f.block_reason = None
    f.blocked_by = None
    f.blocked_at = None
    from app.services import audit_service
    await audit_service.write_safe(
        db, "franchise.unblocked",
        actor_id=current.id, actor_name=current.full_name,
        entity_type="franchise", entity_id=f.id,
        comment=f"Разблокировка франшизы «{f.name}»",
    )
    await db.commit()
    return {"ok": True, "is_blocked": False}


# ── IP allowlist ──────────────────────────────────────────────────────────────

class IpAllowlistRequest(BaseModel):
    ip_cidr: str = Field(..., min_length=3, max_length=43)  # IPv4/CIDR or IPv6
    comment: Optional[str] = Field(None, max_length=500)
    bypass_block: Optional[bool] = False


@router.get("/franchises/{franchise_id}/ip-allowlist")
async def list_ip_allowlist(
    franchise_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Список разрешённых IP/CIDR франшизы."""
    f = await db.get(Franchise, franchise_id)
    if not f:
        raise HTTPException(status_code=404, detail="Франшиза не найдена")
    from app.models.franchise_ip_allowlist import FranchiseIpAllowlist
    rows = (await db.execute(
        select(FranchiseIpAllowlist)
        .where(FranchiseIpAllowlist.franchise_id == franchise_id)
        .order_by(FranchiseIpAllowlist.created_at.desc())
    )).scalars().all()
    out = []
    for r in rows:
        creator = None
        if r.created_by:
            creator = (await db.execute(select(User).where(User.id == r.created_by))).scalar_one_or_none()
        out.append({
            "id": str(r.id),
            "ip_cidr": str(r.ip_cidr),
            "comment": r.comment,
            "bypass_block": r.bypass_block,
            "created_by": str(r.created_by) if r.created_by else None,
            "created_by_name": creator.full_name if creator else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return out


@router.post("/franchises/{franchise_id}/ip-allowlist", status_code=201)
async def add_ip_allowlist(
    franchise_id: uuid.UUID,
    body: IpAllowlistRequest,
    current: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Добавить IP/CIDR в whitelist франшизы. INET-формат: '1.2.3.4' или '1.2.0.0/16'."""
    import ipaddress
    f = await db.get(Franchise, franchise_id)
    if not f:
        raise HTTPException(status_code=404, detail="Франшиза не найдена")
    raw = (body.ip_cidr or "").strip()
    try:
        # Валидация: ipaddress принимает host или network с маской
        ipaddress.ip_network(raw, strict=False)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Некорректный IP/CIDR: {raw}")

    from app.models.franchise_ip_allowlist import FranchiseIpAllowlist
    entry = FranchiseIpAllowlist(
        franchise_id=franchise_id,
        ip_cidr=raw,
        comment=(body.comment or "").strip() or None,
        bypass_block=bool(body.bypass_block),
        created_by=current.id,
    )
    db.add(entry)
    from app.services import audit_service
    await audit_service.write_safe(
        db, "franchise.ip_allowlist_added",
        actor_id=current.id, actor_name=current.full_name,
        entity_type="franchise", entity_id=franchise_id,
        after={"ip_cidr": raw, "comment": entry.comment, "bypass_block": entry.bypass_block},
        comment=f"IP {raw} добавлен в whitelist «{f.name}»",
    )
    await db.commit()
    await db.refresh(entry)
    return {
        "id": str(entry.id),
        "ip_cidr": str(entry.ip_cidr),
        "comment": entry.comment,
        "bypass_block": entry.bypass_block,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }


@router.delete("/franchises/{franchise_id}/ip-allowlist/{entry_id}")
async def delete_ip_allowlist(
    franchise_id: uuid.UUID,
    entry_id: uuid.UUID,
    current: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Удалить запись из whitelist."""
    from app.models.franchise_ip_allowlist import FranchiseIpAllowlist
    entry = await db.get(FranchiseIpAllowlist, entry_id)
    if not entry or entry.franchise_id != franchise_id:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    snapshot = {"ip_cidr": str(entry.ip_cidr), "comment": entry.comment, "bypass_block": entry.bypass_block}
    await db.delete(entry)
    from app.services import audit_service
    await audit_service.write_safe(
        db, "franchise.ip_allowlist_removed",
        actor_id=current.id, actor_name=current.full_name,
        entity_type="franchise", entity_id=franchise_id,
        before=snapshot,
        comment=f"IP {snapshot['ip_cidr']} удалён из whitelist",
    )
    await db.commit()
    return {"ok": True, "deleted_id": str(entry_id)}

