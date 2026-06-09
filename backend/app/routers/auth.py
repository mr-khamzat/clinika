"""
Аутентификация: Telegram Mini App, логин/пароль, инвайт.
Refresh tokens: /auth/refresh, /auth/logout.
"""
import logging
import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from app.database import get_db
from app.models.user import User, UserRole
from app.models.invitation import Invitation
from app.models.refresh_token import RefreshToken
from app.schemas.auth import TelegramAuthData, PasswordLoginData, TokenResponse
from app.core.security import (
    create_access_token, create_refresh_token, hash_refresh_token,
    verify_password, hash_password, verify_telegram_init_data,
    decode_token,
    REFRESH_TOKEN_EXPIRE_DAYS,
)
from app.core.token_blacklist import revoke_access_token
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("auth")

REFRESH_TOKEN_EXPIRE = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

# Опциональный bearer — не падает если заголовка нет
_optional_bearer = HTTPBearer(auto_error=False)

# ─── Per-user brute-force lockout (P1 security fix) ───
# Per-IP rate limit уже есть (fastapi-limiter). Дополнительно блокируем
# конкретный аккаунт после 5 подряд неудачных попыток — чтобы атакующий
# не мог распределить попытки по разным IP в supply-chain ботнете.
LOCKOUT_MAX_ATTEMPTS = 5
LOCKOUT_TTL_SECONDS = 15 * 60  # 15 минут
_lockout_redis: "object | None" = None


def _get_lockout_redis():
    """Ленивая инициализация Redis-клиента для lockout-счётчика."""
    global _lockout_redis
    if _lockout_redis is None:
        try:
            import redis.asyncio as aioredis
            _lockout_redis = aioredis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
        except Exception as e:
            logger.warning(f"Lockout Redis недоступен: {e}")
            _lockout_redis = False  # отключаем lockout если Redis не работает
    return _lockout_redis or None


def _lockout_key(username: str) -> str:
    return f"login_lockout:{(username or '').strip().lower()}"


async def _check_lockout(username: str) -> None:
    """Бросает 423 если аккаунт временно заблокирован за подбор пароля."""
    r = _get_lockout_redis()
    if not r:
        return
    try:
        val = await r.get(_lockout_key(username))
        if val and int(val) >= LOCKOUT_MAX_ATTEMPTS:
            ttl = await r.ttl(_lockout_key(username))
            raise HTTPException(
                status_code=423,
                detail=(
                    f"Аккаунт временно заблокирован после {LOCKOUT_MAX_ATTEMPTS} "
                    f"неудачных попыток. Повторите через {max(ttl, 0)} сек."
                ),
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"lockout check failed: {e}")


async def _register_failed_login(username: str) -> None:
    """INCR счётчика неудач + установка TTL при первой неудаче."""
    r = _get_lockout_redis()
    if not r:
        return
    try:
        key = _lockout_key(username)
        n = await r.incr(key)
        if n == 1:
            await r.expire(key, LOCKOUT_TTL_SECONDS)
    except Exception as e:
        logger.warning(f"lockout incr failed: {e}")


async def _clear_lockout(username: str) -> None:
    """Сбрасываем счётчик после успешного логина."""
    r = _get_lockout_redis()
    if not r:
        return
    try:
        await r.delete(_lockout_key(username))
    except Exception as e:
        logger.warning(f"lockout clear failed: {e}")


def _login_limiter():
    try:
        from fastapi_limiter.depends import RateLimiter
        return [Depends(RateLimiter(times=20, seconds=60))]
    except Exception as e:
        logger.warning(f"Rate limiter недоступен: {e}")
        return []


def _get_ip(request: Request) -> str | None:
    return (
        request.headers.get("x-real-ip")
        or (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or None)
        or (request.client.host if request.client else None)
    )


