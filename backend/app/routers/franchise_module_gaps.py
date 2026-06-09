"""
ФИЧА 4: Gap-анализ модулей по тенантам франшизы.

Endpoint:
  GET /franchise-owner/modules/gaps

Возвращает список модулей с метриками:
  - total_tenants: всего тенантов в франшизе
  - granted:       тенантов с активным грантом этого модуля
  - missing:       тенантов БЕЗ активного гранта (total - granted)
  - avg_price:     средняя internal_price_rub по существующим грантам с ценой > 0
                   (fallback на CommercialModule.price_monthly если все цены 0)
  - potential_mrr: missing × avg_price (если у тенанта нет гранта — нужен)
  - missing_tenants_list: [{id, name, slug}]

Сортировка по умолчанию: potential_mrr DESC.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.commercial import CommercialModule
from app.models.franchise_module_grant import FranchiseModuleGrant

router = APIRouter(prefix="/franchise-owner/modules", tags=["franchise-modules-gaps"])


def _require_franchise_owner(user: User):
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role not in ("franchise_owner", "super_admin"):
        raise HTTPException(403, "Доступ только для владельца франшизы")


async def _get_my_franchise(db: AsyncSession, user: User) -> Franchise:
    r = await db.execute(select(Franchise).where(Franchise.owner_user_id == user.id))
    f = r.scalar_one_or_none()
    if f:
        return f
    if user.tenant_id:
        t = await db.get(Tenant, user.tenant_id)
        if t and t.franchise_id:
            return await db.get(Franchise, t.franchise_id)
    r = await db.execute(select(Franchise).limit(1))
    f = r.scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Франшиза не найдена")
    return f


@router.get("/gaps")
async def get_module_gaps(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Возвращает список модулей с оценкой потенциального MRR (gap-анализ)."""
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)

    # Все тенанты франшизы
    rt = await db.execute(
        select(Tenant).where(Tenant.franchise_id == f.id).order_by(Tenant.name)
    )
    tenants = list(rt.scalars().all())
    tenant_ids = [t.id for t in tenants]
    total_tenants = len(tenants)
    if total_tenants == 0:
        return {"franchise_id": str(f.id), "total_tenants": 0, "items": []}

    # Все модули каталога (активные)
    rm = await db.execute(
        select(CommercialModule).where(CommercialModule.is_active.is_(True)).order_by(CommercialModule.name)
    )
    modules = list(rm.scalars().all())

    # Все активные гранты этой франшизы
    rg = await db.execute(
        select(FranchiseModuleGrant).where(
            FranchiseModuleGrant.franchise_id == f.id,
        )
    )
    grants = list(rg.scalars().all())

    # Сгруппируем гранты по module_key
    grants_by_key: dict[str, list[FranchiseModuleGrant]] = {}
    for g in grants:
        grants_by_key.setdefault(g.module_key, []).append(g)

    items: list[dict[str, Any]] = []

    for m in modules:
        key_grants = grants_by_key.get(m.key, [])
        active_grants = [g for g in key_grants if g.is_active]
        granted_tenant_ids = {g.tenant_id for g in active_grants}
        granted = len(granted_tenant_ids)
        missing = max(0, total_tenants - granted)

        # avg_price — по существующим грантам с price > 0
        priced = [g for g in key_grants if g.internal_price_rub and g.internal_price_rub > 0]
        if priced:
            avg_price = float(sum((g.internal_price_rub for g in priced), Decimal(0)) / len(priced))
        elif m.price_monthly:
            # fallback — платформенная цена
            avg_price = float(m.price_monthly)
        else:
            avg_price = 0.0

        potential_mrr = round(missing * avg_price, 2)

        missing_tenants_list = [
            {"id": str(t.id), "name": t.name, "slug": t.slug}
            for t in tenants
            if t.id not in granted_tenant_ids
        ]

        items.append({
            "module_key": m.key,
            "module_name": m.name,
            "module_category": m.category,
            "module_description": m.description,
            "platform_price": float(m.price_monthly) if m.price_monthly else None,
            "total_tenants": total_tenants,
            "granted": granted,
            "missing": missing,
            "avg_price": round(avg_price, 2),
            "potential_mrr": potential_mrr,
            "missing_tenants_list": missing_tenants_list,
            "granted_tenants_ids": [str(tid) for tid in granted_tenant_ids],
        })

    # Sort by potential_mrr DESC
    items.sort(key=lambda x: x["potential_mrr"], reverse=True)

    return {
        "franchise_id": str(f.id),
        "franchise_name": f.name,
        "total_tenants": total_tenants,
        "total_modules": len(modules),
        "items": items,
    }
