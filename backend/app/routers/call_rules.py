"""Роутер управления правилами звонков. Доступно владельцу франшизы (для своих тенантов)
и менеджеру/super_admin для соответствующего тенанта."""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.franchise import Franchise
from app.services import call_rules_service as crs

router = APIRouter(prefix="/call-rules", tags=["call-rules"])


class RuleIn(BaseModel):
    from_role: str
    to_role: str
    scope: str  # same_clinic | cross_clinic | any
    allow_audio: bool
    allow_video: bool


async def _ensure_access(tenant_id: uuid.UUID, current_user: User, db: AsyncSession) -> Tenant:
    """Проверяет что у текущего пользователя есть право управлять правилами тенанта.

    Доступ:
      - super_admin: любой тенант
      - franchise_owner: только тенанты своей франшизы
      - manager: только свой тенант
    """
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Тенант не найден")

    if current_user.role == UserRole.SUPER_ADMIN:
        return tenant
    if current_user.role == UserRole.MANAGER and current_user.tenant_id == tenant_id:
        return tenant
    if current_user.role == UserRole.SUPERVISOR and current_user.tenant_id == tenant_id:
        return tenant
    if current_user.role == UserRole.FRANCHISE_OWNER:
        # тенанты своей франшизы
        franchise = (await db.execute(
            select(Franchise).where(Franchise.owner_user_id == current_user.id)
        )).scalar_one_or_none()
        if franchise and tenant.franchise_id == franchise.id:
            return tenant
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к правилам этого тенанта")


@router.get("/{tenant_id}")
async def list_rules(
    tenant_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_access(tenant_id, current_user, db)
    rules = await crs.get_rules_matrix(tenant_id, db)
    return {
        "tenant_id": str(tenant_id),
        "rules": rules,
        "active_roles": [r.value for r in crs.ACTIVE_ROLES],
        "excluded_roles": [r.value for r in crs.EXCLUDED_ROLES],
    }


@router.put("/{tenant_id}")
async def upsert_rule(
    tenant_id: uuid.UUID,
    body: RuleIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_access(tenant_id, current_user, db)
    if body.scope not in {"same_clinic", "cross_clinic", "any"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "scope должен быть same_clinic|cross_clinic|any")
    rule = await crs.upsert_rule(
        tenant_id=tenant_id,
        from_role=body.from_role,
        to_role=body.to_role,
        scope=body.scope,
        allow_audio=body.allow_audio,
        allow_video=body.allow_video,
        db=db,
    )
    return {"ok": True, "id": str(rule.id)}


@router.delete("/{tenant_id}")
async def reset_rules(
    tenant_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Сбрасывает все overrides тенанта к дефолтам."""
    await _ensure_access(tenant_id, current_user, db)
    deleted = await crs.reset_rules(tenant_id, db)
    return {"ok": True, "deleted": deleted}
