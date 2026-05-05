"""
Роутер тенанта: /tenant/*
Информация о текущем тенанте, брендинге, лицензии.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime

from app.database import get_db
from app.core.deps import get_current_user, require_manager
from app.models.user import User
from app.models.tenant import Tenant, TenantLicense, TenantBranding
from app.core.tenant import get_current_tenant

router = APIRouter(prefix="/tenant", tags=["tenant"])


# --- Схемы ответов ---

class TenantOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    domain: Optional[str]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class LicenseOut(BaseModel):
    plan: str
    max_clinics: int
    max_users: int
    features: Optional[dict]
    valid_from: datetime
    valid_until: Optional[datetime]
    is_active: bool

    class Config:
        from_attributes = True


class BrandingOut(BaseModel):
    brand_name: Optional[str]
    logo_url: Optional[str]
    primary_color: str
    sidebar_color: str
    bg_color: str
    font_family: str
    # White-label CMS расширения
    secondary_color: Optional[str] = None
    favicon_url: Optional[str] = None
    og_image_url: Optional[str] = None
    footer_text: Optional[str] = None
    custom_domain: Optional[str] = None
    domain_verified: bool = False
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    support_phone: Optional[str] = None
    support_email: Optional[str] = None
    hide_menu_items: Optional[list] = []
    rename_menu_items: Optional[dict] = {}

    class Config:
        from_attributes = True


class BrandingUpdate(BaseModel):
    brand_name: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    sidebar_color: Optional[str] = None
    bg_color: Optional[str] = None
    font_family: Optional[str] = None
    # White-label CMS расширения
    secondary_color: Optional[str] = None
    favicon_url: Optional[str] = None
    og_image_url: Optional[str] = None
    footer_text: Optional[str] = None
    custom_domain: Optional[str] = None
    domain_verified: Optional[bool] = None
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    support_phone: Optional[str] = None
    support_email: Optional[str] = None
    hide_menu_items: Optional[list] = None
    rename_menu_items: Optional[dict] = None


# --- Эндпоинты ---

@router.get("/current", response_model=TenantOut)
async def get_tenant_current(
    tenant: Tenant | None = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Информация о текущем тенанте."""
    if tenant is None:
        # single-tenant режим — возвращаем дефолтный
        result = await db.execute(select(Tenant).where(Tenant.slug == "default"))
        tenant = result.scalar_one_or_none()
        if tenant is None:
            raise HTTPException(status_code=404, detail="Тенант не найден")
    return tenant


@router.get("/branding", response_model=BrandingOut)
async def get_branding(
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Настройки брендинга тенанта."""
    if tenant is None:
        result = await db.execute(select(Tenant).where(Tenant.slug == "default"))
        tenant = result.scalar_one_or_none()
    if tenant is None:
        # Возвращаем дефолтные значения
        return BrandingOut(
            brand_name=None, logo_url=None,
            primary_color="#0097A7", sidebar_color="#004D5F",
            bg_color="#F0F5F6", font_family="Inter",
        )
    result = await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant.id))
    branding = result.scalar_one_or_none()
    if branding is None:
        return BrandingOut(
            brand_name=None, logo_url=None,
            primary_color="#0097A7", sidebar_color="#004D5F",
            bg_color="#F0F5F6", font_family="Inter",
        )
    return branding


@router.patch("/branding", response_model=BrandingOut)
async def update_branding(
    data: BrandingUpdate,
    tenant: Tenant | None = Depends(get_current_tenant),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Обновление брендинга (только менеджер)."""
    if tenant is None:
        result = await db.execute(select(Tenant).where(Tenant.slug == "default"))
        tenant = result.scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Тенант не найден")

    result = await db.execute(select(TenantBranding).where(TenantBranding.tenant_id == tenant.id))
    branding = result.scalar_one_or_none()
    if branding is None:
        branding = TenantBranding(tenant_id=tenant.id)
        db.add(branding)

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(branding, field, value)

    await db.commit()
    await db.refresh(branding)
    return branding


@router.get("/license", response_model=LicenseOut)
async def get_license(
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Лицензия тенанта."""
    if tenant is None:
        result = await db.execute(select(Tenant).where(Tenant.slug == "default"))
        tenant = result.scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Тенант не найден")

    result = await db.execute(select(TenantLicense).where(TenantLicense.tenant_id == tenant.id))
    lic = result.scalar_one_or_none()
    if lic is None:
        raise HTTPException(status_code=404, detail="Лицензия не найдена")
    return lic


# ── Онбординг нового тенанта (публичный или super_admin) ─────────────────────

class TenantCreateRequest(BaseModel):
    name: str
    slug: str
    plan: str = "basic"
    admin_name: str
    admin_username: str
    admin_password: Optional[str] = None
    primary_color: str = "#0097A7"
    sidebar_color: str = "#004D5F"
    city: Optional[str] = None
    # Секретный ключ для защиты эндпоинта (из .env)
    secret_key: Optional[str] = None


@router.post("/create", status_code=201)
async def create_tenant(
    data: TenantCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Создаёт нового тенанта: tenant + license (trial) + branding + admin user.
    Защищён SECRET_ONBOARDING_KEY из конфига (если задан).
    Возвращает логин/пароль и URL нового тенанта.
    """
    from app.config import settings
    from app.services.tenant_onboarding_service import onboard_tenant as _onboard
    # Проверяем ключ, если он задан в конфиге
    expected = getattr(settings, "onboarding_secret", None)
    if expected and data.secret_key != expected:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Неверный ключ доступа")
    try:
        result = await _onboard(
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

@router.get("/modules-status")
async def my_tenant_modules_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает модули текущего тенанта (для проверки доступности фич в UI).
    Любая роль внутри тенанта может прочитать."""
    from app.models.commercial import TenantModuleSubscription
    if not current_user.tenant_id:
        return {"modules": []}
    rows = (await db.execute(
        select(TenantModuleSubscription).where(
            TenantModuleSubscription.tenant_id == current_user.tenant_id
        )
    )).scalars().all()
    return {
        "modules": [
            {
                "module_key": r.module_key,
                "status": r.status,
                "expires_at": r.expires_at.isoformat() if r.expires_at else None,
                "trial_ends_at": r.trial_ends_at.isoformat() if r.trial_ends_at else None,
                "grace_until": r.grace_until.isoformat() if r.grace_until else None,
            }
            for r in rows
        ]
    }

