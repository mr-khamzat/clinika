"""
Роутер /permissions — RBAC как данные (Этап 8 ROADMAP).

Endpoints:
  GET    /permissions/actions          — список всех известных action'ов
  GET    /permissions/matrix           — таблица effective прав по ролям тенанта
  PUT    /permissions/override         — переопределить права роли (franchise_owner)
  DELETE /permissions/override/{role}  — сбросить override роли к дефолту

Все ответы возвращаются с учётом override для текущего тенанта.

super_admin может работать с любым тенантом, передавая ?tenant_id=<uuid>
в query (для GET) или в payload.target_tenant_id (для PUT) — это нужно для
вкладки «Роли и права» в /admin, где super_admin редактирует чужие тенанты.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.database import get_db
from app.core.deps import (
    get_current_user,
    require_manager,
    require_franchise_owner,
)
from app.core.permissions import (
    ROLE_PERMISSIONS,
    EDITABLE_ROLES,
    get_all_actions,
    get_default_permissions,
    get_effective_override,
    invalidate_rbac_cache,
)
from app.models.user import User, UserRole
from app.models.permission_override import TenantPermissionOverride

router = APIRouter(prefix="/permissions", tags=["permissions"])


# ── Pydantic модели ──────────────────────────────────────────────────────────
class OverridePayload(BaseModel):
    """Тело PUT /permissions/override."""
    role: str = Field(..., description="manager|doctor|reg|nurse|recruiter|partner_doctor|visiting_doctor")
    permissions: dict[str, bool] = Field(
        default_factory=dict,
        description="{action: bool} — True/False переопределяет, отсутствие = дефолт",
    )
    # Только для super_admin — целевой тенант (если не указан, берётся свой)
    target_tenant_id: Optional[str] = Field(
        default=None,
        description="(super_admin) UUID тенанта, чьи overrides редактируем",
    )


class RoleMatrix(BaseModel):
    role: str
    default: list[str]
    overrides: dict[str, bool]
    effective: list[str]


class MatrixResponse(BaseModel):
    actions: list[str]
    roles: list[RoleMatrix]
    tenant_id: Optional[str] = None


# ── Хелпер: разрешить super_admin использовать tenant_id query ───────────────
def _resolve_tenant_id(user: User, tenant_id_query: Optional[str]) -> Optional[str]:
    """Возвращает строковый UUID тенанта, с которым работает запрос.

    super_admin может явно указать tenant_id — иначе используется свой.
    Прочие роли всегда работают только со своим тенантом (query игнорируется).
    """
    is_sa = (user.role == UserRole.SUPER_ADMIN)
    if is_sa and tenant_id_query:
        # Валидация UUID
        try:
            uuid.UUID(tenant_id_query)
        except ValueError:
            raise HTTPException(status_code=400, detail="Некорректный tenant_id")
        return tenant_id_query
    return str(user.tenant_id) if user.tenant_id else None


# ── Endpoints ────────────────────────────────────────────────────────────────
@router.get("/actions", response_model=list[str])
async def list_actions(_user: User = Depends(get_current_user)):
    """Полный список всех известных action'ов в системе (для UI заголовков таблицы)."""
    return get_all_actions()


@router.get("/matrix", response_model=MatrixResponse)
async def get_matrix(
    tenant_id: Optional[str] = Query(default=None, description="(super_admin) явный тенант"),
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Возвращает effective матрицу прав.

    Доступно: manager+ (включая franchise_owner и super_admin).
    super_admin может передать ?tenant_id=<uuid> чтобы посмотреть/редактировать
    матрицу любого тенанта. Если у пользователя нет tenant_id и query пуст —
    отдаём чистый дефолт.
    """
    actions = get_all_actions()
    resolved_tid = _resolve_tenant_id(user, tenant_id)

    rows: list[RoleMatrix] = []
    for role_name in EDITABLE_ROLES:
        default_perms = get_default_permissions(role_name)
        overrides: dict[str, bool] = {}
        if resolved_tid:
            overrides = await get_effective_override(db, resolved_tid, role_name)

        # Считаем effective: дефолт + override
        effective = set(default_perms)
        for act, allowed in overrides.items():
            if allowed:
                effective.add(act)
            else:
                effective.discard(act)

        rows.append(
            RoleMatrix(
                role=role_name,
                default=sorted(default_perms),
                overrides=overrides,
                effective=sorted(effective),
            )
        )

    return MatrixResponse(actions=actions, roles=rows, tenant_id=resolved_tid)


@router.put("/override")
async def put_override(
    payload: OverridePayload,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """
    Переопределяет матрицу прав одной роли для тенанта.

    Доступно: franchise_owner / super_admin.
    Тело: {role, permissions: {action: bool}, target_tenant_id?}.
    super_admin может указать target_tenant_id для редактирования чужих тенантов.
    Пустая карта = «нет переопределений» (фактически как DELETE, но строка остаётся).
    """
    # Валидация роли
    if payload.role not in EDITABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Нельзя редактировать роль {payload.role}",
        )

    # Валидация action'ов: все ключи должны быть из get_all_actions()
    known_actions = set(get_all_actions())
    unknown = [a for a in payload.permissions.keys() if a not in known_actions]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Неизвестные action'ы: {unknown}",
        )

    resolved_tid = _resolve_tenant_id(user, payload.target_tenant_id)
    if not resolved_tid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Не указан тенант (target_tenant_id для super_admin или tenant_id у пользователя)",
        )
    tenant_uuid = uuid.UUID(resolved_tid)

    # upsert по (tenant_id, role)
    res = await db.execute(
        select(TenantPermissionOverride).where(
            TenantPermissionOverride.tenant_id == tenant_uuid,
            TenantPermissionOverride.role == payload.role,
        )
    )
    row = res.scalar_one_or_none()
    if row is None:
        row = TenantPermissionOverride(
            id=uuid.uuid4(),
            tenant_id=tenant_uuid,
            role=payload.role,
            permissions=payload.permissions,
            updated_at=datetime.utcnow(),
            updated_by_user_id=user.id,
        )
        db.add(row)
    else:
        row.permissions = payload.permissions
        row.updated_at = datetime.utcnow()
        row.updated_by_user_id = user.id

    await db.commit()
    # Сбрасываем кэш — следующий запрос подтянет свежее
    await invalidate_rbac_cache(resolved_tid, payload.role)
    return {"ok": True, "role": payload.role, "tenant_id": resolved_tid, "permissions": payload.permissions}


@router.delete("/override/{role}")
async def delete_override(
    role: str,
    tenant_id: Optional[str] = Query(default=None, description="(super_admin) явный тенант"),
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """
    Сбрасывает override роли — теперь применяется только захардкоженный дефолт.
    super_admin может указать ?tenant_id=<uuid> для чужих тенантов.
    """
    if role not in EDITABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Нельзя редактировать роль {role}",
        )
    resolved_tid = _resolve_tenant_id(user, tenant_id)
    if not resolved_tid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Не указан тенант",
        )
    tenant_uuid = uuid.UUID(resolved_tid)

    await db.execute(
        delete(TenantPermissionOverride).where(
            TenantPermissionOverride.tenant_id == tenant_uuid,
            TenantPermissionOverride.role == role,
        )
    )
    await db.commit()
    await invalidate_rbac_cache(resolved_tid, role)
    return {"ok": True, "role": role, "tenant_id": resolved_tid}
