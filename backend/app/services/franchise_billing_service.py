"""Биллинг платформы с франшиз: учёт fee при выплате бонусов, выставление счетов."""
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.bonus import Bonus, BonusStatus
from app.models.franchise_invoice import FranchiseInvoice, InvoiceStatus
from app.models.billing_ledger import BillingLedger


# ── Хуки бонусов ───────────────────────────────────────────────────────────────

async def record_platform_fee_for_bonus(
    db: AsyncSession,
    bonus: Bonus,
    direction: str = "charge",  # charge (выплата) | refund (отмена)
) -> Decimal | None:
    """Записывает в billing_ledger fee платформы за конкретный бонус.

    Логика:
    - находим франшизу через bonus.tenant -> tenant.franchise_id
    - если франшиза не задана или fee = 0 → ничего не делаем
    - charge: создаём positive entry (платформа получает)
    - refund: создаём negative entry (платформа возвращает) — только если refund_fee_on_cancel=True
    """
    if not bonus.tenant_id:
        return None

    tenant = (await db.execute(
        select(Tenant).where(Tenant.id == bonus.tenant_id)
    )).scalar_one_or_none()
    if not tenant or not tenant.franchise_id:
        return None

    franchise = (await db.execute(
        select(Franchise).where(Franchise.id == tenant.franchise_id)
    )).scalar_one_or_none()
    if not franchise:
        return None

    fee = Decimal(str(franchise.platform_fee_per_bonus or 0))
    if fee <= 0:
        return None

    if direction == "refund" and not franchise.refund_fee_on_cancel:
        return None

    sign = Decimal("1") if direction == "charge" else Decimal("-1")
    entry = BillingLedger(
        tenant_id=bonus.tenant_id,
        entry_type="platform_fee_per_bonus",
        amount=sign * fee,
        currency="RUB",
        reference_type="bonus",
        reference_id=bonus.id,
        description=f"Fee платформы за бонус #{str(bonus.id)[:8]} (франшиза {franchise.name})",
        created_at=datetime.utcnow(),
    )
    db.add(entry)
    await db.flush()
    return sign * fee


# ── Создание счетов ────────────────────────────────────────────────────────────

async def _next_invoice_number(db: AsyncSession) -> str:
    """Простой счётчик: FR-YYYY-NNNN."""
    year = datetime.utcnow().year
    count = (await db.execute(
        select(func.count(FranchiseInvoice.id)).where(
            FranchiseInvoice.created_at >= datetime(year, 1, 1)
        )
    )).scalar_one()
    return f"FR-{year}-{count + 1:04d}"


async def generate_invoice_for_franchise(
    db: AsyncSession,
    franchise: Franchise,
    period_end: datetime | None = None,
) -> FranchiseInvoice | None:
    """Генерирует счёт за период [last_invoice_at..now] для франшизы.
    Возвращает None если за период не было fee."""
    period_end = period_end or datetime.utcnow()
    period_start = franchise.last_invoice_at or (period_end - timedelta(days=franchise.billing_period_days))

    # Сумма всех platform_fee_per_bonus за период по тенантам этой франшизы
    tenant_ids = (await db.execute(
        select(Tenant.id).where(Tenant.franchise_id == franchise.id)
    )).scalars().all()
    if not tenant_ids:
        return None

    total = (await db.execute(
        select(func.coalesce(func.sum(BillingLedger.amount), 0)).where(
            BillingLedger.tenant_id.in_(tenant_ids),
            BillingLedger.entry_type == "platform_fee_per_bonus",
            BillingLedger.created_at >= period_start,
            BillingLedger.created_at < period_end,
        )
    )).scalar_one()

    count = (await db.execute(
        select(func.count(BillingLedger.id)).where(
            BillingLedger.tenant_id.in_(tenant_ids),
            BillingLedger.entry_type == "platform_fee_per_bonus",
            BillingLedger.amount > 0,
            BillingLedger.created_at >= period_start,
            BillingLedger.created_at < period_end,
        )
    )).scalar_one()

    if not total or total <= 0:
        # Обновим last_invoice_at чтобы не дублировать пустые периоды
        franchise.last_invoice_at = period_end
        await db.commit()
        return None

    inv = FranchiseInvoice(
        franchise_id=franchise.id,
        number=await _next_invoice_number(db),
        period_start=period_start,
        period_end=period_end,
        bonuses_count=int(count),
        total_amount=Decimal(str(total)),
        status=InvoiceStatus.PENDING,
        due_date=period_end + timedelta(days=14),
    )
    db.add(inv)
    franchise.last_invoice_at = period_end
    await db.commit()
    await db.refresh(inv)
    return inv


