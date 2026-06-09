"""
Сервис консолидированного P&L (Profit & Loss) по сети клиник одной франшизы.

Считает финансовую сводку:
  - revenue      — выручка по всем клиникам сети:
                     * Appointment.price для appointments в статусе COMPLETED
                     * ClinicPayment.amount в статусе SUCCEEDED (online эквайринг)
                     * InterClinicInvoice (status=PAID, исходящие — где tenant выписал счёт)
                     * partner_offers — payout_amount по cross-referral'ам, где
                       платил target_tenant (используем bonus_snapshot_amount
                       у Referral'ов из этой сети как источник).
                   Все источники суммируются БЕЗ дублирования (агрегаты по
                   соответствующим таблицам).
  - cogs         — прямые расходы из таблицы spendings (rent + lab + materials +
                     utilities + other). marketing считаем как маркетинговую
                     активность, в COGS НЕ кладём.
                   Если в spendings нет данных за период — возвращаем 0 и
                     помечаем _source: "stub" (для UI-плашки «учёт расходов не
                     ведётся»).
  - taxes        — оценка налогов как % от revenue (по умолчанию 6% — УСН Доходы).
                   Передаётся как параметр tax_rate, дефолт 0.06.
  - platform_fee — комиссии платформы (FranchiseInvoice.total_amount,
                     status=PAID за период) — выставляются платформой
                     франшизе за услуги/бонусы.
  - gross_margin = revenue - cogs
  - net_income   = gross_margin - taxes - platform_fee

Возвращает структуру с разбивкой по клиникам и по месяцам (для line-чарта).
Никаких новых таблиц — всё считается on-the-fly из существующих агрегатов.
"""
from __future__ import annotations

import uuid
from datetime import datetime, date, timedelta
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.clinic import Clinic
from app.models.doctor import Appointment, AppointmentStatus
from app.models.spending import Spending
from app.models.inter_clinic_invoice import InterClinicInvoice, ICIStatus
from app.models.franchise_invoice import FranchiseInvoice, InvoiceStatus
from app.models.referral import Referral

# ClinicPayment может отсутствовать в более старых билдах — импорт защищаем.
try:
    from app.models.payments_clinic import ClinicPayment, ClinicPaymentStatus
    HAS_CLINIC_PAYMENT = True
except Exception:  # pragma: no cover - защита от отсутствия модуля
    ClinicPayment = None  # type: ignore
    ClinicPaymentStatus = None  # type: ignore
    HAS_CLINIC_PAYMENT = False


# Дефолт ставки налога (USN «Доходы», 6%). Передаётся в compute_pnl как
# параметр — может быть переопределён пользователем из UI/настроек.
DEFAULT_TAX_RATE = Decimal("0.06")


def _d(v) -> Decimal:
    """Безопасный cast в Decimal (None → 0)."""
    if v is None:
        return Decimal("0")
    try:
        return Decimal(str(v))
    except Exception:
        return Decimal("0")


async def _list_tenants(db: AsyncSession, tenant_id: uuid.UUID) -> list[Tenant]:
    """Список тенантов франшизы. Если переданный tenant_id ─ корневой,
    возвращаем сразу все тенанты этой франшизы. Иначе — только сам тенант
    (например, super_admin запросил по конкретной сети)."""
    # 1) Если есть franchise_id у переданного тенанта — берём всю сеть.
    t = await db.get(Tenant, tenant_id)
    if t and t.franchise_id:
        r = await db.execute(
            select(Tenant).where(Tenant.franchise_id == t.franchise_id)
        )
        return list(r.scalars().all())
    # 2) Иначе считаем только по переданному тенанту.
    return [t] if t else []


async def _revenue_appointments(
    db: AsyncSession, tenant_ids: list[uuid.UUID],
    start: datetime, end: datetime,
) -> Decimal:
    """Сумма Appointment.price по COMPLETED-приёмам в периоде."""
    if not tenant_ids:
        return Decimal("0")
    q = select(func.coalesce(func.sum(Appointment.price), 0)).where(and_(
        Appointment.tenant_id.in_(tenant_ids),
        Appointment.status == AppointmentStatus.COMPLETED,
        Appointment.appointment_date >= start.date(),
        Appointment.appointment_date <= end.date(),
    ))
    r = await db.execute(q)
    return _d(r.scalar())


