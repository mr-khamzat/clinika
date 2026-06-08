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

    # ── Impersonation: если в токене imp=true — кладём данные impersonator
    # в contextvar чтобы audit_service записывал реального super_admin как actor.
    # Это критично для compliance / GDPR: мы хотим знать кто из super_admin'ов
    # сделал действие под видом tenant-юзера.
    if payload.get("imp") is True:
        act_id_raw = payload.get("act")
        if act_id_raw:
            try:
                act_id = uuid.UUID(act_id_raw)
                from app.core.request_ctx import current_impersonator
                current_impersonator.set({
                    "actor_id": act_id,
                    "actor_name": payload.get("act_name") or "super_admin",
                    "target_id": user.id,
                    "target_name": user.full_name,
                    "reason": payload.get("imp_reason"),
                })
            except (ValueError, Exception):
                pass

    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Администраторы или super_admin."""
    if user.role not in (UserRole.REG, UserRole.MANAGER, UserRole.SUPER_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для администраторов"
        )
    return user


async def require_manager(user: User = Depends(get_current_user)) -> User:
    """Системный администратор (manager) или super_admin."""
    if user.role not in (UserRole.MANAGER, UserRole.SUPER_ADMIN, UserRole.FRANCHISE_OWNER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для системного администратора"
        )
    return user


async def require_reports_access(user: User = Depends(get_current_user)) -> User:
    """Отчёты: доступны и Администраторам клиники, и Системному администратору."""
    if user.role not in (UserRole.REG, UserRole.MANAGER, UserRole.SUPER_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав"
        )
    return user


async def require_partner_or_above(user: User = Depends(get_current_user)) -> User:
    """Доступ для партнёров, администраторов и системного администратора."""
    if user.role not in (UserRole.REG, UserRole.MANAGER, UserRole.SUPER_ADMIN):
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


async def require_director(user: User = Depends(get_current_user)) -> User:
    """Доступ только для директора сети (или super_admin для отладки)."""
    if user.role not in (UserRole.DIRECTOR, UserRole.DEPUTY_DIRECTOR, UserRole.SUPER_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для директора сети"
        )
    return user


async def require_director_or_owner(user: User = Depends(get_current_user)) -> User:
    """Read-доступ к сетевой отчётности: director, franchise_owner или super_admin."""
    if user.role not in (UserRole.DIRECTOR, UserRole.DEPUTY_DIRECTOR, UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав"
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


def _is_super_admin(user) -> bool:
    """super_admin строго ПО РОЛИ (не по NULL tenant_id).

    Дубль `regulation_service.is_super_admin`, вынесен сюда чтобы избежать
    импорта сервисного слоя в core/deps. Только роль SUPER_ADMIN считается
    супер-админом — НИКОГДА не «tenant_id IS NULL».
    """
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    return role == UserRole.SUPER_ADMIN.value


def assert_same_tenant(user, obj, status: int = 404) -> None:
    """Единый fail-CLOSED guard кросс-тенантного доступа (находка #7).

    Заменяет повсеместную fail-open лесенку
    ``if user.tenant_id and obj.tenant_id and obj.tenant_id != user.tenant_id``,
    которая пропускала проверку, если ЛЮБОЙ операнд был NULL → кросс-тенантный
    доступ к записям с ``tenant_id=NULL``.

    Логика (образец `regulation_service.user_has_access_to_regulation:295-297`):
      • super_admin (строго ПО РОЛИ) — пропускается всегда;
      • иначе NULL у пользователя ИЛИ у записи — запрет;
      • иначе несовпадение tenant_id — запрет.

    ``obj`` может быть моделью с атрибутом ``tenant_id`` или сырым значением
    tenant_id (UUID/None). По умолчанию запрет — ``404`` (не подтверждаем
    существование чужой записи); вызывающий может передать 403.
    """
    if _is_super_admin(user):
        return
    obj_tid = getattr(obj, "tenant_id", obj)
    user_tid = getattr(user, "tenant_id", None)
    # Fail-closed: NULL с любой стороны (для не-super_admin) = запрет.
    if not user_tid or not obj_tid or obj_tid != user_tid:
        raise HTTPException(status_code=status, detail="Не найдено")


def assert_can_create_in_tenant(user) -> None:
    """Запрет рождения NULL-тенанта (находка #7, п.3).

    super_admin может создавать записи в системном контексте, но обычный
    пользователь без tenant_id создал бы запись с ``tenant_id=NULL``, которую
    затем сможет прочитать любой тенант — поэтому fail-closed 409.
    """
    if _is_super_admin(user):
        return
    if not getattr(user, "tenant_id", None):
        raise HTTPException(
            status_code=409,
            detail="Пользователь не привязан к тенанту — создание записи запрещено",
        )


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
):
    """Сессия БД с установленным app.tenant_id для RLS (находка #1, Часть B).

    Кладёт tenant_id аутентифицированного пользователя в request-scoped
    contextvar (`current_tenant_id`). begin-listener в database.py применяет
    `SELECT set_config('app.tenant_id', <tid>, true)` в начале КАЖДОЙ
    транзакции сессии — поэтому контекст переживает mid-handler db.commit()
    (старая одноразовая установка терялась после первого commit, и RLS
    становился permissive — корень находки #1, Часть B).

    Поведение:
      • tenant-пользователь → app.tenant_id = его tenant → RLS фильтрует по тенанту;
      • super_admin (строго ПО РОЛИ) → контекст НЕ ставится (None) → app.tenant_id=''
        → RLS-политика пропускает все тенанты (super_admin видит всё);
      • по выходе контекст восстанавливается (token reset) — без утечки в пул.

    Зависит от get_current_user → требует аутентификации. НЕ использовать на
    эндпоинтах, где db нужна ДО auth (например, восстановление patient-сессии
    по токену из query/header) — там оставлять Depends(get_db).

    Использование:
        @router.get("/medcard/diagnoses")
        async def list_diagnoses(db: AsyncSession = Depends(get_tenant_db)):
            ...
    """
    from app.database import current_tenant_id

    # super_admin строго ПО РОЛИ — НЕ ставим контекст (None → permissive RLS).
    # Иначе берём tenant_id пользователя (канонизируем как UUID-строку).
    tid = None if _is_super_admin(user) else (str(user.tenant_id) if user.tenant_id else None)
    token = current_tenant_id.set(str(uuid.UUID(tid)) if tid else None)
    try:
        yield db
    finally:
        current_tenant_id.reset(token)
