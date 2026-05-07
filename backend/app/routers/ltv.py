"""
LTV-аналитика — endpoints модуля ltv_pro.

  GET  /analytics/ltv/patients?clinic_id&limit=100&min_visits=2 — топ по LTV
  GET  /analytics/ltv/cohorts?period=quarter                    — когорты
  GET  /analytics/ltv/summary?clinic_id                         — сводка
  POST /analytics/ltv/recompute?clinic_id                       — принудительный пересчёт

Все требуют:
  - роль manager и выше (require_manager)
  - активную подписку модуля ltv_pro (require_module)
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_manager
from app.core.tenant import get_current_tenant, require_module
from app.database import get_db
from app.models.ltv import PatientLtvSnapshot
from app.models.tenant import Tenant
from app.models.user import User
from app.services.ltv_service import compute_cohorts, compute_ltv_for_clinic

router = APIRouter(prefix="/analytics/ltv", tags=["ltv"])

_mgr = Depends(require_manager)
_mod = Depends(require_module("ltv_pro"))


@router.get("/patients", dependencies=[_mgr, _mod])
async def list_top_patients(
    clinic_id: Optional[uuid.UUID] = Query(None, description="UUID клиники, либо все клиники тенанта"),
    limit: int = Query(100, ge=1, le=500),
    min_visits: int = Query(2, ge=1, description="Минимум визитов для попадания в выборку"),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Топ пациентов по LTV (DESC). Только пациенты с visits_count ≥ min_visits."""
    if tenant is None:
        return []

    q = select(PatientLtvSnapshot).where(
        PatientLtvSnapshot.tenant_id == tenant.id,
        PatientLtvSnapshot.visits_count >= min_visits,
    )
    if clinic_id is not None:
        q = q.where(PatientLtvSnapshot.clinic_id == clinic_id)
    q = q.order_by(PatientLtvSnapshot.ltv_estimate.desc()).limit(limit)

    rows = (await db.execute(q)).scalars().all()
    return [
        {
            "id": str(r.id),
            "patient_phone": r.patient_phone,
            "patient_name": r.patient_name,
            "visits_count": r.visits_count,
            "total_spent": float(r.total_spent or 0),
            "avg_check": float(r.avg_check or 0),
            "ltv_estimate": float(r.ltv_estimate or 0),
            # NetLTV по фактическим оплатам (getPayments). 0 — данные пока недоступны.
            "net_ltv": float(r.net_ltv or 0),
            "visits_per_year": float(r.visits_per_year or 0),
            "first_visit_at": r.first_visit_at.isoformat() if r.first_visit_at else None,
            "last_visit_at": r.last_visit_at.isoformat() if r.last_visit_at else None,
            "cohort_quarter": r.cohort_quarter,
            "churn_risk": r.churn_risk,
            "clinic_id": str(r.clinic_id) if r.clinic_id else None,
        }
        for r in rows
    ]


@router.get("/cohorts", dependencies=[_mgr, _mod])
async def list_cohorts(
    period: str = Query("quarter", pattern="^(quarter)$"),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Сводка по когортам (по умолчанию — квартал первого визита)."""
    if tenant is None:
        return []
    return await compute_cohorts(db, tenant.id, period=period)


@router.get("/summary", dependencies=[_mgr, _mod])
async def get_summary(
    clinic_id: Optional[uuid.UUID] = Query(None),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Общие метрики: avg LTV, avg NetLTV, total patients, churn rate, at-risk."""
    if tenant is None:
        return {
            "total_patients": 0,
            "avg_ltv": 0,
            "avg_net_ltv": 0,
            "total_spent": 0,
            "avg_check": 0,
            "churn_rate": 0,
            "at_risk_patients": 0,
            "last_computed_at": None,
        }

    base = select(
        func.count(PatientLtvSnapshot.id),
        func.coalesce(func.avg(PatientLtvSnapshot.ltv_estimate), 0),
        func.coalesce(func.sum(PatientLtvSnapshot.total_spent), 0),
        func.coalesce(func.avg(PatientLtvSnapshot.avg_check), 0),
        func.max(PatientLtvSnapshot.computed_at),
        # Средний NetLTV считаем только по тем пациентам, у кого net_ltv > 0
        # (т.к. при отсутствии getPayments значение = 0 и оно бы занижало среднее).
        func.coalesce(
            func.avg(
                func.nullif(PatientLtvSnapshot.net_ltv, 0)
            ),
            0,
        ),
    ).where(PatientLtvSnapshot.tenant_id == tenant.id)
    if clinic_id is not None:
        base = base.where(PatientLtvSnapshot.clinic_id == clinic_id)

    row = (await db.execute(base)).one()
    total_patients, avg_ltv, total_spent, avg_check, last_computed, avg_net_ltv = row

    at_risk_q = select(func.count(PatientLtvSnapshot.id)).where(
        PatientLtvSnapshot.tenant_id == tenant.id,
        PatientLtvSnapshot.churn_risk == "high",
    )
    if clinic_id is not None:
        at_risk_q = at_risk_q.where(PatientLtvSnapshot.clinic_id == clinic_id)
    at_risk = int((await db.execute(at_risk_q)).scalar() or 0)

    medium_q = select(func.count(PatientLtvSnapshot.id)).where(
        PatientLtvSnapshot.tenant_id == tenant.id,
        PatientLtvSnapshot.churn_risk == "medium",
    )
    if clinic_id is not None:
        medium_q = medium_q.where(PatientLtvSnapshot.clinic_id == clinic_id)
    medium = int((await db.execute(medium_q)).scalar() or 0)

    total = int(total_patients or 0)
    churn_rate = round(((at_risk + medium) / total * 100.0), 2) if total else 0.0

    return {
        "total_patients": total,
        "avg_ltv": float(avg_ltv or 0),
        "avg_net_ltv": float(avg_net_ltv or 0),
        "total_spent": float(total_spent or 0),
        "avg_check": float(avg_check or 0),
        "churn_rate": churn_rate,
        "at_risk_patients": at_risk,
        "medium_risk_patients": medium,
        "last_computed_at": last_computed.isoformat() if last_computed else None,
    }


@router.post("/recompute", dependencies=[_mgr, _mod])
async def recompute(
    clinic_id: Optional[uuid.UUID] = Query(None),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Принудительный пересчёт LTV-снапшотов. Возвращает {updated, patients}."""
    if tenant is None:
        raise HTTPException(status_code=400, detail="Тенант не определён")
    try:
        result = await compute_ltv_for_clinic(db, tenant, clinic_id)
        return {"ok": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка пересчёта: {e}")
