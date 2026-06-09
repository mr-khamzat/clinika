"""
ФИЧА 1: Консолидированный P&L по сети франшизы.

Endpoints:
  GET /franchise-owner/finance/pnl?period=YYYY-MM&group_by=clinic

Возвращает структурированный отчёт о прибылях и убытках по клиникам сети:
выручка (cash / card / online), себестоимость (зарплаты / supplies / rent /
other), валовая маржа, налоги (УСН 6% от выручки по умолчанию), чистая прибыль.

Источники данных:
  - revenue       → clinic_payments  (group by clinic_id, period; разбивка по gateway)
  - rent/supplies → spendings        (category=rent|supplies|salary|other)
  - salaries      → spendings WHERE category='salary' (если есть)
  - taxes         → revenue * 0.06   (УСН)

Если какой-то таблицы/категории нет — отдаём 0 + помечаем source='missing',
чтобы UI показал yellow banner про неполные данные.
"""
from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.clinic import Clinic

router = APIRouter(prefix="/franchise-owner/finance", tags=["franchise-finance"])


# ─── Helpers (повторяем стиль franchise_modules / franchise_revenue) ──────────


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


def _parse_period(period: str) -> tuple[date, date]:
    """'2026-05' → (2026-05-01, 2026-05-31)."""
    try:
        y, m = period.split("-")
        y = int(y)
        m = int(m)
        if m < 1 or m > 12:
            raise ValueError("month")
        last_day = calendar.monthrange(y, m)[1]
        return date(y, m, 1), date(y, m, last_day)
    except Exception:
        raise HTTPException(400, f"Неверный формат периода: {period} (нужен YYYY-MM)")


async def _table_exists(db: AsyncSession, table_name: str) -> bool:
    """Проверка существования таблицы через to_regclass."""
    try:
        r = await db.execute(select(func.to_regclass(f"public.{table_name}")))
        return r.scalar() is not None
    except Exception:
        return False


# ─── /pnl ─────────────────────────────────────────────────────────────────────


