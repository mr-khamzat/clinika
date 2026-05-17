"""manager_subscription_discounts — CRUD категорных скидок «Здоровье+».

Доступ: require_manager (tenant-scoped). Глобальные правила (tenant_id IS NULL)
доступны на чтение всем менеджерам, но создавать/менять/удалять их через этот
роутер нельзя — это контур super_admin (отдельный эндпоинт можно добавить
позже при необходимости).

Эндпоинты:
  GET    /manager/subscription/discounts
  POST   /manager/subscription/discounts
  PATCH  /manager/subscription/discounts/{rule_id}
  DELETE /manager/subscription/discounts/{rule_id}
"""
import uuid
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_manager
from app.database import get_db
from app.models.user import User

from app.services import subscription_plan_discount_service as discs


router = APIRouter(
    prefix="/manager/subscription/discounts",
    tags=["manager-subscription-discounts"],
    dependencies=[Depends(require_manager)],
)


# ── Pydantic schemas ────────────────────────────────────────────────────────
class DiscountRuleIn(BaseModel):
    plan_key: str = Field(min_length=2, max_length=40,
                           pattern=r"^[a-z][a-z0-9_]+$")
    scope: str = Field(pattern=r"^(all|category|service)$")
    category_id: Optional[uuid.UUID] = None
    category_name: Optional[str] = Field(default=None, max_length=200)
    service_id: Optional[uuid.UUID] = None
    discount_percent: float = Field(ge=0, le=100)
    is_active: bool = True

    @field_validator("category_name")
    @classmethod
    def _strip_cat(cls, v):
        return v.strip() if v else v


class DiscountRulePatch(BaseModel):
    plan_key: Optional[str] = Field(default=None, max_length=40,
                                      pattern=r"^[a-z][a-z0-9_]+$")
    scope: Optional[str] = Field(default=None, pattern=r"^(all|category|service)$")
    category_id: Optional[uuid.UUID] = None
    category_name: Optional[str] = Field(default=None, max_length=200)
    service_id: Optional[uuid.UUID] = None
    discount_percent: Optional[float] = Field(default=None, ge=0, le=100)
    is_active: Optional[bool] = None


def _to_dict(row) -> dict:
    return {
        "id": str(row.id),
        "tenant_id": str(row.tenant_id) if row.tenant_id else None,
        "plan_key": row.plan_key,
        "scope": row.scope,
        "category_id": str(row.category_id) if row.category_id else None,
        "category_name": row.category_name,
        "service_id": str(row.service_id) if row.service_id else None,
        "discount_percent": float(row.discount_percent),
        "is_active": bool(row.is_active),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ── Endpoints ───────────────────────────────────────────────────────────────
@router.get("")
async def list_discounts(
    plan_key: Optional[str] = Query(None),
    scope: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    rows = await discs.list_rules(
        db,
        tenant_id=user.tenant_id,
        plan_key=plan_key,
        scope=scope,
        is_active=is_active,
    )
    return {"items": [_to_dict(r) for r in rows]}


@router.post("", status_code=201)
async def create_discount(
    body: DiscountRuleIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    try:
        row = await discs.create_rule(
            db,
            tenant_id=user.tenant_id,
            plan_key=body.plan_key,
            scope=body.scope,
            category_id=body.category_id,
            category_name=body.category_name,
            service_id=body.service_id,
            discount_percent=Decimal(str(body.discount_percent)),
            is_active=body.is_active,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return _to_dict(row)


@router.patch("/{rule_id}")
async def update_discount(
    rule_id: uuid.UUID,
    body: DiscountRulePatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    patch = body.model_dump(exclude_unset=True)
    try:
        row = await discs.update_rule(
            db, rule_id=rule_id, tenant_id=user.tenant_id, patch=patch,
        )
    except LookupError:
        raise HTTPException(404, "Правило не найдено")
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return _to_dict(row)


@router.delete("/{rule_id}", status_code=204)
async def delete_discount(
    rule_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    try:
        await discs.delete_rule(
            db, rule_id=rule_id, tenant_id=user.tenant_id,
        )
    except LookupError:
        raise HTTPException(404, "Правило не найдено")
    except PermissionError as e:
        raise HTTPException(403, str(e))
    await db.commit()
    return None
