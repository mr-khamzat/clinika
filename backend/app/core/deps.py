from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
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
    """Только Администраторы — полный доступ (создание направлений, управление персоналом)."""
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для администраторов"
        )
    return user


async def require_manager(user: User = Depends(get_current_user)) -> User:
    """Только Системный администратор (manager) — панель управления, настройки, отчёты."""
    if user.role != UserRole.MANAGER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для системного администратора"
        )
    return user


async def require_reports_access(user: User = Depends(get_current_user)) -> User:
    """Отчёты: доступны и Администраторам клиники, и Системному администратору."""
    if user.role not in (UserRole.ADMIN, UserRole.MANAGER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав"
        )
    return user


async def require_partner_or_above(user: User = Depends(get_current_user)) -> User:
    """Доступ для партнёров, администраторов и системного администратора."""
    if user.role not in (UserRole.ADMIN, UserRole.MANAGER, UserRole.PARTNER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав"
        )
    return user