async def _issue_tokens(user: User, request: Request, db: AsyncSession) -> dict:
    """Выпускает access + refresh токены, сохраняет refresh в БД."""
    from app.models.tenant import Tenant as TenantModel
    access = create_access_token({
        "sub": str(user.id),
        "role": user.role.value,
        "tid": str(user.tenant_id) if user.tenant_id else None,
    })
    raw_refresh, token_hash = create_refresh_token(str(user.id))

    ua = request.headers.get("user-agent", "")[:200]
    rt = RefreshToken(
        user_id=user.id,
        token_hash=token_hash,
        device_info=ua or None,
        ip=_get_ip(request),
        expires_at=datetime.utcnow() + REFRESH_TOKEN_EXPIRE,
    )
    db.add(rt)
    await db.commit()

    # Получаем slug тенанта для редиректа на правильную панель
    tenant_slug = None
    if user.tenant_id:
        t_r = await db.execute(select(TenantModel).where(TenantModel.id == user.tenant_id))
        t_obj = t_r.scalar_one_or_none()
        tenant_slug = t_obj.slug if t_obj else None

    # Определяем куда редиректить после логина
    role = user.role.value
    superadmin_uname = settings.superadmin_username if hasattr(settings, "superadmin_username") else "khamzat"
    is_super = (role == "super_admin" or user.username == superadmin_uname)
    # Все «admin-кабинетные» роли идут на /{slug}/admin — там AdminRoot
    # выбирает компонент кабинета по роли (FranchiseOwner / Doctor /
    # OperationalCabinet для reg+nurse / Recruiter / PartnerDoctor / VisitingDoctor).
    ADMIN_CABINET_ROLES = {
        "franchise_owner",
        "doctor",
        "reg",
        "nurse",
        "recruiter",
        "visiting_doctor",
        "partner_doctor",
    }
    if is_super:
        redirect_url = "/admin"
    elif role == "manager" and tenant_slug:
        redirect_url = f"/{tenant_slug}/manager"
    elif role in ("director", "deputy_director") and tenant_slug:
        redirect_url = f"/{tenant_slug}/director"
    elif role in ADMIN_CABINET_ROLES and tenant_slug:
        redirect_url = f"/{tenant_slug}/admin"
    elif tenant_slug:
        redirect_url = f"/{tenant_slug}/"
    else:
        redirect_url = "/arc/"

    return {
        "access_token": access,
        "refresh_token": raw_refresh,
        "token_type": "bearer",
        "expires_in": 30 * 60,
        "user_id": str(user.id),
        "role": role,
        "clinic_id": str(user.clinic_id) if user.clinic_id else None,
        "full_name": user.full_name,
        "tenant_slug": tenant_slug,
        "redirect_url": redirect_url,
    }


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

    @field_validator("password")
    @classmethod
    def _check_password(cls, v: str) -> str:
        from app.utils.password_strength import validate_password_strength
        return validate_password_strength(v)


class RefreshRequest(BaseModel):
    refresh_token: str


# ─── Telegram Mini App ───

