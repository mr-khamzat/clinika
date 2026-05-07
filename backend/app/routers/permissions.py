"""
Роутер /permissions — RBAC как данные (Этап 8 ROADMAP).

Endpoints:
  GET    /permissions/actions          — список всех известных action'ов
  GET    /permissions/matrix           — таблица effective прав по ролям тенанта
  PUT    /permissions/override         — переопределить права роли (franchise_owner)
  DELETE /permissions/override/{role}  — сбросить override роли к дефолту

Все ответы возвращаются с учётом override для текущего тенанта.
"""
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
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


class RoleMatrix(BaseModel):
    role: str
    default: list[str]
    overrides: dict[str, bool]
    effective: list[str]


class MatrixResponse(BaseModel):
    actions: list[str]
    roles: list[RoleMatrix]


# ── Endpoints ────────────────────────────────────────────────────────────────
@router.get("/actions", response_model=list[str])
async def list_actions(_user: User = Depends(get_current_user)):
    """Полный список всех известных action'ов в системе (для UI заголовков таблицы)."""
    return get_all_actions()


@router.get("/matrix", response_model=MatrixResponse)
async def get_matrix(
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Возвращает effective матрицу прав для тенанта текущего пользователя.

    Доступно: manager+ (включая franchise_owner и super_admin).
    Если у пользователя нет tenant_id — отдаём чистый дефолт.
    """
    actions = get_all_actions()
    tenant_id = str(user.tenant_id) if user.tenant_id else None

    rows: list[RoleMatrix] = []
    for role_name in EDITABLE_ROLES:
        default_perms = get_default_permissions(role_name)
        overrides: dict[str, bool] = {}
        if tenant_id:
            overrides = await get_effective_override(db, tenant_id, role_name)

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

    return MatrixResponse(actions=actions, roles=rows)


@router.put("/override")
async def put_override(
    payload: OverridePayload,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """
    Переопределяет матрицу прав одной роли для тенанта владельца.

    Доступно только franchise_owner / super_admin.
    Тело: {role, permissions: {action: bool}} — карта переопределений.
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

    if not user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Текущий пользователь не привязан к тенанту",
        )
    tenant_id = user.tenant_id

    # upsert по (tenant_id, role)
    res = await db.execute(
        select(TenantPermissionOverride).where(
            TenantPermissionOverride.tenant_id == tenant_id,
            TenantPermissionOverride.role == payload.role,
        )
    )
    row = res.scalar_one_or_none()
    if row is None:
        row = TenantPermissionOverride(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
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
    await invalidate_rbac_cache(str(tenant_id), payload.role)
    return {"ok": True, "role": payload.role, "permissions": payload.permissions}


@router.delete("/override/{role}")
async def delete_override(
    role: str,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """
    Сбрасывает override роли — теперь применяется только захардкоженный дефолт.
    """
    if role not in EDITABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Нельзя редактировать роль {role}",
        )
    if not user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Текущий пользователь не привязан к тенанту",
        )
    tenant_id = user.tenant_id

    await db.execute(
        delete(TenantPermissionOverride).where(
            TenantPermissionOverride.tenant_id == tenant_id,
            TenantPermissionOverride.role == role,
        )
    )
    await db.commit()
    await invalidate_rbac_cache(str(tenant_id), role)
    return {"ok": True, "role": role}
