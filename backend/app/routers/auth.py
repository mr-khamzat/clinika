"""
========================================
БЛОК: Аутентификация и регистрация
========================================
Методы входа:
  - Telegram Mini App (authTelegram)
  - Логин/пароль (для системной панели и партнёров)
  - Регистрация по инвайт-коду (для партнёров)
========================================
"""
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.user import User, UserRole
from app.models.invitation import Invitation
from app.schemas.auth import TelegramAuthData, PasswordLoginData, TokenResponse
from app.core.security import create_access_token, verify_password, hash_password, verify_telegram_init_data
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("auth")


def _login_limiter():
    """10 попыток входа / 5 минут с одного IP."""
    try:
        from fastapi_limiter.depends import RateLimiter
        return [Depends(RateLimiter(times=10, seconds=300))]
    except Exception as e:
        logger.warning(f"Rate limiter недоступен — брутфорс не защищён: {e}")
        return []


# ─── Схемы инвайта ───

class InviteInfoResponse(BaseModel):
    valid: bool
    clinic_id: str
    clinic_name: str
    role: str


class InviteRegisterRequest(BaseModel):
    code: str
    full_name: str
    phone_number: str
    password: str


# ─── Вход через Telegram Mini App ───

@router.post("/telegram", response_model=TokenResponse)
async def telegram_auth(data: TelegramAuthData, db: AsyncSession = Depends(get_db)):
    """
    Вход через Telegram Mini App.
    Верифицирует подпись initData если бот-токен настроен.
    Создаёт пользователя при первом входе.
    """
    # Верификация подписи Telegram
    if not verify_telegram_init_data(data.init_data or ""):
        raise HTTPException(status_code=401, detail="Недействительная подпись Telegram")

    tg_id = str(data.id)
    result = await db.execute(select(User).where(User.telegram_id == tg_id))
    user = result.scalar_one_or_none()

    full_name = data.first_name
    if data.last_name:
        full_name += f" {data.last_name}"

    auto_role = UserRole.MANAGER if tg_id in settings.get_manager_ids() else UserRole.ADMIN

    if not user:
        user = User(
            telegram_id=tg_id,
            full_name=full_name,
            phone_number=data.phone_number,
            role=auto_role
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        user.full_name = full_name
        if auto_role == UserRole.MANAGER and user.role != UserRole.MANAGER:
            user.role = UserRole.MANAGER
        await db.commit()

    token = create_access_token({"sub": str(user.id), "role": user.role.value, "tid": str(user.tenant_id) if user.tenant_id else None})
    return TokenResponse(
        access_token=token,
        user_id=str(user.id),
        role=user.role.value,
        clinic_id=str(user.clinic_id) if user.clinic_id else None,
        full_name=user.full_name
    )


# ─── Вход по логину/паролю (системная панель и партнёры) ───

@router.post("/login", response_model=TokenResponse, dependencies=_login_limiter())
async def password_login(data: PasswordLoginData, db: AsyncSession = Depends(get_db)):
    """Вход по логину и паролю — для системной панели и партнёров."""
    result = await db.execute(select(User).where(User.username == data.username))
    user = result.scalar_one_or_none()

    if not user or not user.password_hash or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Аккаунт заблокирован")

    token = create_access_token({"sub": str(user.id), "role": user.role.value, "tid": str(user.tenant_id) if user.tenant_id else None})
    return TokenResponse(
        access_token=token,
        user_id=str(user.id),
        role=user.role.value,
        clinic_id=str(user.clinic_id) if user.clinic_id else None,
        full_name=user.full_name
    )


# ─── БЛОК: Регистрация по инвайт-коду (для партнёров) ───

@router.get("/invite/{code}", response_model=InviteInfoResponse)
async def get_invite_info(code: str, db: AsyncSession = Depends(get_db)):
    """Публичный эндпоинт. Возвращает информацию об инвайте для страницы регистрации."""
    from app.models.clinic import Clinic
    result = await db.execute(select(Invitation).where(Invitation.code == code))
    invite = result.scalar_one_or_none()

    if not invite:
        return InviteInfoResponse(valid=False, clinic_id="", clinic_name="", role="")

    if invite.expires_at and invite.expires_at < datetime.utcnow():
        return InviteInfoResponse(valid=False, clinic_id="", clinic_name="Инвайт устарел", role="")

    if invite.uses_count >= invite.max_uses:
        return InviteInfoResponse(valid=False, clinic_id="", clinic_name="Инвайт исчерпан", role="")

    clinic = (await db.execute(select(Clinic).where(Clinic.id == invite.clinic_id))).scalar_one_or_none()

    return InviteInfoResponse(
        valid=True,
        clinic_id=str(invite.clinic_id),
        clinic_name=clinic.name if clinic else "—",
        role=invite.role,
    )


@router.post("/register-invite", response_model=TokenResponse)
async def register_by_invite(data: InviteRegisterRequest, db: AsyncSession = Depends(get_db)):
    """Регистрация нового партнёра по инвайт-коду. Телефон становится логином для входа."""
    result = await db.execute(select(Invitation).where(Invitation.code == data.code))
    invite = result.scalar_one_or_none()

    if not invite:
        raise HTTPException(status_code=404, detail="Инвайт не найден")
    if invite.expires_at and invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Инвайт устарел")
    if invite.uses_count >= invite.max_uses:
        raise HTTPException(status_code=400, detail="Инвайт исчерпан")

    normalized_phone = "".join(c for c in data.phone_number if c.isdigit() or c == "+")

    existing = await db.execute(select(User).where(User.username == normalized_phone))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Пользователь с таким телефоном уже существует")

    user = User(
        full_name=data.full_name.strip(),
        phone_number=data.phone_number,
        username=normalized_phone,
        password_hash=hash_password(data.password),
        role=UserRole(invite.role),
        clinic_id=invite.clinic_id,
        is_active=True,
    )
    db.add(user)
    invite.uses_count += 1
    await db.commit()
    await db.refresh(user)

    token = create_access_token({"sub": str(user.id), "role": user.role.value, "tid": str(user.tenant_id) if user.tenant_id else None})
    return TokenResponse(
        access_token=token,
        user_id=str(user.id),
        role=user.role.value,
        clinic_id=str(user.clinic_id) if user.clinic_id else None,
        full_name=user.full_name
    )