@router.post("/telegram")
async def telegram_auth(data: TelegramAuthData, request: Request, db: AsyncSession = Depends(get_db)):
    if not verify_telegram_init_data(data.init_data or ""):
        raise HTTPException(status_code=401, detail="Недействительная подпись Telegram")

    tg_id = str(data.id)
    result = await db.execute(select(User).where(User.telegram_id == tg_id))
    user = result.scalar_one_or_none()

    full_name = data.first_name
    if data.last_name:
        full_name += f" {data.last_name}"

    auto_role = UserRole.MANAGER if tg_id in settings.get_manager_ids() else UserRole.REG

    if not user:
        user = User(
            telegram_id=tg_id,
            full_name=full_name,
            phone_number=data.phone_number,
            role=auto_role,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        user.full_name = full_name
        if auto_role == UserRole.MANAGER and user.role != UserRole.MANAGER:
            user.role = UserRole.MANAGER
        await db.commit()

    return await _issue_tokens(user, request, db)


# ─── Вход по логину/паролю ───

@router.post("/login", dependencies=_login_limiter())
async def password_login(data: PasswordLoginData, request: Request, db: AsyncSession = Depends(get_db)):
    # ── Per-user lockout (P1 security): сначала проверяем не заблокирован
    # ли уже этот логин по счётчику неудач. Per-IP лимит проверяется выше
    # через _login_limiter() в dependencies.
    await _check_lockout(data.username)

    result = await db.execute(select(User).where(User.username == data.username))
    user = result.scalar_one_or_none()

    if not user or not user.password_hash or not verify_password(data.password, user.password_hash):
        # ── Журнал безопасности: фиксируем неудачную попытку ────────────
        # Никаких подсказок «такого пользователя нет» — пишем единый action
        # auth.login_failed. Сам username сохраняем в actor_name для top-5
        # атакованных. IP/UA подтянет audit_service из request.
        try:
            from app.services import security_service
            await security_service.log_login_failed(
                db,
                username=data.username,
                reason=("user_not_found" if not user else "invalid_password"),
                request=request,
            )
            await db.commit()
        except Exception as e:
            logger.warning(f"login_failed audit failed: {e}")
        # ── Инкрементируем счётчик lockout (используется реальный username
        # из запроса, не из БД — чтобы даже несуществующие логины не давали
        # атакующему бесконечный энумеретор).
        await _register_failed_login(data.username)
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    if not user.is_active:
        # Тоже security-событие — попытка входа в заблокированный аккаунт.
        try:
            from app.services import security_service
            await security_service.log_login_failed(
                db,
                username=data.username,
                reason="account_disabled",
                request=request,
            )
            await db.commit()
        except Exception:
            pass
        await _register_failed_login(data.username)
        raise HTTPException(status_code=403, detail="Аккаунт заблокирован")

    # ── Успешный вход: сбрасываем счётчик lockout.
    await _clear_lockout(data.username)
    return await _issue_tokens(user, request, db)


# ─── Обновление access token через refresh ───

@router.post("/refresh")
async def refresh_access_token(body: RefreshRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Обменивает refresh token на новый access + НОВЫЙ refresh (rotation).

    Reuse detection: если приходит уже использованный (revoked) refresh — это сигнал
    компрометации, ревокаем ВСЕ активные refresh пользователя и кидаем 401.
    """
    import logging as _lg
    token_hash = hash_refresh_token(body.refresh_token)

    # SELECT без revoked-фильтра — нужно различать «нет вообще» и «есть, но revoked»
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    rt = result.scalar_one_or_none()

    if not rt:
        raise HTTPException(status_code=401, detail="Недействительный refresh token")
    if rt.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Refresh token истёк")

    # REUSE DETECTION
    if rt.revoked:
        # Grace window (2 сек) — игнорируем сетевые ретраи сразу после ротации
        grace_ok = (
            rt.revoked_at and (datetime.utcnow() - rt.revoked_at).total_seconds() < 2
        )
        if not grace_ok:
            # Компрометация: revoke всю цепочку для этого user_id
            await db.execute(
                update(RefreshToken)
                .where(RefreshToken.user_id == rt.user_id, RefreshToken.revoked == False)  # noqa: E712
                .values(revoked=True, revoked_at=datetime.utcnow())
            )
            rt.reused_at = datetime.utcnow()
            await db.commit()
            _lg.getLogger("auth").warning(
                f"refresh_token_reuse user_id={rt.user_id} ip={request.client.host if request.client else '?'}"
            )
            raise HTTPException(status_code=401, detail="Refresh token compromised")
        raise HTTPException(status_code=401, detail="Refresh token already used")

    user_result = await db.execute(select(User).where(User.id == rt.user_id))
    user = user_result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Пользователь не найден или заблокирован")

    # Ротация: создаём новый refresh, старый помечаем revoked + replaced_by
    new_raw, new_hash = create_refresh_token(str(user.id))
    new_rt = RefreshToken(
        user_id=user.id,
        token_hash=new_hash,
        device_info=rt.device_info,
        ip=(request.client.host if request.client else None),
        expires_at=datetime.utcnow() + REFRESH_TOKEN_EXPIRE,
    )
    db.add(new_rt)
    await db.flush()

    rt.revoked = True
    rt.revoked_at = datetime.utcnow()
    rt.replaced_by_id = new_rt.id

    access = create_access_token({
        "sub": str(user.id),
        "role": user.role.value,
        "tid": str(user.tenant_id) if user.tenant_id else None,
    })
    await db.commit()
    return {
        "access_token": access,
        "refresh_token": new_raw,
        "token_type": "bearer",
        "expires_in": 30 * 60,
    }


# ─── Выход (revoke refresh token + blacklist access token) ───

@router.post("/logout")
async def logout(
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
):
    """Отзывает refresh token и добавляет access token в blacklist."""
    # Добавить текущий access token в blacklist (если передан в заголовке)
    if credentials and credentials.credentials:
        payload = decode_token(credentials.credentials)
        if payload:
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti and exp:
                await revoke_access_token(jti, int(exp))

    # Отозвать refresh token в БД (прежняя логика)
    token_hash = hash_refresh_token(body.refresh_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    rt = result.scalar_one_or_none()
    if rt:
        rt.revoked = True
        await db.commit()
    return {"ok": True}


# ─── Выход со всех устройств ───

@router.post("/logout-all")
async def logout_all(
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
):
    """Отзывает все refresh токены пользователя и blacklist текущий access token."""
    # Добавить текущий access token в blacklist (если передан в заголовке)
    if credentials and credentials.credentials:
        payload = decode_token(credentials.credentials)
        if payload:
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti and exp:
                await revoke_access_token(jti, int(exp))

    token_hash = hash_refresh_token(body.refresh_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    rt = result.scalar_one_or_none()
    if not rt:
        raise HTTPException(status_code=401, detail="Недействительный refresh token")

    await db.execute(
        delete(RefreshToken).where(
            RefreshToken.user_id == rt.user_id,
            RefreshToken.revoked == False,  # noqa: E712
        )
    )
    await db.commit()
    return {"ok": True, "message": "Выход со всех устройств выполнен"}


# ─── Активные сессии ───

@router.post("/sessions")
async def get_sessions(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Список активных refresh-сессий пользователя."""
    token_hash = hash_refresh_token(body.refresh_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    rt = result.scalar_one_or_none()
    if not rt:
        raise HTTPException(status_code=401, detail="Недействительный refresh token")

    sessions_result = await db.execute(
        select(RefreshToken)
        .where(RefreshToken.user_id == rt.user_id, RefreshToken.revoked == False)  # noqa: E712
        .order_by(RefreshToken.created_at.desc())
    )
    sessions = sessions_result.scalars().all()
    return {
        "sessions": [
            {
                "id": str(s.id),
                "device_info": s.device_info,
                "ip": s.ip,
                "created_at": s.created_at.isoformat(),
                "expires_at": s.expires_at.isoformat(),
                "current": s.token_hash == token_hash,
            }
            for s in sessions
        ]
    }


# ─── Инвайт ───

@router.get("/invite/{code}", response_model=InviteInfoResponse)
async def get_invite_info(code: str, db: AsyncSession = Depends(get_db)):
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


@router.post("/register-invite")
async def register_by_invite(data: InviteRegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
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

    # ─── Email-уведомление о регистрации (Этап 10 ROADMAP) ──────────────────
    # Отправляем приветственное письмо если у пользователя задан email
    # (telegram-онбординг может позже привязать email — сюда не попадаем).
    try:
        if user.email:
            from app.services.email_service import schedule_email
            schedule_email(
                user.email,
                "Добро пожаловать в КлиникСеть",
                body_html=(
                    f"<p>Здравствуйте, {user.full_name}!</p>"
                    f"<p>Ваш аккаунт в КлиникСеть успешно создан.</p>"
                    f"<ul>"
                    f"<li>Логин: <b>{user.username}</b></li>"
                    f"<li>Роль: {user.role.value if hasattr(user.role,'value') else user.role}</li>"
                    f"</ul>"
                    f"<p>Если вы не регистрировались — сообщите администратору клиники.</p>"
                ),
            )
    except Exception:
        logger.exception("[REGISTER] email уведомление не отправлено")

    return await _issue_tokens(user, request, db)