async def _revenue_clinic_payments(
    db: AsyncSession, tenant_ids: list[uuid.UUID],
    start: datetime, end: datetime,
) -> Decimal:
    """Сумма SUCCEEDED ClinicPayment (онлайн-эквайринг) в периоде."""
    if not HAS_CLINIC_PAYMENT or not tenant_ids:
        return Decimal("0")
    q = select(func.coalesce(func.sum(ClinicPayment.amount), 0)).where(and_(
        ClinicPayment.tenant_id.in_(tenant_ids),
        ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
        ClinicPayment.paid_at.isnot(None),
        ClinicPayment.paid_at >= start,
        ClinicPayment.paid_at <= end,
    ))
    r = await db.execute(q)
    return _d(r.scalar())


async def _revenue_inter_clinic(
    db: AsyncSession, tenant_ids: list[uuid.UUID],
    start: datetime, end: datetime,
) -> Decimal:
    """Сумма межклиничных счетов PAID, выставленных тенантами сети
    (доход клиники-исполнителя, оставаясь в сети)."""
    if not tenant_ids:
        return Decimal("0")
    q = select(func.coalesce(func.sum(InterClinicInvoice.amount), 0)).where(and_(
        InterClinicInvoice.issuer_tenant_id.in_(tenant_ids),
        InterClinicInvoice.status == ICIStatus.PAID,
        InterClinicInvoice.paid_at.isnot(None),
        InterClinicInvoice.paid_at >= start,
        InterClinicInvoice.paid_at <= end,
    ))
    r = await db.execute(q)
    return _d(r.scalar())


async def _revenue_partner_offers(
    db: AsyncSession, tenant_ids: list[uuid.UUID],
    start: datetime, end: datetime,
) -> Decimal:
    """Доход по партнёрским офферам — bonus_snapshot_amount у completed
    cross-referrals, где принимающая клиника в нашей сети.

    Используем Referral.bonus_snapshot_amount + cross_clinic_status='completed'.
    """
    if not tenant_ids:
        return Decimal("0")
    q = select(func.coalesce(func.sum(Referral.bonus_snapshot_amount), 0)).where(and_(
        Referral.target_tenant_id.in_(tenant_ids),
        Referral.cross_clinic_status == "completed",
        Referral.bonus_snapshot_amount.isnot(None),
        Referral.created_at >= start,
        Referral.created_at <= end,
    ))
    r = await db.execute(q)
    return _d(r.scalar())


async def _cogs_spendings(
    db: AsyncSession, tenant_ids: list[uuid.UUID],
    start: datetime, end: datetime,
) -> tuple[Decimal, bool]:
    """COGS = rent + lab + materials + utilities + other (без marketing).

    Возвращает (сумма, is_stub). is_stub=True если за период расходов нет
    вообще — фронт покажет плашку «учёт расходов не ведётся».
    """
    if not tenant_ids:
        return Decimal("0"), True
    cogs_categories = ["rent", "lab", "materials", "utilities", "other"]
    q = select(func.coalesce(func.sum(Spending.amount), 0)).where(and_(
        Spending.tenant_id.in_(tenant_ids),
        Spending.category.in_(cogs_categories),
        Spending.paid_at.isnot(None),
        Spending.paid_at >= start.date(),
        Spending.paid_at <= end.date(),
    ))
    r = await db.execute(q)
    val = _d(r.scalar())
    # Проверим вообще есть ли spendings у этих тенантов (любые) — для is_stub.
    q2 = select(func.count(Spending.id)).where(Spending.tenant_id.in_(tenant_ids))
    r2 = await db.execute(q2)
    any_exists = int(r2.scalar() or 0) > 0
    return val, (not any_exists)


async def _platform_fee(
    db: AsyncSession, franchise_id: uuid.UUID,
    start: datetime, end: datetime,
) -> Decimal:
    """Сумма FranchiseInvoice (PAID) платформа → франшиза за период."""
    q = select(func.coalesce(func.sum(FranchiseInvoice.total_amount), 0)).where(and_(
        FranchiseInvoice.franchise_id == franchise_id,
        FranchiseInvoice.status == InvoiceStatus.PAID,
        FranchiseInvoice.paid_at.isnot(None),
        FranchiseInvoice.paid_at >= start,
        FranchiseInvoice.paid_at <= end,
    ))
    r = await db.execute(q)
    return _d(r.scalar())


