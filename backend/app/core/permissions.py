"""
RBAC — матрица прав по ролям + tenant-level overrides (Этап 8 ROADMAP).

Использование:
  @router.get("/something")
  async def handler(user = Depends(require_permission("referrals:read"))):
      ...

Архитектура:
  • ROLE_PERMISSIONS — базовая матрица в коде. Источник правды по умолчанию.
  • tenant_permission_overrides — таблица переопределений.
    permissions[action] = True  → разрешить независимо от кода
    permissions[action] = False → запретить независимо от кода
    отсутствие ключа            → fallback на ROLE_PERMISSIONS из кода
  • Redis-кэш rbac:{tenant_id}:{role} (TTL 5 мин). Инвалидация при PUT/DELETE
    override через invalidate_rbac_cache().

Все существующие require_permission/require_role работают как раньше — теперь
через has_permission, который сначала проверяет override, потом код.
"""
import json
import logging
from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.user import User, UserRole
from app.core.deps import get_current_user
from app.database import get_db

log = logging.getLogger(__name__)

# ── Базовая матрица: роль → набор разрешённых действий ──
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
    UserRole.REG: {
        # Регистратор клиники
        "referrals:read", "referrals:write",
        "bonuses:read",
        "staff:read",
        "clinics:read",
        "services:read",
        "reports:read",
        "scheduling:read", "scheduling:write",
        "consent:own",
    },
    UserRole.PARTNER_DOCTOR: {
        # Врач-партнёр (бывший external_doctor)
        "referrals:read", "referrals:write",
        "bonuses:read",
        "services:read",
        "scheduling:read",
        "consent:own",
    },
    UserRole.DOCTOR: {
        # Врач — читает своё расписание и записи, обновляет статусы приёмов
        "scheduling:read", "scheduling:write",
        "referrals:read",
        "services:read",
        "consent:own",
    },
    UserRole.NURSE: {
        # Медсестра — помогает врачу с расписанием/витальными
        "scheduling:read",
        "referrals:read",
        "services:read",
        "consent:own",
    },
    UserRole.RECRUITER: {
        # Рекрутер — приглашает партнёрских врачей
        "partners:read", "partners:write",
        "bonuses:read",
        "staff:read",
    },
    UserRole.VISITING_DOCTOR: {
        # Приходящий врач — расписание + записи, ничего больше
        "scheduling:read", "scheduling:write",
        "referrals:read",
        "services:read",
        "consent:own",
    },
}

# Роли, которые франшизер может настраивать через UI «Роли и права».
# super_admin / franchise_owner / patient — не редактируем (системные).
EDITABLE_ROLES: list[str] = [
    UserRole.MANAGER.value,
    UserRole.DOCTOR.value,
    UserRole.REG.value,
    UserRole.NURSE.value,
    UserRole.RECRUITER.value,
    UserRole.PARTNER_DOCTOR.value,
    UserRole.VISITING_DOCTOR.value,
]


def get_all_actions() -> list[str]:
    """Полный список известных action'ов из ROLE_PERMISSIONS (для UI матрицы)."""
    actions: set[str] = set()
    for perms in ROLE_PERMISSIONS.values():
        actions.update(perms)
    return sorted(actions)


def get_default_permissions(role: str) -> set[str]:
    """Базовый набор прав роли из захардкоженной матрицы."""
    try:
        return set(ROLE_PERMISSIONS.get(UserRole(role), set()))
    except ValueError:
        return set()


# ── Redis-кэш ────────────────────────────────────────────────────────────────
_redis_client = None


def _get_redis():
    """Ленивый клиент Redis. None при недоступности → fallback на БД."""
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import redis.asyncio as aioredis
        from app.config import settings
        _redis_client = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        return _redis_client
    except Exception as e:
        log.warning(f"RBAC: Redis недоступен ({e}) — кэш отключён")
        return None


def _cache_key(tenant_id: str, role: str) -> str:
    return f"rbac:{tenant_id}:{role}"


async def _cache_get_override(tenant_id: str, role: str) -> dict | None:
    """Достаёт сохранённый override из Redis. None если не закэширован."""
    r = _get_redis()
    if r is None:
        return None
    try:
        raw = await r.get(_cache_key(tenant_id, role))
        if raw is None:
            return None
        # Спец-маркер «MISS» — кэшируем отсутствие override
        if raw == "__none__":
            return {}
        return json.loads(raw)
    except Exception as e:
        log.warning(f"RBAC cache_get error: {e}")
        return None


