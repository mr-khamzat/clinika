# ===== БЛОК: Manager Cost Forecast (Глава 4) =====
# GET /manager/analytics/cost-forecast — прогноз расходов клиники.
#
# Источники расходов:
#   • bonuses             — выплаченные/начисленные бонусы (модель Bonus)
#   • salaries            — если есть recruiter_bonus / salary-сущность,
#                           используем; иначе available_categories отметит отсутствие
#   • supplies (writeoff) — InventoryMovement с типами WRITE_OFF/OUTGOING/EXPIRED
#
# Прогноз без statsmodels:
#   • группировка по месяцам (12 последних);
#   • тренд = LSQ-аппроксимация y = a*x + b (метод наименьших квадратов);
#   • месячная сезонность = доля каждого месяца от среднего;
#   • forecast = (a*future_x + b) * seasonality_for_month;
#   • R² для confidence (low<0.3, medium<0.7, high>=0.7).
#
# Возвращает: history[], forecast[], trend, warning, available_categories.

import uuid
from datetime import datetime, date as _date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_manager
from app.database import get_db
from app.models.bonus import Bonus
from app.models.user import User
from app.routers.manager.clinics_access import resolve_clinic_filter_ids

# Inventory может быть не у всех — пробуем импортнуть
try:
    from app.models.inventory import InventoryMovement, InventoryMovementType, InventoryItem
    _HAS_INVENTORY = True
except Exception:
    _HAS_INVENTORY = False

router = APIRouter(tags=["manager:cost-forecast"])


# ── Утилиты для месячных бакетов ───────────────────────────────────────────
def _month_key(d: datetime | _date) -> str:
    return d.strftime("%Y-%m") if isinstance(d, datetime) else f"{d.year:04d}-{d.month:02d}"


def _add_months(d: _date, n: int) -> _date:
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    return _date(y, m, 1)


def _build_month_axis(months: int) -> list[str]:
    """Возвращает массив YYYY-MM последних `months` месяцев включая текущий."""
    today = _date.today().replace(day=1)
    out = []
    for i in range(months - 1, -1, -1):
        out.append(_month_key(_add_months(today, -i)))
    return out


