# ===== БЛОК: Отчёты руководителя =====
# Все аналитические и статистические эндпоинты.
# /manager/reports/*, /manager/badge-counts

import uuid
import csv
import io
from datetime import datetime, timedelta, date as date_cls
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import Response
from sqlalchemy import select, func, and_, Integer, cast
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager, require_reports_access
from app.core.tenant import require_feature
from app.models.user import User, UserRole
from app.models.clinic import Clinic
from app.models.referral import Referral, ReferralStatus
from app.models.bonus import Bonus, BonusStatus
from app.models.service import Service
from app.models.doctor import Appointment, AppointmentStatus, Doctor
from app.schemas.manager import (
    SummaryReport, AdminStats, ClinicFlowEntry,
)
from app.routers.manager.clinics_access import resolve_clinic_filter_ids

router = APIRouter(tags=["manager:reports"])


# ---------------------------------------------------------------------------
# GET /manager/reports/summary
# ---------------------------------------------------------------------------

@router.get("/reports/summary", response_model=SummaryReport)
async def get_summary(
    clinic_id: Optional[uuid.UUID] = Query(None, description="UUID клиники (per-clinic скоуп)"),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    filters = []

    if current_user.tenant_id is not None:
        filters.append(Referral.tenant_id == current_user.tenant_id)
    if current_user.clinic_id is not None:
        from sqlalchemy import or_ as _or_rep
        filters.append(_or_rep(
            Referral.from_clinic_id == current_user.clinic_id,
            Referral.to_clinic_id == current_user.clinic_id,
        ))
    # Per-clinic scope: lika (manager Лорсановой) видит только свою клинику;
    # super_admin/franchise_owner — все клиники в скоупе.
    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    if filter_ids == []:
        return SummaryReport(
            total_referrals=0, confirmed_referrals=0, expired_referrals=0,
            pending_referrals=0, pending_bonuses=0.0, paid_bonuses=0.0,
            date_from=date_from, date_to=date_to,
        )
    if filter_ids is not None:
        from sqlalchemy import or_
        filters.append(or_(
            Referral.from_clinic_id.in_(filter_ids),
            Referral.to_clinic_id.in_(filter_ids),
        ))
    if date_from:
        filters.append(Referral.created_at >= date_from)
    if date_to:
        filters.append(Referral.created_at <= date_to)
    where = and_(*filters) if filters else True

    ref_q = await db.execute(
        select(Referral.status, func.count(Referral.id))
        .where(where).group_by(Referral.status)
    )
    status_counts = {row[0]: row[1] for row in ref_q.all()}
    total = sum(status_counts.values())

    bonus_q = await db.execute(
        select(Bonus.status, func.coalesce(func.sum(Bonus.amount), 0))
        .join(Referral, Bonus.referral_id == Referral.id)
        .where(where).group_by(Bonus.status)
    )
    bonus_sums = {row[0]: float(row[1]) for row in bonus_q.all()}

    return SummaryReport(
        total_referrals=total,
        confirmed_referrals=status_counts.get(ReferralStatus.CONFIRMED, 0),
        expired_referrals=status_counts.get(ReferralStatus.EXPIRED, 0),
        pending_referrals=status_counts.get(ReferralStatus.CREATED, 0),
        pending_bonuses=bonus_sums.get(BonusStatus.PENDING, 0.0),
        paid_bonuses=bonus_sums.get(BonusStatus.PAID, 0.0),
        date_from=date_from,
        date_to=date_to,
    )


# ---------------------------------------------------------------------------
# GET /manager/reports/admins
# ---------------------------------------------------------------------------

@router.get("/reports/admins", response_model=list[AdminStats])
async def get_admin_stats(
    clinic_id: Optional[uuid.UUID] = Query(None, description="UUID клиники (per-clinic скоуп)"),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    ref_filters = []

    if current_user.tenant_id is not None:
        ref_filters.append(Referral.tenant_id == current_user.tenant_id)
    if current_user.clinic_id is not None:
        from sqlalchemy import or_ as _or_rep2
        ref_filters.append(_or_rep2(
            Referral.from_clinic_id == current_user.clinic_id,
            Referral.to_clinic_id == current_user.clinic_id,
        ))
    # Per-clinic scope: lika видит сотрудников только своей клиники.
    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    if filter_ids == []:
        return []
    if filter_ids is not None:
        ref_filters.append(User.clinic_id.in_(filter_ids))
    if date_from:
        ref_filters.append(Referral.created_at >= date_from)
    if date_to:
        ref_filters.append(Referral.created_at <= date_to)
    ref_where = and_(*ref_filters) if ref_filters else True

    ref_q = await db.execute(
        select(
            User.id, User.full_name, User.clinic_id,
            Clinic.name.label("clinic_name"),
            Referral.status, func.count(Referral.id).label("cnt"),
        )
        .join(Referral, Referral.created_by_admin_id == User.id)
        .outerjoin(Clinic, Clinic.id == User.clinic_id)
        .where(ref_where)
        .group_by(User.id, User.full_name, User.clinic_id, Clinic.name, Referral.status)
    )

    aggregated: dict[uuid.UUID, dict] = {}
    for row in ref_q.all():
        aid = row.id
        if aid not in aggregated:
            aggregated[aid] = {
                "admin_id": aid, "full_name": row.full_name,
                "clinic_id": row.clinic_id, "clinic_name": row.clinic_name,
                "total_referrals": 0, "confirmed_referrals": 0,
                "expired_referrals": 0, "pending_bonuses": 0.0, "paid_bonuses": 0.0,
            }
        aggregated[aid]["total_referrals"] += row.cnt
        if row.status == ReferralStatus.CONFIRMED:
            aggregated[aid]["confirmed_referrals"] += row.cnt
        elif row.status == ReferralStatus.EXPIRED:
            aggregated[aid]["expired_referrals"] += row.cnt

    if not aggregated:
        return []

    bonus_filters = [Bonus.admin_id.in_(list(aggregated.keys()))]
    if date_from:
        bonus_filters.append(Referral.created_at >= date_from)
    if date_to:
        bonus_filters.append(Referral.created_at <= date_to)

    bonus_q = await db.execute(
        select(Bonus.admin_id, Bonus.status, func.coalesce(func.sum(Bonus.amount), 0).label("total"))
        .join(Referral, Bonus.referral_id == Referral.id)
        .where(and_(*bonus_filters))
        .group_by(Bonus.admin_id, Bonus.status)
    )
    for row in bonus_q.all():
        if row.admin_id in aggregated:
            if row.status == BonusStatus.PENDING:
                aggregated[row.admin_id]["pending_bonuses"] = float(row.total)
            elif row.status == BonusStatus.PAID:
                aggregated[row.admin_id]["paid_bonuses"] = float(row.total)

    extra_q = await db.execute(
        select(Bonus.admin_id, User.full_name, User.clinic_id, Bonus.status, func.coalesce(func.sum(Bonus.amount), 0).label("total"))
        .join(User, User.id == Bonus.admin_id)
        .where(~Bonus.admin_id.in_(list(aggregated.keys()) or [None]))
        .group_by(Bonus.admin_id, User.full_name, User.clinic_id, Bonus.status)
    )
    for row in extra_q.all():
        aid = row.admin_id
        if aid not in aggregated:
            aggregated[aid] = {
                "admin_id": aid, "full_name": row.full_name,
                "clinic_id": row.clinic_id, "clinic_name": None,
                "total_referrals": 0, "confirmed_referrals": 0,
                "expired_referrals": 0, "pending_bonuses": 0.0, "paid_bonuses": 0.0,
            }
        if row.status == BonusStatus.PENDING:
            aggregated[aid]["pending_bonuses"] = float(row.total)
        elif row.status == BonusStatus.PAID:
            aggregated[aid]["paid_bonuses"] = float(row.total)

    return [AdminStats(**v) for v in aggregated.values()]


# ---------------------------------------------------------------------------
# GET /manager/reports/clinics
# ---------------------------------------------------------------------------

@router.get("/reports/clinics", response_model=list[ClinicFlowEntry])
async def get_clinic_flow(
    clinic_id: Optional[uuid.UUID] = Query(None, description="UUID клиники (per-clinic скоуп)"),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    filters = []

    if current_user.tenant_id is not None:
        filters.append(Referral.tenant_id == current_user.tenant_id)
    if current_user.clinic_id is not None:
        from sqlalchemy import or_ as _or_rep
        filters.append(_or_rep(
            Referral.from_clinic_id == current_user.clinic_id,
            Referral.to_clinic_id == current_user.clinic_id,
        ))
    # Per-clinic scope (фильтр потоков, в которых участвует одна из клиник скоупа)
    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    if filter_ids == []:
        return []
    if filter_ids is not None:
        from sqlalchemy import or_
        filters.append(or_(
            Referral.from_clinic_id.in_(filter_ids),
            Referral.to_clinic_id.in_(filter_ids),
        ))
    if date_from:
        filters.append(Referral.created_at >= date_from)
    if date_to:
        filters.append(Referral.created_at <= date_to)
    where = and_(*filters) if filters else True

    ref_q = await db.execute(
        select(Referral.from_clinic_id, Referral.to_clinic_id, Referral.status, func.count(Referral.id).label("cnt"))
        .where(where).group_by(Referral.from_clinic_id, Referral.to_clinic_id, Referral.status)
    )
    flow: dict = {}
    for row in ref_q.all():
        key = (row.from_clinic_id, row.to_clinic_id)
        if key not in flow:
            flow[key] = {"total": 0, "confirmed": 0}
        flow[key]["total"] += row.cnt
        if row.status == ReferralStatus.CONFIRMED:
            flow[key]["confirmed"] += row.cnt

    if not flow:
        return []

    all_clinic_ids = set()
    for fc, tc in flow.keys():
        all_clinic_ids.add(fc)
        all_clinic_ids.add(tc)

    clinic_filter = [Clinic.id.in_(list(all_clinic_ids))]
    if current_user.tenant_id is not None:
        clinic_filter.append(Clinic.tenant_id == current_user.tenant_id)
    if current_user.clinic_id is not None:
        clinic_filter.append(Clinic.id == current_user.clinic_id)
    clinic_q = await db.execute(select(Clinic.id, Clinic.name).where(*clinic_filter))
    clinic_names = {row.id: row.name for row in clinic_q.all()}

    return [
        ClinicFlowEntry(
            from_clinic_id=fc, from_clinic_name=clinic_names.get(fc, ""),
            to_clinic_id=tc, to_clinic_name=clinic_names.get(tc, ""),
            total=counts["total"], confirmed=counts["confirmed"],
        )
        for (fc, tc), counts in flow.items()
    ]


# ---------------------------------------------------------------------------
# GET /manager/reports/export (CSV)
# ---------------------------------------------------------------------------

@router.get("/reports/export")
async def export_referrals(
    clinic_id: Optional[uuid.UUID] = Query(None, description="UUID клиники (per-clinic скоуп)"),
    admin_id: Optional[uuid.UUID] = Query(None),
    ref_status: Optional[ReferralStatus] = Query(None, alias="status"),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import aliased
    from sqlalchemy import or_
    FromC = aliased(Clinic, name="from_c")
    ToC = aliased(Clinic, name="to_c")

    filters = []

    if current_user.tenant_id is not None:
        filters.append(Referral.tenant_id == current_user.tenant_id)
    if current_user.clinic_id is not None:
        from sqlalchemy import or_ as _or_rep
        filters.append(_or_rep(
            Referral.from_clinic_id == current_user.clinic_id,
            Referral.to_clinic_id == current_user.clinic_id,
        ))
    # Per-clinic scope с проверкой прав
    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    if filter_ids == []:
        # Пустой CSV
        output = io.StringIO()
        output.write('﻿')
        writer = csv.writer(output)
        writer.writerow(["id","patient_phone","status","from_clinic","to_clinic","admin","created_at","confirmed_at","expires_at","notes","bonus_amount","bonus_status"])
        filename = f"referrals_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
        return Response(
            content=output.getvalue().encode("utf-8"), media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    if filter_ids is not None:
        filters.append(or_(
            Referral.from_clinic_id.in_(filter_ids),
            Referral.to_clinic_id.in_(filter_ids),
        ))
    if admin_id:
        filters.append(Referral.created_by_admin_id == admin_id)
    if ref_status:
        filters.append(Referral.status == ref_status)
    if date_from:
        filters.append(Referral.created_at >= date_from)
    if date_to:
        filters.append(Referral.created_at <= date_to)
    where = and_(*filters) if filters else True

    q = await db.execute(
        select(
            Referral.id, Referral.patient_phone, Referral.status,
            Referral.created_at, Referral.confirmed_at, Referral.expires_at, Referral.notes,
            FromC.name.label("from_clinic"), ToC.name.label("to_clinic"),
            User.full_name.label("admin_name"), Bonus.amount.label("bonus_amount"), Bonus.status.label("bonus_status"),
        )
        .outerjoin(FromC, FromC.id == Referral.from_clinic_id)
        .join(ToC, ToC.id == Referral.to_clinic_id)
        .join(User, User.id == Referral.created_by_admin_id)
        .outerjoin(Bonus, Bonus.referral_id == Referral.id)
        .where(where).order_by(Referral.created_at.desc())
    )
    rows = q.all()

    output = io.StringIO()
    output.write('\ufeff')
    writer = csv.writer(output)
    writer.writerow(["id","patient_phone","status","from_clinic","to_clinic","admin","created_at","confirmed_at","expires_at","notes","bonus_amount","bonus_status"])
    for r in rows:
        writer.writerow([
            str(r.id), r.patient_phone, r.status, r.from_clinic, r.to_clinic, r.admin_name,
            r.created_at.isoformat() if r.created_at else "",
            r.confirmed_at.isoformat() if r.confirmed_at else "",
            r.expires_at.isoformat() if r.expires_at else "",
            r.notes or "", str(r.bonus_amount) if r.bonus_amount is not None else "", r.bonus_status or "",
        ])

    filename = f"referrals_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=output.getvalue().encode("utf-8"), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# GET /manager/reports/bonuses
# ---------------------------------------------------------------------------

@router.get("/reports/bonuses", response_model=list[dict])
async def list_bonuses_by_admin(
    clinic_id: Optional[uuid.UUID] = Query(None, description="UUID клиники (per-clinic скоуп)"),
    only_pending: bool = Query(False),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    ref_filters = []

    if current_user.tenant_id is not None:
        ref_filters.append(Referral.tenant_id == current_user.tenant_id)
    if current_user.clinic_id is not None:
        from sqlalchemy import or_ as _or_rep2
        ref_filters.append(_or_rep2(
            Referral.from_clinic_id == current_user.clinic_id,
            Referral.to_clinic_id == current_user.clinic_id,
        ))
    # Per-clinic scope: lika видит бонусы сотрудников только своей клиники.
    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    if filter_ids == []:
        return []
    if filter_ids is not None:
        ref_filters.append(User.clinic_id.in_(filter_ids))
    if date_from:
        ref_filters.append(Referral.created_at >= date_from)
    if date_to:
        ref_filters.append(Referral.created_at < date_to + timedelta(days=1))
    if only_pending:
        ref_filters.append(Bonus.status == BonusStatus.PENDING)
    where = and_(*ref_filters) if ref_filters else True

    q = await db.execute(
        select(
            Bonus.id.label("bonus_id"), Bonus.admin_id, Bonus.amount,
            Bonus.status.label("bonus_status"), Bonus.created_at.label("bonus_created_at"), Bonus.paid_at,
            User.full_name, User.clinic_id,
            Clinic.name.label("clinic_name"),
            Referral.id.label("referral_id"), Referral.patient_phone, Referral.confirmed_at,
            Service.name.label("service_name"),
        )
        .join(User, User.id == Bonus.admin_id)
        .outerjoin(Clinic, Clinic.id == User.clinic_id)
        .join(Referral, Referral.id == Bonus.referral_id)
        .join(Service, Service.id == Referral.service_id)
        .where(where).order_by(Bonus.admin_id, Bonus.created_at.desc())
    )
    rows = q.all()

    from collections import OrderedDict
    admins_map: dict = OrderedDict()
    for row in rows:
        aid = str(row.admin_id)
        if aid not in admins_map:
            admins_map[aid] = {
                "admin_id": aid, "full_name": row.full_name,
                "clinic_name": row.clinic_name or "—",
                "pending_total": 0.0, "paid_total": 0.0,
                "pending_bonuses": [], "paid_bonuses": [],
            }
        item = {
            "bonus_id": str(row.bonus_id), "referral_id": str(row.referral_id),
            "service_name": row.service_name, "patient_phone": row.patient_phone,
            "amount": float(row.amount),
            "confirmed_at": row.confirmed_at.isoformat() if row.confirmed_at else None,
            "paid_at": row.paid_at.isoformat() if row.paid_at else None,
        }
        if row.bonus_status == BonusStatus.PENDING:
            admins_map[aid]["pending_total"] += float(row.amount)
            admins_map[aid]["pending_bonuses"].append(item)
        else:
            admins_map[aid]["paid_total"] += float(row.amount)
            admins_map[aid]["paid_bonuses"].append(item)

    return sorted(admins_map.values(), key=lambda x: x["pending_total"], reverse=True)


# ---------------------------------------------------------------------------
# GET /manager/reports/referrals
# ---------------------------------------------------------------------------

@router.get("/reports/referrals", response_model=list[dict])
async def list_all_referrals(
    clinic_id: Optional[uuid.UUID] = Query(None, description="UUID клиники (per-clinic скоуп)"),
    author_id: Optional[uuid.UUID] = Query(None, description="UUID автора направления (created_by_admin_id)"),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    ref_status: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import aliased
    from sqlalchemy import or_
    FromC = aliased(Clinic, name="from_c")
    ToC = aliased(Clinic, name="to_c")
    Creator = aliased(User, name="creator")
    Canceller = aliased(User, name="canceller")

    filters = []

    if current_user.tenant_id is not None:
        filters.append(Referral.tenant_id == current_user.tenant_id)
    if current_user.clinic_id is not None:
        from sqlalchemy import or_ as _or_rep
        filters.append(_or_rep(
            Referral.from_clinic_id == current_user.clinic_id,
            Referral.to_clinic_id == current_user.clinic_id,
        ))
    # Per-clinic scope: lika видит направления только своей клиники.
    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    if filter_ids == []:
        return []
    if filter_ids is not None:
        filters.append(or_(
            Referral.from_clinic_id.in_(filter_ids),
            Referral.to_clinic_id.in_(filter_ids),
        ))
    # Фильтр по автору направления (поверх tenant/clinic-скоупа; не ослабляет изоляцию).
    if author_id is not None:
        filters.append(Referral.created_by_admin_id == author_id)
    if date_from:
        filters.append(Referral.created_at >= date_from)
    if date_to:
        filters.append(Referral.created_at < date_to + timedelta(days=1))
    if ref_status and ref_status != "all":
        try:
            filters.append(Referral.status == ReferralStatus(ref_status))
        except ValueError:
            pass
    where = and_(*filters) if filters else True
    offset = (page - 1) * limit

    total_q = await db.execute(select(func.count(Referral.id)).where(where))
    total = total_q.scalar() or 0

    q = await db.execute(
        select(
            Referral, Service.name.label("service_name"),
            FromC.name.label("from_clinic_name"), ToC.name.label("to_clinic_name"),
            Creator.full_name.label("creator_name"), Canceller.full_name.label("canceller_name"),
            Bonus.amount.label("bonus_amount"), Bonus.status.label("bonus_status"),
        )
        .join(Service, Service.id == Referral.service_id)
        .outerjoin(FromC, FromC.id == Referral.from_clinic_id)
        .join(ToC, ToC.id == Referral.to_clinic_id)
        .join(Creator, Creator.id == Referral.created_by_admin_id)
        .outerjoin(Canceller, Canceller.id == Referral.cancelled_by_id)
        .outerjoin(Bonus, Bonus.referral_id == Referral.id)
        .where(where).order_by(Referral.created_at.desc())
        .offset(offset).limit(limit)
    )
    rows = q.all()

    items = []
    for row in rows:
        r = row.Referral
        items.append({
            "id": str(r.id), "patient_phone": r.patient_phone, "patient_name": r.patient_name,
            "status": r.status, "notes": r.notes, "short_code": r.short_code,
            "service_name": row.service_name,
            "from_clinic_name": row.from_clinic_name or "—",
            "to_clinic_name": row.to_clinic_name,
            "created_by_name": row.creator_name,
            "cancelled_by_name": row.canceller_name,
            "bonus_amount": float(row.bonus_amount) if row.bonus_amount is not None else None,
            "bonus_status": row.bonus_status,
            "cancel_reason": r.cancel_reason,
            "created_at": r.created_at.isoformat(),
            "confirmed_at": r.confirmed_at.isoformat() if r.confirmed_at else None,
            "expires_at": r.expires_at.isoformat() if r.expires_at else None,
            "cancelled_at": r.cancelled_at.isoformat() if r.cancelled_at else None,
        })
    return items


# ---------------------------------------------------------------------------
# GET /manager/reports/daily
# ---------------------------------------------------------------------------

@router.get("/reports/daily", response_model=list[dict])
async def get_daily_report(
    clinic_id: Optional[uuid.UUID] = Query(None, description="UUID клиники (per-clinic скоуп)"),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    from datetime import date
    from sqlalchemy import cast, Date, or_
    today = date.today()
    start = today - timedelta(days=29)

    # Tenant + per-clinic scope
    extra_filters = []
    if current_user.tenant_id is not None:
        extra_filters.append(Referral.tenant_id == current_user.tenant_id)
    if current_user.clinic_id is not None:
        from sqlalchemy import or_ as _or_rep3
        extra_filters.append(_or_rep3(
            Referral.from_clinic_id == current_user.clinic_id,
            Referral.to_clinic_id == current_user.clinic_id,
        ))
    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    if filter_ids == []:
        return [
            {"date": (start + timedelta(days=i)).isoformat(), "total": 0, "confirmed": 0}
            for i in range(30)
        ]
    if filter_ids is not None:
        extra_filters.append(or_(
            Referral.from_clinic_id.in_(filter_ids),
            Referral.to_clinic_id.in_(filter_ids),
        ))

    q = await db.execute(
        select(
            cast(Referral.created_at, Date).label("day"),
            func.count(Referral.id).label("total"),
            func.count(Referral.id).filter(Referral.status == ReferralStatus.CONFIRMED).label("confirmed"),
        )
        .where(Referral.created_at >= start, *extra_filters)
        .group_by(cast(Referral.created_at, Date))
        .order_by(cast(Referral.created_at, Date))
    )
    day_map = {r.day: {"total": r.total, "confirmed": r.confirmed} for r in q.all()}
    return [
        {"date": (start + timedelta(days=i)).isoformat(), **day_map.get(start + timedelta(days=i), {"total": 0, "confirmed": 0})}
        for i in range(30)
    ]


# ---------------------------------------------------------------------------
# GET /manager/reports/analytics
# ---------------------------------------------------------------------------

@router.get("/reports/analytics", response_model=dict, dependencies=[Depends(require_feature("analytics"))])
async def get_analytics(
    clinic_id: Optional[uuid.UUID] = Query(None, description="UUID клиники (фильтр аналитики)"),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    # ── Применяем scope-фильтр по клиникам с учётом прав пользователя ──
    # Логика: если clinic_id не передан и у user есть clinic_id (manager
    # клиники, reg/nurse) — подставляем user.clinic_id; super_admin/
    # franchise_owner без явного фильтра видят всё. Если clinic_id передан,
    # проверяем доступ через get_user_clinic_ids().
    from app.routers.manager.clinics_access import get_user_clinic_ids
    if clinic_id is None:
        if current_user.role not in (UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
            if current_user.clinic_id is not None:
                clinic_id = current_user.clinic_id
    else:
        accessible = await get_user_clinic_ids(db, current_user)
        if current_user.role == UserRole.SUPER_ADMIN and not accessible:
            if current_user.tenant_id is None:
                from fastapi import HTTPException as _H
                raise _H(status_code=403, detail="Тенант не выбран")
            accessible = await get_user_clinic_ids(db, current_user, tenant_id_param=current_user.tenant_id)
        if clinic_id not in accessible:
            from fastapi import HTTPException as _H
            raise _H(status_code=403, detail="Нет доступа к этой клинике")

    from datetime import date
    from sqlalchemy import cast, Date, or_
    today = date.today()
    start_30 = today - timedelta(days=29)

    # ── Общий фильтр по тенанту + клинике ──
    base_filters = []
    if current_user.tenant_id is not None:
        base_filters.append(Referral.tenant_id == current_user.tenant_id)
    if clinic_id is not None:
        # Учитываем как from_clinic_id, так и to_clinic_id (направление в обе стороны)
        base_filters.append(or_(
            Referral.from_clinic_id == clinic_id,
            Referral.to_clinic_id == clinic_id,
        ))

    daily_q = select(
        cast(Referral.created_at, Date).label("day"),
        func.count(Referral.id).label("total"),
        func.count(Referral.id).filter(Referral.status == ReferralStatus.CONFIRMED).label("confirmed"),
    ).where(Referral.created_at >= start_30, *base_filters).group_by(cast(Referral.created_at, Date)).order_by(cast(Referral.created_at, Date))
    dq = await db.execute(daily_q)
    day_map = {r.day: {"total": r.total, "confirmed": r.confirmed} for r in dq.all()}
    daily = [
        {"date": (start_30 + timedelta(days=i)).isoformat(), **day_map.get(start_30 + timedelta(days=i), {"total": 0, "confirmed": 0})}
        for i in range(30)
    ]

    services_q = select(
        Service.id, Service.name, func.count(Referral.id).label("total"),
        func.count(Referral.id).filter(Referral.status == ReferralStatus.CONFIRMED).label("confirmed"),
        func.coalesce(func.sum(Bonus.amount).filter(Bonus.status != None), 0).label("bonus_total"),
    ).join(Referral, Referral.service_id == Service.id).outerjoin(Bonus, Bonus.referral_id == Referral.id)
    if base_filters:
        services_q = services_q.where(*base_filters)
    services_q = services_q.group_by(Service.id, Service.name).order_by(func.count(Referral.id).desc()).limit(10)
    sq = await db.execute(services_q)
    top_services = [{"service_id": str(r.id), "name": r.name, "total": r.total, "confirmed": r.confirmed, "bonus_total": float(r.bonus_total)} for r in sq.all()]

    admin_q = select(
        User.id, User.full_name, Clinic.name.label("clinic_name"),
        func.count(Referral.id).label("total"),
        func.count(Referral.id).filter(Referral.status == ReferralStatus.CONFIRMED).label("confirmed"),
    ).join(Referral, Referral.created_by_admin_id == User.id).outerjoin(Clinic, Clinic.id == User.clinic_id).where(User.role == UserRole.REG)
    if base_filters:
        admin_q = admin_q.where(*base_filters)
    admin_q = admin_q.group_by(User.id, User.full_name, Clinic.name).order_by(func.count(Referral.id).desc())
    cq = await db.execute(admin_q)
    admin_conversion = [
        {"admin_id": str(r.id), "full_name": r.full_name, "clinic_name": r.clinic_name or "—",
         "total": r.total, "confirmed": r.confirmed,
         "conversion_pct": round(r.confirmed / r.total * 100, 1) if r.total > 0 else 0.0}
        for r in cq.all()
    ]

    first_this = today.replace(day=1)
    last_month_end = first_this - timedelta(days=1)
    first_last = last_month_end.replace(day=1)

    async def _month_stats(d_from, d_to):
        r = await db.execute(
            select(func.count(Referral.id).label("total"),
                func.count(Referral.id).filter(Referral.status == ReferralStatus.CONFIRMED).label("confirmed"),
                func.coalesce(func.sum(Bonus.amount), 0).label("bonuses"),
            )
            .outerjoin(Bonus, Bonus.referral_id == Referral.id)
            .where(Referral.created_at >= d_from, Referral.created_at <= d_to, *base_filters)
        )
        row = r.one()
        return {"total": row.total, "confirmed": row.confirmed, "bonuses": float(row.bonuses)}

    this_month = await _month_stats(first_this, today)
    last_month = await _month_stats(first_last, last_month_end)

    # Сравнение клиник: учитываем тенант, но НЕ фильтруем по clinic_id
    # (иначе в табличке всегда будет одна строка). Если clinic_id задан —
    # выводим только эту клинику (manager своей клиники).
    clinic_filters = []
    if current_user.tenant_id is not None:
        clinic_filters.append(Referral.tenant_id == current_user.tenant_id)
    if clinic_id is not None:
        clinic_filters.append(Clinic.id == clinic_id)
    clinic_q_stmt = select(
        Clinic.id, Clinic.name, func.count(Referral.id).label("total"),
        func.count(Referral.id).filter(Referral.status == ReferralStatus.CONFIRMED).label("confirmed"),
        func.coalesce(func.sum(Bonus.amount), 0).label("bonuses"),
    ).join(Referral, Referral.from_clinic_id == Clinic.id).outerjoin(Bonus, Bonus.referral_id == Referral.id)
    if clinic_filters:
        clinic_q_stmt = clinic_q_stmt.where(*clinic_filters)
    clinic_q_stmt = clinic_q_stmt.group_by(Clinic.id, Clinic.name).order_by(func.count(Referral.id).desc())
    clinic_q = await db.execute(clinic_q_stmt)
    clinic_comparison = [
        {"clinic_id": str(r.id), "name": r.name, "total": r.total, "confirmed": r.confirmed,
         "conversion_pct": round(r.confirmed / r.total * 100, 1) if r.total > 0 else 0.0, "bonuses": float(r.bonuses)}
        for r in clinic_q.all()
    ]

    total_all = sum(d["total"] for d in daily)
    confirmed_all = sum(d["confirmed"] for d in daily)
    return {
        "daily": daily, "top_services": top_services, "admin_conversion": admin_conversion,
        "clinic_comparison": clinic_comparison,
        "conversion_rate": round(confirmed_all / total_all * 100, 1) if total_all > 0 else 0.0,
        "this_month": this_month, "last_month": last_month,
    }


# ---------------------------------------------------------------------------
# GET /manager/reports/today
# ---------------------------------------------------------------------------

@router.get("/reports/today", response_model=dict, dependencies=[Depends(require_feature("analytics"))])
async def get_today_stats(
    clinic_id: Optional[uuid.UUID] = Query(None, description="UUID клиники (per-clinic скоуп)"),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    from datetime import date
    from sqlalchemy import or_
    today_start = datetime.combine(date.today(), datetime.min.time())
    tomorrow_start = today_start + timedelta(days=1)

    # Per-clinic scope
    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    if filter_ids == []:
        return {"total_today": 0, "confirmed_today": 0, "pending_cancel": 0, "pending_bonuses": 0.0}
    clinic_filter = []
    if filter_ids is not None:
        clinic_filter.append(or_(
            Referral.from_clinic_id.in_(filter_ids),
            Referral.to_clinic_id.in_(filter_ids),
        ))
    if current_user.tenant_id is not None:
        clinic_filter.append(Referral.tenant_id == current_user.tenant_id)

    total_q = await db.execute(select(func.count(Referral.id)).where(Referral.created_at >= today_start, Referral.created_at < tomorrow_start, *clinic_filter))
    confirmed_q = await db.execute(select(func.count(Referral.id)).where(Referral.status == ReferralStatus.CONFIRMED, Referral.confirmed_at >= today_start, Referral.confirmed_at < tomorrow_start, *clinic_filter))
    cancel_q = await db.execute(select(func.count(Referral.id)).where(Referral.status == ReferralStatus.CANCEL_REQUESTED, *clinic_filter))

    bonus_ref_filter = []
    if filter_ids is not None:
        bonus_ref_filter.append(Bonus.referral_id.in_(
            select(Referral.id).where(or_(
                Referral.from_clinic_id.in_(filter_ids),
                Referral.to_clinic_id.in_(filter_ids),
            ))
        ))
    bonuses_q = await db.execute(select(func.coalesce(func.sum(Bonus.amount), 0)).where(Bonus.status == BonusStatus.PENDING, *bonus_ref_filter))

    return {
        "total_today": total_q.scalar() or 0,
        "confirmed_today": confirmed_q.scalar() or 0,
        "pending_cancel": cancel_q.scalar() or 0,
        "pending_bonuses": float(bonuses_q.scalar() or 0),
    }


# ---------------------------------------------------------------------------
# GET /manager/reports/chart
# ---------------------------------------------------------------------------

@router.get("/reports/chart", response_model=list[dict], dependencies=[Depends(require_feature("analytics"))])
async def get_chart_data(
    clinic_id: Optional[uuid.UUID] = Query(None, description="UUID клиники (per-clinic скоуп)"),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    from datetime import date
    from sqlalchemy import or_
    today = date.today()

    # Per-clinic scope (резолвим один раз за запрос)
    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    if filter_ids == []:
        return [
            {"date": (today - timedelta(days=i)).strftime("%d.%m"), "total": 0, "confirmed": 0}
            for i in range(6, -1, -1)
        ]

    base_clinic_filter = []
    if filter_ids is not None:
        base_clinic_filter.append(or_(
            Referral.from_clinic_id.in_(filter_ids),
            Referral.to_clinic_id.in_(filter_ids),
        ))
    if current_user.tenant_id is not None:
        base_clinic_filter.append(Referral.tenant_id == current_user.tenant_id)

    result = []
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        day_start = datetime.combine(day, datetime.min.time())
        day_end = day_start + timedelta(days=1)
        total_q = await db.execute(select(func.count(Referral.id)).where(Referral.created_at >= day_start, Referral.created_at < day_end, *base_clinic_filter))
        confirmed_q = await db.execute(select(func.count(Referral.id)).where(Referral.status == ReferralStatus.CONFIRMED, Referral.confirmed_at >= day_start, Referral.confirmed_at < day_end, *base_clinic_filter))
        result.append({"date": day.strftime("%d.%m"), "total": total_q.scalar() or 0, "confirmed": confirmed_q.scalar() or 0})
    return result


# ---------------------------------------------------------------------------
# GET /manager/badge-counts
# ---------------------------------------------------------------------------

@router.get("/badge-counts", response_model=dict)
async def get_badge_counts(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    cancel_q = await db.execute(select(func.count(Referral.id)).where(Referral.status == ReferralStatus.CANCEL_REQUESTED))
    bonus_q = await db.execute(select(func.count(func.distinct(Bonus.admin_id))).where(Bonus.status == BonusStatus.PENDING))
    return {"cancel_requests": cancel_q.scalar() or 0, "pending_bonus_staff": bonus_q.scalar() or 0}


# ---------------------------------------------------------------------------
# GET /manager/reports/appointments — отчёт по приёмам (для PDF/Excel/CSV экспорта)
# ---------------------------------------------------------------------------
# Возвращает данные (НЕ файл!) — frontend сам формирует PDF/Excel/CSV.
# Параметры: from_date, to_date (обязательно), doctor_id?, clinic_id?, status?
# Лимит: 5000 записей, диапазон ≤ 6 месяцев.
# ---------------------------------------------------------------------------

@router.get("/reports/appointments", response_model=dict)
async def get_appointments_report(
    from_date: date_cls = Query(..., description="Начало периода, YYYY-MM-DD"),
    to_date: date_cls = Query(..., description="Конец периода, YYYY-MM-DD"),
    doctor_id: Optional[uuid.UUID] = Query(None, description="UUID врача"),
    clinic_id: Optional[uuid.UUID] = Query(None, description="UUID клиники"),
    status: Optional[AppointmentStatus] = Query(None, description="Статус записи"),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Отчёт по приёмам за произвольный период.
    Возвращает массив записей + KPI (агрегаты), фронт сам строит PDF/Excel.
    """
    # ── Валидация периода ────────────────────────────────────────────────
    if to_date < from_date:
        raise HTTPException(400, "to_date должен быть >= from_date")
    if (to_date - from_date).days > 186:
        raise HTTPException(400, "Период не может превышать 6 месяцев")

    # ── Фильтр клиник по правам пользователя ─────────────────────────────
    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    if filter_ids == []:
        # Нет доступа → пустой результат
        return {
            "appointments": [],
            "total": 0,
            "total_revenue": 0.0,
            "period": {"from": from_date.isoformat(), "to": to_date.isoformat()},
            "kpi": {
                "by_status": {}, "top_doctors": [], "avg_cheque": 0.0,
                "total_revenue": 0.0, "total_count": 0,
            },
        }

    # ── Сборка фильтров ──────────────────────────────────────────────────
    filters = [
        Appointment.appointment_date >= from_date,
        Appointment.appointment_date <= to_date,
    ]
    if current_user.tenant_id is not None:
        filters.append(Appointment.tenant_id == current_user.tenant_id)
    if filter_ids is not None:
        filters.append(Appointment.clinic_id.in_(filter_ids))
    if doctor_id:
        filters.append(Appointment.doctor_id == doctor_id)
    if status:
        filters.append(Appointment.status == status)

    where = and_(*filters)

    # ── Основной запрос: записи + врач + клиника (LEFT JOIN) ─────────────
    # TODO(#2 PHI): этот отчёт ОТОБРАЖАЕТ ПДн — после миграции выбирать сам
    # Appointment (ORM-объект), а в строку ответа класть расшифрованные
    # patient_phone_plain / patient_name_plain / notes_plain. Выбор отдельных
    # шифр-колонок здесь отдал бы 'enc:...' токены — переводить на ORM+property,
    # НЕ на сырые *_encrypted колонки.
    q = (
        select(
            Appointment.id,
            Appointment.appointment_date,
            Appointment.start_time,
            Appointment.end_time,
            Appointment.patient_name,
            Appointment.patient_phone,
            Appointment.status,
            Appointment.price,
            Appointment.payment_method,
            Appointment.notes,
            Doctor.full_name.label("doctor_name"),
            Doctor.specialty.label("doctor_specialty"),
            Doctor.id.label("doctor_id"),
            Clinic.name.label("clinic_name"),
            Clinic.id.label("clinic_id"),
        )
        .join(Doctor, Doctor.id == Appointment.doctor_id, isouter=True)
        .join(Clinic, Clinic.id == Appointment.clinic_id, isouter=True)
        .where(where)
        .order_by(Appointment.appointment_date, Appointment.start_time)
        .limit(5000)
    )
    rows = (await db.execute(q)).all()

    # ── Сериализация записей ─────────────────────────────────────────────
    appointments = []
    total_revenue = 0.0
    by_status: dict[str, int] = {}
    by_doctor: dict[str, dict] = {}

    for r in rows:
        price_val = float(r.price) if r.price is not None else 0.0
        total_revenue += price_val
        st = r.status.value if hasattr(r.status, "value") else str(r.status)
        by_status[st] = by_status.get(st, 0) + 1
        if r.doctor_id:
            key = str(r.doctor_id)
            d = by_doctor.setdefault(key, {
                "doctor_id": key,
                "doctor_name": r.doctor_name or "",
                "specialty": r.doctor_specialty or "",
                "count": 0,
                "revenue": 0.0,
            })
            d["count"] += 1
            d["revenue"] += price_val

        appointments.append({
            "id": str(r.id),
            "date": r.appointment_date.isoformat(),
            "time": r.start_time.strftime("%H:%M") if r.start_time else "",
            "end_time": r.end_time.strftime("%H:%M") if r.end_time else "",
            "doctor_name": r.doctor_name or "",
            "doctor_specialty": r.doctor_specialty or "",
            "clinic_name": r.clinic_name or "",
            "patient_name": r.patient_name or "",
            "patient_phone": r.patient_phone or "",
            "status": st,
            "price": price_val,
            "payment_method": r.payment_method or "",
            "notes": r.notes or "",
        })

    # ── KPI: топ-10 врачей ───────────────────────────────────────────────
    top_doctors = sorted(by_doctor.values(), key=lambda d: d["count"], reverse=True)[:10]
    total_count = len(appointments)
    avg_cheque = (total_revenue / total_count) if total_count > 0 else 0.0

    return {
        "appointments": appointments,
        "total": total_count,
        "total_revenue": round(total_revenue, 2),
        "period": {"from": from_date.isoformat(), "to": to_date.isoformat()},
        "kpi": {
            "by_status": by_status,
            "top_doctors": top_doctors,
            "avg_cheque": round(avg_cheque, 2),
            "total_revenue": round(total_revenue, 2),
            "total_count": total_count,
        },
    }
