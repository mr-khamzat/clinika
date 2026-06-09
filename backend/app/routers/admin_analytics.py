"""
Admin Analytics — расширенная аналитика платформы для super_admin.

Префикс: /admin/analytics
Содержит:
  • GET /mrr              — MRR/ARR, разбивка по планам, тренд 12 месяцев
  • GET /churn            — отток тенантов (rate, причины, voluntary/involuntary)
  • GET /tenant-health    — список всех тенантов с health_score
  • GET /tenant-health/{tenant_id} — детальная разбивка health одного тенанта

Связан с фронтовой страницей /opt/clinika/frontend/src/pages/admin/AdminAnalytics.jsx,
вкладки "MRR", "Churn", "Health Score".

Источники:
  • subscriptions.amount_per_period (активные) → MRR
  • если подписок нет — derive из tenant_licenses.plan × PLAN_PRICES
  • tenants.churned_at / churn_reason → churn dashboard
  • audit_log + appointments + invoices → health score (см. services/tenant_health.py)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, date
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_super_admin
from app.models.user import User
from app.models.tenant import Tenant, TenantLicense
from app.models.billing import Subscription, SubStatus

router = APIRouter(prefix="/admin/analytics", tags=["admin-analytics"])


# ── Фоллбэк-прайслист (если в БД нет subscriptions, считаем по плану) ────────
# Цены в копейках (т.к. фронт показывает рубли — делим на 100 при выводе),
# а здесь храним как целое для точности.
PLAN_PRICES_RUB: dict[str, int] = {
    "solo":         9900,
    "basic":        9900,
    "professional": 24900,
    "network":      29900,
    "enterprise":   89900,
}


def _plan_price(plan: str | None) -> int:
    if not plan:
        return 0
    key = plan.lower().strip()
    return PLAN_PRICES_RUB.get(key, 0)


def _month_label(d: datetime | date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(year, month, 1)
    end = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    return start, end


def _last_n_months(n: int, anchor: datetime | None = None) -> list[tuple[int, int]]:
    """Возвращает список (year, month) за последние n месяцев включая текущий."""
    anchor = anchor or datetime.utcnow()
    y, m = anchor.year, anchor.month
    out: list[tuple[int, int]] = []
    for i in range(n - 1, -1, -1):
        mm = m - i
        yy = y
        while mm <= 0:
            mm += 12
            yy -= 1
        out.append((yy, mm))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# ФИЧА 1: MRR / ARR Dashboard
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/mrr")
async def analytics_mrr(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """MRR / ARR с разбивкой по планам и трендом 12 месяцев.

    Источник данных:
      • subscriptions (status=active) — приоритетный источник.
      • если subscriptions пуст — derive из tenant_licenses.plan × PLAN_PRICES_RUB.
    """
    # ── Попытка #1: реальные subscriptions ──────────────────────────────────
    subs_rows = (await db.execute(
        select(Subscription.plan, Subscription.billing_cycle, Subscription.amount_per_period)
        .where(Subscription.status == SubStatus.ACTIVE)
    )).all()

    source = "subscriptions"
    by_plan_map: dict[str, dict[str, float]] = {}
    mrr_total = 0.0

    if subs_rows:
        for plan, cycle, amt in subs_rows:
            amt_f = float(amt or 0)
            monthly = amt_f / 12.0 if cycle == "annual" else amt_f
            mrr_total += monthly
            entry = by_plan_map.setdefault(plan or "unknown", {"plan": plan or "unknown", "tenants": 0, "mrr": 0.0})
            entry["tenants"] += 1
            entry["mrr"] += monthly
    else:
        # ── Попытка #2: derive из tenant_licenses ───────────────────────────
        source = "derived"
        lic_rows = (await db.execute(
            select(TenantLicense.plan, func.count(TenantLicense.id))
            .join(Tenant, Tenant.id == TenantLicense.tenant_id)
            .where(
                TenantLicense.is_active == True,
                Tenant.is_active == True,
                Tenant.churned_at.is_(None),
            )
            .group_by(TenantLicense.plan)
        )).all()
        for plan, cnt in lic_rows:
            price = _plan_price(plan)
            n = int(cnt or 0)
            monthly = price * n
            mrr_total += monthly
            by_plan_map[plan or "unknown"] = {
                "plan": plan or "unknown",
                "tenants": n,
                "mrr": monthly,
            }

    arr_total = mrr_total * 12.0

    # ── Тренд 12 месяцев ─────────────────────────────────────────────────────
    # Для исторических месяцев берём активные подписки на конец месяца:
    # subscription.created_at <= month_end AND (cancelled_at IS NULL OR cancelled_at >= month_end).
    # Если subscriptions нет — derive: count активных tenants на конец месяца × средняя цена плана.
    trend: list[dict[str, Any]] = []
    months = _last_n_months(12)

    if source == "subscriptions":
        for yy, mm in months:
            _, m_end = _month_bounds(yy, mm)
            rows = (await db.execute(
                select(Subscription.billing_cycle, Subscription.amount_per_period)
                .where(
                    Subscription.created_at < m_end,
                    (Subscription.cancelled_at.is_(None)) | (Subscription.cancelled_at >= m_end),
                )
            )).all()
            month_mrr = 0.0
            for cycle, amt in rows:
                amt_f = float(amt or 0)
                month_mrr += amt_f / 12.0 if cycle == "annual" else amt_f
            trend.append({"month": f"{yy:04d}-{mm:02d}", "mrr": round(month_mrr, 2)})
    else:
        # Derived: считаем по tenants активным на конец месяца с предположением
        # текущего плана (исторические планы не сохраняются на нашей стороне).
        # Берём план из tenant_licenses (last known) — апроксимация.
        all_tenants = (await db.execute(
            select(Tenant.id, Tenant.created_at, Tenant.churned_at, TenantLicense.plan)
            .outerjoin(TenantLicense, TenantLicense.tenant_id == Tenant.id)
        )).all()
        for yy, mm in months:
            _, m_end = _month_bounds(yy, mm)
            month_mrr = 0.0
            for tid, created, churned, plan in all_tenants:
                if created and created >= m_end:
                    continue
                if churned and churned < m_end:
                    continue
                month_mrr += _plan_price(plan)
            trend.append({"month": f"{yy:04d}-{mm:02d}", "mrr": round(month_mrr, 2)})

    # ── Прирост MoM (для удобства фронта) ────────────────────────────────────
    growth_mom_pct = 0.0
    if len(trend) >= 2:
        prev = trend[-2]["mrr"]
        curr = trend[-1]["mrr"]
        if prev > 0:
            growth_mom_pct = round((curr - prev) / prev * 100, 2)
        elif curr > 0:
            growth_mom_pct = 100.0

    # ── Average LTV (грубо: MRR / churn_rate за 12 мес) ──────────────────────
    avg_ltv = 0.0
    try:
        active_count = (await db.execute(
            select(func.count(Tenant.id)).where(
                Tenant.is_active == True, Tenant.churned_at.is_(None)
            )
        )).scalar() or 0
        churned_12m = (await db.execute(
            sa_text(
                "SELECT COUNT(*) FROM tenants "
                "WHERE churned_at IS NOT NULL "
                "AND churned_at >= :since"
            ),
            {"since": datetime.utcnow() - timedelta(days=365)},
        )).scalar() or 0
        arpu = (mrr_total / active_count) if active_count else 0.0
        # Простая LTV-формула: ARPU / monthly_churn (~ ARPU × 12 / churn%)
        if active_count and churned_12m:
            monthly_churn = (churned_12m / 12) / active_count
            if monthly_churn > 0:
                avg_ltv = round(arpu / monthly_churn, 2)
            else:
                avg_ltv = round(arpu * 24, 2)
        elif active_count:
            # Нет оттока — оценка по умолчанию 24 мес LTV
            avg_ltv = round(arpu * 24, 2)
    except Exception:
        avg_ltv = 0.0

    by_plan = sorted(by_plan_map.values(), key=lambda x: -x["mrr"])
    for entry in by_plan:
        entry["mrr"] = round(entry["mrr"], 2)

    return {
        "mrr_total": round(mrr_total, 2),
        "arr_total": round(arr_total, 2),
        "growth_mom_pct": growth_mom_pct,
        "avg_ltv": avg_ltv,
        "by_plan": by_plan,
        "trend_12m": trend,
        "source": source,
    }


# ─────────────────────────────────────────────────────────────────────────────
# ФИЧА 2: Churn Dashboard
# ─────────────────────────────────────────────────────────────────────────────

VOLUNTARY_REASONS = {"downgrade", "voluntary"}
INVOLUNTARY_REASONS = {"not_renewed", "hard_delete", "payment_failed", "non_payment"}


@router.get("/churn")
async def analytics_churn(
    period: str = Query("last_6m", regex=r"^(last_3m|last_6m|last_12m)$"),
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Churn dashboard.

    period: last_3m | last_6m | last_12m
    Возвращает помесячный churn rate, разбивку по причинам и voluntary/involuntary.
    """
    months_count = {"last_3m": 3, "last_6m": 6, "last_12m": 12}[period]
    months = _last_n_months(months_count)

    monthly: list[dict[str, Any]] = []
    total_churned = 0
    reasons_acc: dict[str, int] = {}

    for yy, mm in months:
        m_start, m_end = _month_bounds(yy, mm)

        # активных на начало месяца
        active_q = await db.execute(
            sa_text(
                "SELECT COUNT(*) FROM tenants "
                "WHERE created_at < :ms "
                "AND (churned_at IS NULL OR churned_at >= :ms)"
            ),
            {"ms": m_start},
        )
        active_n = int(active_q.scalar() or 0)

        # отчурненные в месяце
        churned_q = await db.execute(
            sa_text(
                "SELECT churn_reason, COUNT(*) FROM tenants "
                "WHERE churned_at IS NOT NULL "
                "AND churned_at >= :ms AND churned_at < :me "
                "GROUP BY churn_reason"
            ),
            {"ms": m_start, "me": m_end},
        )
        month_total = 0
        for reason, cnt in churned_q.all():
            c = int(cnt or 0)
            month_total += c
            key = reason or "unknown"
            reasons_acc[key] = reasons_acc.get(key, 0) + c

        total_churned += month_total
        rate = round((month_total / active_n) * 100, 2) if active_n else 0.0
        monthly.append({
            "month": f"{yy:04d}-{mm:02d}",
            "rate": rate,
            "churned": month_total,
            "total": active_n,
        })

    by_reason = sorted(
        [{"reason": k, "count": v} for k, v in reasons_acc.items()],
        key=lambda x: -x["count"],
    )

    voluntary = sum(v for k, v in reasons_acc.items() if k in VOLUNTARY_REASONS)
    involuntary = sum(v for k, v in reasons_acc.items() if k in INVOLUNTARY_REASONS)
    classified = voluntary + involuntary
    if classified > 0:
        voluntary_pct = round(voluntary * 100 / classified, 1)
        involuntary_pct = round(involuntary * 100 / classified, 1)
    else:
        voluntary_pct = involuntary_pct = 0.0

    # MoM change
    mom_change_pp = 0.0
    if len(monthly) >= 2:
        mom_change_pp = round(monthly[-1]["rate"] - monthly[-2]["rate"], 2)

    # Revenue lost = total_churned × avg MRR per tenant (грубо)
    revenue_lost = 0
    try:
        active_now = (await db.execute(
            select(func.count(Tenant.id)).where(
                Tenant.is_active == True, Tenant.churned_at.is_(None)
            )
        )).scalar() or 0
        mrr_total = 0.0
        for plan, cnt in (await db.execute(
            select(TenantLicense.plan, func.count(TenantLicense.id))
            .join(Tenant, Tenant.id == TenantLicense.tenant_id)
            .where(Tenant.is_active == True, Tenant.churned_at.is_(None))
            .group_by(TenantLicense.plan)
        )).all():
            mrr_total += _plan_price(plan) * int(cnt or 0)
        arpu = (mrr_total / active_now) if active_now else 0
        revenue_lost = int(arpu * total_churned)
    except Exception:
        revenue_lost = 0

    has_data = total_churned > 0
    return {
        "period": period,
        "monthly_churn_rate": monthly,
        "by_reason": by_reason,
        "voluntary_pct": voluntary_pct,
        "involuntary_pct": involuntary_pct,
        "current_rate": monthly[-1]["rate"] if monthly else 0.0,
        "mom_change_pp": mom_change_pp,
        "total_churned": total_churned,
        "revenue_lost": revenue_lost,
        "note": None if has_data else "no data yet",
    }


