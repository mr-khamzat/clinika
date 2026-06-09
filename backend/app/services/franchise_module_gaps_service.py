"""
Сервис «Остатки модулей» (gap-analysis по клиникам).

В отличие от уже существующего `routers/franchise_module_gaps.py`, который
группирует «модуль → сколько тенантов БЕЗ него», здесь мы группируем
**по клинике**: для каждой клиники сети — какие коммерческие модули у неё
НЕ подключены, и какую упущенную выручку это даёт.

Источник «подключённости» — FranchiseModuleGrant (is_active=True). Если у
тенанта стоит грант — модуль считается подключённым внутренне; если
нет — это «gap».

Цена для оценки potential_revenue:
  internal_price_rub (по другим грантам этого модуля у этой франшизы) —
  если их нет, fallback на CommercialModule.price_monthly. Считаем
  среднее по существующим внутри-франшизным грантам с price > 0.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.clinic import Clinic
from app.models.commercial import CommercialModule
from app.models.franchise_module_grant import FranchiseModuleGrant


async def _get_franchise(db: AsyncSession, tenant_id: uuid.UUID) -> Franchise | None:
    t = await db.get(Tenant, tenant_id)
    if not t or not t.franchise_id:
        return None
    return await db.get(Franchise, t.franchise_id)


def _avg_price(grants: list[FranchiseModuleGrant], fallback: Decimal | None) -> Decimal:
    """Средняя internal_price_rub по гранту > 0 ₽; fallback — каталожная цена."""
    priced = [g for g in grants if g.internal_price_rub and g.internal_price_rub > 0]
    if priced:
        total = sum((g.internal_price_rub for g in priced), Decimal(0))
        return (total / len(priced)).quantize(Decimal("0.01"))
    return Decimal(str(fallback or 0))


async def compute_gaps(
    db: AsyncSession,
    tenant_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Возвращает список клиник сети с указанием непосвящённых модулей.

    Формат каждого элемента:
        {
            "clinic_id": str,
            "tenant_id": str,
            "clinic_name": str,
            "tenant_name": str,
            "missing_modules": [
                {"key": str, "name": str, "category": str, "monthly_price_rub": float}
            ],
            "potential_revenue": float,  # сумма monthly_price_rub
        }
    """
    franchise = await _get_franchise(db, tenant_id)
    if not franchise:
        return []

    # все тенанты сети
    rt = await db.execute(
        select(Tenant).where(Tenant.franchise_id == franchise.id).order_by(Tenant.name)
    )
    tenants = list(rt.scalars().all())
    if not tenants:
        return []

    # все активные модули каталога
    rm = await db.execute(
        select(CommercialModule).where(CommercialModule.is_active.is_(True)).order_by(CommercialModule.name)
    )
    modules = list(rm.scalars().all())

    # все гранты по этой франшизе
    rg = await db.execute(
        select(FranchiseModuleGrant).where(FranchiseModuleGrant.franchise_id == franchise.id)
    )
    grants = list(rg.scalars().all())

    # средняя цена по каждому модулю (для оценки)
    grants_by_key: dict[str, list[FranchiseModuleGrant]] = {}
    for g in grants:
        grants_by_key.setdefault(g.module_key, []).append(g)
    avg_price_per_module: dict[str, Decimal] = {}
    for m in modules:
        avg_price_per_module[m.key] = _avg_price(grants_by_key.get(m.key, []), m.price_monthly)

    # активные гранты по (tenant_id, module_key)
    active_pairs: set[tuple[uuid.UUID, str]] = {
        (g.tenant_id, g.module_key) for g in grants if g.is_active
    }

    out: list[dict[str, Any]] = []
    for t in tenants:
        # клиника тенанта (первая по имени) — для UI
        rc = await db.execute(
            select(Clinic).where(Clinic.tenant_id == t.id).order_by(Clinic.name).limit(1)
        )
        clinic = rc.scalar_one_or_none()
        missing: list[dict[str, Any]] = []
        potential = Decimal("0")
        for m in modules:
            if (t.id, m.key) in active_pairs:
                continue
            price = avg_price_per_module.get(m.key, Decimal("0"))
            missing.append({
                "key": m.key,
                "name": m.name,
                "category": m.category,
                "monthly_price_rub": float(price),
            })
            potential += price
        out.append({
            "clinic_id": str(clinic.id) if clinic else None,
            "clinic_name": clinic.name if clinic else "—",
            "tenant_id": str(t.id),
            "tenant_name": t.name,
            "tenant_slug": t.slug,
            "missing_modules": missing,
            "missing_count": len(missing),
            "potential_revenue": float(potential),
        })

    # сортировка: больше всего «не хватает» → сверху
    out.sort(key=lambda x: x["potential_revenue"], reverse=True)
    return out


async def compute_summary(
    db: AsyncSession,
    tenant_id: uuid.UUID,
) -> dict[str, Any]:
    """Агрегаты: общая упущенная выручка + топ-5 «дефицитных» модулей."""
    items = await compute_gaps(db, tenant_id)
    total_potential = sum((i["potential_revenue"] for i in items), 0.0)

    # счётчик: сколько раз модуль НЕ подключён в сети
    counter: dict[str, dict[str, Any]] = {}
    for item in items:
        for m in item["missing_modules"]:
            slot = counter.setdefault(m["key"], {
                "key": m["key"], "name": m["name"], "category": m["category"],
                "monthly_price_rub": m["monthly_price_rub"],
                "missing_clinics_count": 0, "potential_revenue": 0.0,
            })
            slot["missing_clinics_count"] += 1
            slot["potential_revenue"] += m["monthly_price_rub"]

    top_modules = sorted(counter.values(), key=lambda x: x["potential_revenue"], reverse=True)[:5]

    return {
        "clinics_with_gaps": sum(1 for i in items if i["missing_count"] > 0),
        "total_clinics": len(items),
        "total_potential_revenue": round(total_potential, 2),
        "top_missing_modules": top_modules,
    }
