"""
Кабинет Директора — read-only финансово-операционная отчётность сети.

Доступ: роль `director` (или `franchise_owner`/`super_admin` для read-эндпоинтов).
Все ручки строго GET. Дополнительная защита от write-операций — глобальный
middleware `director_readonly_guard` в main.py.

Endpoints (prefix `/director`):
  GET /me                — данные о директоре + summary франшизы
  GET /dashboard         — топ-виджеты главной (выручка, прибыль, кешфло, sparkline)
  GET /pnl               — P&L за период (?from=&to=&granularity=day|month)
  GET /pnl/by-clinic     — выручка/расходы по клиникам
  GET /pnl/by-service    — топ-20 услуг по выручке
  GET /pnl/by-doctor     — топ-20 врачей по выработке
  GET /cashflow          — ДДС по дням (in / out / net)
  GET /kpi               — средний чек, повторные пациенты, LTV
  GET /kpi/funnel        — лиды → записи → приёмы → оплаты
  GET /marketing/sources — источники пациентов (donut)
  GET /marketing/roi     — ROI рекламы по каналам
  GET /clinics           — список клиник сети с компактными метриками

Источник выручки — clinic_payments (платежи пациентов в клинике):
  ClinicPayment.status == 'succeeded' AND ClinicPayment.paid_at BETWEEN ...

Расходы (Этап 3 INVENTORY_COST_PLAN):
  • Материалы — inventory_movements (type in write_off/outgoing) × batch.unit_cost
  • Реклама — ad_spend_entries.amount по period_from/period_to
  total_expenses = materials + advertising.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_director_or_owner
from app.database import get_db
from app.models.clinic import Clinic
from app.models.doctor import Appointment, AppointmentStatus, Doctor
from app.models.franchise import Franchise
from app.models.inventory import (
    InventoryBatch,
    InventoryItem,
    InventoryMovement,
    InventoryMovementType,
)
from app.models.marketing import AdSpendEntry
from app.models.payments_clinic import ClinicPayment, ClinicPaymentStatus
from app.models.service import Service
from app.models.tenant import Tenant
from app.models.user import User, UserRole

logger = logging.getLogger("director")

router = APIRouter(prefix="/director", tags=["director"])


# ════════════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════════════


async def _get_franchise_id(db: AsyncSession, user: User) -> Optional[uuid.UUID]:
    """Возвращает franchise_id, по которому фильтруем данные.

    Логика по ролям:
      • super_admin    → None (нет фильтра, видим все клиники).
      • director       → user.franchise_id (если не привязан — 403).
      • franchise_owner → Franchise.owner_user_id == user.id.
    """
    role = user.role.value if hasattr(user.role, "value") else str(user.role)

    if role == "super_admin":
        return None

    if role in ("director", "deputy_director"):
        if not getattr(user, "franchise_id", None):
            raise HTTPException(403, "Директор не привязан к франшизе")
        return user.franchise_id

    if role == "franchise_owner":
        r = await db.execute(
            select(Franchise.id).where(Franchise.owner_user_id == user.id)
        )
        fid = r.scalar_one_or_none()
        if not fid:
            raise HTTPException(403, "У владельца нет франшизы")
        return fid

    raise HTTPException(403, "Недостаточно прав")


async def _get_tenant_ids(
    db: AsyncSession, franchise_id: Optional[uuid.UUID]
) -> list[uuid.UUID]:
    """Список tenant_id под этой франшизой (или все активные для super_admin)."""
    q = select(Tenant.id).where(Tenant.is_active.is_(True))
    if franchise_id is not None:
        q = q.where(Tenant.franchise_id == franchise_id)
    r = await db.execute(q)
    return [row[0] for row in r.all()]


def _default_period(
    from_: Optional[date], to: Optional[date]
) -> tuple[date, date]:
    """По умолчанию — последние 30 дней."""
    today = date.today()
    if not to:
        to = today
    if not from_:
        from_ = to - timedelta(days=30)
    return from_, to


def _prev_period_bounds(
    from_: date, to: date
) -> tuple[datetime, datetime]:
    """Границы предыдущего эквивалентного периода."""
    span = (to - from_).days or 1
    prev_to = from_ - timedelta(days=1)
    prev_from = prev_to - timedelta(days=span)
    return (
        datetime.combine(prev_from, datetime.min.time()),
        datetime.combine(prev_to, datetime.max.time()),
    )


async def _revenue_sum(
    db: AsyncSession,
    tenant_ids: list[uuid.UUID],
    start: datetime,
    end: datetime,
) -> Decimal:
    """Сумма успешных платежей пациентов за период.

    ClinicPayment — оплаты пациентами клинике (НЕ путать с подпиской платформы).
    """
    if not tenant_ids:
        return Decimal("0")
    q = select(func.coalesce(func.sum(ClinicPayment.amount), 0)).where(
        and_(
            ClinicPayment.tenant_id.in_(tenant_ids),
            ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
            ClinicPayment.paid_at >= start,
            ClinicPayment.paid_at <= end,
        )
    )
    r = await db.execute(q)
    return Decimal(str(r.scalar() or 0))


async def _appointments_count(
    db: AsyncSession,
    tenant_ids: list[uuid.UUID],
    start: date,
    end: date,
    status: Optional[AppointmentStatus] = None,
) -> int:
    if not tenant_ids:
        return 0
    q = select(func.count(Appointment.id)).where(
        and_(
            Appointment.tenant_id.in_(tenant_ids),
            Appointment.appointment_date >= start,
            Appointment.appointment_date <= end,
        )
    )
    if status is not None:
        q = q.where(Appointment.status == status)
    r = await db.execute(q)
    return int(r.scalar() or 0)


# ─── Расходы (Этап 3 INVENTORY_COST_PLAN) ──────────────────────────────────


async def _materials_expenses(
    db: AsyncSession,
    tenant_ids: list[uuid.UUID],
    start: datetime,
    end: datetime,
) -> Decimal:
    """Стоимость списанных материалов (write_off + outgoing) за период.

    Δ = ABS(quantity) * batch.unit_cost, JOIN inventory_batches.
    Если batch_id NULL (legacy-движения) — fallback на item.cost_per_unit.
    """
    if not tenant_ids:
        return Decimal("0")
    # С батчем (точная себестоимость).
    q1 = (
        select(
            func.coalesce(
                func.sum(
                    func.abs(InventoryMovement.quantity)
                    * InventoryBatch.unit_cost
                ),
                0,
            )
        )
        .select_from(InventoryMovement)
        .join(InventoryBatch, InventoryBatch.id == InventoryMovement.batch_id)
        .where(
            InventoryMovement.tenant_id.in_(tenant_ids),
            InventoryMovement.type.in_(
                [
                    InventoryMovementType.WRITE_OFF,
                    InventoryMovementType.OUTGOING,
                ]
            ),
            InventoryMovement.quantity < 0,
            InventoryMovement.created_at >= start,
            InventoryMovement.created_at <= end,
        )
    )
    s1 = (await db.execute(q1)).scalar() or 0
    # Без батча — fallback по item.cost_per_unit.
    q2 = (
        select(
            func.coalesce(
                func.sum(
                    func.abs(InventoryMovement.quantity)
                    * InventoryItem.cost_per_unit
                ),
                0,
            )
        )
        .select_from(InventoryMovement)
        .join(InventoryItem, InventoryItem.id == InventoryMovement.item_id)
        .where(
            InventoryMovement.tenant_id.in_(tenant_ids),
            InventoryMovement.type.in_(
                [
                    InventoryMovementType.WRITE_OFF,
                    InventoryMovementType.OUTGOING,
                ]
            ),
            InventoryMovement.quantity < 0,
            InventoryMovement.batch_id.is_(None),
            InventoryMovement.created_at >= start,
            InventoryMovement.created_at <= end,
        )
    )
    s2 = (await db.execute(q2)).scalar() or 0
    return Decimal(str(s1)) + Decimal(str(s2))


async def _ads_expenses(
    db: AsyncSession,
    tenant_ids: list[uuid.UUID],
    start: date,
    end: date,
) -> Decimal:
    """Рекламные расходы за период.

    AdSpendEntry хранит period_from / period_to: считаем суммой записей,
    у которых диапазон пересекается с (start, end).
    """
    if not tenant_ids:
        return Decimal("0")
    q = select(func.coalesce(func.sum(AdSpendEntry.amount), 0)).where(
        AdSpendEntry.tenant_id.in_(tenant_ids),
        AdSpendEntry.period_from <= end,
        AdSpendEntry.period_to >= start,
    )
    r = await db.execute(q)
    return Decimal(str(r.scalar() or 0))


async def _expenses_total(
    db: AsyncSession,
    tenant_ids: list[uuid.UUID],
    period_from: date,
    period_to: date,
) -> dict[str, Decimal]:
    """Свод расходов за период: материалы + реклама.

    Возвращает {materials, advertising, total}.
    """
    start_dt = datetime.combine(period_from, datetime.min.time())
    end_dt = datetime.combine(period_to, datetime.max.time())
    materials = await _materials_expenses(db, tenant_ids, start_dt, end_dt)
    ads = await _ads_expenses(db, tenant_ids, period_from, period_to)
    return {
        "materials": materials,
        "advertising": ads,
        "total": materials + ads,
    }


# ════════════════════════════════════════════════════════════════════════════
# Endpoints
# ════════════════════════════════════════════════════════════════════════════


@router.get("/me")
async def me(
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """Данные о текущем директоре + краткая сводка по франшизе."""
    franchise_id = await _get_franchise_id(db, user)

    franchise = None
    if franchise_id is not None:
        f = await db.get(Franchise, franchise_id)
        if f:
            franchise = {
                "id": str(f.id),
                "name": f.name,
                "slug": f.slug,
                "is_active": f.is_active,
                "is_blocked": f.is_blocked,
            }

    tenant_ids = await _get_tenant_ids(db, franchise_id)

    # Кол-во клиник во всех тенантах франшизы
    clinics_count = 0
    if tenant_ids:
        r = await db.execute(
            select(func.count(Clinic.id)).where(
                and_(Clinic.tenant_id.in_(tenant_ids), Clinic.is_active.is_(True))
            )
        )
        clinics_count = int(r.scalar() or 0)

    return {
        "user": {
            "id": str(user.id),
            "full_name": user.full_name,
            "role": user.role.value
            if hasattr(user.role, "value")
            else str(user.role),
            "username": user.username,
            "email": user.email,
        },
        "franchise": franchise,
        "summary": {
            "clinics_count": clinics_count,
            "tenants_count": len(tenant_ids),
        },
    }


@router.get("/dashboard")
async def dashboard(
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """Главные виджеты: выручка, прибыль, кешфло + спарклайны/топы."""
    franchise_id = await _get_franchise_id(db, user)
    tenant_ids = await _get_tenant_ids(db, franchise_id)

    today = date.today()
    period_from = today - timedelta(days=30)
    period_to = today

    start_dt = datetime.combine(period_from, datetime.min.time())
    end_dt = datetime.combine(period_to, datetime.max.time())
    prev_start, prev_end = _prev_period_bounds(period_from, period_to)

    # Выручка
    cur_rev = await _revenue_sum(db, tenant_ids, start_dt, end_dt)
    prev_rev = await _revenue_sum(db, tenant_ids, prev_start, prev_end)
    growth_pct = 0.0
    if prev_rev > 0:
        growth_pct = float((cur_rev - prev_rev) / prev_rev * 100)

    # Кол-во приёмов и пациентов
    appts = await _appointments_count(
        db, tenant_ids, period_from, period_to
    )
    patients = 0
    if tenant_ids:
        r = await db.execute(
            select(func.count(func.distinct(Appointment.patient_phone))).where(
                and_(
                    Appointment.tenant_id.in_(tenant_ids),
                    Appointment.appointment_date >= period_from,
                    Appointment.appointment_date <= period_to,
                )
            )
        )
        patients = int(r.scalar() or 0)

    # Кол-во клиник
    clinics_count = 0
    if tenant_ids:
        r = await db.execute(
            select(func.count(Clinic.id)).where(
                and_(Clinic.tenant_id.in_(tenant_ids), Clinic.is_active.is_(True))
            )
        )
        clinics_count = int(r.scalar() or 0)

    # Sparkline выручки — последние 12 месяцев (помесячно)
    revenue_sparkline: list[dict[str, Any]] = []
    if tenant_ids:
        # Берём текущий месяц как 12-й
        cursor_month = date(today.year, today.month, 1)
        # Откатываемся на 11 месяцев назад
        months: list[date] = []
        m = cursor_month
        for _ in range(12):
            months.append(m)
            # Шаг назад на 1 месяц
            prev_y, prev_m = (m.year, m.month - 1) if m.month > 1 else (m.year - 1, 12)
            m = date(prev_y, prev_m, 1)
        months.reverse()
        for mstart in months:
            # mend — последний день месяца
            if mstart.month == 12:
                mend = date(mstart.year, 12, 31)
            else:
                mend = date(mstart.year, mstart.month + 1, 1) - timedelta(days=1)
            val = await _revenue_sum(
                db,
                tenant_ids,
                datetime.combine(mstart, datetime.min.time()),
                datetime.combine(mend, datetime.max.time()),
            )
            revenue_sparkline.append(
                {"date": mstart.strftime("%Y-%m"), "value": float(val)}
            )

    # Top-5 услуг и top-5 врачей за период — переиспользуем эндпоинты
    top_services = await _top_services(db, tenant_ids, start_dt, end_dt, limit=5)
    top_doctors = await _top_doctors(db, tenant_ids, start_dt, end_dt, limit=5)

    # Этап 3 INVENTORY_COST_PLAN: реальные расходы (материалы + реклама).
    exp = await _expenses_total(db, tenant_ids, period_from, period_to)
    exp_total = exp["total"]
    profit_cur = cur_rev - exp_total
    profit_margin_pct = (
        float(profit_cur / cur_rev * 100) if cur_rev > 0 else 0.0
    )

    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "revenue": {
            "current": float(cur_rev),
            "prev": float(prev_rev),
            "growth_pct": round(growth_pct, 1),
        },
        "expenses": {
            "current": float(exp_total),
            "materials": float(exp["materials"]),
            "advertising": float(exp["advertising"]),
        },
        "profit": {
            "current": float(profit_cur),
            "margin_pct": round(profit_margin_pct, 1),
        },
        "cashflow": {
            "in": float(cur_rev),
            "out": float(exp_total),
            "net": float(cur_rev - exp_total),
        },
        "clinics_count": clinics_count,
        "appointments_count": appts,
        "patients_count": patients,
        "revenue_sparkline": revenue_sparkline,
        "top_services": top_services,
        "top_doctors": top_doctors,
    }


# ─── P&L ─────────────────────────────────────────────────────────────────────


@router.get("/pnl")
async def pnl(
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    granularity: str = Query("month", regex="^(day|month)$"),
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """P&L по сети за период с заданной гранулярностью."""
    franchise_id = await _get_franchise_id(db, user)
    tenant_ids = await _get_tenant_ids(db, franchise_id)

    period_from, period_to = _default_period(from_, to)

    series: list[dict[str, Any]] = []
    total_rev = Decimal("0")

    total_exp = Decimal("0")

    if tenant_ids:
        if granularity == "day":
            # День за днём — для коротких периодов
            cursor = period_from
            while cursor <= period_to:
                start_dt = datetime.combine(cursor, datetime.min.time())
                end_dt = datetime.combine(cursor, datetime.max.time())
                rev = await _revenue_sum(db, tenant_ids, start_dt, end_dt)
                exp = await _expenses_total(db, tenant_ids, cursor, cursor)
                exp_total = exp["total"]
                series.append(
                    {
                        "date": cursor.isoformat(),
                        "revenue": float(rev),
                        "expenses": float(exp_total),
                        "profit": float(rev - exp_total),
                    }
                )
                total_rev += rev
                total_exp += exp_total
                cursor += timedelta(days=1)
        else:
            # По месяцам
            cursor = date(period_from.year, period_from.month, 1)
            while cursor <= period_to:
                if cursor.month == 12:
                    next_month = date(cursor.year + 1, 1, 1)
                else:
                    next_month = date(cursor.year, cursor.month + 1, 1)
                mend = min(next_month - timedelta(days=1), period_to)
                mstart = max(cursor, period_from)
                rev = await _revenue_sum(
                    db,
                    tenant_ids,
                    datetime.combine(mstart, datetime.min.time()),
                    datetime.combine(mend, datetime.max.time()),
                )
                exp = await _expenses_total(db, tenant_ids, mstart, mend)
                exp_total = exp["total"]
                series.append(
                    {
                        "date": cursor.strftime("%Y-%m"),
                        "revenue": float(rev),
                        "expenses": float(exp_total),
                        "profit": float(rev - exp_total),
                    }
                )
                total_rev += rev
                total_exp += exp_total
                cursor = next_month

    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "granularity": granularity,
        "series": series,
        "totals": {
            "revenue": float(total_rev),
            "expenses": float(total_exp),
            "profit": float(total_rev - total_exp),
        },
    }


@router.get("/pnl/by-clinic")
async def pnl_by_clinic(
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """Разбивка выручки/прибыли по клиникам сети."""
    franchise_id = await _get_franchise_id(db, user)
    tenant_ids = await _get_tenant_ids(db, franchise_id)
    period_from, period_to = _default_period(from_, to)
    start_dt = datetime.combine(period_from, datetime.min.time())
    end_dt = datetime.combine(period_to, datetime.max.time())

    items: list[dict[str, Any]] = []
    if tenant_ids:
        # Группируем по clinic_id
        q = (
            select(
                ClinicPayment.clinic_id,
                func.coalesce(func.sum(ClinicPayment.amount), 0).label("revenue"),
                func.count(ClinicPayment.id).label("payments_count"),
            )
            .where(
                and_(
                    ClinicPayment.tenant_id.in_(tenant_ids),
                    ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
                    ClinicPayment.paid_at >= start_dt,
                    ClinicPayment.paid_at <= end_dt,
                )
            )
            .group_by(ClinicPayment.clinic_id)
        )
        r = await db.execute(q)
        rows = r.all()
        clinic_ids = [row[0] for row in rows]
        rev_by_clinic = {row[0]: (row[1], row[2]) for row in rows}

        # Расходы по материалам — группировка по clinic_id из inventory_movements.
        mat_by_clinic: dict[uuid.UUID, Decimal] = {}
        q_mat = (
            select(
                InventoryMovement.clinic_id,
                func.coalesce(
                    func.sum(
                        func.abs(InventoryMovement.quantity)
                        * InventoryBatch.unit_cost
                    ),
                    0,
                ).label("expenses"),
            )
            .select_from(InventoryMovement)
            .join(InventoryBatch, InventoryBatch.id == InventoryMovement.batch_id)
            .where(
                InventoryMovement.tenant_id.in_(tenant_ids),
                InventoryMovement.type.in_(
                    [
                        InventoryMovementType.WRITE_OFF,
                        InventoryMovementType.OUTGOING,
                    ]
                ),
                InventoryMovement.quantity < 0,
                InventoryMovement.created_at >= start_dt,
                InventoryMovement.created_at <= end_dt,
            )
            .group_by(InventoryMovement.clinic_id)
        )
        r_mat = await db.execute(q_mat)
        for row in r_mat.all():
            mat_by_clinic[row[0]] = Decimal(str(row[1] or 0))

        # Расходы на рекламу — группировка по clinic_id (если есть).
        ads_by_clinic: dict[uuid.UUID, Decimal] = {}
        q_ads = (
            select(
                AdSpendEntry.clinic_id,
                func.coalesce(func.sum(AdSpendEntry.amount), 0).label("amt"),
            )
            .where(
                AdSpendEntry.tenant_id.in_(tenant_ids),
                AdSpendEntry.period_from <= period_to,
                AdSpendEntry.period_to >= period_from,
                AdSpendEntry.clinic_id.isnot(None),
            )
            .group_by(AdSpendEntry.clinic_id)
        )
        r_ads = await db.execute(q_ads)
        for row in r_ads.all():
            if row[0] is not None:
                ads_by_clinic[row[0]] = Decimal(str(row[1] or 0))

        # Подтягиваем имена клиник (включая те, у которых только расходы).
        all_clinic_ids = (
            set(clinic_ids) | set(mat_by_clinic.keys()) | set(ads_by_clinic.keys())
        )
        clinics_map: dict[uuid.UUID, Clinic] = {}
        if all_clinic_ids:
            rc = await db.execute(
                select(Clinic).where(Clinic.id.in_(list(all_clinic_ids)))
            )
            for c in rc.scalars().all():
                clinics_map[c.id] = c

        for cid in all_clinic_ids:
            rev_tuple = rev_by_clinic.get(cid)
            rev = rev_tuple[0] if rev_tuple else Decimal("0")
            cnt = rev_tuple[1] if rev_tuple else 0
            mat = mat_by_clinic.get(cid, Decimal("0"))
            ads = ads_by_clinic.get(cid, Decimal("0"))
            exp_total = mat + ads
            profit = Decimal(str(rev)) - exp_total
            margin = (
                float(profit / Decimal(str(rev)) * 100)
                if rev and Decimal(str(rev)) > 0
                else 0
            )
            c = clinics_map.get(cid)
            items.append(
                {
                    "clinic_id": str(cid),
                    "clinic_name": c.name if c else "—",
                    "city": c.city if c else None,
                    "revenue": float(rev),
                    "expenses": float(exp_total),
                    "expenses_materials": float(mat),
                    "expenses_advertising": float(ads),
                    "profit": float(profit),
                    "margin_pct": round(margin, 1),
                    "payments_count": int(cnt),
                }
            )
        items.sort(key=lambda x: x["revenue"], reverse=True)

    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "clinics": items,
    }


async def _top_services(
    db: AsyncSession,
    tenant_ids: list[uuid.UUID],
    start_dt: datetime,
    end_dt: datetime,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Топ услуг по выручке (JOIN payments → appointments → services)."""
    if not tenant_ids:
        return []
    # appointment.service_id отсутствует напрямую; в нашей схеме service связан с
    # referral. Простая аппроксимация: группируем выручку по appointment.price
    # и берём услугу через referrals. Если структура слишком сложная — fallback
    # на сумму по appointment.price без service_name.
    try:
        from app.models.referral import Referral

        q = (
            select(
                Service.id,
                Service.name,
                func.coalesce(func.sum(ClinicPayment.amount), 0).label("revenue"),
                func.count(ClinicPayment.id).label("cnt"),
            )
            .join(Appointment, Appointment.id == ClinicPayment.appointment_id)
            .join(Referral, Referral.id == Appointment.referral_id)
            .join(Service, Service.id == Referral.service_id)
            .where(
                and_(
                    ClinicPayment.tenant_id.in_(tenant_ids),
                    ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
                    ClinicPayment.paid_at >= start_dt,
                    ClinicPayment.paid_at <= end_dt,
                )
            )
            .group_by(Service.id, Service.name)
            .order_by(func.sum(ClinicPayment.amount).desc())
            .limit(limit)
        )
        r = await db.execute(q)
        return [
            {
                "service_id": str(row[0]),
                "service_name": row[1],
                "revenue": float(row[2] or 0),
                "count": int(row[3] or 0),
            }
            for row in r.all()
        ]
    except SQLAlchemyError as e:
        logger.warning("top_services fallback: %s", e)
        return []
    except Exception as e:  # noqa: BLE001
        logger.warning("top_services unexpected: %s", e)
        return []