# ─────────────────────────────────────────────────────────────────────────────
# ФИЧА 3: Tenant Health Score
# ─────────────────────────────────────────────────────────────────────────────

# Веса согласно ТЗ: 30 + 30 + 20 + 20 = 100
W_USERS = 30
W_BOOKINGS = 30
W_PAYMENTS = 20
W_TTV = 20


def _color_for_score(score: float) -> str:
    if score >= 70:
        return "green"
    if score >= 40:
        return "yellow"
    return "red"


async def _compute_simple_health(tenant: Tenant, db: AsyncSession) -> dict[str, Any]:
    """Композитный health-score по упрощённой формуле из ТЗ (max=100)."""
    now = datetime.utcnow()
    period_30 = now - timedelta(days=30)
    tid = tenant.id

    # ── 1. Активные пользователи 30д (audit_log distinct actor) ──────────────
    active_users = int((await db.execute(
        sa_text(
            "SELECT COUNT(DISTINCT actor_id) FROM audit_log "
            "WHERE tenant_id = :tid AND created_at > :since AND actor_id IS NOT NULL"
        ),
        {"tid": str(tid), "since": period_30},
    )).scalar() or 0)

    if active_users > 5:
        users_score = W_USERS
    elif active_users >= 3:
        users_score = 20
    elif active_users >= 1:
        users_score = 10
    else:
        users_score = 0

    # ── 2. Записи в booking за 30д (appointments) ────────────────────────────
    bookings = int((await db.execute(
        sa_text(
            "SELECT COUNT(*) FROM appointments "
            "WHERE tenant_id = :tid AND created_at > :since"
        ),
        {"tid": str(tid), "since": period_30},
    )).scalar() or 0)

    if bookings > 50:
        bookings_score = W_BOOKINGS
    elif bookings >= 20:
        bookings_score = 20
    elif bookings >= 5:
        bookings_score = 10
    else:
        bookings_score = 0

    # ── 3. % оплаченных счетов (invoices) ────────────────────────────────────
    inv_row = (await db.execute(
        sa_text(
            "SELECT "
            "  COUNT(*) FILTER (WHERE status='paid') AS paid, "
            "  COUNT(*) AS total "
            "FROM invoices WHERE tenant_id = :tid AND created_at > :since"
        ),
        {"tid": str(tid), "since": period_30},
    )).first()
    paid_n = int(inv_row.paid or 0) if inv_row else 0
    inv_total = int(inv_row.total or 0) if inv_row else 0

    if inv_total > 0:
        paid_pct = (paid_n / inv_total) * 100
        if paid_pct > 80:
            payments_score = W_PAYMENTS
        elif paid_pct >= 50:
            payments_score = 10
        else:
            payments_score = 0
        payments_pct = round(paid_pct, 1)
    else:
        # Если invoices нет — отдаём 0 баллов, но передаём флаг no_invoices
        payments_score = 0
        payments_pct = None

    # ── 4. TTV (возраст после онбординга) ────────────────────────────────────
    days_since_create = (now - tenant.created_at).days if tenant.created_at else 0
    total_bookings_ever = int((await db.execute(
        sa_text("SELECT COUNT(*) FROM appointments WHERE tenant_id = :tid"),
        {"tid": str(tid)},
    )).scalar() or 0)

    if days_since_create > 14 and total_bookings_ever > 0:
        ttv_score = W_TTV
        ttv_status = "activated"
    else:
        ttv_score = 10
        ttv_status = "newcomer"

    total = users_score + bookings_score + payments_score + ttv_score
    total = max(0, min(100, total))
    color = _color_for_score(total)

    return {
        "score": total,
        "color": color,
        "breakdown": {
            "users": {
                "value": active_users,
                "score": users_score,
                "max": W_USERS,
                "label": "Активные юзеры 30д",
            },
            "bookings": {
                "value": bookings,
                "score": bookings_score,
                "max": W_BOOKINGS,
                "label": "Записи 30д",
            },
            "payments": {
                "value": payments_pct,
                "score": payments_score,
                "max": W_PAYMENTS,
                "paid": paid_n,
                "total": inv_total,
                "label": "% оплаченных счетов 30д",
            },
            "ttv": {
                "value": days_since_create,
                "score": ttv_score,
                "max": W_TTV,
                "status": ttv_status,
                "total_bookings": total_bookings_ever,
                "label": "Time-to-value",
            },
        },
    }


