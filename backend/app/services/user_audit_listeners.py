"""
SQLAlchemy event listeners для аудита создания/изменения пользователей.

Регистрируют два события в audit_log:
  • user.created          — при INSERT в users (после flush с реальным id)
  • user.password_changed — при UPDATE users.password_hash на существующей записи

Actor определяется так:
  1. Если в request-контексте активна impersonation сессия → реальный super_admin
  2. Иначе — None (системное действие / неавторизованный путь)

NB: Это синхронный listener (другого пути нет — SQLAlchemy ORM events sync).
Поэтому пишем напрямую в connection через ядро без async-обёртки.

Подключение: импорт этого модуля из main.py при старте, чтобы listeners
зарегистрировались на ORM model User.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime

from sqlalchemy import event, insert, inspect
from sqlalchemy.orm.attributes import get_history

from app.models.user import User
from app.models.audit import AuditEntry

log = logging.getLogger("user_audit_listeners")

_MARK_PWD_CHANGED = "_audit_pwd_changed"


def _resolve_actor() -> tuple[uuid.UUID | None, str | None]:
    """Берём actor из contextvar — есть только при impersonation."""
    try:
        from app.core.request_ctx import current_impersonator
        imp = current_impersonator.get()
        if imp:
            return imp.get("actor_id"), imp.get("actor_name") or "super_admin"
    except Exception:
        pass
    return None, None


def _role_str(role) -> str | None:
    if role is None:
        return None
    return role.value if hasattr(role, "value") else str(role)


@event.listens_for(User, "after_insert")
def _user_after_insert(mapper, connection, target: User):
    """audit user.created на каждый INSERT в users."""
    try:
        actor_id, actor_name = _resolve_actor()
        payload = {
            "username": target.username,
            "full_name": target.full_name,
            "role": _role_str(target.role),
            "tenant_id": str(target.tenant_id) if target.tenant_id else None,
            "clinic_id": str(target.clinic_id) if target.clinic_id else None,
            "phone_number": target.phone_number,
            "email": target.email,
            "password_set": bool(target.password_hash),
            "is_active": bool(target.is_active),
        }
        connection.execute(
            insert(AuditEntry.__table__).values(
                id=uuid.uuid4(),
                action="user.created",
                actor_id=actor_id,
                actor_name=actor_name,
                entity_type="user",
                entity_id=target.id,
                after=payload,
                tenant_id=target.tenant_id,
                created_at=datetime.utcnow(),
            )
        )
    except Exception as e:
        # Никогда не блокируем INSERT пользователя из-за аудита
        log.warning("user.created audit failed: %s", e)


@event.listens_for(User, "before_update")
def _user_before_update(mapper, connection, target: User):
    """Метим target если password_hash действительно изменился."""
    try:
        state = inspect(target)
        if "password_hash" not in state.attrs:
            return
        hist = get_history(target, "password_hash")
        # has_changes() True если значение изменено относительно загруженного
        if not hist.has_changes():
            return
        # added — новое значение, deleted — старое
        new_val = (hist.added or [None])[0]
        old_val = (hist.deleted or [None])[0]
        if new_val == old_val:
            return
        # Первичная установка пароля на ранее password-less юзера — тоже считаем
        # за смену (важно для compliance: «у юзера появился пароль»).
        setattr(target, _MARK_PWD_CHANGED, True)
    except Exception as e:
        log.warning("password_hash diff inspect failed: %s", e)


@event.listens_for(User, "after_update")
def _user_after_update(mapper, connection, target: User):
    """audit user.password_changed если был before_update mark."""
    if not getattr(target, _MARK_PWD_CHANGED, False):
        return
    try:
        actor_id, actor_name = _resolve_actor()
        connection.execute(
            insert(AuditEntry.__table__).values(
                id=uuid.uuid4(),
                action="user.password_changed",
                actor_id=actor_id,
                actor_name=actor_name,
                entity_type="user",
                entity_id=target.id,
                after={
                    "username": target.username,
                    "full_name": target.full_name,
                    "role": _role_str(target.role),
                    "password_now_set": bool(target.password_hash),
                },
                tenant_id=target.tenant_id,
                created_at=datetime.utcnow(),
            )
        )
    except Exception as e:
        log.warning("user.password_changed audit failed: %s", e)
    finally:
        try:
            delattr(target, _MARK_PWD_CHANGED)
        except Exception:
            pass


log.info("User audit listeners registered (user.created, user.password_changed)")