async def _cache_set_override(tenant_id: str, role: str, value: dict | None) -> None:
    """Кэширует override на 5 минут. value=None означает «нет override»."""
    r = _get_redis()
    if r is None:
        return
    try:
        payload = "__none__" if value is None else json.dumps(value)
        await r.setex(_cache_key(tenant_id, role), 300, payload)
    except Exception as e:
        log.warning(f"RBAC cache_set error: {e}")


async def invalidate_rbac_cache(tenant_id: str, role: str | None = None) -> None:
    """Сбрасывает кэш для одного role или для всех ролей тенанта."""
    r = _get_redis()
    if r is None:
        return
    try:
        if role is not None:
            await r.delete(_cache_key(tenant_id, role))
        else:
            # Удаляем все роли тенанта
            async for key in r.scan_iter(f"rbac:{tenant_id}:*"):
                await r.delete(key)
    except Exception as e:
        log.warning(f"RBAC cache_invalidate error: {e}")


# ── Загрузка override из БД ──────────────────────────────────────────────────
async def _load_override(db: AsyncSession, tenant_id: str, role: str) -> dict:
    """Возвращает permissions карту из БД (пустой dict если override нет)."""
    from app.models.permission_override import TenantPermissionOverride
    res = await db.execute(
        select(TenantPermissionOverride).where(
            TenantPermissionOverride.tenant_id == tenant_id,
            TenantPermissionOverride.role == role,
        )
    )
    row = res.scalar_one_or_none()
    return dict(row.permissions or {}) if row else {}


async def get_effective_override(
    db: AsyncSession, tenant_id: str, role: str
) -> dict:
    """
    Достаёт permissions override через кэш с fallback на БД.
    Возвращает map {action: bool}; пустой dict если override не задан.
    """
    cached = await _cache_get_override(tenant_id, role)
    if cached is not None:
        return cached
    fresh = await _load_override(db, tenant_id, role)
    await _cache_set_override(tenant_id, role, fresh if fresh else None)
    return fresh


# ── Публичный API проверки прав ──────────────────────────────────────────────
def _has_permission_static(user: User, permission: str) -> bool:
    """Старая логика: только захардкоженная матрица. Используется в sync-контексте."""
    return permission in ROLE_PERMISSIONS.get(user.role, set())


async def has_permission(
    user: User, action: str, db: AsyncSession | None = None
) -> bool:
    """
    Проверка прав с учётом override.
    1. Если у пользователя есть tenant_id и передан db — смотрим override.
       • permissions[action] == True  → разрешить
       • permissions[action] == False → запретить
    2. Иначе fallback на ROLE_PERMISSIONS из кода.

    Сигнатура асинхронная — потому что проверка может ходить в Redis/БД.
    Старый sync-вариант оставлен как _has_permission_static.
    """
    # super_admin — всегда true
    if user.role == UserRole.SUPER_ADMIN:
        return True
    role_value = user.role.value if hasattr(user.role, "value") else str(user.role)

    if user.tenant_id is not None and db is not None:
        try:
            override = await get_effective_override(db, str(user.tenant_id), role_value)
            if action in override:
                return bool(override[action])
        except Exception as e:
            log.warning(f"RBAC override lookup failed, fallback to static: {e}")

    return _has_permission_static(user, action)


def require_permission(permission: str):
    """
    Зависимость FastAPI: проверяет наличие права у текущего пользователя.

    ВАЖНО: внутри ходим в БД через has_permission, чтобы учитывать override.
    Если БД недоступна — has_permission падает на статическую матрицу.
    """
    async def _check(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        ok = await has_permission(user, permission, db)
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Недостаточно прав: требуется {permission}",
            )
        return user
    return Depends(_check)


def get_user_permissions(user: User) -> list[str]:
    """
    Возвращает список прав пользователя (для фронта).
    Без учёта override — sync-функция; используется в /auth/me.
    Эффективные права с override считает /permissions/matrix.
    """
    return sorted(ROLE_PERMISSIONS.get(user.role, set()))


async def get_user_permissions_effective(
    user: User, db: AsyncSession
) -> list[str]:
    """
    Возвращает эффективный список прав с учётом override (для фронта).
    """
    if user.role == UserRole.SUPER_ADMIN:
        return get_all_actions()
    role_value = user.role.value if hasattr(user.role, "value") else str(user.role)
    base = set(ROLE_PERMISSIONS.get(user.role, set()))
    if user.tenant_id is None:
        return sorted(base)
    try:
        override = await get_effective_override(db, str(user.tenant_id), role_value)
        for action, allowed in override.items():
            if allowed:
                base.add(action)
            else:
                base.discard(action)
    except Exception as e:
        log.warning(f"RBAC effective lookup failed: {e}")
    return sorted(base)
