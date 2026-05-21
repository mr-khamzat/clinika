"""
Self-service сброс пароля по email.

Two endpoints:
  POST /auth/forgot-password — публичный, rate-limit 3/min на IP.
    Никогда не сообщает существует ли email (защита от user-enumeration).
  POST /auth/reset-password — публичный, rate-limit 5/min на IP.
    Меняет пароль по одноразовому raw-token (TTL 1 час).

SMTP может быть не настроен — тогда email_service.send_password_reset
залогирует raw-токен в stdout с маркером [FORGOT-PWD-DEV] (для dev-теста).
"""
import hashlib
import logging
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import hash_password
from app.database import get_db
from app.models.password_reset import PasswordResetToken
from app.models.refresh_token import RefreshToken
from app.models.tenant import Tenant
from app.models.user import User
from app.services import audit_service
from app.services.email_service import send_password_reset

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("auth.password_reset")


# Срок жизни raw-токена сброса
_RESET_TTL = timedelta(hours=1)


def _forgot_limiter():
    """Rate-limit 3/min для /auth/forgot-password. Если limiter не поднялся — без лимита."""
    try:
        from fastapi_limiter.depends import RateLimiter
        return [Depends(RateLimiter(times=3, seconds=60))]
    except Exception as e:
        logger.warning("Rate limiter (forgot) недоступен: %s", e)
        return []


def _reset_limiter():
    """Rate-limit 5/min для /auth/reset-password."""
    try:
        from fastapi_limiter.depends import RateLimiter
        return [Depends(RateLimiter(times=5, seconds=60))]
    except Exception as e:
        logger.warning("Rate limiter (reset) недоступен: %s", e)
        return []


def _get_ip(request: Request) -> str | None:
    return (
        request.headers.get("x-real-ip")
        or (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or None)
        or (request.client.host if request.client else None)
    )


def _hash_token(raw: str) -> str:
    """SHA-256 hex от raw-токена. Используется при хранении и при поиске."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ─── Pydantic ───

class ForgotPasswordRequest(BaseModel):
    email: EmailStr
    tenant_slug: str | None = None


class ForgotPasswordResponse(BaseModel):
    ok: bool = True
    message: str = "Если такой email есть — отправлена ссылка"


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _check(cls, v: str) -> str:
        # Локальная валидация: ≥8, хотя бы одна буква И одна цифра.
        # Не используем общий validate_password_strength (там цифра ИЛИ спецсимвол) —
        # тут требование строже, как в ТЗ.
        if not isinstance(v, str) or len(v) < 8:
            raise ValueError("Пароль слишком короткий: минимум 8 символов")
        has_letter = any(c.isalpha() for c in v)
        has_digit = any(c.isdigit() for c in v)
        if not has_letter:
            raise ValueError("Пароль должен содержать хотя бы одну букву")
        if not has_digit:
            raise ValueError("Пароль должен содержать хотя бы одну цифру")
        return v


# ─── Endpoints ───

@router.post(
    "/forgot-password",
    response_model=ForgotPasswordResponse,
    dependencies=_forgot_limiter(),
)
async def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Запросить ссылку для сброса пароля.

    Всегда возвращает 200 даже если email не найден (защита от user-enumeration).
    Если SMTP не настроен — raw-токен попадает в логи с пометкой [FORGOT-PWD-DEV].
    """
    email_norm = body.email.strip().lower()
    ip = _get_ip(request)

    # 1) Найти юзера. Если несколько (один email на разных тенантах) — выбираем
    #    подходящего по tenant_slug, иначе берём первого.
    q = select(User).where(User.email.ilike(email_norm))
    rows = (await db.execute(q)).scalars().all()

    user: User | None = None
    if rows:
        if body.tenant_slug:
            slug = body.tenant_slug.strip()
            tres = await db.execute(select(Tenant).where(Tenant.slug == slug))
            tenant = tres.scalar_one_or_none()
            if tenant:
                user = next((u for u in rows if u.tenant_id == tenant.id), None)
        if user is None:
            # Выбираем активного, если возможно — иначе первого
            user = next((u for u in rows if u.is_active), rows[0])

    # 2) Если не нашли — тихо отвечаем 200 (no enumeration). НИЧЕГО не пишем в БД.
    if not user or not user.email:
        logger.info("[FORGOT-PWD] email=%s — пользователь не найден, возвращаем 200", email_norm)
        return ForgotPasswordResponse()

    # 3) Сгенерировать raw_token и сохранить хэш
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    rec = PasswordResetToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=datetime.utcnow() + _RESET_TTL,
        requested_ip=ip,
    )
    db.add(rec)
    await db.commit()

    # 4) Определить базовый URL для письма (по slug тенанта)
    base_url = "https://клиниксеть.рф"
    tenant_slug: str | None = None
    if user.tenant_id:
        tres = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
        t = tres.scalar_one_or_none()
        if t:
            tenant_slug = t.slug

    # 5) Отправить email (или залогировать в [FORGOT-PWD-DEV] если SMTP не настроен)
    try:
        await send_password_reset(
            user.email,
            raw_token,
            base_url=base_url,
            tenant_slug=tenant_slug,
            full_name=user.full_name or "",
        )
    except Exception:
        logger.exception("[FORGOT-PWD] ошибка отправки письма для user_id=%s", user.id)

    return ForgotPasswordResponse()


