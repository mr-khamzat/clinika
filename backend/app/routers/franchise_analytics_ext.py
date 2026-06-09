"""
ФИЧИ 2 + 3: Рейтинг клиник по KPI + матрица перелива пациентов.

Endpoints (добавляются к существующему /admin/analytics/* через include_router):
  GET /franchise-owner/analytics/clinic-ranking?period=last_30d|last_7d|last_90d|all
  GET /franchise-owner/analytics/referral-matrix?period=YYYY-MM

Источник данных:
  - revenue          → clinic_payments  (status=paid/success)
  - avg_check        → revenue / count(payments)
  - doctors_count    → users (role in doctor / visiting_doctor / lab_*)
  - no_show_rate     → appointments.status='no_show' / total
  - conversion       → appointments / referrals  (per clinic)
  - retention_30/90  → пациенты с >1 уник.визитом за период
  - NPS              → null (нет таблицы опросов)

Referral-matrix:
  inter_clinic_invoices group by (issuer_clinic_id, recipient_clinic_id)
  Считаем COUNT и SUM(amount) только за указанный период.
"""
from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, and_, text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.clinic import Clinic

router = APIRouter(prefix="/franchise-owner/analytics", tags=["franchise-analytics-ext"])


# ── Permission helpers ──────────────────────────────────────────────────────


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


def _period_to_range(period: str) -> tuple[datetime, datetime]:
    """'last_7d' / 'last_30d' / 'last_90d' / 'all' → (from, to)."""
    now = datetime.utcnow()
    if period == "last_7d":
        return now - timedelta(days=7), now
    if period == "last_30d":
        return now - timedelta(days=30), now
    if period == "last_90d":
        return now - timedelta(days=90), now
    if period == "all":
        return datetime(2000, 1, 1), now
    raise HTTPException(400, f"Unsupported period: {period}")


def _ym_period_to_range(period: str) -> tuple[date, date]:
    """'2026-05' → (2026-05-01, 2026-05-31)."""
    try:
        y, m = period.split("-")
        y = int(y); m = int(m)
        if m < 1 or m > 12:
            raise ValueError
        last_day = calendar.monthrange(y, m)[1]
        return date(y, m, 1), date(y, m, last_day)
    except Exception:
        raise HTTPException(400, f"Неверный формат периода: {period} (нужен YYYY-MM)")


# ── ФИЧА 2: clinic-ranking ──────────────────────────────────────────────────


