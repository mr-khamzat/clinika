"""
Tenant Impersonation API — для super_admin.

Эндпоинты:
  POST /admin/impersonate         — начать сессию под видом target user
  POST /admin/impersonate/stop    — выйти из режима, восстановить super_admin
  GET  /admin/impersonate/active  — текущее состояние (если imp=true в токене)
  GET  /admin/impersonate/history — последние импersonation-сессии (для UI)

JWT-claims (RFC 8693 OAuth 2 Token Exchange):
  sub         — id target user
  act         — id оригинального super_admin (actor)
  imp         — true (флаг)
  imp_reason  — причина (str, optional, max 500)
  role        — роль target user
  tid         — tenant_id target user
  exp         — now + 30 минут (короткий)

Защита:
  • impersonate только не-super_admin
  • impersonate пациента — требует extra_confirm=true (GDPR/152-ФЗ)
  • Нет вложенных impersonation (если уже imp=true — запрет)
  • Все действия в audit_log
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import get_current_user
from app.core.security import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    decode_token,
)
from app.database import get_db
from app.models.audit import AuditEntry
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services import audit_service

router = APIRouter(prefix="/admin/impersonate", tags=["admin-impersonation"])
bearer = HTTPBearer()

# Срок жизни impersonation-токена — короткий (30 минут) для безопасности
IMPERSONATION_TOKEN_TTL_MIN = 30


# ── Audit actions ────────────────────────────────────────────────────────────
AUDIT_IMP_STARTED = "impersonation.started"
AUDIT_IMP_STOPPED = "impersonation.stopped"


# ── Схемы ────────────────────────────────────────────────────────────────────

class ImpersonateRequest(BaseModel):
    target_user_id: uuid.UUID
    reason: Optional[str] = Field(None, max_length=500, description="Причина (для аудита)")
    confirm_sensitive: Optional[bool] = Field(
        False,
        description="Подтверждение для пациентов (GDPR/152-ФЗ)",
    )


class ImpersonateResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # секунд
    target: dict
    actor: dict
    tenant_slug: Optional[str] = None
    redirect_url: Optional[str] = None


class ImpersonateStopResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    actor: dict
    redirect_url: str = "/admin"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _decode_current(credentials: HTTPAuthorizationCredentials) -> dict:
    """Декодирует raw JWT (без БД-валидации) — нужен для проверки imp/act claims."""
    payload = decode_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен")
    return payload


def _create_impersonation_token(
    target: User,
    actor: User,
    reason: Optional[str],
) -> str:
    """Создаёт JWT с claims sub=target, act=actor, imp=true (RFC 8693)."""
    payload = {
        "sub": str(target.id),
        "role": target.role.value if hasattr(target.role, "value") else str(target.role),
        "tid": str(target.tenant_id) if target.tenant_id else None,
        # RFC 8693 act claim — оригинальный actor
        "act": str(actor.id),
        "act_name": actor.full_name or actor.username,
        "imp": True,
        "imp_reason": (reason or "").strip()[:500] or None,
    }
    # Сокращаем TTL — стандартный create_access_token использует 30мин, нам тоже нужно 30
    # Если в будущем дефолт изменится — мы переопределяем тут.
    to_encode = payload.copy()
    expire = datetime.utcnow() + timedelta(minutes=IMPERSONATION_TOKEN_TTL_MIN)
    to_encode["exp"] = expire
    to_encode["iat"] = datetime.utcnow()
    to_encode["type"] = "access"
    to_encode["jti"] = str(uuid.uuid4())
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def _create_restore_token(actor: User) -> str:
    """Создаёт обычный access-токен для оригинального super_admin (на /admin/impersonate/stop)."""
    return create_access_token({
        "sub": str(actor.id),
        "role": actor.role.value if hasattr(actor.role, "value") else str(actor.role),
        "tid": str(actor.tenant_id) if actor.tenant_id else None,
    })


def _is_super_admin(user: User) -> bool:
    return (
        user.role == UserRole.SUPER_ADMIN
        or (user.username and user.username == settings.superadmin_username)
    )


async def _tenant_slug(db: AsyncSession, tenant_id: Optional[uuid.UUID]) -> Optional[str]:
    if not tenant_id:
        return None
    t = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    return t.slug if t else None


def _redirect_url_for(target: User, slug: Optional[str]) -> Optional[str]:
    """Куда перенаправить super_admin после impersonate (исходя из роли target)."""
    role = target.role.value if hasattr(target.role, "value") else str(target.role)
    if role == "patient":
        return f"/{slug}/p" if slug else "/p"
    if role == "manager" and slug:
        return f"/{slug}/manager"
    # Все «admin-кабинетные» роли заходят на /{slug}/admin — там AdminRoot выбирает кабинет по роли
    if slug:
        return f"/{slug}/admin"
    return None


# ── POST /admin/impersonate ──────────────────────────────────────────────────

@router.post("", response_model=ImpersonateResponse, status_code=200)
async def start_impersonation(
    body: ImpersonateRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Начать impersonation-сессию.

    Только super_admin. Возвращает новый JWT с imp=true / act=<super>.
    Эндпоинт идемпотентен на уровне current_user — каждый вызов создаёт
    новую сессию (с актуальным reason / TTL).
    """
    # 1. Только super_admin
    if not _is_super_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступ только для super_admin")

    # 2. Запрет вложенных impersonation: если текущий JWT уже imp=true → отказ
    payload = _decode_current(credentials)
    if payload.get("imp") is True:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Вложенный impersonation запрещён. Сначала /admin/impersonate/stop.",
        )

    # 3. Загружаем target
    target = (await db.execute(select(User).where(User.id == body.target_user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Целевой пользователь не найден")
    if not target.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Целевой пользователь отключён")
    if target.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя impersonate самого себя")

    # 4. Запрет impersonate другого super_admin
    if _is_super_admin(target):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нельзя impersonate другого super_admin",
        )

    # 5. Доп. подтверждение для пациентов (GDPR/152-ФЗ)
    target_role = target.role.value if hasattr(target.role, "value") else str(target.role)
    if target_role == "patient" and not body.confirm_sensitive:
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail=(
                "Impersonation пациента требует дополнительного подтверждения "
                "(confirm_sensitive=true) согласно ФЗ-152."
            ),
        )

    # 6. Выпускаем token
    token = _create_impersonation_token(target=target, actor=current_user, reason=body.reason)
    slug = await _tenant_slug(db, target.tenant_id)
    redirect = _redirect_url_for(target, slug)

    # 7. Audit: started (actor=super_admin, target=user)
    await audit_service.write_safe(
        db,
        AUDIT_IMP_STARTED,
        actor_id=current_user.id,
        actor_name=current_user.full_name or current_user.username,
        entity_type="user",
        entity_id=target.id,
        after={
            "target_id": str(target.id),
            "target_name": target.full_name,
            "target_username": target.username,
            "target_role": target_role,
            "target_tenant_id": str(target.tenant_id) if target.tenant_id else None,
            "tenant_slug": slug,
            "reason": (body.reason or "").strip() or None,
            "ttl_minutes": IMPERSONATION_TOKEN_TTL_MIN,
            "sensitive_confirmed": bool(body.confirm_sensitive) if target_role == "patient" else None,
        },
        comment=(
            f"Super-admin «{current_user.full_name or current_user.username}» начал impersonation "
            f"пользователя «{target.full_name}» (роль={target_role})."
        ),
        request=request,
        tenant_id=target.tenant_id,
    )
    await db.commit()

    return ImpersonateResponse(
        access_token=token,
        expires_in=IMPERSONATION_TOKEN_TTL_MIN * 60,
        target={
            "id": str(target.id),
            "full_name": target.full_name,
            "username": target.username,
            "role": target_role,
            "tenant_id": str(target.tenant_id) if target.tenant_id else None,
        },
        actor={
            "id": str(current_user.id),
            "full_name": current_user.full_name,
            "username": current_user.username,
        },
        tenant_slug=slug,
        redirect_url=redirect,
    )


# ── POST /admin/impersonate/stop ─────────────────────────────────────────────

@router.post("/stop", response_model=ImpersonateStopResponse, status_code=200)
async def stop_impersonation(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    """Выйти из impersonation-режима.

    Принимает текущий JWT с imp=true. Достаёт act (id оригинального super_admin),
    проверяет что он всё ещё super_admin и активен, выпускает обычный access-токен.
    """
    payload = _decode_current(credentials)
    if not payload.get("imp"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Текущая сессия не является impersonation",
        )

    actor_id_raw = payload.get("act")
    if not actor_id_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Поле act в токене отсутствует",
        )
    try:
        actor_id = uuid.UUID(actor_id_raw)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректный actor id")

    actor = (await db.execute(select(User).where(User.id == actor_id))).scalar_one_or_none()
    if not actor or not actor.is_active or not _is_super_admin(actor):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Оригинальный super_admin недоступен — восстановление запрещено",
        )

    # Загружаем target (для audit)
    target_id_raw = payload.get("sub")
    target = None
    if target_id_raw:
        try:
            target = (
                await db.execute(select(User).where(User.id == uuid.UUID(target_id_raw)))
            ).scalar_one_or_none()
        except ValueError:
            pass

    restore = _create_restore_token(actor)

    # Audit: stopped (actor=super_admin, target=кто был обуэн)
    await audit_service.write_safe(
        db,
        AUDIT_IMP_STOPPED,
        actor_id=actor.id,
        actor_name=actor.full_name or actor.username,
        entity_type="user",
        entity_id=target.id if target else None,
        after={
            "target_id": str(target.id) if target else target_id_raw,
            "target_name": target.full_name if target else None,
            "reason": payload.get("imp_reason"),
        },
        comment=(
            f"Super-admin «{actor.full_name or actor.username}» вышел из impersonation"
            + (f" пользователя «{target.full_name}»" if target else "")
        ),
        request=request,
        tenant_id=target.tenant_id if target else None,
    )
    await db.commit()

    return ImpersonateStopResponse(
        access_token=restore,
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        actor={
            "id": str(actor.id),
            "full_name": actor.full_name,
            "username": actor.username,
        },
        redirect_url="/admin",
    )