@router.post(
    "/reset-password",
    dependencies=_reset_limiter(),
)
async def reset_password(
    body: ResetPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Сменить пароль по одноразовому токену из письма.

    Инвалидирует все refresh-токены пользователя (logout-all).
    """
    if not body.token:
        raise HTTPException(status_code=400, detail="Не передан токен")

    token_hash = _hash_token(body.token)

    res = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)
    )
    rec = res.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=400, detail="Недействительный или истёкший токен")
    if rec.used_at is not None:
        raise HTTPException(status_code=400, detail="Токен уже использован")
    if rec.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Срок действия токена истёк")

    # Найти пользователя
    ures = await db.execute(select(User).where(User.id == rec.user_id))
    user = ures.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Пользователь не найден")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Аккаунт заблокирован")

    # Установить новый пароль
    user.password_hash = hash_password(body.new_password)
    # pwdmust01: публичный сброс — пользователь сам выбрал новый пароль,
    # снимаем флаг принудительной смены (если стоял).
    user.password_must_change = False
    rec.used_at = datetime.utcnow()

    # Инвалидировать все refresh-токены пользователя (logout со всех устройств)
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked == False)  # noqa: E712
        .values(revoked=True)
    )

    # Audit-лог: успешный сброс пароля. write() делает только flush(),
    # коммит общий вместе с остальными изменениями этой транзакции.
    try:
        await audit_service.write(
            db,
            "password.reset.success",
            actor_id=user.id,
            actor_name=user.full_name,
            entity_type="user",
            entity_id=user.id,
            comment=f"Self-service password reset (ip={_get_ip(request)})",
            request=request,
            tenant_id=user.tenant_id,
        )
    except Exception:
        logger.exception("[RESET-PWD] не удалось записать audit-лог")

    await db.commit()
    return {"ok": True}


# ─── Cleanup-job ───

async def cleanup_expired_password_reset_tokens() -> int:
    """Удаляет истёкшие токены сброса (старше 24 ч после expires_at).

    Запускается из APScheduler (см. main.py, job id='password_reset_cleanup').
    Возвращает кол-во удалённых строк (для логов).
    """
    from app.database import AsyncSessionLocal

    cutoff = datetime.utcnow() - timedelta(hours=24)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            delete(PasswordResetToken).where(PasswordResetToken.expires_at < cutoff)
        )
        await db.commit()
        n = result.rowcount or 0
        if n:
            logger.info("[FORGOT-PWD] cleanup: удалено %s истёкших токенов", n)
        return n
