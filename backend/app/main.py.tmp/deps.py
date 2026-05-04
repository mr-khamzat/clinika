from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from app.database import get_db
from app.core.security import decode_token
from app.models.user import User, UserRole
import uuid

bearer = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db)
) -> User:
    token = credentials.credentials
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен")

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Пользователь не найден")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Администраторы или super_admin."""
    if user.role not in (UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN, UserRole.SUPERVISOR):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для администраторов"
        )
    return user


async def require_manager(user: User = Depends(get_current_user)) -> User:
    """Системный администратор (manager) или super_admin."""
    if user.role not in (UserRole.MANAGER, UserRole.SUPER_ADMIN, UserRole.SUPERVISOR, UserRole.FRANCHISE_OWNER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для системного администратора"
        )
    return user


async def require_reports_access(user: User = Depends(get_current_user)) -> User:
    """Отчёты: доступны и Администраторам клиники, и Системному администратору."""
    if user.role not in (UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN, UserRole.SUPERVISOR):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав"
        )
    return user


async def require_partner_or_above(user: User = Depends(get_current_user)) -> User:
    """Доступ для партнёров, администраторов и системного администратора."""
    if user.role not in (UserRole.ADMIN, UserRole.MANAGER, UserRole.PARTNER, UserRole.SUPER_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав"
        )
    return user


async def require_franchise_owner(user: User = Depends(get_current_user)) -> User:
    """Доступ только для владельца франшизы (или super_admin для отладки)."""
    if user.role not in (UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для владельца франшизы"
        )
    return user


async def require_super_admin(user: User = Depends(get_current_user)) -> User:
    """Только super_admin — владелец платформы (по роли ИЛИ по username суперадмина)."""
    from app.config import settings
    is_sa = (user.role == UserRole.SUPER_ADMIN or
             (user.username and user.username == settings.superadmin_username))
    if not is_sa:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для super_admin"
        )
    return user


async def get_current_tenant(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает тенант текущего пользователя. HTTP 403 если пользователь без тенанта."""
    from app.models.tenant import Tenant
    if not user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Пользователь не привязан к тенанту"
        )
    result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Тенант не найден"
        )
    return tenant


def require_role(*roles: str):
    """Фабрика зависимостей — разрешает доступ только указанным ролям."""
    async def _check(user: User = Depends(get_current_user)) -> None:
        role_val = user.role.value if hasattr(user.role, 'value') else str(user.role)
        if role_val not in roles and role_val != 'super_admin':
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Недостаточно прав для этого раздела"
            )
    return _check


async def get_tenant_db(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AsyncSession:
    """Сессия БД с установленным app.tenant_id для RLS.

    Если у пользователя есть tenant_id — устанавливает SET LOCAL app.tenant_id,
    и RLS автоматически фильтрует строки по тенанту.
    Если tenant_id отсутствует (суперадмин) — сессия без ограничений, видны все строки.

    Использование:
        @router.get("/referrals")
        async def list_referrals(db: AsyncSession = Depends(get_tenant_db)):
            ...
    """
    if user.tenant_id:
        await db.execute(text(f"SET LOCAL app.tenant_id = '{user.tenant_id}'"))
    return db