@router.get("/tenant-health")
async def tenant_health_list(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Список тенантов с health_score (для таблицы вкладки Health)."""
    res = await db.execute(
        select(Tenant, TenantLicense.plan)
        .outerjoin(TenantLicense, TenantLicense.tenant_id == Tenant.id)
        .where(Tenant.is_active == True, Tenant.churned_at.is_(None))
        .order_by(Tenant.created_at.desc())
    )
    out: list[dict[str, Any]] = []
    for tenant, plan in res.all():
        h = await _compute_simple_health(tenant, db)
        out.append({
            "tenant_id": str(tenant.id),
            "name": tenant.name,
            "slug": tenant.slug,
            "plan": plan or "—",
            "score": h["score"],
            "color": h["color"],
            "breakdown": h["breakdown"],
            "created_at": tenant.created_at.isoformat() if tenant.created_at else None,
        })
    return out


@router.get("/tenant-health/{tenant_id}")
async def tenant_health_detail(
    tenant_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Детальная разбивка health одного тенанта."""
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Тенант не найден")

    lic_row = (await db.execute(
        select(TenantLicense.plan).where(TenantLicense.tenant_id == tenant_id)
    )).first()
    plan = lic_row[0] if lic_row else None

    h = await _compute_simple_health(tenant, db)
    return {
        "tenant_id": str(tenant.id),
        "name": tenant.name,
        "slug": tenant.slug,
        "plan": plan or "—",
        "score": h["score"],
        "color": h["color"],
        "breakdown": h["breakdown"],
        "created_at": tenant.created_at.isoformat() if tenant.created_at else None,
        "churned_at": tenant.churned_at.isoformat() if tenant.churned_at else None,
    }