async def _revenue_by_clinic(
    db: AsyncSession, tenants: list[Tenant],
    start: datetime, end: datetime,
) -> list[dict[str, Any]]:
    """Разбивка выручки по клиникам (тенантам). Берём суммарную выручку
    из appointments + clinic_payments + inter_clinic для каждого тенанта.

    Возвращает список словарей, отсортированный по revenue DESC.
    """
    out: list[dict[str, Any]] = []
    for t in tenants:
        # имя клиники — первая клиника тенанта
        rc = await db.execute(
            select(Clinic).where(Clinic.tenant_id == t.id).order_by(Clinic.name).limit(1)
        )
        clinic = rc.scalar_one_or_none()
        appt = await _revenue_appointments(db, [t.id], start, end)
        pay  = await _revenue_clinic_payments(db, [t.id], start, end)
        ici  = await _revenue_inter_clinic(db, [t.id], start, end)
        po   = await _revenue_partner_offers(db, [t.id], start, end)
        total = appt + pay + ici + po
        out.append({
            "tenant_id": str(t.id),
            "tenant_name": t.name,
            "tenant_slug": t.slug,
            "clinic_name": clinic.name if clinic else "—",
            "revenue": float(total),
            "appointments_rub": float(appt),
            "clinic_payments_rub": float(pay),
            "inter_clinic_rub": float(ici),
            "partner_offers_rub": float(po),
        })
    out.sort(key=lambda x: x["revenue"], reverse=True)
    return out


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    """Возвращает [начало месяца, конец месяца] как datetime."""
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1) - timedelta(seconds=1)
    else:
        end = datetime(year, month + 1, 1) - timedelta(seconds=1)
    return start, end


async def _by_month(
    db: AsyncSession, franchise_id: uuid.UUID,
    tenants: list[Tenant], months: int = 12,
    tax_rate: Decimal = DEFAULT_TAX_RATE,
) -> list[dict[str, Any]]:
    """История P&L по месяцам (для line-чарта).

    Возвращает список словарей с ключами:
      {month: "2026-05", revenue, cogs, gross_margin, taxes, platform_fee, net_income}
    """
    tenant_ids = [t.id for t in tenants]
    now = datetime.utcnow()
    rows: list[dict[str, Any]] = []
    # Двигаемся назад от текущего месяца на `months` шагов.
    year, month = now.year, now.month
    pairs: list[tuple[int, int]] = []
    for _ in range(months):
        pairs.append((year, month))
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    pairs.reverse()  # хронологически

    for y, m in pairs:
        s, e = _month_bounds(y, m)
        appt = await _revenue_appointments(db, tenant_ids, s, e)
        pay  = await _revenue_clinic_payments(db, tenant_ids, s, e)
        ici  = await _revenue_inter_clinic(db, tenant_ids, s, e)
        po   = await _revenue_partner_offers(db, tenant_ids, s, e)
        revenue = appt + pay + ici + po
        cogs, _ = await _cogs_spendings(db, tenant_ids, s, e)
        fee = await _platform_fee(db, franchise_id, s, e)
        taxes = (revenue * tax_rate).quantize(Decimal("0.01"))
        gross = revenue - cogs
        net = gross - taxes - fee
        rows.append({
            "month": f"{y:04d}-{m:02d}",
            "revenue": float(revenue),
            "cogs": float(cogs),
            "gross_margin": float(gross),
            "taxes": float(taxes),
            "platform_fee": float(fee),
            "net_income": float(net),
        })
    return rows


# ── Public API ─────────────────────────────────────────────────────────────


