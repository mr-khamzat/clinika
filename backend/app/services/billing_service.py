"""
Сервис биллинга.
Создание подписок, выставление счетов, регистрация платежей.
Этап 9 SaaS-трансформации.
"""
import uuid
from datetime import datetime, date, timedelta
from decimal import Decimal

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.billing import (
    Subscription, Invoice, Payment,
    SubStatus, InvoiceStatus, PaymentStatus, PLAN_PRICES,
)


# ── Хелперы ───────────────────────────────────────────────────────────────────

def _next_invoice_number(db_seq_value: int) -> str:
    """INV-2026-00001"""
    year = datetime.utcnow().year
    return f"INV-{year}-{db_seq_value:05d}"


def _period_end(start: date, cycle: str) -> date:
    if cycle == "annual":
        return date(start.year + 1, start.month, start.day) - timedelta(days=1)
    # monthly — ровно месяц
    month = start.month + 1
    year  = start.year + (month - 1) // 12
    month = ((month - 1) % 12) + 1
    return date(year, month, start.day) - timedelta(days=1)


# ── Подписки ──────────────────────────────────────────────────────────────────

async def create_subscription(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    plan: str,
    billing_cycle: str = "monthly",
    trial_days: int = 14,
) -> Subscription:
    """Создать новую подписку (или пробный период)."""
    today = date.today()
    price = PLAN_PRICES.get(plan, {}).get(billing_cycle, Decimal("0"))

    sub = Subscription(
        tenant_id=tenant_id,
        plan=plan,
        billing_cycle=billing_cycle,
        status=SubStatus.TRIAL if trial_days > 0 else SubStatus.ACTIVE,
        trial_ends_at=datetime.utcnow() + timedelta(days=trial_days) if trial_days > 0 else None,
        current_period_start=today,
        current_period_end=_period_end(today, billing_cycle),
        next_invoice_date=today + timedelta(days=trial_days) if trial_days > 0 else today,
        amount_per_period=price,
    )
    db.add(sub)
    await db.flush()
    return sub


