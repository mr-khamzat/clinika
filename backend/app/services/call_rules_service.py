"""Сервис правил звонков. Держит дефолты в коде + читает overrides из call_rules."""
import uuid
from typing import Optional
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_rule import CallRule, CallScope
from app.models.user import User, UserRole


# Роли которые НЕ участвуют в звонках по умолчанию (ни инициировать, ни принимать).
EXCLUDED_ROLES = {
    UserRole.SUPER_ADMIN,
    UserRole.VISITING_DOCTOR,
    UserRole.EXTERNAL_DOCTOR,
    UserRole.PARTNER,           # партнёр (Telegram Mini App) — не для звонков
    UserRole.ACQUISITION_MANAGER,  # CRM роль, не звонит
}

# Роли которые участвуют в звонках (для дефолтной матрицы и UI).
ACTIVE_ROLES = [
    UserRole.FRANCHISE_OWNER,
    UserRole.MANAGER,
    UserRole.SUPERVISOR,
    UserRole.ADMIN,
    UserRole.NURSE,
    UserRole.DOCTOR,
    UserRole.RECRUITER,
    UserRole.ACCOUNTANT,
]


def default_rule(from_role: str, to_role: str, scope: str) -> dict:
    """Дефолтные права при отсутствии явного правила в БД.

    Базовая политика: все активные роли могут друг другу аудио и видео.
    Исключение — роли из EXCLUDED_ROLES (нет звонков ни в какую сторону).
    """
    if from_role in {r.value for r in EXCLUDED_ROLES} or to_role in {r.value for r in EXCLUDED_ROLES}:
        return {"allow_audio": False, "allow_video": False}
    return {"allow_audio": True, "allow_video": True}


def _resolve_scope(from_clinic_id: Optional[uuid.UUID], to_clinic_id: Optional[uuid.UUID]) -> str:
    """Определяет scope для пары пользователей по их клиникам."""
    if from_clinic_id and to_clinic_id and from_clinic_id == to_clinic_id:
        return CallScope.SAME_CLINIC
    if from_clinic_id and to_clinic_id and from_clinic_id != to_clinic_id:
        return CallScope.CROSS_CLINIC
    return CallScope.ANY


async def check_can_call(
    from_user: User,
    to_user: User,
    db: AsyncSession,
) -> dict:
    """Возвращает {allow_audio, allow_video} для пары пользователей.

    Порядок поиска правила:
    1. Точное совпадение (tenant, from_role, to_role, resolved_scope)
    2. Тот же набор с scope=any
    3. Дефолт из default_rule()
    """
    if from_user.id == to_user.id:
        return {"allow_audio": False, "allow_video": False}
    if from_user.tenant_id != to_user.tenant_id or not from_user.tenant_id:
        return {"allow_audio": False, "allow_video": False}

    resolved_scope = _resolve_scope(from_user.clinic_id, to_user.clinic_id)

    # 1. exact scope rule
    row = (await db.execute(
        select(CallRule).where(
            CallRule.tenant_id == from_user.tenant_id,
            CallRule.from_role == from_user.role,
            CallRule.to_role == to_user.role,
            CallRule.scope == resolved_scope,
        )
    )).scalar_one_or_none()
    if row:
        return {"allow_audio": row.allow_audio, "allow_video": row.allow_video}

    # 2. fallback на ANY
    if resolved_scope != CallScope.ANY:
        row = (await db.execute(
            select(CallRule).where(
                CallRule.tenant_id == from_user.tenant_id,
                CallRule.from_role == from_user.role,
                CallRule.to_role == to_user.role,
                CallRule.scope == CallScope.ANY,
            )
        )).scalar_one_or_none()
        if row:
            return {"allow_audio": row.allow_audio, "allow_video": row.allow_video}

    # 3. дефолт
    return default_rule(from_user.role, to_user.role, resolved_scope)


async def get_rules_matrix(tenant_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """Возвращает все правила тенанта в виде плоского списка для UI."""
    rows = (await db.execute(
        select(CallRule).where(CallRule.tenant_id == tenant_id)
    )).scalars().all()
    return [
        {
            "id": str(r.id),
            "from_role": r.from_role,
            "to_role": r.to_role,
            "scope": r.scope,
            "allow_audio": r.allow_audio,
            "allow_video": r.allow_video,
        }
        for r in rows
    ]


async def upsert_rule(
    tenant_id: uuid.UUID,
    from_role: str,
    to_role: str,
    scope: str,
    allow_audio: bool,
    allow_video: bool,
    db: AsyncSession,
) -> CallRule:
    """Создаёт или обновляет правило."""
    row = (await db.execute(
        select(CallRule).where(
            CallRule.tenant_id == tenant_id,
            CallRule.from_role == from_role,
            CallRule.to_role == to_role,
            CallRule.scope == scope,
        )
    )).scalar_one_or_none()
    if row:
        row.allow_audio = allow_audio
        row.allow_video = allow_video
    else:
        row = CallRule(
            tenant_id=tenant_id,
            from_role=from_role,
            to_role=to_role,
            scope=scope,
            allow_audio=allow_audio,
            allow_video=allow_video,
        )
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def reset_rules(tenant_id: uuid.UUID, db: AsyncSession) -> int:
    """Удаляет все overrides — возврат к дефолтам. Возвращает кол-во удалённых."""
    res = await db.execute(delete(CallRule).where(CallRule.tenant_id == tenant_id))
    await db.commit()
    return res.rowcount or 0
