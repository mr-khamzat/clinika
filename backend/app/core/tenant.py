"""
Зависимости для работы с тенантами.
Получает текущий тенант из пользователя (поле tenant_id).
"""
import uuid
from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.tenant import Tenant, TenantLicense, TenantBranding


async def get_current_tenant(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Tenant | None:
    """Возвращает тенант текущего пользователя или None если single-tenant."""
    if current_user.tenant_id is None:
        return None
    result = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    tenant = result.scalar_one_or_none()
    if tenant and not tenant.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Тенант деактивирован")
    return tenant


async def get_tenant_license(
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> TenantLicense | None:
    """Возвращает лицензию тенанта."""
    if tenant is None:
        return None
    result = await db.execute(select(TenantLicense).where(TenantLicense.tenant_id == tenant.id))
    return result.scalar_one_or_none()


def require_feature(feature_name: str):
    """
    FastAPI-зависимость: разрешает запрос только если у тенанта есть данная фича.
    Приоритет: tenant_modules (override) > license.features JSONB > plan defaults.
    """
    async def checker(
        tenant: Tenant | None = Depends(get_current_tenant),
        license: TenantLicense | None = Depends(get_tenant_license),
        db: AsyncSession = Depends(get_db),
        current_user: "User" = Depends(get_current_user),
    ):
        from app.modules import has_feature
        from app.models.user import UserRole
        from app.config import settings
        from sqlalchemy import select
        # SUPER_ADMIN обходит все проверки фич
        if (current_user.role == UserRole.SUPER_ADMIN or
                (current_user.username and current_user.username == settings.superadmin_username)):
            return
        # 1. Явный override через tenant_modules таблицу
        if tenant is not None:
            from app.models.tenant import TenantModule
            r = await db.execute(
                select(TenantModule).where(
                    TenantModule.tenant_id == tenant.id,
                    TenantModule.module == feature_name,
                )
            )
            mod = r.scalar_one_or_none()
            if mod is not None:
                if not mod.enabled:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"Модуль {feature_name} отключён для вашего тенанта",
                    )
                return  # явно включён через override
        # 2. Проверяем через план + license.features JSONB
        if not has_feature(license, feature_name):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Фича {feature_name} недоступна в вашем тарифном плане",
            )
    return checker


def require_module(*module_keys: str):
    async def checker(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        from app.models.user import UserRole
        from app.config import settings
        from app.models.commercial import TenantModuleSubscription, ModuleStatus

        if (current_user.role == UserRole.SUPER_ADMIN or
                (current_user.username and current_user.username == settings.superadmin_username)):
            return
        if not current_user.tenant_id:
            return

        row = (await db.execute(
            select(TenantModuleSubscription).where(
                TenantModuleSubscription.tenant_id == current_user.tenant_id,
                TenantModuleSubscription.module_key.in_(list(module_keys)),
                TenantModuleSubscription.status.in_([ModuleStatus.ACTIVE, ModuleStatus.TRIAL, ModuleStatus.GRACE]),
            )
        )).first()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Модуль не подключён. Обратитесь к администратору платформы.",
            )
    return checker