@router.get("/pnl")
async def get_pnl(
    period: str = Query(..., description="Период в формате YYYY-MM, напр. 2026-05"),
    group_by: str = Query("clinic", regex="^(clinic|tenant)$"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Консолидированный P&L по сети за месяц.

    Параметры:
      - period: 'YYYY-MM' (обязательный)
      - group_by: 'clinic' (по умолчанию) — детализация по клиникам.

    Источники:
      revenue:  clinic_payments (status='paid'/'success')
      cogs:     spendings (category in ['salary','supplies','rent','other'])
      taxes:    revenue * 0.06 (УСН)
      gross:    revenue - cogs (без налогов)
      net:      gross - taxes
    """
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    date_from, date_to = _parse_period(period)

    # 1) Все клиники сети (через тенантов франшизы)
    rt = await db.execute(select(Tenant.id).where(Tenant.franchise_id == f.id))
    tenant_ids = [row[0] for row in rt.all()]
    if not tenant_ids:
        return {
            "period": period,
            "group_by": group_by,
            "rows": [],
            "totals": _empty_row_totals(),
            "sources": {"revenue": "missing", "salaries": "missing", "supplies": "missing", "rent": "missing"},
            "notice": "В франшизе нет тенантов",
        }

    rc = await db.execute(
        select(Clinic).where(Clinic.tenant_id.in_(tenant_ids)).order_by(Clinic.name)
    )
    clinics = list(rc.scalars().all())
    clinic_ids = [c.id for c in clinics]
    if not clinic_ids:
        return {
            "period": period,
            "group_by": group_by,
            "rows": [],
            "totals": _empty_row_totals(),
            "sources": {"revenue": "missing", "salaries": "missing", "supplies": "missing", "rent": "missing"},
            "notice": "У тенантов франшизы нет клиник",
        }

    # ── Источник: revenue из clinic_payments ─────────────────────────────────
    revenue_by_clinic: dict[uuid.UUID, dict[str, Decimal]] = {
        c.id: {"cash": Decimal(0), "card": Decimal(0), "online": Decimal(0), "total": Decimal(0)}
        for c in clinics
    }
    revenue_src_status = "ok"
    try:
        # Используем raw SQL для устойчивости (clinic_payments может не быть импортирована как модель):
        from sqlalchemy import text as sql_text

        q = sql_text(
            """
            SELECT clinic_id, COALESCE(gateway,'') AS gw, COALESCE(SUM(amount),0) AS s
            FROM clinic_payments
            WHERE clinic_id = ANY(:cids)
              AND status IN ('paid','success','succeeded','completed')
              AND COALESCE(paid_at, created_at) >= :df
              AND COALESCE(paid_at, created_at) <= :dt
            GROUP BY clinic_id, gateway
            """
        )
        rr = await db.execute(
            q,
            {"cids": list(clinic_ids), "df": datetime.combine(date_from, datetime.min.time()),
             "dt": datetime.combine(date_to, datetime.max.time())},
        )
        for row in rr.all():
            cid = row[0]
            gw = (row[1] or "").lower()
            amount = Decimal(row[2] or 0)
            bucket = revenue_by_clinic.get(cid)
            if not bucket:
                continue
            if "cash" in gw or "касса" in gw:
                bucket["cash"] += amount
            elif "card" in gw or "карта" in gw or "terminal" in gw:
                bucket["card"] += amount
            elif gw:
                bucket["online"] += amount
            else:
                bucket["online"] += amount
            bucket["total"] += amount
        if all(v["total"] == 0 for v in revenue_by_clinic.values()):
            revenue_src_status = "empty"
    except Exception:
        revenue_src_status = "missing"

    # ── Источник: spendings (cogs) ───────────────────────────────────────────
    cogs_by_clinic: dict[uuid.UUID, dict[str, Decimal]] = {
        c.id: {"salaries": Decimal(0), "supplies": Decimal(0), "rent": Decimal(0), "other": Decimal(0), "total": Decimal(0)}
        for c in clinics
    }
    cogs_src_status = {"salaries": "missing", "supplies": "missing", "rent": "missing"}
    try:
        from sqlalchemy import text as sql_text

        q = sql_text(
            """
            SELECT clinic_id, category, COALESCE(SUM(amount),0) AS s
            FROM spendings
            WHERE clinic_id = ANY(:cids)
              AND COALESCE(paid_at, created_at::date) >= :df
              AND COALESCE(paid_at, created_at::date) <= :dt
            GROUP BY clinic_id, category
            """
        )
        rr = await db.execute(
            q,
            {"cids": list(clinic_ids), "df": date_from, "dt": date_to},
        )
        seen_cats: set[str] = set()
        for row in rr.all():
            cid = row[0]
            cat = (row[1] or "other").lower()
            amount = Decimal(row[2] or 0)
            bucket = cogs_by_clinic.get(cid)
            if not bucket:
                continue
            seen_cats.add(cat)
            if cat in ("salary", "salaries", "payroll"):
                bucket["salaries"] += amount
            elif cat in ("supplies", "supply", "inventory"):
                bucket["supplies"] += amount
            elif cat == "rent":
                bucket["rent"] += amount
            else:
                bucket["other"] += amount
            bucket["total"] += amount
        if "salary" in seen_cats or "salaries" in seen_cats or "payroll" in seen_cats:
            cogs_src_status["salaries"] = "ok"
        if "supplies" in seen_cats or "supply" in seen_cats or "inventory" in seen_cats:
            cogs_src_status["supplies"] = "ok"
        if "rent" in seen_cats:
            cogs_src_status["rent"] = "ok"
    except Exception:
        # spendings таблицы нет — оставляем missing
        pass

    # ── Сборка строк ─────────────────────────────────────────────────────────
    TAX_RATE = Decimal("0.06")  # УСН 6%

    rows: list[dict[str, Any]] = []
    totals_rev = {"cash": Decimal(0), "card": Decimal(0), "online": Decimal(0), "total": Decimal(0)}
    totals_cogs = {"salaries": Decimal(0), "supplies": Decimal(0), "rent": Decimal(0), "other": Decimal(0), "total": Decimal(0)}
    totals_taxes = Decimal(0)
    totals_gross = Decimal(0)
    totals_net = Decimal(0)

    for c in clinics:
        rev = revenue_by_clinic[c.id]
        cogs = cogs_by_clinic[c.id]
        taxes = (rev["total"] * TAX_RATE).quantize(Decimal("0.01"))
        gross = rev["total"] - cogs["total"]
        net = gross - taxes
        gm_pct = float((gross / rev["total"] * 100).quantize(Decimal("0.01"))) if rev["total"] else 0.0
        np_pct = float((net / rev["total"] * 100).quantize(Decimal("0.01"))) if rev["total"] else 0.0

        for k in totals_rev:
            totals_rev[k] += rev[k]
        for k in totals_cogs:
            totals_cogs[k] += cogs[k]
        totals_taxes += taxes
        totals_gross += gross
        totals_net += net

        rows.append({
            "clinic_id": str(c.id),
            "clinic_name": c.name,
            "revenue": {k: float(v) for k, v in rev.items()},
            "cogs": {k: float(v) for k, v in cogs.items()},
            "gross_margin": float(gross),
            "gross_margin_pct": gm_pct,
            "taxes": float(taxes),
            "net_profit": float(net),
            "net_profit_pct": np_pct,
        })

    total_rev_sum = totals_rev["total"]
    totals_gm_pct = float((totals_gross / total_rev_sum * 100).quantize(Decimal("0.01"))) if total_rev_sum else 0.0
    totals_np_pct = float((totals_net / total_rev_sum * 100).quantize(Decimal("0.01"))) if total_rev_sum else 0.0

    sources: dict[str, str] = {
        "revenue": revenue_src_status,
        "salaries": cogs_src_status["salaries"],
        "supplies": cogs_src_status["supplies"],
        "rent": cogs_src_status["rent"],
    }

    return {
        "period": period,
        "group_by": group_by,
        "tax_rate_pct": float(TAX_RATE * 100),
        "rows": rows,
        "totals": {
            "revenue": {k: float(v) for k, v in totals_rev.items()},
            "cogs": {k: float(v) for k, v in totals_cogs.items()},
            "gross_margin": float(totals_gross),
            "gross_margin_pct": totals_gm_pct,
            "taxes": float(totals_taxes),
            "net_profit": float(totals_net),
            "net_profit_pct": totals_np_pct,
        },
        "sources": sources,
    }


def _empty_row_totals() -> dict[str, Any]:
    return {
        "revenue": {"cash": 0.0, "card": 0.0, "online": 0.0, "total": 0.0},
        "cogs": {"salaries": 0.0, "supplies": 0.0, "rent": 0.0, "other": 0.0, "total": 0.0},
        "gross_margin": 0.0,
        "gross_margin_pct": 0.0,
        "taxes": 0.0,
        "net_profit": 0.0,
        "net_profit_pct": 0.0,
    }
