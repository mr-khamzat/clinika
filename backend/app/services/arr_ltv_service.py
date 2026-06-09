"""
ARR / Cohort LTV / Forecast — сервисный слой расширенной финансовой аналитики
для super_admin.

Зачем нужен этот сервис:
  • AdminAnalytics уже отдаёт MRR (см. routers/admin_analytics.py /mrr) — здесь
    мы НЕ дублируем расчёт, а расширяем картину тремя срезами:
      1) ARR  = MRR × 12 + сумма годовых подписок, нормализованная.
      2) Cohort LTV — retention-матрица по месяцу первой подписки тенанта.
      3) LTV summary (avg / median / p90 / by_plan) — поверх billing_ledger
         с фоллбэком на MRR × месяцев активности.

Источники данных (только то, что уже существует):
  • subscriptions          — статус, billing_cycle, amount_per_period, created_at,
                              cancelled_at, plan, tenant_id.
  • billing_ledger         — фактические доходы (PLATFORM_INCOME / SUBSCRIPTION_CHARGE
                              / PAYMENT_RECEIVED).
  • tenants                — is_active, churned_at, created_at (для фоллбэка
                              кохорты, если у тенанта нет subscriptions).

Все расчёты выполняются on-the-fly (БЕЗ новой таблицы mrr_history): объём
данных платформы (несколько сотен тенантов) позволяет считать в реалтайме за
секунды. Если в будущем потребуется снимок — добавим миграцию arrltv01.
"""
from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import datetime, date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant import Tenant
from app.models.billing import Subscription, SubStatus
from app.models.billing_ledger import BillingLedger, EntryType, Direction


# ── Helpers ──────────────────────────────────────────────────────────────────

