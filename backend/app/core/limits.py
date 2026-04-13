"""
Проверка лимитов тарифного плана тенанта.
Вызывается при создании ресурсов (клиники, пользователи).

Принцип безопасности:
  - Нет лицензии → разрешаем (legacy тенант без лицензии)
  - max = -1 → безлимитно
  - tenant_id = None → суперадмин, без ограничений
"""
from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant import TenantLicense
from app.models.clinic import Clinic
from app.models.user import User


# Лимиты по умолчанию для каждого плана (резервные, если в БД не задан лимит)
PLAN_DEFAULTS: dict[str, dict[str, int]] = {
    "basic":        {"clinics": 3,  "users": 20},
    "professional": {"clinics": 10, "users": 100},
    "enterprise":   {"clinics": -1, "users": -1},   # -1 = безлимит
}


async def check_plan_limit(
    resource: str,
    tenant_id,
    db: AsyncSession,
) -> None:
    """
    Проверяет не превышен ли лимит тарифа для тенанта.

    resource: "clinics" | "users"
    Бросает HTTPException 402 если лимит достигнут.
    """
    # Суперадмин / нет тенанта → без ограничений
    if tenant_id is None:
        return

    # Получаем активную лицензию тенанта
    lic_result = await db.execute(
        select(TenantLicense).where(
            TenantLicense.tenant_id == tenant_id,
            TenantLicense.is_active == True,
        )
    )
    lic = lic_result.scalar_one_or_none()

    # Нет лицензии → не блокируем (legacy тенанты без лицензии)
    if lic is None:
        return

    # Определяем лимит
    if resource == "clinics":
        limit = lic.max_clinics
        if limit < 0:
            return  # безлимит
        count_result = await db.execute(
            select(func.count()).select_from(Clinic).where(
                Clinic.tenant_id == tenant_id,
                Clinic.is_active == True,
            )
        )
        current = count_result.scalar() or 0
        if current >= limit:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "plan_limit_exceeded",
                    "resource": "clinics",
                    "limit": limit,
                    "current": current,
                    "plan": lic.plan,
                    "message": (
                        f"Достигнут лимит клиник для тарифа {lic.plan.upper()} "
                        f"({current}/{limit}). Для расширения перейдите на следующий тариф."
                    ),
                }
            )

    elif resource == "users":
        limit = lic.max_users
        if limit < 0:
            return  # безлимит
        count_result = await db.execute(
            select(func.count()).select_from(User).where(
                User.tenant_id == tenant_id,
                User.is_active == True,
            )
        )
        current = count_result.scalar() or 0
        if current >= limit:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "plan_limit_exceeded",
                    "resource": "users",
                    "limit": limit,
                    "current": current,
                    "plan": lic.plan,
                    "message": (
                        f"Достигнут лимит сотрудников для тарифа {lic.plan.upper()} "
                        f"({current}/{limit}). Для расширения перейдите на следующий тариф."
                    ),
                }
            )
