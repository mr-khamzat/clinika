"""
Сервис «Перелив пациентов» — матрица направлений между клиниками одной сети.

Считает cross-clinic referrals (Referral.cross_clinic_status='completed') и
группирует их по парам (from_tenant_id, to_tenant_id).

Доход для каждой пары — сумма bonus_snapshot_amount по completed-направлениям
(она же доход target-клиники по партнёрскому офферу).

Источник данных — таблица referrals (поля referred_by_tenant_id /
target_tenant_id / cross_clinic_status / bonus_snapshot_amount / created_at).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.clinic import Clinic
from app.models.referral import Referral


def _d(v) -> Decimal:
    if v is None:
        return Decimal("0")
    try:
        return Decimal(str(v))
    except Exception:
        return Decimal("0")


async def _list_tenants(db: AsyncSession, tenant_id: uuid.UUID) -> list[Tenant]:
    """Полный список тенантов в франшизе переданного tenant_id."""
    t = await db.get(Tenant, tenant_id)
    if t and t.franchise_id:
        r = await db.execute(
            select(Tenant).where(Tenant.franchise_id == t.franchise_id)
        )
        return list(r.scalars().all())
    return [t] if t else []


async def _clinic_name(db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """Возвращает имя первой клиники тенанта (для UI)."""
    r = await db.execute(
        select(Clinic).where(Clinic.tenant_id == tenant_id).order_by(Clinic.name).limit(1)
    )
    c = r.scalar_one_or_none()
    return c.name if c else "—"


async def compute_matrix(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    period_start: datetime,
    period_end: datetime,
) -> dict[str, Any]:
    """Матрица переливов внутри сети за период.

    Returns:
        {
          "tenants": [{id, name, clinic_name, slug}, ...],
          "matrix": [{from_clinic_id, from_clinic_name, to_clinic_id,
                       to_clinic_name, count, total_amount}, ...],
          "totals": {total_count, total_amount, top_directions: [...] (5)},
          "period_start", "period_end"
        }
    """
    tenants = await _list_tenants(db, tenant_id)
    if not tenants:
        return {
            "tenants": [],
            "matrix": [],
            "totals": {"total_count": 0, "total_amount": 0.0, "top_directions": []},
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
        }

    tenant_ids = [t.id for t in tenants]
    by_id: dict[uuid.UUID, Tenant] = {t.id: t for t in tenants}
    names: dict[uuid.UUID, str] = {}
    for t in tenants:
        names[t.id] = await _clinic_name(db, t.id)

    # Группируем completed cross-referrals по (from, to).
    # Учитываем только направления внутри сети (обе стороны — наши тенанты).
    q = (
        select(
            Referral.referred_by_tenant_id.label("from_id"),
            Referral.target_tenant_id.label("to_id"),
            func.count(Referral.id).label("cnt"),
            func.coalesce(func.sum(Referral.bonus_snapshot_amount), 0).label("amt"),
        )
        .where(and_(
            Referral.referred_by_tenant_id.in_(tenant_ids),
            Referral.target_tenant_id.in_(tenant_ids),
            Referral.cross_clinic_status == "completed",
            Referral.created_at >= period_start,
            Referral.created_at <= period_end,
        ))
        .group_by(Referral.referred_by_tenant_id, Referral.target_tenant_id)
    )
    r = await db.execute(q)
    rows = r.all()

    matrix: list[dict[str, Any]] = []
    total_count = 0
    total_amount = Decimal("0")
    for row in rows:
        from_id = row.from_id
        to_id = row.to_id
        if not from_id or not to_id:
            continue
        cnt = int(row.cnt or 0)
        amt = _d(row.amt)
        matrix.append({
            "from_clinic_id": str(from_id),
            "from_clinic_name": names.get(from_id, by_id[from_id].name if from_id in by_id else "—"),
            "from_tenant_id": str(from_id),
            "from_tenant_name": by_id[from_id].name if from_id in by_id else "—",
            "to_clinic_id": str(to_id),
            "to_clinic_name": names.get(to_id, by_id[to_id].name if to_id in by_id else "—"),
            "to_tenant_id": str(to_id),
            "to_tenant_name": by_id[to_id].name if to_id in by_id else "—",
            "count": cnt,
            "total_amount": float(amt),
        })
        total_count += cnt
        total_amount += amt

    matrix.sort(key=lambda x: (-x["count"], -x["total_amount"]))
    top = matrix[:5]

    tenants_payload = [
        {
            "id": str(t.id),
            "name": t.name,
            "slug": t.slug,
            "clinic_name": names.get(t.id, "—"),
        }
        for t in sorted(tenants, key=lambda x: x.name or "")
    ]

    return {
        "tenants": tenants_payload,
        "matrix": matrix,
        "totals": {
            "total_count": total_count,
            "total_amount": float(total_amount),
            "top_directions": top,
        },
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
    }


async def compute_top(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    period_start: datetime,
    period_end: datetime,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Топ-N направлений по количеству переливов."""
    data = await compute_matrix(db, tenant_id, period_start, period_end)
    return data["matrix"][:limit]


async def compute_summary(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    period_start: datetime,
    period_end: datetime,
) -> dict[str, Any]:
    """Только агрегаты (totals + top-5), без полной матрицы."""
    data = await compute_matrix(db, tenant_id, period_start, period_end)
    return {
        "totals": data["totals"],
        "tenants_count": len(data["tenants"]),
        "period_start": data["period_start"],
        "period_end": data["period_end"],
    }