@router.get("/clinic-ranking")
async def clinic_ranking(
    period: str = Query("last_30d", regex="^(last_7d|last_30d|last_90d|all)$"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Сводный рейтинг клиник по 8 KPI за выбранный период.

    Колонки:
      revenue, revenue_per_doctor, avg_check, appointments_total,
      no_show_rate (%), conversion_rate (%), retention_30d (%), retention_90d (%), nps (null).
    """
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    dt_from, dt_to = _period_to_range(period)

    # Все клиники сети
    rt = await db.execute(select(Tenant.id).where(Tenant.franchise_id == f.id))
    tenant_ids = [row[0] for row in rt.all()]
    if not tenant_ids:
        return {"period": period, "rows": [], "notice": "В франшизе нет тенантов"}
    rc = await db.execute(
        select(Clinic).where(Clinic.tenant_id.in_(tenant_ids)).order_by(Clinic.name)
    )
    clinics = list(rc.scalars().all())
    clinic_ids = [c.id for c in clinics]
    if not clinic_ids:
        return {"period": period, "rows": [], "notice": "У тенантов франшизы нет клиник"}

    # ── 1. revenue + кол-во платежей (для avg_check) ─────────────────────────
    rev_map: dict[uuid.UUID, dict[str, float]] = {cid: {"revenue": 0.0, "count": 0} for cid in clinic_ids}
    try:
        q = sql_text(
            """
            SELECT clinic_id, COALESCE(SUM(amount),0) AS rev, COUNT(*) AS cnt
            FROM clinic_payments
            WHERE clinic_id = ANY(:cids)
              AND status IN ('paid','success','succeeded','completed')
              AND COALESCE(paid_at, created_at) >= :df
              AND COALESCE(paid_at, created_at) <= :dt
            GROUP BY clinic_id
            """
        )
        r = await db.execute(q, {"cids": list(clinic_ids), "df": dt_from, "dt": dt_to})
        for row in r.all():
            rev_map[row[0]] = {"revenue": float(row[1] or 0), "count": int(row[2] or 0)}
    except Exception:
        pass

    # ── 2. doctors_count (для revenue_per_doctor) ────────────────────────────
    doc_count: dict[uuid.UUID, int] = {cid: 0 for cid in clinic_ids}
    try:
        q = sql_text(
            """
            SELECT clinic_id, COUNT(*) AS c
            FROM users
            WHERE clinic_id = ANY(:cids)
              AND role IN ('doctor','visiting_doctor','lab_ct','lab_xray')
              AND is_active = true
            GROUP BY clinic_id
            """
        )
        r = await db.execute(q, {"cids": list(clinic_ids)})
        for row in r.all():
            doc_count[row[0]] = int(row[1] or 0)
    except Exception:
        pass

    # ── 3. appointments_total + no_show ──────────────────────────────────────
    apt_map: dict[uuid.UUID, dict[str, int]] = {cid: {"total": 0, "no_show": 0} for cid in clinic_ids}
    try:
        q = sql_text(
            """
            SELECT clinic_id,
                   COUNT(*) AS total,
                   SUM(CASE WHEN status IN ('no_show','noshow','missed') THEN 1 ELSE 0 END) AS ns
            FROM appointments
            WHERE clinic_id = ANY(:cids)
              AND appointment_date >= :df
              AND appointment_date <= :dt
            GROUP BY clinic_id
            """
        )
        r = await db.execute(q, {"cids": list(clinic_ids), "df": dt_from.date(), "dt": dt_to.date()})
        for row in r.all():
            apt_map[row[0]] = {"total": int(row[1] or 0), "no_show": int(row[2] or 0)}
    except Exception:
        pass

    # ── 4. conversion = appointments / referrals (per to_clinic_id) ──────────
    ref_count: dict[uuid.UUID, int] = {cid: 0 for cid in clinic_ids}
    try:
        q = sql_text(
            """
            SELECT to_clinic_id, COUNT(*) AS c
            FROM referrals
            WHERE to_clinic_id = ANY(:cids)
              AND created_at >= :df
              AND created_at <= :dt
            GROUP BY to_clinic_id
            """
        )
        r = await db.execute(q, {"cids": list(clinic_ids), "df": dt_from, "dt": dt_to})
        for row in r.all():
            ref_count[row[0]] = int(row[1] or 0)
    except Exception:
        pass

    # ── 5. retention (30d / 90d): доля пациентов с >1 уник. визитом ──────────
    # Считаем: за период патиенты с count(distinct date) > 1 / уник. пациентов
    retention_30: dict[uuid.UUID, float] = {cid: 0.0 for cid in clinic_ids}
    retention_90: dict[uuid.UUID, float] = {cid: 0.0 for cid in clinic_ids}
    try:
        for win_days, target in ((30, retention_30), (90, retention_90)):
            win_from = (datetime.utcnow() - timedelta(days=win_days)).date()
            q = sql_text(
                """
                WITH pv AS (
                    SELECT clinic_id, patient_phone, COUNT(DISTINCT appointment_date) AS visits
                    FROM appointments
                    WHERE clinic_id = ANY(:cids)
                      AND appointment_date >= :df
                      AND status NOT IN ('cancelled','no_show','noshow')
                    GROUP BY clinic_id, patient_phone
                )
                SELECT clinic_id,
                       COUNT(*) AS uniq_patients,
                       SUM(CASE WHEN visits > 1 THEN 1 ELSE 0 END) AS repeated
                FROM pv
                GROUP BY clinic_id
                """
            )
            r = await db.execute(q, {"cids": list(clinic_ids), "df": win_from})
            for row in r.all():
                uniq = int(row[1] or 0)
                rep = int(row[2] or 0)
                target[row[0]] = round((rep / uniq) * 100, 2) if uniq > 0 else 0.0
    except Exception:
        pass

    # ── Сборка строк ─────────────────────────────────────────────────────────
    rows: list[dict[str, Any]] = []
    for c in clinics:
        rev = rev_map[c.id]["revenue"]
        cnt = rev_map[c.id]["count"]
        docs = doc_count[c.id]
        apt = apt_map[c.id]
        refs = ref_count[c.id]
        avg_check = round(rev / cnt, 2) if cnt > 0 else 0.0
        rev_per_doc = round(rev / docs, 2) if docs > 0 else 0.0
        no_show_rate = round((apt["no_show"] / apt["total"]) * 100, 2) if apt["total"] > 0 else 0.0
        conversion = round((apt["total"] / refs) * 100, 2) if refs > 0 else 0.0
        if conversion > 100:
            conversion = 100.0

        rows.append({
            "clinic_id": str(c.id),
            "clinic_name": c.name,
            "revenue": rev,
            "revenue_per_doctor": rev_per_doc,
            "avg_check": avg_check,
            "appointments_total": apt["total"],
            "no_show_rate": no_show_rate,
            "conversion_rate": conversion,
            "retention_30d": retention_30[c.id],
            "retention_90d": retention_90[c.id],
            "nps": None,
            "doctors_count": docs,
            "referrals_in": refs,
        })

    # Sort default — by revenue DESC
    rows.sort(key=lambda r: r["revenue"], reverse=True)

    return {
        "period": period,
        "from": dt_from.isoformat(),
        "to": dt_to.isoformat(),
        "rows": rows,
        "sources": {"nps": "missing"},
    }


# ── ФИЧА 3: referral-matrix ─────────────────────────────────────────────────


@router.get("/referral-matrix")
async def referral_matrix(
    period: str = Query(..., description="Период YYYY-MM"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Матрица перелива пациентов: from_clinic → to_clinic.

    Источник: inter_clinic_invoices (issuer_clinic_id = откуда направили, recipient_clinic_id = куда).
    Считаем COUNT направлений и SUM(amount) за указанный месяц.
    """
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    date_from, date_to = _ym_period_to_range(period)

    rt = await db.execute(select(Tenant.id).where(Tenant.franchise_id == f.id))
    tenant_ids = [row[0] for row in rt.all()]
    rc = await db.execute(
        select(Clinic).where(Clinic.tenant_id.in_(tenant_ids) if tenant_ids else False).order_by(Clinic.name)
    )
    clinics = list(rc.scalars().all())
    clinic_ids = [c.id for c in clinics]
    if not clinic_ids:
        return {"period": period, "clinics": [], "matrix": [], "notice": "Нет клиник в франшизе"}

    matrix_rows: list[dict[str, Any]] = []
    try:
        q = sql_text(
            """
            SELECT issuer_clinic_id, recipient_clinic_id,
                   COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS revenue
            FROM inter_clinic_invoices
            WHERE issuer_clinic_id = ANY(:cids)
              AND recipient_clinic_id = ANY(:cids)
              AND created_at >= :df
              AND created_at <= :dt
            GROUP BY issuer_clinic_id, recipient_clinic_id
            """
        )
        r = await db.execute(
            q,
            {"cids": list(clinic_ids),
             "df": datetime.combine(date_from, datetime.min.time()),
             "dt": datetime.combine(date_to, datetime.max.time())},
        )
        for row in r.all():
            matrix_rows.append({
                "from": str(row[0]),
                "to": str(row[1]),
                "count": int(row[2] or 0),
                "revenue": float(row[3] or 0),
            })
    except Exception:
        pass

    return {
        "period": period,
        "clinics": [{"id": str(c.id), "name": c.name} for c in clinics],
        "matrix": matrix_rows,
    }
