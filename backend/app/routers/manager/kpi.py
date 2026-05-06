# ===== БЛОК: KPI цели =====
# Установка и чтение KPI целей для сотрудников.
# /manager/kpi/*

import uuid
import calendar
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.core.tenant import require_feature
from app.models.user import User, UserRole
from app.models.clinic import Clinic
from app.models.referral import Referral, ReferralStatus
from app.models.kpi_target import KpiTarget

router = APIRouter(tags=["manager:kpi"])


@router.get("/kpi/", response_model=list[dict], dependencies=[Depends(require_feature("kpi"))])
async def list_kpi(
    month: Optional[str] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    if month:
        try:
            target_month = date.fromisoformat(month + "-01")
        except Exception:
            raise HTTPException(status_code=400, detail="Неверный формат месяца (YYYY-MM)")
    else:
        target_month = date.today().replace(day=1)

    month_start = target_month
    last_day = calendar.monthrange(target_month.year, target_month.month)[1]
    month_end = target_month.replace(day=last_day)

    admins_filters = [User.role == UserRole.REG, User.is_active == True]
    # Tenant isolation: видим только своих сотрудников
    if current_user.tenant_id is not None:
        admins_filters.append(User.tenant_id == current_user.tenant_id)
    admins_q = await db.execute(
        select(User, Clinic.name.label("clinic_name"))
        .outerjoin(Clinic, Clinic.id == User.clinic_id)
        .where(*admins_filters)
        .order_by(User.full_name)
    )
    admins = admins_q.all()

    kpi_filters = [KpiTarget.month == month_start]
    if current_user.tenant_id is not None:
        # KpiTarget связан с admin_id; ограничим выбираемых admin_id своим тенантом
        admin_ids = [r.User.id for r in admins]
        if not admin_ids:
            return []
        kpi_filters.append(KpiTarget.admin_id.in_(admin_ids))
    kpi_q = await db.execute(select(KpiTarget).where(*kpi_filters))
    kpi_map = {str(k.admin_id): k for k in kpi_q.scalars().all()}

    actual_filters = [Referral.created_at >= month_start, Referral.created_at <= month_end]
    if current_user.tenant_id is not None:
        actual_filters.append(Referral.tenant_id == current_user.tenant_id)
    actual_q = await db.execute(
        select(
            Referral.created_by_admin_id,
            func.count(Referral.id).label("total"),
            func.count(Referral.id).filter(Referral.status == ReferralStatus.CONFIRMED).label("confirmed"),
        )
        .where(*actual_filters)
        .group_by(Referral.created_by_admin_id)
    )
    actual_map = {str(r.created_by_admin_id): {"total": r.total, "confirmed": r.confirmed} for r in actual_q.all()}

    result = []
    for row in admins:
        u = row.User
        aid = str(u.id)
        kpi = kpi_map.get(aid)
        actual = actual_map.get(aid, {"total": 0, "confirmed": 0})
        target_r = kpi.target_referrals if kpi else 0
        target_c = kpi.target_confirmed if kpi else 0
        result.append({
            "admin_id": aid, "admin_name": u.full_name, "clinic_name": row.clinic_name or "—",
            "month": month_start.isoformat(),
            "target_referrals": target_r, "target_confirmed": target_c,
            "actual_referrals": actual["total"], "actual_confirmed": actual["confirmed"],
            "progress_refs_pct": min(round(actual["total"] / target_r * 100, 1) if target_r > 0 else 0.0, 100.0),
            "progress_conf_pct": min(round(actual["confirmed"] / target_c * 100, 1) if target_c > 0 else 0.0, 100.0),
        })
    return result


@router.post("/kpi/{admin_id}", response_model=dict, dependencies=[Depends(require_feature("kpi"))])
async def set_kpi(
    admin_id: uuid.UUID,
    body: dict,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    # Tenant isolation: проверка что админ принадлежит нашему тенанту
    admin_obj = (await db.execute(select(User).where(User.id == admin_id))).scalar_one_or_none()
    if not admin_obj or (current_user.tenant_id is not None and admin_obj.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    target_referrals = int(body.get("target_referrals", 0))
    target_confirmed = int(body.get("target_confirmed", 0))
    month_str = body.get("month")
    if month_str:
        try:
            target_month = date.fromisoformat(month_str + "-01") if len(month_str) == 7 else date.fromisoformat(month_str)
            target_month = target_month.replace(day=1)
        except Exception:
            raise HTTPException(status_code=400, detail="Неверный формат месяца")
    else:
        target_month = date.today().replace(day=1)

    existing_q = await db.execute(select(KpiTarget).where(KpiTarget.admin_id == admin_id, KpiTarget.month == target_month))
    existing = existing_q.scalar_one_or_none()
    if existing:
        existing.target_referrals = target_referrals
        existing.target_confirmed = target_confirmed
    else:
        db.add(KpiTarget(admin_id=admin_id, month=target_month, target_referrals=target_referrals, target_confirmed=target_confirmed))
    await db.commit()
    return {"status": "ok", "month": target_month.isoformat()}
