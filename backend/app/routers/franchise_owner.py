"""
Кабинет владельца франшизы (role=franchise_owner).
Доступные операции:
  GET  /franchise-owner/me           — данные моей франшизы
  GET  /franchise-owner/tenants      — все тенанты в моей франшизе
  POST /franchise-owner/tenants      — создать новый тенант ВНУТРИ моей франшизы
  PATCH /franchise-owner/tenants/{id}— редактировать тенант (только свой)

Иерархия: super_admin создаёт Franchise + назначает владельца.
Владелец заходит в свой кабинет и сам формирует сеть тенантов под своей франшизой.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_franchise_owner
from app.models.user import User, UserRole
from app.models.franchise import Franchise
from app.models.tenant import Tenant, TenantLicense, TenantBranding
from app.models.billing import Subscription, SubStatus
from app.services.tenant_onboarding_service import onboard_tenant


router = APIRouter(prefix="/franchise-owner", tags=["franchise-owner"])


# ── Схемы ────────────────────────────────────────────────────────────────────

class TenantCreateForOwner(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    plan: str = Field("trial", pattern=r"^(trial|basic|professional|enterprise|pro)$")
    admin_full_name: str = Field(..., min_length=2)
    admin_login: str = Field(..., min_length=3, max_length=100)
    admin_password: Optional[str] = None
    primary_color: Optional[str] = None
    sidebar_color: Optional[str] = None
    city: Optional[str] = None


class TenantPatchForOwner(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


# ── Хелперы ──────────────────────────────────────────────────────────────────

async def _get_my_franchise(db: AsyncSession, user: User) -> Franchise:
    """Возвращает Franchise, которой владеет текущий пользователь."""
    r = await db.execute(select(Franchise).where(Franchise.owner_user_id == user.id))
    f = r.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="У вас нет привязанной франшизы. Обратитесь к администратору платформы.")
    return f


# ── Эндпоинты ────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_my_franchise(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Данные моей франшизы + агрегаты."""
    f = await _get_my_franchise(db, user)
    tc = (await db.execute(
        select(func.count(Tenant.id)).where(Tenant.franchise_id == f.id)
    )).scalar() or 0
    mrr = float((await db.execute(
        select(func.coalesce(func.sum(Subscription.amount_per_period), 0))
        .join(Tenant, Tenant.id == Subscription.tenant_id)
        .where(Tenant.franchise_id == f.id, Subscription.status == SubStatus.ACTIVE)
    )).scalar() or 0)

    return {
        "id": str(f.id),
        "name": f.name,
        "slug": f.slug,
        "owner_user_id": str(f.owner_user_id) if f.owner_user_id else None,
        "contact_email": f.contact_email,
        "contact_phone": f.contact_phone,
        "brand_color": f.brand_color,
        "logo_url": f.logo_url,
        "notes": f.notes,
        "is_active": f.is_active,
        "tenant_count": tc,
        "mrr_sum": mrr,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


@router.get("/tenants")
async def list_my_tenants(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Список тенантов моей франшизы."""
    f = await _get_my_franchise(db, user)
    rows = await db.execute(
        select(Tenant).where(Tenant.franchise_id == f.id).order_by(Tenant.created_at.desc())
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
            "trial_ends_at": sub.trial_ends_at.isoformat() if (sub and sub.trial_ends_at) else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })
    return out


@router.post("/tenants", status_code=201)
async def create_tenant_in_my_franchise(
    body: TenantCreateForOwner,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Создать тенант внутри моей франшизы. Использует общий onboard_tenant + проставляет franchise_id."""
    f = await _get_my_franchise(db, user)

    # План: для стандартного onboard_tenant нужен один из basic/professional/enterprise.
    # Маппим из UI (trial/pro и т.п.) во внутренний план.
    plan_map = {
        "trial": "basic",
        "pro": "professional",
        "basic": "basic",
        "professional": "professional",
        "enterprise": "enterprise",
    }
    onboard_plan = plan_map.get(body.plan, "basic")

    try:
        result = await onboard_tenant(
            db,
            name=body.name,
            slug=body.slug,
            city=body.city,
            plan=onboard_plan,
            admin_name=body.admin_full_name,
            admin_username=body.admin_login,
            admin_password=body.admin_password,
            primary_color=body.primary_color or (f.brand_color or "#0097A7"),
            sidebar_color=body.sidebar_color or "#004D5F",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Привязываем созданный тенант к моей франшизе
    tenant_id = uuid.UUID(result["tenant_id"])
    t = await db.get(Tenant, tenant_id)
    if t:
        t.franchise_id = f.id
        # Дополнительно проставляем franchise_owner_id для совместимости с legacy-кодом
        t.franchise_owner_id = user.id
        await db.commit()

    result["franchise_id"] = str(f.id)
    return result


@router.patch("/tenants/{tenant_id}")
async def update_my_tenant(
    tenant_id: uuid.UUID,
    body: TenantPatchForOwner,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Редактировать тенант — только если он принадлежит моей франшизе."""
    f = await _get_my_franchise(db, user)
    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Тенант не найден")
    if t.franchise_id != f.id:
        raise HTTPException(status_code=403, detail="Этот тенант не принадлежит вашей франшизе")

    if body.name is not None: t.name = body.name
    if body.is_active is not None: t.is_active = body.is_active
    await db.commit()
    await db.refresh(t)

    return {
        "id": str(t.id),
        "name": t.name,
        "slug": t.slug,
        "is_active": t.is_active,
    }
