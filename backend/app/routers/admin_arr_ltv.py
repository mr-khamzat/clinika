"""
Admin ARR / LTV — расширенная финансовая аналитика для super_admin.

Префикс: /admin/arr-ltv
Endpoints:
  • GET /summary            — ARR, MRR, total_active, MoM growth (%)
  • GET /cohorts?months=12  — retention-матрица по кохортам подписок
  • GET /ltv                — avg / median / p90 LTV + разбивка по плану
  • GET /forecast?months_ahead=6 — линейный прогноз MRR на N месяцев

Все endpoints закрыты require_super_admin (403 для остальных ролей).

Полностью read-only, не пишет в БД, не имеет фоновых задач — поэтому в
main.py регистрируется как обычный include_router (см. TODO в отчёте).

Существующий /admin/analytics/mrr (admin_analytics.py) НЕ затрагивает.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_super_admin
from app.models.user import User
from app.services.arr_ltv_service import (
    compute_arr,
    compute_cohort_ltv,
    compute_ltv_summary,
    compute_forecast,
    compute_mrr_history,
)

router = APIRouter(prefix="/admin/arr-ltv", tags=["admin-arr-ltv"])


# ── 1) Summary: ARR + MRR + MoM ───────────────────────────────────────────────

@router.get("/summary")
async def arr_ltv_summary(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Сводка ARR/MRR + MoM-рост.

    MoM рост = (mrr_current - mrr_prev) / mrr_prev × 100. Если prev = 0 —
    возвращаем None (фронт показывает "—").
    """
    arr = await compute_arr(db)
    history = await compute_mrr_history(db, months=2)

    mom_growth_pct: float | None = None
    if len(history) >= 2:
        prev = history[-2]["mrr"]
        curr = history[-1]["mrr"]
        if prev > 0:
            mom_growth_pct = round((curr - prev) * 100.0 / prev, 2)

    return {
        **arr,
        "mom_growth_pct": mom_growth_pct,
        "history_tail": history,
    }


# ── 2) Cohorts: retention-матрица ─────────────────────────────────────────────

@router.get("/cohorts")
async def arr_ltv_cohorts(
    months: int = Query(12, ge=1, le=36, description="Сколько последних кохорт показывать"),
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Retention-матрица: [{cohort, tenants, retention:[%...], avg_revenue}, ...]."""
    cohorts = await compute_cohort_ltv(db, cohort_months=months)
    return {"cohorts": cohorts, "months": months}


# ── 3) LTV summary ───────────────────────────────────────────────────────────

@router.get("/ltv")
async def arr_ltv_summary_ltv(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """LTV: avg / median / p90 + by_plan + source ('ledger' | 'fallback')."""
    return await compute_ltv_summary(db)


# ── 4) Forecast ──────────────────────────────────────────────────────────────

@router.get("/forecast")
async def arr_ltv_forecast(
    months_ahead: int = Query(6, ge=1, le=24, description="На сколько месяцев вперёд"),
    window: int = Query(12, ge=3, le=36, description="Окно регрессии (последние N месяцев истории)"),
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Линейная регрессия по последним `window` точкам → прогноз на `months_ahead`."""
    return await compute_forecast(db, months_ahead=months_ahead, window=window)
