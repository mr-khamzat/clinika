"""
RBAC — матрица прав по ролям.

Использование:
  @router.get("/something")
  async def handler(user = Depends(require_permission("referrals:read"))):
      ...

Права разбиты по ресурсам: resource:action
"""
from fastapi import Depends, HTTPException, status
from app.models.user import User, UserRole
from app.core.deps import get_current_user

# Матрица прав: роль → набор разрешённых действий
ROLE_PERMISSIONS: dict[UserRole, set[str]] = {
    UserRole.MANAGER: {
        # Полный доступ
        "referrals:read", "referrals:write", "referrals:delete",
        "bonuses:read", "bonuses:write", "bonuses:delete", "bonuses:bulk",
        "staff:read", "staff:write", "staff:delete",
        "clinics:read", "clinics:write", "clinics:delete",
        "services:read", "services:write", "services:delete",
        "reports:read",
        "settings:read", "settings:write",
        "analytics:read",
        "audit:read",
        "ledger:read", "ledger:write",
        "billing:read", "billing:write",
        "scheduling:read", "scheduling:write",
        "partners:read", "partners:write",
        "discounts:read", "discounts:write",
        "consent:admin",
    },
    UserRole.ADMIN: {
        # Сотрудник клиники
        "referrals:read", "referrals:write",
        "bonuses:read",
        "staff:read",
        "clinics:read",
        "services:read",
        "reports:read",
        "scheduling:read", "scheduling:write",
        "consent:own",
    },
    UserRole.PARTNER: {
        # Партнёр
        "referrals:read", "referrals:write",
        "bonuses:read",
        "services:read",
        "scheduling:read",
        "consent:own",
    },
}


def has_permission(user: User, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(user.role, set())


def require_permission(permission: str):
    """Зависимость FastAPI: проверяет наличие права у текущего пользователя."""
    async def _check(user: User = Depends(get_current_user)) -> User:
        if not has_permission(user, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Недостаточно прав: требуется {permission}"
            )
        return user
    return Depends(_check)


def get_user_permissions(user: User) -> list[str]:
    """Возвращает список прав пользователя (для фронта)."""
    return sorted(ROLE_PERMISSIONS.get(user.role, set()))