# ── Простая линейная регрессия y=ax+b ──────────────────────────────────────
def _linreg(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """Возвращает (a, b, r2). xs.len == ys.len."""
    n = len(xs)
    if n < 2:
        return 0.0, (ys[0] if ys else 0.0), 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    den = sum((xs[i] - mx) ** 2 for i in range(n)) or 1e-9
    a = num / den
    b = my - a * mx
    # R²
    ss_tot = sum((y - my) ** 2 for y in ys) or 1e-9
    ss_res = sum((ys[i] - (a * xs[i] + b)) ** 2 for i in range(n))
    r2 = max(0.0, 1.0 - ss_res / ss_tot)
    return a, b, r2


# ── GET /manager/analytics/cost-forecast ───────────────────────────────────
@router.get("/analytics/cost-forecast")
async def cost_forecast(
    clinic_id: Optional[uuid.UUID] = Query(None),
    months_ahead: int = Query(3, ge=1, le=12),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает 12-мес. историю + прогноз на N месяцев."""
    # ── 0. Скоуп клиники ─────────────────────────────────────────────────
    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    # filter_ids == [] — нет доступа, возвращаем пустой ответ
    # filter_ids is None — все клиники тенанта (для franchise_owner/super_admin)

    history_axis = _build_month_axis(12)
    history_map = {m: {"bonuses": 0.0, "salaries": 0.0, "supplies": 0.0} for m in history_axis}
    start_date = _date.fromisoformat(history_axis[0] + "-01")

    available_categories: list[str] = []

    # ── 1. Бонусы ────────────────────────────────────────────────────────
    bonus_filters = [Bonus.created_at >= start_date]
    if current_user.tenant_id is not None:
        bonus_filters.append(Bonus.tenant_id == current_user.tenant_id)

    # Bonus напрямую к clinic не привязан, но через referral.to_clinic.
    # Для упрощения: фильтруем по тенанту. Если клиника указана — джойним через
    # Referral.to_clinic_id.
    from app.models.referral import Referral
    bonus_q = (
        select(
            func.to_char(Bonus.created_at, "YYYY-MM").label("ym"),
            func.coalesce(func.sum(Bonus.amount), 0).label("total"),
        )
        .join(Referral, Referral.id == Bonus.referral_id, isouter=True)
        .where(and_(*bonus_filters))
    )
    if filter_ids is not None and len(filter_ids) > 0:
        bonus_q = bonus_q.where(Referral.to_clinic_id.in_(filter_ids))
    elif filter_ids == []:
        bonus_q = bonus_q.where(False)
    bonus_q = bonus_q.group_by("ym")
    bonus_rows = (await db.execute(bonus_q)).all()
    for ym, total in bonus_rows:
        if ym in history_map:
            history_map[ym]["bonuses"] = float(total or 0)
    available_categories.append("bonuses")

    # ── 2. Зарплаты — пока отдельной модели нет, ставим 0 и помечаем «n/a»
    # (можно расширить когда появится модель SalaryPayment).
    # Не добавляем в available_categories.

    # ── 3. Расходники (inventory writeoffs / outgoing / expired) ─────────
    if _HAS_INVENTORY:
        inv_filters = [
            InventoryMovement.created_at >= start_date,
            InventoryMovement.type.in_([
                InventoryMovementType.WRITE_OFF.value,
                InventoryMovementType.OUTGOING.value,
                InventoryMovementType.EXPIRED.value,
            ]),
        ]
        if current_user.tenant_id is not None:
            inv_filters.append(InventoryMovement.tenant_id == current_user.tenant_id)
        if filter_ids is not None and len(filter_ids) > 0:
            inv_filters.append(InventoryMovement.clinic_id.in_(filter_ids))
        elif filter_ids == []:
            inv_filters.append(InventoryMovement.tenant_id == uuid.UUID(int=0))

        # Стоимость: |quantity| * item.cost_per_unit
        inv_q = (
            select(
                func.to_char(InventoryMovement.created_at, "YYYY-MM").label("ym"),
                func.coalesce(func.sum(
                    func.abs(InventoryMovement.quantity) * InventoryItem.cost_per_unit
                ), 0).label("total"),
            )
            .join(InventoryItem, InventoryItem.id == InventoryMovement.item_id)
            .where(and_(*inv_filters))
            .group_by("ym")
        )
        try:
            inv_rows = (await db.execute(inv_q)).all()
            for ym, total in inv_rows:
                if ym in history_map:
                    history_map[ym]["supplies"] = float(total or 0)
            available_categories.append("supplies")
        except Exception:
            pass

    # ── 4. Собираем history ──────────────────────────────────────────────
    history = []
    totals = []
    for ym in history_axis:
        row = history_map[ym]
        total = row["bonuses"] + row["salaries"] + row["supplies"]
        history.append({
            "month": ym,
            "total_cost": round(total, 2),
            "bonuses":  round(row["bonuses"], 2),
            "salaries": round(row["salaries"], 2),
            "supplies": round(row["supplies"], 2),
        })
        totals.append(total)

    # ── 5. Прогноз ───────────────────────────────────────────────────────
    xs = list(range(len(totals)))   # 0..11
    a, b, r2 = _linreg([float(x) for x in xs], totals)

    avg = (sum(totals) / len(totals)) if totals else 0.0
    # Месячная сезонность (доля от среднего)
    season = [1.0] * 12
    if avg > 0:
        # По индексу month_of_year (Jan=0..Dec=11) усредняем долю
        per_month: dict[int, list[float]] = {}
        for i, ym in enumerate(history_axis):
            mo = int(ym.split("-")[1]) - 1
            per_month.setdefault(mo, []).append(totals[i])
        for mo, vals in per_month.items():
            if vals:
                season[mo] = (sum(vals) / len(vals)) / avg if avg > 0 else 1.0

    # Confidence по R²
    if r2 >= 0.7:
        confidence = "high"
    elif r2 >= 0.3:
        confidence = "medium"
    else:
        confidence = "low"

    # Forecast
    today_first = _date.today().replace(day=1)
    forecast = []
    for i in range(months_ahead):
        fdate = _add_months(today_first, i + 1)
        xi = len(totals) + i  # продолжаем шкалу
        baseline = a * xi + b
        s = season[(fdate.month - 1) % 12]
        predicted = max(0.0, baseline * (s if avg > 0 else 1.0))
        # Доверительный интервал — простая дельта 10% при low, 7% medium, 5% high
        delta = {"low": 0.15, "medium": 0.10, "high": 0.07}[confidence]
        forecast.append({
            "month": _month_key(fdate),
            "predicted_cost": round(predicted, 2),
            "confidence": confidence,
            "range_min": round(predicted * (1 - delta), 2),
            "range_max": round(predicted * (1 + delta), 2),
        })

    # ── 6. Тренд + warning ───────────────────────────────────────────────
    if a > avg * 0.02:
        trend = "growing"
    elif a < -avg * 0.02:
        trend = "declining"
    else:
        trend = "stable"

    warning = None
    if forecast:
        next_predicted = forecast[0]["predicted_cost"]
        if avg > 0 and next_predicted > avg * 1.15:
            pct = round((next_predicted / avg - 1) * 100)
            warning = f"Прогноз на {pct}% выше среднего — проверьте новые расходы"
        elif trend == "growing" and confidence != "low":
            warning = "Тренд расходов растёт — рекомендуем проверить статьи затрат"

    return {
        "history": history,
        "forecast": forecast,
        "trend": trend,
        "warning": warning,
        "available_categories": available_categories,
        "stats": {
            "avg_monthly": round(avg, 2),
            "r2": round(r2, 3),
            "confidence": confidence,
            "trend_slope": round(a, 3),
        },
    }