async def run_invoice_job(db: AsyncSession) -> dict:
    """Cron: проходит по всем активным франшизам и выставляет счета у тех,
    у кого истёк billing_period_days с last_invoice_at."""
    now = datetime.utcnow()
    franchises = (await db.execute(
        select(Franchise).where(Franchise.is_active == True)
    )).scalars().all()

    created = 0
    skipped = 0
    for fr in franchises:
        last = fr.last_invoice_at
        if last and (now - last).days < fr.billing_period_days:
            skipped += 1
            continue
        inv = await generate_invoice_for_franchise(db, fr, period_end=now)
        if inv:
            created += 1
        else:
            skipped += 1
    return {"created": created, "skipped": skipped}


# ── Запросы для UI ─────────────────────────────────────────────────────────────

async def list_invoices_for_franchise(
    db: AsyncSession, franchise_id: uuid.UUID
) -> list[dict]:
    rows = (await db.execute(
        select(FranchiseInvoice)
        .where(FranchiseInvoice.franchise_id == franchise_id)
        .order_by(FranchiseInvoice.created_at.desc())
    )).scalars().all()
    return [
        {
            "id": str(r.id),
            "number": r.number,
            "period_start": r.period_start.isoformat() if r.period_start else None,
            "period_end": r.period_end.isoformat() if r.period_end else None,
            "bonuses_count": r.bonuses_count,
            "total_amount": float(r.total_amount or 0),
            "status": r.status,
            "due_date": r.due_date.isoformat() if r.due_date else None,
            "paid_at": r.paid_at.isoformat() if r.paid_at else None,
        }
        for r in rows
    ]


async def get_pending_total(db: AsyncSession, franchise_id: uuid.UUID) -> dict:
    """Сводка для дашборда: сколько начислено за текущий период (ещё не в счёте) +
    сумма pending счетов."""
    fr = (await db.execute(
        select(Franchise).where(Franchise.id == franchise_id)
    )).scalar_one_or_none()
    if not fr:
        return {"current_period_amount": 0, "current_period_count": 0, "pending_invoices_total": 0}

    period_start = fr.last_invoice_at or (datetime.utcnow() - timedelta(days=fr.billing_period_days))
    tenant_ids = (await db.execute(
        select(Tenant.id).where(Tenant.franchise_id == franchise_id)
    )).scalars().all()

    cur_total = 0
    cur_count = 0
    if tenant_ids:
        cur_total = (await db.execute(
            select(func.coalesce(func.sum(BillingLedger.amount), 0)).where(
                BillingLedger.tenant_id.in_(tenant_ids),
                BillingLedger.entry_type == "platform_fee_per_bonus",
                BillingLedger.created_at >= period_start,
            )
        )).scalar_one()
        cur_count = (await db.execute(
            select(func.count(BillingLedger.id)).where(
                BillingLedger.tenant_id.in_(tenant_ids),
                BillingLedger.entry_type == "platform_fee_per_bonus",
                BillingLedger.amount > 0,
                BillingLedger.created_at >= period_start,
            )
        )).scalar_one()

    pending_total = (await db.execute(
        select(func.coalesce(func.sum(FranchiseInvoice.total_amount), 0)).where(
            FranchiseInvoice.franchise_id == franchise_id,
            FranchiseInvoice.status == InvoiceStatus.PENDING,
        )
    )).scalar_one()

    return {
        "current_period_amount": float(cur_total),
        "current_period_count": int(cur_count or 0),
        "pending_invoices_total": float(pending_total or 0),
        "period_start": period_start.isoformat(),
        "billing_period_days": fr.billing_period_days,
    }