def _month_key(d: datetime | date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _add_months(d: date, n: int) -> date:
    """Возвращает date, сдвинутую на n месяцев от d (без учёта дней — берём 1)."""
    y = d.year + (d.month - 1 + n) // 12
    m = (d.month - 1 + n) % 12 + 1
    return date(y, m, 1)


def _months_between(a: date, b: date) -> int:
    """Количество полных месяцев между a и b (a <= b). Возвращает >= 0."""
    if a > b:
        return 0
    return (b.year - a.year) * 12 + (b.month - a.month)


def _to_float(x: Any) -> float:
    if x is None:
        return 0.0
    if isinstance(x, Decimal):
        return float(x)
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _monthly_amount(billing_cycle: str | None, amount_per_period: Any) -> float:
    """Нормализуем sumма_per_period к месяцу (annual / 12)."""
    amt = _to_float(amount_per_period)
    if (billing_cycle or "").lower() == "annual":
        return amt / 12.0
    return amt


# ── 1) ARR ────────────────────────────────────────────────────────────────────

async def compute_arr(db: AsyncSession) -> dict[str, Any]:
    """
    ARR = MRR × 12 + (annual_subs_amount, уже посчитанный как годовой) поправка.

    Реализация:
      • Берём активные подписки (status=active).
      • monthly_part  = sum(amount_per_period для cycle != 'annual')
      • annual_part   = sum(amount_per_period для cycle == 'annual')   ← уже годовой
      • mrr_rub       = monthly_part + annual_part / 12.0
      • arr_rub       = monthly_part × 12 + annual_part
      • total_active_tenants = distinct tenant_id среди активных подписок.

    Если активных подписок нет — возвращаем нули (фронт получает консистентный
    JSON, AdminLayout рендерит "—").
    """
    rows = (
        await db.execute(
            select(
                Subscription.tenant_id,
                Subscription.billing_cycle,
                Subscription.amount_per_period,
            ).where(Subscription.status == SubStatus.ACTIVE)
        )
    ).all()

    monthly_part = 0.0
    annual_part = 0.0
    tenant_ids: set = set()

    for tid, cycle, amt in rows:
        amt_f = _to_float(amt)
        if tid is not None:
            tenant_ids.add(tid)
        if (cycle or "").lower() == "annual":
            annual_part += amt_f
        else:
            monthly_part += amt_f

    mrr_rub = monthly_part + annual_part / 12.0
    arr_rub = monthly_part * 12.0 + annual_part

    return {
        "arr_rub": round(arr_rub, 2),
        "mrr_rub": round(mrr_rub, 2),
        "annual_subs_rub": round(annual_part, 2),
        "monthly_subs_rub": round(monthly_part, 2),
        "total_active_tenants": len(tenant_ids),
    }


# ── 2) Cohort LTV ─────────────────────────────────────────────────────────────

async def compute_cohort_ltv(db: AsyncSession, cohort_months: int = 12) -> list[dict[str, Any]]:
    """
    Retention-матрица по кохортам "месяц первой подписки".

    Алгоритм:
      1) Для каждого тенанта → его первая подписка (min created_at) → cohort_key
         (YYYY-MM). Если у тенанта нет subscriptions — пропускаем (он не платил).
      2) Активен ли тенант X в месяце M:
            EXISTS(subscription where created_at < end(M) AND
                                       (cancelled_at IS NULL OR cancelled_at >= start(M)))
         Для производительности берём ВСЕ подписки разом и проверяем in-memory.
      3) retention[i] = % тенантов кохорты, активных в (cohort + i месяцев).
         retention[0] = 100% по определению.
      4) avg_revenue_total — средний платёж тенанта кохорты, рассчитанный как:
            avg_monthly_amount × месяцев_активности_тенанта (по subscriptions).
         Это аппроксимация — для точной цифры берём LTV из billing_ledger в
         compute_ltv_summary; здесь важна динамика retention.

    Возвращаем последние cohort_months кохорт (по умолчанию 12).
    """
    # Загружаем все подписки за разумный период (1.5 × cohort_months назад).
    today = date.today()
    horizon_start = _add_months(date(today.year, today.month, 1), -(cohort_months + 1))

    subs = (
        await db.execute(
            select(
                Subscription.tenant_id,
                Subscription.created_at,
                Subscription.cancelled_at,
                Subscription.amount_per_period,
                Subscription.billing_cycle,
            )
        )
    ).all()

    # Группируем по тенантам и берём первую (по created_at) подписку.
    per_tenant: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for tid, created, cancelled, amt, cycle in subs:
        if tid is None or created is None:
            continue
        per_tenant[tid].append(
            {
                "created": created,
                "cancelled": cancelled,
                "monthly": _monthly_amount(cycle, amt),
            }
        )

    # Какие месяцы рендерим (от старого к новому).
    cohort_keys: list[date] = []
    for i in range(cohort_months, 0, -1):
        cohort_keys.append(_add_months(date(today.year, today.month, 1), -i + 1))
    # Уникальный список, отсортированный.
    cohort_keys = sorted(set(cohort_keys))

    # Группировка тенантов по кохорте (= первый месяц подписки).
    cohort_tenants: dict[str, list[Any]] = defaultdict(list)
    tenant_first_month: dict[Any, date] = {}
    tenant_total_revenue: dict[Any, float] = {}

    for tid, items in per_tenant.items():
        items_sorted = sorted(items, key=lambda x: x["created"])
        first = items_sorted[0]["created"]
        if isinstance(first, datetime):
            first_date = first.date()
        else:
            first_date = first
        first_month = date(first_date.year, first_date.month, 1)
        if first_month < horizon_start:
            continue  # тенант старше окна — не учитываем в матрице
        ck = _month_key(first_month)
        cohort_tenants[ck].append(tid)
        tenant_first_month[tid] = first_month

        # Грубая оценка выручки тенанта: средний monthly × месяцев активности
        # последней подписки.
        last = items_sorted[-1]
        last_created = last["created"].date() if isinstance(last["created"], datetime) else last["created"]
        last_cancel = last["cancelled"]
        if last_cancel is None:
            end_d = today
        else:
            end_d = last_cancel.date() if isinstance(last_cancel, datetime) else last_cancel
        months_alive = max(1, _months_between(last_created, end_d) + 1)
        tenant_total_revenue[tid] = last["monthly"] * months_alive

    # Считаем retention для каждой кохорты.
    # Для каждого тенанта определяем, в каких месяцах он был активен.
    def tenant_active_in_month(tid: Any, month_start: date) -> bool:
        month_end = _add_months(month_start, 1)
        for it in per_tenant.get(tid, []):
            c = it["created"]
            c_d = c.date() if isinstance(c, datetime) else c
            if c_d >= month_end:
                continue
            cancel = it["cancelled"]
            if cancel is None:
                return True
            cancel_d = cancel.date() if isinstance(cancel, datetime) else cancel
            if cancel_d >= month_start:
                return True
        return False

    result: list[dict[str, Any]] = []
    for cohort_month in cohort_keys:
        ck = _month_key(cohort_month)
        tenants = cohort_tenants.get(ck, [])
        n = len(tenants)
        retention: list[float] = []
        # Сколько месяцев "вперёд" умещается до сегодня.
        max_step = _months_between(cohort_month, date(today.year, today.month, 1))
        for step in range(0, max_step + 1):
            m_start = _add_months(cohort_month, step)
            if n == 0:
                retention.append(0.0)
                continue
            active = sum(1 for tid in tenants if tenant_active_in_month(tid, m_start))
            retention.append(round(active * 100.0 / n, 1))

        avg_revenue = (
            sum(tenant_total_revenue.get(tid, 0.0) for tid in tenants) / n if n else 0.0
        )
        result.append(
            {
                "cohort": ck,
                "tenants": n,
                "retention": retention,
                "avg_revenue": round(avg_revenue, 2),
            }
        )

    return result


# ── 3) LTV Summary ────────────────────────────────────────────────────────────

async def compute_ltv_summary(db: AsyncSession) -> dict[str, Any]:
    """
    LTV per tenant:
      приоритет — суммарные PLATFORM_INCOME + SUBSCRIPTION_CHARGE (direction=credit)
      из billing_ledger по tenant_id.
      Фоллбэк (если в ledger нет записей по тенанту) — MRR × месяцев активности.

    Возвращает:
      {avg_ltv, median_ltv, p90_ltv, sample_size, by_plan: [{plan, avg_ltv, tenants}], source}
    """
    # ── 1) Тенант → его LTV из ledger ───────────────────────────────────────
    ledger_rows = (
        await db.execute(
            select(BillingLedger.tenant_id, func.sum(BillingLedger.amount))
            .where(
                BillingLedger.direction == Direction.CREDIT,
                BillingLedger.entry_type.in_(
                    [
                        EntryType.PLATFORM_INCOME,
                        EntryType.SUBSCRIPTION_CHARGE,
                        EntryType.PAYMENT_RECEIVED,
                    ]
                ),
                BillingLedger.tenant_id.is_not(None),
            )
            .group_by(BillingLedger.tenant_id)
        )
    ).all()

    ledger_ltv: dict[Any, float] = {tid: _to_float(amt) for tid, amt in ledger_rows}

    # ── 2) Все подписки → план + monthly для фоллбэка и by_plan ─────────────
    subs = (
        await db.execute(
            select(
                Subscription.tenant_id,
                Subscription.plan,
                Subscription.billing_cycle,
                Subscription.amount_per_period,
                Subscription.created_at,
                Subscription.cancelled_at,
            )
        )
    ).all()

    today = date.today()
    today_month = date(today.year, today.month, 1)

    per_tenant: dict[Any, dict[str, Any]] = {}
    for tid, plan, cycle, amt, created, cancelled in subs:
        if tid is None:
            continue
        monthly = _monthly_amount(cycle, amt)
        created_d = created.date() if isinstance(created, datetime) else created
        cancelled_d = (
            cancelled.date() if isinstance(cancelled, datetime) else cancelled
        )
        end_d = cancelled_d if cancelled_d else today
        months_alive = max(1, _months_between(created_d, end_d) + 1) if created_d else 1
        # Берём последнюю подписку как репрезентативную (plan + monthly).
        cur = per_tenant.get(tid)
        if cur is None or (created_d and cur.get("created") and created_d > cur["created"]):
            per_tenant[tid] = {
                "plan": plan or "unknown",
                "monthly": monthly,
                "months_alive": months_alive,
                "created": created_d,
                "fallback_ltv": monthly * months_alive,
            }

    # ── 3) Итоговый LTV по тенанту: ledger > fallback ───────────────────────
    ltvs: list[float] = []
    by_plan_acc: dict[str, dict[str, float]] = defaultdict(
        lambda: {"sum": 0.0, "n": 0}
    )
    source = "ledger" if ledger_ltv else "fallback"

    all_tids = set(per_tenant.keys()) | set(ledger_ltv.keys())
    for tid in all_tids:
        if tid in ledger_ltv:
            v = ledger_ltv[tid]
        else:
            v = per_tenant.get(tid, {}).get("fallback_ltv", 0.0)
        if v <= 0:
            continue
        ltvs.append(v)
        plan = per_tenant.get(tid, {}).get("plan", "unknown")
        by_plan_acc[plan]["sum"] += v
        by_plan_acc[plan]["n"] += 1

    def _percentile(values: list[float], p: float) -> float:
        if not values:
            return 0.0
        s = sorted(values)
        # numpy-style linear, безопасно для маленьких выборок.
        k = (len(s) - 1) * p
        f = int(k)
        c = min(f + 1, len(s) - 1)
        if f == c:
            return s[f]
        return s[f] + (s[c] - s[f]) * (k - f)

    avg_ltv = round(sum(ltvs) / len(ltvs), 2) if ltvs else 0.0
    median_ltv = round(statistics.median(ltvs), 2) if ltvs else 0.0
    p90_ltv = round(_percentile(ltvs, 0.9), 2)

    by_plan = [
        {
            "plan": plan,
            "avg_ltv": round(acc["sum"] / acc["n"], 2) if acc["n"] else 0.0,
            "tenants": acc["n"],
        }
        for plan, acc in sorted(by_plan_acc.items(), key=lambda kv: -kv[1]["sum"])
    ]

    return {
        "avg_ltv": avg_ltv,
        "median_ltv": median_ltv,
        "p90_ltv": p90_ltv,
        "sample_size": len(ltvs),
        "by_plan": by_plan,
        "source": source,
    }


# ── 4) Forecast (линейная регрессия по MRR-тренду) ────────────────────────────

def _linear_regression(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """Возвращает (slope, intercept) для y = slope*x + intercept по МНК."""
    n = len(xs)
    if n < 2:
        return 0.0, (ys[0] if ys else 0.0)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    num = sum((xs[i] - mean_x) * (ys[i] - mean_y) for i in range(n))
    den = sum((xs[i] - mean_x) ** 2 for i in range(n))
    if den == 0:
        return 0.0, mean_y
    slope = num / den
    intercept = mean_y - slope * mean_x
    return slope, intercept


async def compute_mrr_history(db: AsyncSession, months: int = 12) -> list[dict[str, Any]]:
    """
    История MRR по месяцам — для тренда и линейной регрессии.

    MRR(M) = сумма monthly_amount активных подписок на конец месяца M, где
    "активная" означает created_at < end(M) AND (cancelled_at IS NULL OR cancelled_at >= end(M)).
    """
    today = date.today()
    today_month = date(today.year, today.month, 1)
    keys = [_add_months(today_month, -i) for i in range(months - 1, -1, -1)]

    subs = (
        await db.execute(
            select(
                Subscription.billing_cycle,
                Subscription.amount_per_period,
                Subscription.created_at,
                Subscription.cancelled_at,
            )
        )
    ).all()

    history: list[dict[str, Any]] = []
    for month_start in keys:
        month_end = _add_months(month_start, 1)
        total = 0.0
        for cycle, amt, created, cancelled in subs:
            if created is None:
                continue
            c_d = created.date() if isinstance(created, datetime) else created
            if c_d >= month_end:
                continue
            if cancelled is not None:
                cancel_d = cancelled.date() if isinstance(cancelled, datetime) else cancelled
                if cancel_d < month_end:
                    continue
            total += _monthly_amount(cycle, amt)
        history.append({"month": _month_key(month_start), "mrr": round(total, 2)})
    return history


async def compute_forecast(
    db: AsyncSession, months_ahead: int = 6, window: int = 12
) -> dict[str, Any]:
    """
    Простой прогноз MRR на N месяцев вперёд по линейной регрессии последних
    `window` точек истории.

    Возвращает:
      {
        history:  [{month, mrr}, ...],          # фактическая история
        forecast: [{month, mrr_forecast}, ...], # прогноз
        slope:    float,                        # рублей/месяц
        confidence: 'low'|'medium'|'high',      # эвристика по R²
      }
    """
    history = await compute_mrr_history(db, months=max(window, 3))
    if not history:
        return {"history": [], "forecast": [], "slope": 0.0, "confidence": "low"}

    xs = list(range(len(history)))
    ys = [pt["mrr"] for pt in history]
    slope, intercept = _linear_regression([float(x) for x in xs], ys)

    # R² для оценки уверенности.
    mean_y = sum(ys) / len(ys)
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    ss_res = sum((ys[i] - (slope * xs[i] + intercept)) ** 2 for i in range(len(ys)))
    r2 = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    if r2 >= 0.7:
        confidence = "high"
    elif r2 >= 0.4:
        confidence = "medium"
    else:
        confidence = "low"

    # Прогноз: продолжаем индексы.
    today = date.today()
    today_month = date(today.year, today.month, 1)
    forecast: list[dict[str, Any]] = []
    for i in range(1, months_ahead + 1):
        x = len(history) - 1 + i
        y = slope * x + intercept
        # Не позволяем уйти ниже нуля — для UX.
        y = max(0.0, y)
        m = _add_months(today_month, i)
        forecast.append({"month": _month_key(m), "mrr_forecast": round(y, 2)})

    return {
        "history": history,
        "forecast": forecast,
        "slope": round(slope, 2),
        "confidence": confidence,
        "r2": round(r2, 3),
    }