@router.get("/pnl/by-service")
async def pnl_by_service(
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    franchise_id = await _get_franchise_id(db, user)
    tenant_ids = await _get_tenant_ids(db, franchise_id)
    period_from, period_to = _default_period(from_, to)
    start_dt = datetime.combine(period_from, datetime.min.time())
    end_dt = datetime.combine(period_to, datetime.max.time())

    items = await _top_services(db, tenant_ids, start_dt, end_dt, limit=20)
    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "services": items,
    }


async def _top_doctors(
    db: AsyncSession,
    tenant_ids: list[uuid.UUID],
    start_dt: datetime,
    end_dt: datetime,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Топ врачей по выработке (через appointments + payments)."""
    if not tenant_ids:
        return []
    try:
        q = (
            select(
                Doctor.id,
                Doctor.full_name,
                Doctor.specialty,
                func.coalesce(func.sum(ClinicPayment.amount), 0).label("revenue"),
                func.count(ClinicPayment.id).label("cnt"),
            )
            .join(Appointment, Appointment.doctor_id == Doctor.id)
            .join(ClinicPayment, ClinicPayment.appointment_id == Appointment.id)
            .where(
                and_(
                    ClinicPayment.tenant_id.in_(tenant_ids),
                    ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
                    ClinicPayment.paid_at >= start_dt,
                    ClinicPayment.paid_at <= end_dt,
                )
            )
            .group_by(Doctor.id, Doctor.full_name, Doctor.specialty)
            .order_by(func.sum(ClinicPayment.amount).desc())
            .limit(limit)
        )
        r = await db.execute(q)
        return [
            {
                "doctor_id": str(row[0]),
                "doctor_name": row[1],
                "specialty": row[2],
                "revenue": float(row[3] or 0),
                "appointments": int(row[4] or 0),
            }
            for row in r.all()
        ]
    except SQLAlchemyError as e:
        logger.warning("top_doctors fallback: %s", e)
        return []
    except Exception as e:  # noqa: BLE001
        logger.warning("top_doctors unexpected: %s", e)
        return []


@router.get("/pnl/by-doctor")
async def pnl_by_doctor(
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    franchise_id = await _get_franchise_id(db, user)
    tenant_ids = await _get_tenant_ids(db, franchise_id)
    period_from, period_to = _default_period(from_, to)
    start_dt = datetime.combine(period_from, datetime.min.time())
    end_dt = datetime.combine(period_to, datetime.max.time())

    items = await _top_doctors(db, tenant_ids, start_dt, end_dt, limit=20)
    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "doctors": items,
    }


# ─── Cashflow ────────────────────────────────────────────────────────────────


@router.get("/cashflow")
async def cashflow(
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """ДДС по дням (поступления + выплаты).

    Расходов пока нет → out=0, net=in. Возвращаем notice для фронта.
    """
    franchise_id = await _get_franchise_id(db, user)
    tenant_ids = await _get_tenant_ids(db, franchise_id)
    period_from, period_to = _default_period(from_, to)

    series: list[dict[str, Any]] = []
    total_in = Decimal("0")
    total_out = Decimal("0")

    if tenant_ids:
        # Группируем платежи по дате (paid_at::date)
        q = (
            select(
                func.date_trunc("day", ClinicPayment.paid_at).label("d"),
                func.coalesce(func.sum(ClinicPayment.amount), 0).label("amt"),
            )
            .where(
                and_(
                    ClinicPayment.tenant_id.in_(tenant_ids),
                    ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
                    ClinicPayment.paid_at
                    >= datetime.combine(period_from, datetime.min.time()),
                    ClinicPayment.paid_at
                    <= datetime.combine(period_to, datetime.max.time()),
                )
            )
            .group_by("d")
            .order_by("d")
        )
        r = await db.execute(q)
        by_day_in: dict[date, Decimal] = {}
        for row in r.all():
            if row[0] is None:
                continue
            d = row[0].date() if hasattr(row[0], "date") else row[0]
            by_day_in[d] = Decimal(str(row[1] or 0))

        # Расходы по дням — материалы (по created_at) + реклама (по period_from).
        by_day_out: dict[date, Decimal] = {}
        q_mat_day = (
            select(
                func.date_trunc("day", InventoryMovement.created_at).label("d"),
                func.coalesce(
                    func.sum(
                        func.abs(InventoryMovement.quantity)
                        * InventoryBatch.unit_cost
                    ),
                    0,
                ).label("amt"),
            )
            .select_from(InventoryMovement)
            .join(InventoryBatch, InventoryBatch.id == InventoryMovement.batch_id)
            .where(
                InventoryMovement.tenant_id.in_(tenant_ids),
                InventoryMovement.type.in_(
                    [
                        InventoryMovementType.WRITE_OFF,
                        InventoryMovementType.OUTGOING,
                    ]
                ),
                InventoryMovement.quantity < 0,
                InventoryMovement.created_at
                >= datetime.combine(period_from, datetime.min.time()),
                InventoryMovement.created_at
                <= datetime.combine(period_to, datetime.max.time()),
            )
            .group_by("d")
        )
        rm = await db.execute(q_mat_day)
        for row in rm.all():
            if row[0] is None:
                continue
            d = row[0].date() if hasattr(row[0], "date") else row[0]
            by_day_out[d] = by_day_out.get(d, Decimal("0")) + Decimal(
                str(row[1] or 0)
            )

        # Реклама: суммируем по period_from (упрощение).
        q_ads_day = (
            select(
                AdSpendEntry.period_from,
                func.coalesce(func.sum(AdSpendEntry.amount), 0).label("amt"),
            )
            .where(
                AdSpendEntry.tenant_id.in_(tenant_ids),
                AdSpendEntry.period_from >= period_from,
                AdSpendEntry.period_from <= period_to,
            )
            .group_by(AdSpendEntry.period_from)
        )
        ra = await db.execute(q_ads_day)
        for row in ra.all():
            d = row[0]
            if d is None:
                continue
            by_day_out[d] = by_day_out.get(d, Decimal("0")) + Decimal(
                str(row[1] or 0)
            )

        cursor = period_from
        while cursor <= period_to:
            v_in = by_day_in.get(cursor, Decimal("0"))
            v_out = by_day_out.get(cursor, Decimal("0"))
            series.append(
                {
                    "date": cursor.isoformat(),
                    "in": float(v_in),
                    "out": float(v_out),
                    "net": float(v_in - v_out),
                }
            )
            total_in += v_in
            total_out += v_out
            cursor += timedelta(days=1)

    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "series": series,
        "totals": {
            "in": float(total_in),
            "out": float(total_out),
            "net": float(total_in - total_out),
        },
    }


# ─── KPI ─────────────────────────────────────────────────────────────────────


@router.get("/kpi")
async def kpi(
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """KPI сети: средний чек, повторные пациенты, LTV (грубо)."""
    franchise_id = await _get_franchise_id(db, user)
    tenant_ids = await _get_tenant_ids(db, franchise_id)
    period_from, period_to = _default_period(from_, to)
    start_dt = datetime.combine(period_from, datetime.min.time())
    end_dt = datetime.combine(period_to, datetime.max.time())

    avg_check = 0.0
    payments_count = 0
    unique_patients = 0
    repeat_patients = 0
    ltv_avg = 0.0

    if tenant_ids:
        # Avg check + кол-во платежей
        r = await db.execute(
            select(
                func.avg(ClinicPayment.amount),
                func.count(ClinicPayment.id),
            ).where(
                and_(
                    ClinicPayment.tenant_id.in_(tenant_ids),
                    ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
                    ClinicPayment.paid_at >= start_dt,
                    ClinicPayment.paid_at <= end_dt,
                )
            )
        )
        row = r.first()
        if row:
            avg_check = float(row[0] or 0)
            payments_count = int(row[1] or 0)

        # Уникальные пациенты по phone
        r = await db.execute(
            select(func.count(func.distinct(ClinicPayment.patient_phone))).where(
                and_(
                    ClinicPayment.tenant_id.in_(tenant_ids),
                    ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
                    ClinicPayment.paid_at >= start_dt,
                    ClinicPayment.paid_at <= end_dt,
                )
            )
        )
        unique_patients = int(r.scalar() or 0)

        # Повторные пациенты — у кого > 1 платежа за период
        sub = (
            select(
                ClinicPayment.patient_phone.label("p"),
                func.count(ClinicPayment.id).label("c"),
            )
            .where(
                and_(
                    ClinicPayment.tenant_id.in_(tenant_ids),
                    ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
                    ClinicPayment.paid_at >= start_dt,
                    ClinicPayment.paid_at <= end_dt,
                )
            )
            .group_by(ClinicPayment.patient_phone)
            .having(func.count(ClinicPayment.id) > 1)
            .subquery()
        )
        r = await db.execute(select(func.count()).select_from(sub))
        repeat_patients = int(r.scalar() or 0)

        # LTV (упрощённо: вся выручка / уникальные пациенты за всё время в этих тенантах)
        r = await db.execute(
            select(
                func.coalesce(func.sum(ClinicPayment.amount), 0),
                func.count(func.distinct(ClinicPayment.patient_phone)),
            ).where(
                and_(
                    ClinicPayment.tenant_id.in_(tenant_ids),
                    ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
                )
            )
        )
        row = r.first()
        if row and row[1]:
            ltv_avg = float(Decimal(str(row[0] or 0)) / Decimal(row[1]))

    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "avg_check": round(avg_check, 2),
        "payments_count": payments_count,
        "unique_patients": unique_patients,
        "repeat_patients": repeat_patients,
        "repeat_rate_pct": round(
            (repeat_patients / unique_patients * 100) if unique_patients else 0, 1
        ),
        "ltv_avg": round(ltv_avg, 2),
    }


@router.get("/kpi/funnel")
async def kpi_funnel(
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """Воронка: заявки → записи → приёмы → оплачено."""
    franchise_id = await _get_franchise_id(db, user)
    tenant_ids = await _get_tenant_ids(db, franchise_id)
    period_from, period_to = _default_period(from_, to)
    start_dt = datetime.combine(period_from, datetime.min.time())
    end_dt = datetime.combine(period_to, datetime.max.time())

    # 1. Заявки (contact_requests) — глобальная таблица без tenant_id, поэтому
    # для франшизного директора она даст шум. Берём общую цифру за период, но
    # фронт может показать её с пометкой «вся платформа».
    leads = 0
    try:
        from app.models.contact_request import ContactRequest

        r = await db.execute(
            select(func.count(ContactRequest.id)).where(
                and_(
                    ContactRequest.created_at >= start_dt,
                    ContactRequest.created_at <= end_dt,
                )
            )
        )
        leads = int(r.scalar() or 0)
    except Exception as e:  # noqa: BLE001
        logger.info("funnel: contact_requests not available: %s", e)

    # 2. Записи (appointments — любой статус)
    booked = await _appointments_count(db, tenant_ids, period_from, period_to)

    # 3. Состоявшиеся приёмы (COMPLETED)
    completed = await _appointments_count(
        db, tenant_ids, period_from, period_to, status=AppointmentStatus.COMPLETED
    )

    # 4. Оплачено — кол-во успешных платежей
    paid_count = 0
    if tenant_ids:
        r = await db.execute(
            select(func.count(ClinicPayment.id)).where(
                and_(
                    ClinicPayment.tenant_id.in_(tenant_ids),
                    ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
                    ClinicPayment.paid_at >= start_dt,
                    ClinicPayment.paid_at <= end_dt,
                )
            )
        )
        paid_count = int(r.scalar() or 0)

    def pct(a: int, b: int) -> float:
        return round((a / b * 100), 1) if b else 0.0

    stages = [
        {"name": "Заявки", "count": leads, "conversion_pct": 100.0},
        {
            "name": "Записи",
            "count": booked,
            "conversion_pct": pct(booked, leads) if leads else 0.0,
        },
        {
            "name": "Приёмы",
            "count": completed,
            "conversion_pct": pct(completed, booked),
        },
        {
            "name": "Оплачено",
            "count": paid_count,
            "conversion_pct": pct(paid_count, completed),
        },
    ]

    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "stages": stages,
        "total_conversion_pct": pct(paid_count, leads) if leads else 0.0,
        "notes": {
            "leads_scope": "all_platform" if franchise_id else "all_platform",
        },
    }


# ─── Marketing ──────────────────────────────────────────────────────────────


@router.get("/marketing/sources")
async def marketing_sources(
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """Источники пациентов (donut chart).

    JOIN'им `patient_attribution` (источник) → `clinic_payments` через `patient_phone`
    в рамках тенантов франшизы. Возвращаем агрегированные пациенты + выручку по каналам.
    Если в БД ещё нет атрибуций — возвращаем пустой список, но без заглушки `notice`.
    """
    from sqlalchemy import text

    franchise_id = await _get_franchise_id(db, user)
    tenant_ids = await _get_tenant_ids(db, franchise_id)
    period_from, period_to = _default_period(from_, to)

    if not tenant_ids:
        return {
            "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
            "sources": [], "total": 0, "total_revenue": 0.0,
        }

    sql = text("""
        WITH attr AS (
            SELECT pa.tenant_id, pa.patient_phone, pa.patient_user_id, pa.channel_id
            FROM patient_attribution pa
            WHERE pa.tenant_id = ANY(:tids)
              AND pa.patient_phone IS NOT NULL
        ),
        rev AS (
            -- Выручка пациента в clinic_payments за период
            SELECT
                a.tenant_id, a.channel_id,
                a.patient_phone,
                COALESCE(SUM(cp.amount), 0) AS revenue,
                COUNT(DISTINCT cp.appointment_id) FILTER (WHERE cp.appointment_id IS NOT NULL) AS appointments_count
            FROM attr a
            LEFT JOIN clinic_payments cp
              ON  cp.tenant_id = a.tenant_id
              AND cp.patient_phone = a.patient_phone
              AND cp.status = 'succeeded'
              AND cp.paid_at::date BETWEEN :pf AND :pt
            GROUP BY a.tenant_id, a.channel_id, a.patient_phone
        )
        SELECT
            COALESCE(mc.code, 'unknown')      AS code,
            COALESCE(mc.name, 'Неизвестно')   AS name,
            COALESCE(mc.icon, 'help')         AS icon,
            COUNT(DISTINCT r.patient_phone)   AS patients_count,
            COALESCE(SUM(r.appointments_count), 0) AS appointments_count,
            COALESCE(SUM(r.revenue), 0)       AS revenue
        FROM rev r
        LEFT JOIN marketing_channels mc ON mc.id = r.channel_id
        GROUP BY mc.code, mc.name, mc.icon
        ORDER BY revenue DESC, patients_count DESC
    """)
    result = await db.execute(sql, {"tids": tenant_ids, "pf": period_from, "pt": period_to})
    rows = [dict(row) for row in result.mappings()]
    total_patients = sum(int(r["patients_count"]) for r in rows) or 0

    sources = []
    for r in rows:
        rev = float(r["revenue"] or 0)
        cnt = int(r["patients_count"] or 0)
        pct = round(cnt * 100.0 / total_patients, 1) if total_patients else 0.0
        sources.append({
            "code": r["code"],
            "name": r["name"],
            "icon": r["icon"],
            "count": cnt,                       # для donut (старое имя)
            "patients_count": cnt,
            "appointments_count": int(r["appointments_count"] or 0),
            "revenue": rev,
            "pct": pct,
        })
    total_revenue = sum(s["revenue"] for s in sources)

    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "sources": sources,
        "total": total_patients,
        "total_revenue": total_revenue,
    }


@router.get("/marketing/roi")
async def marketing_roi(
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """ROI по рекламным каналам.

    Расход — из `ad_spend_entries`, выручка — из `clinic_payments` через
    `patient_attribution.patient_phone`. Возвращаем по каждому каналу:
    spent, revenue, ROI%, CPL (цена лида), CAC (стоимость привлечения пациента).
    """
    from sqlalchemy import text

    franchise_id = await _get_franchise_id(db, user)
    tenant_ids = await _get_tenant_ids(db, franchise_id)
    period_from, period_to = _default_period(from_, to)

    if not tenant_ids:
        return {
            "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
            "channels": [],
            "totals": {"spent": 0.0, "revenue": 0.0, "leads": 0, "patients": 0, "roi_pct": 0.0, "cpl": 0.0, "cac": 0.0},
        }

    sql = text("""
        WITH spend_by_channel AS (
            SELECT
                s.channel_id,
                SUM(s.amount)            AS total_spent,
                SUM(s.leads_count)       AS total_leads,
                SUM(s.clicks_count)      AS total_clicks,
                SUM(s.impressions_count) AS total_impressions
            FROM ad_spend_entries s
            WHERE s.tenant_id = ANY(:tids)
              AND s.period_from <= :pt
              AND s.period_to   >= :pf
            GROUP BY s.channel_id
        ),
        revenue_by_channel AS (
            SELECT
                pa.channel_id,
                COUNT(DISTINCT pa.patient_phone) AS patients_acquired,
                COALESCE(SUM(cp.amount), 0)      AS revenue_attributed
            FROM patient_attribution pa
            LEFT JOIN clinic_payments cp
              ON  cp.tenant_id     = pa.tenant_id
              AND cp.patient_phone = pa.patient_phone
              AND cp.status = 'succeeded'
              AND cp.paid_at::date BETWEEN :pf AND :pt
            WHERE pa.tenant_id = ANY(:tids)
              AND pa.patient_phone IS NOT NULL
            GROUP BY pa.channel_id
        ),
        all_channels AS (
            SELECT channel_id FROM spend_by_channel
            UNION
            SELECT channel_id FROM revenue_by_channel
        )
        SELECT
            ac.channel_id,
            mc.code, mc.name, mc.icon,
            COALESCE(sb.total_spent, 0)         AS total_spent,
            COALESCE(sb.total_leads, 0)         AS total_leads,
            COALESCE(sb.total_clicks, 0)        AS total_clicks,
            COALESCE(sb.total_impressions, 0)   AS total_impressions,
            COALESCE(rb.patients_acquired, 0)   AS patients_acquired,
            COALESCE(rb.revenue_attributed, 0)  AS revenue
        FROM all_channels ac
        LEFT JOIN spend_by_channel   sb ON sb.channel_id = ac.channel_id
        LEFT JOIN revenue_by_channel rb ON rb.channel_id = ac.channel_id
        LEFT JOIN marketing_channels mc ON mc.id        = ac.channel_id
        ORDER BY revenue DESC, total_spent DESC
    """)
    result = await db.execute(sql, {"tids": tenant_ids, "pf": period_from, "pt": period_to})

    channels: list[dict[str, Any]] = []
    total_spent = Decimal("0")
    total_revenue = Decimal("0")
    total_leads = 0
    total_patients = 0

    for r in result.mappings():
        spent = Decimal(str(r["total_spent"] or 0))
        rev   = Decimal(str(r["revenue"] or 0))
        leads = int(r["total_leads"] or 0)
        patients = int(r["patients_acquired"] or 0)

        roi_pct = float((rev - spent) / spent * 100) if spent > 0 else 0.0
        cpl = float(spent / leads) if leads > 0 else 0.0
        cac = float(spent / patients) if patients > 0 else 0.0

        channels.append({
            "channel_id": str(r["channel_id"]) if r["channel_id"] else None,
            "code": r["code"] or "unknown",
            "name": r["name"] or "Неизвестно",
            "icon": r["icon"] or "help",
            "spent": float(spent),
            "revenue": float(rev),
            "leads": leads,
            "clicks": int(r["total_clicks"] or 0),
            "impressions": int(r["total_impressions"] or 0),
            "patients": patients,
            "roi_pct": round(roi_pct, 1),
            "cpl": round(cpl, 2),
            "cac": round(cac, 2),
        })
        total_spent    += spent
        total_revenue  += rev
        total_leads    += leads
        total_patients += patients

    total_roi = (
        float((total_revenue - total_spent) / total_spent * 100)
        if total_spent > 0 else 0.0
    )
    total_cpl = float(total_spent / total_leads) if total_leads > 0 else 0.0
    total_cac = float(total_spent / total_patients) if total_patients > 0 else 0.0

    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "channels": channels,
        "totals": {
            "spent": float(total_spent),
            "revenue": float(total_revenue),
            "leads": total_leads,
            "patients": total_patients,
            "roi_pct": round(total_roi, 1),
            "cpl": round(total_cpl, 2),
            "cac": round(total_cac, 2),
        },
    }


# ─── Clinics ─────────────────────────────────────────────────────────────────


@router.get("/clinics")
async def clinics_list(
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """Список клиник сети с компактными метриками за период."""
    franchise_id = await _get_franchise_id(db, user)
    tenant_ids = await _get_tenant_ids(db, franchise_id)
    period_from, period_to = _default_period(from_, to)
    start_dt = datetime.combine(period_from, datetime.min.time())
    end_dt = datetime.combine(period_to, datetime.max.time())

    out: list[dict[str, Any]] = []
    if tenant_ids:
        rc = await db.execute(
            select(Clinic).where(
                and_(Clinic.tenant_id.in_(tenant_ids), Clinic.is_active.is_(True))
            )
        )
        clinics = list(rc.scalars().all())

        for c in clinics:
            # Выручка
            r = await db.execute(
                select(
                    func.coalesce(func.sum(ClinicPayment.amount), 0),
                    func.count(ClinicPayment.id),
                ).where(
                    and_(
                        ClinicPayment.clinic_id == c.id,
                        ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
                        ClinicPayment.paid_at >= start_dt,
                        ClinicPayment.paid_at <= end_dt,
                    )
                )
            )
            row = r.first()
            revenue = float(row[0] or 0) if row else 0.0
            payments_cnt = int(row[1] or 0) if row else 0

            # Кол-во приёмов
            r = await db.execute(
                select(func.count(Appointment.id)).where(
                    and_(
                        Appointment.clinic_id == c.id,
                        Appointment.appointment_date >= period_from,
                        Appointment.appointment_date <= period_to,
                    )
                )
            )
            appts_cnt = int(r.scalar() or 0)

            # Уникальные пациенты
            r = await db.execute(
                select(func.count(func.distinct(Appointment.patient_phone))).where(
                    and_(
                        Appointment.clinic_id == c.id,
                        Appointment.appointment_date >= period_from,
                        Appointment.appointment_date <= period_to,
                    )
                )
            )
            patients_cnt = int(r.scalar() or 0)

            # Кол-во врачей
            r = await db.execute(
                select(func.count(Doctor.id)).where(Doctor.clinic_id == c.id)
            )
            doctors_cnt = int(r.scalar() or 0)

            avg_check = round(revenue / payments_cnt, 2) if payments_cnt else 0.0

            out.append(
                {
                    "id": str(c.id),
                    "name": c.name,
                    "city": c.city,
                    "revenue": revenue,
                    "appointments": appts_cnt,
                    "patients": patients_cnt,
                    "doctors_count": doctors_cnt,
                    "avg_check": avg_check,
                    "margin_pct": 100 if revenue else 0,
                    "trend": "flat",  # placeholder — нужна история для трендов
                }
            )

        out.sort(key=lambda x: x["revenue"], reverse=True)

    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "clinics": out,
    }