# ── GET /admin/impersonate/active ───────────────────────────────────────────

@router.get("/active")
async def active_impersonation(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает информацию о текущем impersonation (если активен).

    Используется фронтендом для рендера баннера: имя цели, имя actor, время
    окончания сессии, причина.
    """
    payload = _decode_current(credentials)
    if not payload.get("imp"):
        return {"active": False}

    target_id = payload.get("sub")
    actor_id = payload.get("act")
    exp = payload.get("exp")

    target = actor = None
    try:
        if target_id:
            target = (
                await db.execute(select(User).where(User.id == uuid.UUID(target_id)))
            ).scalar_one_or_none()
        if actor_id:
            actor = (
                await db.execute(select(User).where(User.id == uuid.UUID(actor_id)))
            ).scalar_one_or_none()
    except ValueError:
        pass

    return {
        "active": True,
        "target": (
            {
                "id": str(target.id),
                "full_name": target.full_name,
                "username": target.username,
                "role": target.role.value if hasattr(target.role, "value") else str(target.role),
            }
            if target
            else {"id": target_id}
        ),
        "actor": (
            {
                "id": str(actor.id),
                "full_name": actor.full_name,
                "username": actor.username,
            }
            if actor
            else {"id": actor_id, "full_name": payload.get("act_name")}
        ),
        "reason": payload.get("imp_reason"),
        "expires_at": (
            datetime.utcfromtimestamp(exp).isoformat() + "Z" if isinstance(exp, (int, float)) else None
        ),
    }


# ── GET /admin/impersonate/history ──────────────────────────────────────────

@router.get("/history")
async def impersonation_history(
    days: int = 30,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список последних impersonation-сессий (для AuditLog UI).

    Только super_admin. Объединяет started/stopped в логические сессии:
    для каждого started ищем ближайший stopped того же target после него.
    """
    if not _is_super_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступ только для super_admin")

    days = max(1, min(int(days), 365))
    limit = max(1, min(int(limit), 500))
    cutoff = datetime.utcnow() - timedelta(days=days)

    rows = (
        await db.execute(
            select(AuditEntry)
            .where(
                and_(
                    AuditEntry.action.in_([AUDIT_IMP_STARTED, AUDIT_IMP_STOPPED]),
                    AuditEntry.created_at >= cutoff,
                )
            )
            .order_by(AuditEntry.created_at.desc())
            .limit(limit * 2)  # с запасом — started+stopped парами
        )
    ).scalars().all()

    started = [r for r in rows if r.action == AUDIT_IMP_STARTED]
    stopped = [r for r in rows if r.action == AUDIT_IMP_STOPPED]

    # Маппим started → ближайший stopped с тем же entity_id (target) после created_at
    sessions = []
    for s in started:
        # ищем stopped с тем же entity_id и created_at > s.created_at
        candidates = [
            x for x in stopped
            if x.entity_id == s.entity_id and x.created_at and s.created_at and x.created_at > s.created_at
        ]
        candidates.sort(key=lambda x: x.created_at)
        end = candidates[0] if candidates else None
        duration_sec = None
        if end and s.created_at:
            duration_sec = int((end.created_at - s.created_at).total_seconds())
        after = s.after or {}
        sessions.append({
            "id": str(s.id),
            "started_at": s.created_at.isoformat() if s.created_at else None,
            "stopped_at": end.created_at.isoformat() if end else None,
            "duration_seconds": duration_sec,
            "actor_id": str(s.actor_id) if s.actor_id else None,
            "actor_name": s.actor_name,
            "target_id": after.get("target_id"),
            "target_name": after.get("target_name"),
            "target_username": after.get("target_username"),
            "target_role": after.get("target_role"),
            "tenant_id": after.get("target_tenant_id"),
            "tenant_slug": after.get("tenant_slug"),
            "reason": after.get("reason"),
            "ip_address": s.ip_address,
            "geo_country": s.geo_country,
            "geo_city": s.geo_city,
            "still_active": end is None,
        })

    sessions.sort(key=lambda x: x["started_at"] or "", reverse=True)
    return {"total": len(sessions), "days": days, "items": sessions[:limit]}