async def compute_pnl(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    period_start: datetime,
    period_end: datetime,
    tax_rate: Decimal = DEFAULT_TAX_RATE,
    include_by_month: bool = False,
    months: int = 12,
) -> dict[str, Any]:
    """Главная функция: считает P&L за период по всей сети франшизы.

    Args:
        db: AsyncSession
        tenant_id: любой tenant из сети (берём franchise_id из него)
        period_start, period_end: границы периода (datetime)
        tax_rate: ставка налога в долях (0.06 = 6%)
        include_by_month: добавить ли разбивку по последним N месяцам
        months: сколько месяцев в by_month

    Returns:
        dict с ключами revenue, revenue_by_clinic, cogs, gross_margin,
        taxes, platform_fee, net_income, period_start, period_end, tax_rate,
        cogs_source ("real"|"stub"), [by_month].
    """
    tenants = await _list_tenants(db, tenant_id)
    if not tenants:
        return {
            "revenue": 0.0,
            "revenue_by_clinic": [],
            "cogs": 0.0,
            "gross_margin": 0.0,
            "taxes": 0.0,
            "platform_fee": 0.0,
            "net_income": 0.0,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "tax_rate": float(tax_rate),
            "cogs_source": "stub",
            "tenants_count": 0,
        }

    tenant_ids = [t.id for t in tenants]
    # franchise_id для platform_fee (от первого тенанта; все имеют один)
    franchise_id = tenants[0].franchise_id

    # ── Revenue ────────────────────────────────────────────────────────
    appt = await _revenue_appointments(db, tenant_ids, period_start, period_end)
    pay  = await _revenue_clinic_payments(db, tenant_ids, period_start, period_end)
    ici  = await _revenue_inter_clinic(db, tenant_ids, period_start, period_end)
    po   = await _revenue_partner_offers(db, tenant_ids, period_start, period_end)
    revenue = appt + pay + ici + po

    # ── COGS ───────────────────────────────────────────────────────────
    cogs, is_stub = await _cogs_spendings(db, tenant_ids, period_start, period_end)

    # ── Platform fee ───────────────────────────────────────────────────
    fee = Decimal("0")
    if franchise_id:
        fee = await _platform_fee(db, franchise_id, period_start, period_end)

    # ── Taxes ──────────────────────────────────────────────────────────
    taxes = (revenue * Decimal(str(tax_rate))).quantize(Decimal("0.01"))

    gross_margin = revenue - cogs
    net_income = gross_margin - taxes - fee

    # ── By clinic ──────────────────────────────────────────────────────
    by_clinic = await _revenue_by_clinic(db, tenants, period_start, period_end)

    result: dict[str, Any] = {
        "revenue": float(revenue),
        "revenue_breakdown": {
            "appointments": float(appt),
            "clinic_payments": float(pay),
            "inter_clinic": float(ici),
            "partner_offers": float(po),
        },
        "revenue_by_clinic": by_clinic,
        "cogs": float(cogs),
        "cogs_source": "stub" if is_stub else "real",
        "cogs_note": (
            "Учёт расходов не ведётся — подключите модуль бухгалтерии"
            if is_stub else None
        ),
        "gross_margin": float(gross_margin),
        "taxes": float(taxes),
        "tax_rate": float(tax_rate),
        "platform_fee": float(fee),
        "net_income": float(net_income),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "tenants_count": len(tenants),
        "franchise_id": str(franchise_id) if franchise_id else None,
    }

    if include_by_month:
        result["by_month"] = await _by_month(
            db, franchise_id, tenants, months=months, tax_rate=Decimal(str(tax_rate))
        )

    return result


def resolve_period(
    period: Optional[str], from_: Optional[date], to: Optional[date]
) -> tuple[datetime, datetime, str]:
    """Преобразует короткое имя периода в (start, end, label).

    Поддерживаемые значения period:
      current_month  — с 1-го числа текущего месяца по now
      last_month     — весь прошлый месяц
      ytd            — с 1 января по now
      custom         — берёт from_/to (оба обязательны)

    Returns:
        tuple(start_dt, end_dt, normalized_label)
    """
    now = datetime.utcnow()
    p = (period or "current_month").lower()
    if p == "current_month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = now
        return start, end, "current_month"
    if p == "last_month":
        first_this = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = first_this - timedelta(seconds=1)
        start = end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return start, end, "last_month"
    if p == "ytd":
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        return start, now, "ytd"
    if p == "custom":
        if not from_ or not to:
            raise ValueError("Для custom периода требуются параметры from и to")
        if from_ > to:
            raise ValueError("Параметр from должен быть раньше to")
        start = datetime.combine(from_, datetime.min.time())
        end = datetime.combine(to, datetime.max.time())
        return start, end, "custom"
    raise ValueError(f"Неподдерживаемый период: {period}")