async def get_active_subscription(db: AsyncSession, tenant_id: uuid.UUID) -> Subscription | None:
    """Вернуть активную/trial подписку тенанта."""
    result = await db.execute(
        select(Subscription)
        .where(
            Subscription.tenant_id == tenant_id,
            Subscription.status.in_([SubStatus.TRIAL, SubStatus.ACTIVE, SubStatus.PAST_DUE]),
        )
        .order_by(Subscription.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def change_plan(
    db: AsyncSession,
    subscription_id: uuid.UUID,
    new_plan: str,
    new_cycle: str | None = None,
) -> Subscription:
    """Поменять тариф (upgrade/downgrade)."""
    result = await db.execute(select(Subscription).where(Subscription.id == subscription_id))
    sub = result.scalar_one_or_none()
    if not sub:
        raise ValueError("Подписка не найдена")

    sub.plan = new_plan
    if new_cycle:
        sub.billing_cycle = new_cycle
    sub.amount_per_period = PLAN_PRICES.get(new_plan, {}).get(sub.billing_cycle, Decimal("0"))
    await db.flush()
    return sub


async def cancel_subscription(db: AsyncSession, subscription_id: uuid.UUID) -> Subscription:
    """Отменить подписку (сразу)."""
    result = await db.execute(select(Subscription).where(Subscription.id == subscription_id))
    sub = result.scalar_one_or_none()
    if not sub:
        raise ValueError("Подписка не найдена")
    sub.status = SubStatus.CANCELLED
    sub.cancelled_at = datetime.utcnow()
    sub.auto_renew = False
    await db.flush()
    return sub


# ── Счета ─────────────────────────────────────────────────────────────────────

async def generate_invoice(
    db: AsyncSession,
    subscription_id: uuid.UUID,
    period_start: date | None = None,
) -> Invoice:
    """Выставить счёт за следующий период подписки."""
    result = await db.execute(select(Subscription).where(Subscription.id == subscription_id))
    sub = result.scalar_one_or_none()
    if not sub:
        raise ValueError("Подписка не найдена")

    start = period_start or sub.current_period_start
    end   = _period_end(start, sub.billing_cycle)

    # Порядковый номер счёта
    count_q = await db.execute(select(func.count(Invoice.id)))
    seq = (count_q.scalar() or 0) + 1

    invoice = Invoice(
        subscription_id=sub.id,
        tenant_id=sub.tenant_id,
        invoice_number=_next_invoice_number(seq),
        status=InvoiceStatus.SENT,
        amount=sub.amount_per_period,
        period_start=start,
        period_end=end,
        due_date=start + timedelta(days=14),
        line_items=[{
            "description": f"Подписка {sub.plan} ({sub.billing_cycle})",
            "amount": float(sub.amount_per_period),
            "quantity": 1,
        }],
    )
    db.add(invoice)

    # Обновляем следующий период в подписке
    next_start = end + timedelta(days=1)
    sub.current_period_start = next_start
    sub.current_period_end   = _period_end(next_start, sub.billing_cycle)
    sub.next_invoice_date    = next_start
    sub.status = SubStatus.ACTIVE

    await db.flush()
    return invoice


async def mark_invoice_overdue(db: AsyncSession) -> int:
    """Пометить просроченные неоплаченные счета. Вызывается фоновой задачей."""
    today = date.today()
    result = await db.execute(
        select(Invoice).where(
            Invoice.status == InvoiceStatus.SENT,
            Invoice.due_date < today,
        )
    )
    overdue = result.scalars().all()
    for inv in overdue:
        inv.status = InvoiceStatus.OVERDUE
        # Переводим подписку в past_due
        sub_q = await db.execute(select(Subscription).where(Subscription.id == inv.subscription_id))
        sub = sub_q.scalar_one_or_none()
        if sub and sub.status == SubStatus.ACTIVE:
            sub.status = SubStatus.PAST_DUE
    await db.flush()
    return len(overdue)


# ── Платежи ───────────────────────────────────────────────────────────────────

async def record_payment(
    db: AsyncSession,
    invoice_id: uuid.UUID,
    amount: Decimal,
    method: str = "manual",
    transaction_id: str | None = None,
    gateway: str = "manual",
    meta: dict | None = None,
) -> Payment:
    """Зарегистрировать платёж по счёту."""
    inv_q = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    invoice = inv_q.scalar_one_or_none()
    if not invoice:
        raise ValueError("Счёт не найден")
    if invoice.status == InvoiceStatus.PAID:
        raise ValueError("Счёт уже оплачен")

    payment = Payment(
        invoice_id=invoice_id,
        tenant_id=invoice.tenant_id,
        amount=amount,
        status=PaymentStatus.COMPLETED,
        method=method,
        transaction_id=transaction_id,
        gateway=gateway,
        processed_at=datetime.utcnow(),
        meta=meta,
    )
    db.add(payment)

    # Помечаем счёт как оплаченный
    invoice.status     = InvoiceStatus.PAID
    invoice.paid_at    = datetime.utcnow()
    invoice.paid_amount = amount

    # Возобновляем подписку если была past_due
    sub_q = await db.execute(select(Subscription).where(Subscription.id == invoice.subscription_id))
    sub = sub_q.scalar_one_or_none()
    if sub and sub.status == SubStatus.PAST_DUE:
        sub.status = SubStatus.ACTIVE

    await db.flush()
    return payment


async def get_billing_summary(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Сводка биллинга тенанта."""
    sub = await get_active_subscription(db, tenant_id)

    # Последние счета
    inv_q = await db.execute(
        select(Invoice)
        .where(Invoice.tenant_id == tenant_id)
        .order_by(Invoice.created_at.desc())
        .limit(12)
    )
    invoices = inv_q.scalars().all()

    total_paid = sum(float(i.amount) for i in invoices if i.status == InvoiceStatus.PAID)
    total_due  = sum(float(i.amount) for i in invoices if i.status in (InvoiceStatus.SENT, InvoiceStatus.OVERDUE))

    return {
        "subscription": {
            "id":      str(sub.id) if sub else None,
            "plan":    sub.plan if sub else None,
            "cycle":   sub.billing_cycle if sub else None,
            "status":  sub.status if sub else None,
            "trial_ends_at": sub.trial_ends_at.isoformat() if sub and sub.trial_ends_at else None,
            "period_end":    sub.current_period_end.isoformat() if sub else None,
            "next_invoice":  sub.next_invoice_date.isoformat() if sub and sub.next_invoice_date else None,
            "amount_per_period": float(sub.amount_per_period) if sub else 0,
        } if sub else None,
        "total_paid": total_paid,
        "total_due":  total_due,
        "invoices_count": len(invoices),
    }
