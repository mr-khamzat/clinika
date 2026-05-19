"""Управление матрицей видимости между клиниками одной франшизы.

Доступ: super_admin, franchise_owner. Для каждой пары (viewer_tenant, target_tenant)
в рамках одной франшизы хранится флаг allow_chat / allow_calls. Если записи нет —
видимость разрешена (default).
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.tenant_visibility import TenantVisibility
from app.core.deps import get_current_user

router = APIRouter(prefix="/franchise/visibility", tags=["franchise-visibility"])


def _require_franchise_admin(user: User) -> None:
    if user.role not in (UserRole.SUPER_ADMIN, UserRole.FRANCHISE_OWNER):
        raise HTTPException(403, "Доступ только super_admin / franchise_owner")


async def _franchise_tenants(db: AsyncSession, user: User) -> list[Tenant]:
    """Все тенанты той же франшизы, что и пользователь."""
    if not user.tenant_id:
        return []
    t = (await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    if not t or not t.franchise_id:
        return []
    r = await db.execute(select(Tenant).where(Tenant.franchise_id == t.franchise_id))
    return list(r.scalars().all())


class VisibilityCellIn(BaseModel):
    viewer_tenant_id: uuid.UUID
    target_tenant_id: uuid.UUID
    allow_chat: bool
    allow_calls: bool


class VisibilityMatrixIn(BaseModel):
    cells: list[VisibilityCellIn]


@router.get("")
async def get_matrix(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Текущая матрица видимости + список тенантов франшизы."""
    _require_franchise_admin(user)
    tenants = await _franchise_tenants(db, user)
    if not tenants:
        return {"tenants": [], "cells": []}

    tids = [t.id for t in tenants]
    rows = (await db.execute(
        select(TenantVisibility).where(
            TenantVisibility.viewer_tenant_id.in_(tids),
            TenantVisibility.target_tenant_id.in_(tids),
        )
    )).scalars().all()

    cells_map: dict[tuple, dict] = {}
    for r in rows:
        cells_map[(r.viewer_tenant_id, r.target_tenant_id)] = {
            "viewer_tenant_id": str(r.viewer_tenant_id),
            "target_tenant_id": str(r.target_tenant_id),
            "allow_chat": r.allow_chat,
            "allow_calls": r.allow_calls,
        }

    # Полная матрица — для отсутствующих пар выдаём default (true/true)
    full_cells = []
    for v in tenants:
        for t in tenants:
            if v.id == t.id:
                continue  # сама с собой всегда true (внутри-тенантная видимость не настраивается)
            key = (v.id, t.id)
            full_cells.append(cells_map.get(key, {
                "viewer_tenant_id": str(v.id),
                "target_tenant_id": str(t.id),
                "allow_chat": True,
                "allow_calls": True,
            }))

    return {
        "tenants": [{"id": str(t.id), "slug": t.slug, "name": t.name} for t in tenants],
        "cells": full_cells,
    }


@router.put("")
async def set_matrix(
    payload: VisibilityMatrixIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Полная замена матрицы: пишем upsert на каждую пришедшую ячейку.

    Ячейки где allow_chat=true И allow_calls=true → удаляем (default).
    """
    _require_franchise_admin(user)
    tenants = await _franchise_tenants(db, user)
    if not tenants:
        raise HTTPException(400, "У вас нет франшизы для управления видимостью")
    tids_set = {t.id for t in tenants}

    # Существующие записи для франшизы
    existing = {
        (r.viewer_tenant_id, r.target_tenant_id): r
        for r in (await db.execute(
            select(TenantVisibility).where(
                TenantVisibility.viewer_tenant_id.in_(tids_set),
                TenantVisibility.target_tenant_id.in_(tids_set),
            )
        )).scalars().all()
    }

    seen_keys = set()
    for c in payload.cells:
        if c.viewer_tenant_id not in tids_set or c.target_tenant_id not in tids_set:
            continue
        if c.viewer_tenant_id == c.target_tenant_id:
            continue
        key = (c.viewer_tenant_id, c.target_tenant_id)
        seen_keys.add(key)
        # Если оба true — удаляем запись (default = true)
        is_default = bool(c.allow_chat) and bool(c.allow_calls)
        existing_row = existing.get(key)
        if is_default:
            if existing_row is not None:
                await db.delete(existing_row)
            continue
        if existing_row is None:
            db.add(TenantVisibility(
                viewer_tenant_id=c.viewer_tenant_id,
                target_tenant_id=c.target_tenant_id,
                allow_chat=bool(c.allow_chat),
                allow_calls=bool(c.allow_calls),
            ))
        else:
            existing_row.allow_chat = bool(c.allow_chat)
            existing_row.allow_calls = bool(c.allow_calls)

    await db.commit()
    return {"status": "ok", "updated": len(seen_keys)}
