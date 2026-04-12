"""
Сервис аудит-журнала (append-only).
Все операции — только добавление, никаких update/delete.
Этап 8.
"""
import uuid
from typing import Any
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEntry


# ── Константы действий ────────────────────────────────────────────────────────
class AuditAction:
    # Пользователи / сотрудники
    USER_CREATED      = "user.created"
    USER_UPDATED      = "user.updated"
    USER_DELETED      = "user.deleted"
    USER_ASSIGN_CLINIC = "user.assign_clinic"

    # Клиники
    CLINIC_CREATED    = "clinic.created"
    CLINIC_UPDATED    = "clinic.updated"

    # Направления
    REFERRAL_CONFIRMED = "referral.confirmed"
    REFERRAL_CANCELLED = "referral.cancelled"

    # Бонусы
    BONUS_PAID        = "bonus.paid"
    BONUS_CANCELLED   = "bonus.cancelled"
    BONUS_BULK_PAID   = "bonus.bulk_paid"

    # Настройки
    SETTINGS_UPDATED  = "settings.updated"

    # Реестр
    LEDGER_ADJUSTED   = "ledger.adjusted"

    # Скидки / партнёры
    DISCOUNT_CREATED  = "discount.created"
    DISCOUNT_UPDATED  = "discount.updated"
    DISCOUNT_DELETED  = "discount.deleted"
    PARTNER_CREATED   = "partner.created"
    PARTNER_UPDATED   = "partner.updated"
    PARTNER_DELETED   = "partner.deleted"


def _ip(request: Request | None) -> str | None:
    if request is None:
        return None
    for header in ("x-real-ip", "x-forwarded-for"):
        v = request.headers.get(header)
        if v:
            return v.split(",")[0].strip()
    return getattr(request.client, "host", None) if request.client else None


def _ua(request: Request | None) -> str | None:
    return request.headers.get("user-agent") if request else None


async def write(
    db: AsyncSession,
    action: str,
    *,
    actor_id: uuid.UUID | None = None,
    actor_name: str | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    before: dict | Any | None = None,
    after: dict | Any | None = None,
    comment: str | None = None,
    request: Request | None = None,
    tenant_id: uuid.UUID | None = None,
) -> AuditEntry:
    """
    Записать событие в аудит-журнал.
    db.flush() вызывается внутри — commit делает вызывающий код.
    """
    entry = AuditEntry(
        action=action,
        actor_id=actor_id,
        actor_name=actor_name,
        entity_type=entity_type,
        entity_id=entity_id,
        before=before if isinstance(before, (dict, type(None))) else {"value": str(before)},
        after=after if isinstance(after, (dict, type(None))) else {"value": str(after)},
        comment=comment,
        ip_address=_ip(request),
        user_agent=_ua(request),
        tenant_id=tenant_id,
    )
    db.add(entry)
    await db.flush()
    return entry


async def write_safe(
    db: AsyncSession,
    action: str,
    **kwargs,
) -> None:
    """Безопасная обёртка — не падает при ошибке, не прерывает основную транзакцию."""
    try:
        await write(db, action, **kwargs)
    except Exception:
        pass
