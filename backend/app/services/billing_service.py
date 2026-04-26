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


def _add_months(start: date, n: int) -> date:
    month = start.month + n
    year  = start.year + (month - 1) // 12
    month = ((month - 1) % 12) + 1
    return date(year, month, start.day)

def _period_end(start: date, cycle: str) -> date:
    months = {"monthly": 1, "quarterly": 3, "semi_annual": 6, "nine_months": 9, "annual": 12}
    n = months.get(cycle, 1)
    return _add_months(start, n) - timedelta(days=1)


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

    # Пишем в billing_ledger: начисление за подписку
    if sub.amount_per_period and sub.amount_per_period > 0:
        await record_billing_ledger(
            db,
            tenant_id=sub.tenant_id,
            entry_type=EntryType.SUBSCRIPTION_CHARGE,
            direction=Direction.DEBIT,
            amount=sub.amount_per_period,
            reference_id=invoice.id,
            reference_type='invoice',
            description=f'Подписка {sub.plan} ({sub.billing_cycle}) — {invoice.invoice_number}',
            meta={'plan': sub.plan, 'cycle': sub.billing_cycle, 'invoice_number': invoice.invoice_number},
        )

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

    # Пишем в billing_ledger: получение платежа
    await record_billing_ledger(
        db,
        tenant_id=invoice.tenant_id,
        entry_type=EntryType.PAYMENT_RECEIVED,
        direction=Direction.CREDIT,
        amount=amount,
        reference_id=payment.id,
        reference_type='payment',
        description=f'Оплата счёта {invoice.invoice_number}',
        meta={'invoice_id': str(invoice.id), 'method': method, 'gateway': gateway},
    )

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


# ═══════════════════════════════════════════════════════════════════════════════
# BILLING V2 — Revenue split, plugin subscriptions, advertising, billing ledger
# ═══════════════════════════════════════════════════════════════════════════════

import hashlib
from datetime import date
from app.models.billing import TenantPluginSubscription, PluginSubStatus
from app.models.billing_plan import TenantPlan, TenantPricingRules
from app.models.billing_ledger import BillingLedger, EntryType, Direction
from app.models.advertising import Ad, AdEvent, AdStatus, AdType, PricingModel, AdEventType
from app.models.plugin import PluginFeature


# ── TenantPlan ────────────────────────────────────────────────────────────────

async def get_plan_by_name(db: AsyncSession, name: str) -> TenantPlan | None:
    """Получить план по slug (basic/professional/enterprise)."""
    result = await db.execute(
        select(TenantPlan).where(TenantPlan.name == name, TenantPlan.is_active == True)
    )
    return result.scalar_one_or_none()


async def list_plans(db: AsyncSession, public_only: bool = True) -> list[TenantPlan]:
    """Список тарифных планов (для страницы тарифов)."""
    q = select(TenantPlan).where(TenantPlan.is_active == True)
    if public_only:
        q = q.where(TenantPlan.is_public == True)
    q = q.order_by(TenantPlan.sort_order)
    result = await db.execute(q)
    return result.scalars().all()


# ── TenantPricingRules ────────────────────────────────────────────────────────

async def get_pricing_rules(db: AsyncSession, tenant_id: uuid.UUID) -> TenantPricingRules:
    """
    Получить правила ценообразования тенанта.
    Если нет — создаём с дефолтами (plugin_split=30%, ad_split=20%).
    """
    result = await db.execute(
        select(TenantPricingRules).where(TenantPricingRules.tenant_id == tenant_id)
    )
    rules = result.scalar_one_or_none()
    if rules is None:
        rules = TenantPricingRules(tenant_id=tenant_id)
        db.add(rules)
        await db.flush()
    return rules


async def update_pricing_rules(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    plugin_split_percent: Decimal | None = None,
    ad_split_percent: Decimal | None = None,
    franchise_fee_percent: Decimal | None = None,
    subscription_discount_percent: Decimal | None = None,
    min_price: Decimal | None = None,
    max_price: Decimal | None = None,
) -> TenantPricingRules:
    """Обновить правила ценообразования тенанта (суперадмин)."""
    rules = await get_pricing_rules(db, tenant_id)
    if plugin_split_percent is not None:
        rules.plugin_split_percent = plugin_split_percent
    if ad_split_percent is not None:
        rules.ad_split_percent = ad_split_percent
    if franchise_fee_percent is not None:
        rules.franchise_fee_percent = franchise_fee_percent
    if subscription_discount_percent is not None:
        rules.subscription_discount_percent = subscription_discount_percent
    if min_price is not None:
        rules.min_price = min_price
    if max_price is not None:
        rules.max_price = max_price
    rules.updated_at = datetime.utcnow()
    await db.flush()
    return rules


# ── BillingLedger ─────────────────────────────────────────────────────────────

async def record_billing_ledger(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    entry_type: str,
    direction: str,
    amount: Decimal,
    reference_id: uuid.UUID | None = None,
    reference_type: str | None = None,
    description: str | None = None,
    meta: dict | None = None,
    is_split: bool = False,
    split_parent_id: uuid.UUID | None = None,
    split_actor: str | None = None,
    clinic_id: uuid.UUID | None = None,
    currency: str = "RUB",
) -> BillingLedger:
    """
    Универсальная append-only запись в billing_ledger.
    Единственная точка записи — всегда используй эту функцию.
    """
    entry = BillingLedger(
        tenant_id=tenant_id,
        clinic_id=clinic_id,
        entry_type=entry_type,
        direction=direction,
        amount=Decimal(str(amount)),
        currency=currency,
        reference_id=reference_id,
        reference_type=reference_type,
        description=description,
        meta=meta,
        is_split=is_split,
        split_parent_id=split_parent_id,
        split_actor=split_actor,
    )
    db.add(entry)
    await db.flush()
    return entry


# ── Revenue Split ─────────────────────────────────────────────────────────────

async def _apply_revenue_split(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    gross_amount: Decimal,
    source_entry: BillingLedger,
    split_type: str,  # "plugin" | "ad"
) -> tuple[Decimal, Decimal]:
    """
    Разбивает gross сумму на доли платформы и тенанта.
    Создаёт 2-3 записи в billing_ledger (platform_income, tenant_income, franchise_fee).

    Returns: (platform_amount, tenant_amount)

    Revenue split pattern:
      source_entry (gross)
        ├─ PLATFORM_INCOME: gross * split_pct% → платформа
        ├─ TENANT_INCOME:   gross * (100-split_pct)% → тенант
        └─ FRANCHISE_FEE:   tenant_income * franchise_pct% → дебет тенанта (если >0)
    """
    rules = await get_pricing_rules(db, tenant_id)

    pct = rules.plugin_split_percent if split_type == "plugin" else rules.ad_split_percent
    platform_amount = (gross_amount * pct / Decimal("100")).quantize(Decimal("0.01"))
    tenant_amount   = gross_amount - platform_amount

    # 1. Доход платформы
    await record_billing_ledger(
        db,
        tenant_id=None,   # доход платформы не привязан к тенанту
        entry_type=EntryType.PLATFORM_INCOME,
        direction=Direction.CREDIT,
        amount=platform_amount,
        reference_id=source_entry.id,
        reference_type="billing_ledger",
        description=f"Platform share {pct}% ({split_type})",
        is_split=True,
        split_parent_id=source_entry.id,
        split_actor="platform",
        meta={"source_type": split_type, "tenant_id": str(tenant_id), "pct": str(pct)},
    )

    # 2. Доход тенанта
    await record_billing_ledger(
        db,
        tenant_id=tenant_id,
        entry_type=EntryType.TENANT_INCOME,
        direction=Direction.CREDIT,
        amount=tenant_amount,
        reference_id=source_entry.id,
        reference_type="billing_ledger",
        description=f"Tenant share {100 - float(pct)}% ({split_type})",
        is_split=True,
        split_parent_id=source_entry.id,
        split_actor="tenant",
    )

    # 3. Franchise fee (если задан и > 0)
    if rules.franchise_fee_percent > 0:
        fee = (tenant_amount * rules.franchise_fee_percent / Decimal("100")).quantize(Decimal("0.01"))
        await record_billing_ledger(
            db,
            tenant_id=tenant_id,
            entry_type=EntryType.FRANCHISE_FEE,
            direction=Direction.DEBIT,
            amount=fee,
            reference_id=source_entry.id,
            reference_type="billing_ledger",
            description=f"Franchise fee {rules.franchise_fee_percent}%",
            is_split=True,
            split_parent_id=source_entry.id,
            split_actor="franchise",
        )

    return platform_amount, tenant_amount


# ── Plugin Subscriptions ──────────────────────────────────────────────────────

async def get_active_plugin_subscription(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    feature_key: str,
) -> TenantPluginSubscription | None:
    """Вернуть активную/trial подписку на плагин."""
    result = await db.execute(
        select(TenantPluginSubscription).where(
            TenantPluginSubscription.tenant_id == tenant_id,
            TenantPluginSubscription.feature_key == feature_key,
            TenantPluginSubscription.status.in_([PluginSubStatus.TRIAL, PluginSubStatus.ACTIVE]),
        )
    )
    return result.scalar_one_or_none()


async def enable_plugin(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    feature_key: str,
    billing_cycle: str = "monthly",
    trial_days: int = 7,
) -> TenantPluginSubscription:
    """
    Включить платный плагин для тенанта.

    Логика:
    1. Идемпотентность: если уже active/trial → возвращаем существующую
    2. Проверяем что фича платная и существует в каталоге
    3. trial_days>0 → создаём trial (нет списания), иначе сразу charge+split

    Валидация:
    - Нельзя включить бесплатную фичу (для неё TenantPluginFeature)
    - UniqueConstraint гарантирует одну запись per (tenant, feature_key)
    """
    from fastapi import HTTPException

    # Идемпотентность
    existing = await get_active_plugin_subscription(db, tenant_id, feature_key)
    if existing:
        return existing

    # Проверяем каталог
    feat_result = await db.execute(
        select(PluginFeature).where(PluginFeature.key == feature_key)
    )
    feature = feat_result.scalar_one_or_none()
    if feature is None:
        raise HTTPException(status_code=404, detail=f"Фича плагина не найдена: {feature_key}")
    if not feature.is_paid:
        raise HTTPException(
            status_code=400,
            detail=f"Фича {feature_key} бесплатна — включается через настройки модулей"
        )

    price = feature.price_monthly
    now = datetime.utcnow()
    trial_ends = now + timedelta(days=trial_days) if trial_days > 0 else None
    expires    = now + timedelta(days=30) if trial_days == 0 else None

    plugin_sub = TenantPluginSubscription(
        tenant_id=tenant_id,
        feature_key=feature_key,
        status=PluginSubStatus.TRIAL if trial_days > 0 else PluginSubStatus.ACTIVE,
        billing_cycle=billing_cycle,
        price=price,
        trial_ends_at=trial_ends,
        expires_at=expires,
        last_charged_at=None if trial_days > 0 else now,
    )
    db.add(plugin_sub)
    await db.flush()

    if trial_days > 0:
        # Trial — нулевая запись для аудита (сумма=0, тип=trial)
        await record_billing_ledger(
            db,
            tenant_id=tenant_id,
            entry_type=EntryType.SUBSCRIPTION_TRIAL,
            direction=Direction.CREDIT,
            amount=Decimal("0"),
            reference_id=plugin_sub.id,
            reference_type="plugin_subscription",
            description=f"Trial {feature_key} ({trial_days} дней)",
            meta={"feature_key": feature_key, "trial_days": trial_days},
        )
    else:
        # Сразу платим и делаем split
        charge = await record_billing_ledger(
            db,
            tenant_id=tenant_id,
            entry_type=EntryType.PLUGIN_CHARGE,
            direction=Direction.DEBIT,
            amount=price,
            reference_id=plugin_sub.id,
            reference_type="plugin_subscription",
            description=f"Активация плагина {feature_key}",
        )
        await _apply_revenue_split(
            db, tenant_id=tenant_id, gross_amount=price,
            source_entry=charge, split_type="plugin"
        )

    return plugin_sub


async def charge_plugin_subscription(
    db: AsyncSession,
    plugin_sub_id: uuid.UUID,
) -> BillingLedger:
    """
    Продление платного плагина (вызывается фоновой задачей по расписанию).
    Создаёт PLUGIN_RENEWAL запись + revenue split.
    """
    result = await db.execute(
        select(TenantPluginSubscription).where(TenantPluginSubscription.id == plugin_sub_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise ValueError("Подписка на плагин не найдена")
    if sub.status not in (PluginSubStatus.TRIAL, PluginSubStatus.ACTIVE):
        raise ValueError(f"Нельзя списать — статус: {sub.status}")

    now = datetime.utcnow()
    charge = await record_billing_ledger(
        db,
        tenant_id=sub.tenant_id,
        entry_type=EntryType.PLUGIN_RENEWAL,
        direction=Direction.DEBIT,
        amount=sub.price,
        reference_id=sub.id,
        reference_type="plugin_subscription",
        description=f"Автопродление плагина {sub.feature_key}",
    )

    sub.status = PluginSubStatus.ACTIVE
    sub.last_charged_at = now
    days = 30 if sub.billing_cycle == "monthly" else 365
    sub.expires_at = now + timedelta(days=days)
    await db.flush()

    await _apply_revenue_split(
        db, tenant_id=sub.tenant_id, gross_amount=sub.price,
        source_entry=charge, split_type="plugin"
    )
    return charge


async def cancel_plugin_subscription(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    feature_key: str,
) -> TenantPluginSubscription:
    """Отменить подписку на плагин."""
    sub = await get_active_plugin_subscription(db, tenant_id, feature_key)
    if not sub:
        raise ValueError(f"Активная подписка на {feature_key} не найдена")
    sub.status = PluginSubStatus.CANCELLED
    sub.cancelled_at = datetime.utcnow()
    sub.auto_renew = False
    await db.flush()
    return sub


async def assert_plugin_active(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    feature_key: str,
) -> None:
    """
    Dependency-guard: бросает HTTP 402 если плагин не активен.
    Использовать в роутерах как: await assert_plugin_active(db, tenant_id, "p2p_calls")
    """
    from fastapi import HTTPException
    sub = await get_active_plugin_subscription(db, tenant_id, feature_key)
    if sub is None:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "plugin_not_subscribed",
                "feature_key": feature_key,
                "message": f"Плагин {feature_key} не подключён. Включите его в разделе Плагины.",
            }
        )


# ── Advertising ───────────────────────────────────────────────────────────────

async def create_ad(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    title: str,
    start_date: date,
    end_date: date,
    price: Decimal,
    body: str | None = None,
    image_url: str | None = None,
    link: str | None = None,
    ad_type: str = AdType.BANNER,
    pricing_model: str = PricingModel.FLAT,
    impressions_limit: int | None = None,
    clicks_limit: int | None = None,
    created_by_id: uuid.UUID | None = None,
    meta: dict | None = None,
) -> Ad:
    """
    Создать рекламное объявление.

    При flat pricing: сразу создаётся BillingLedger AD_CHARGE + revenue split.
    При cpc/cpm: billing происходит при событиях (AdEvent → record_ad_event_billing).
    """
    ad = Ad(
        tenant_id=tenant_id,
        created_by_id=created_by_id,
        title=title,
        body=body,
        image_url=image_url,
        link=link,
        ad_type=ad_type,
        status=AdStatus.DRAFT,
        start_date=start_date,
        end_date=end_date,
        price=price,
        pricing_model=pricing_model,
        impressions_limit=impressions_limit,
        clicks_limit=clicks_limit,
        meta=meta,
    )
    db.add(ad)
    await db.flush()

    # Flat: списание сразу при создании
    if price > 0 and pricing_model == PricingModel.FLAT:
        charge = await record_billing_ledger(
            db,
            tenant_id=tenant_id,
            entry_type=EntryType.AD_CHARGE,
            direction=Direction.DEBIT,
            amount=price,
            reference_id=ad.id,
            reference_type="ad",
            description=f"Размещение рекламы: {title}",
            meta={"ad_type": ad_type, "pricing_model": pricing_model,
                  "start": str(start_date), "end": str(end_date)},
        )
        await _apply_revenue_split(
            db, tenant_id=tenant_id, gross_amount=price,
            source_entry=charge, split_type="ad"
        )

    return ad


async def record_ad_event(
    db: AsyncSession,
    *,
    ad_id: uuid.UUID,
    tenant_id: uuid.UUID,
    event_type: str,   # impression / click / conversion
    user_id: uuid.UUID | None = None,
    ip: str | None = None,
    meta: dict | None = None,
) -> AdEvent:
    """
    Зарегистрировать событие рекламы (показ, клик, конверсия).

    - Обновляет счётчик на Ad (денормализация)
    - При cpc/cpm: создаёт BillingLedger запись + split
    - ip_hash = SHA-256(ip + date) — без хранения PII (152-ФЗ)
    """
    # Хешируем IP
    ip_hash = None
    if ip:
        today = str(date.today())
        ip_hash = hashlib.sha256(f"{ip}:{today}".encode()).hexdigest()

    event = AdEvent(
        ad_id=ad_id,
        tenant_id=tenant_id,
        user_id=user_id,
        event_type=event_type,
        ip_hash=ip_hash,
        meta=meta,
    )
    db.add(event)

    # Обновляем денормализованные счётчики
    ad_result = await db.execute(select(Ad).where(Ad.id == ad_id))
    ad = ad_result.scalar_one_or_none()
    if ad:
        if event_type == AdEventType.IMPRESSION:
            ad.impressions_count += 1
        elif event_type == AdEventType.CLICK:
            ad.clicks_count += 1
        elif event_type == AdEventType.CONVERSION:
            ad.conversions_count += 1

        # CPC/CPM биллинг при событии
        if ad.pricing_model == PricingModel.CPC and event_type == AdEventType.CLICK and ad.price > 0:
            charge = await record_billing_ledger(
                db,
                tenant_id=tenant_id,
                entry_type=EntryType.AD_CLICK_INCOME,
                direction=Direction.DEBIT,
                amount=ad.price,
                reference_id=ad_id,
                reference_type="ad",
                description=f"CPC click: {ad.title}",
            )
            await _apply_revenue_split(db, tenant_id=tenant_id, gross_amount=ad.price,
                                       source_entry=charge, split_type="ad")

        elif ad.pricing_model == PricingModel.CPM and event_type == AdEventType.IMPRESSION:
            # CPM: списываем price/1000 за каждый показ
            cost_per_impression = (ad.price / Decimal("1000")).quantize(Decimal("0.0001"))
            if cost_per_impression > 0:
                charge = await record_billing_ledger(
                    db,
                    tenant_id=tenant_id,
                    entry_type=EntryType.AD_IMPRESSION_INCOME,
                    direction=Direction.DEBIT,
                    amount=cost_per_impression,
                    reference_id=ad_id,
                    reference_type="ad",
                    description=f"CPM impression: {ad.title}",
                )
                await _apply_revenue_split(db, tenant_id=tenant_id, gross_amount=cost_per_impression,
                                           source_entry=charge, split_type="ad")

    await db.flush()
    return event


# ── Аналитика биллинга ────────────────────────────────────────────────────────

async def get_billing_ledger_summary(
    db: AsyncSession,
    tenant_id: uuid.UUID | None = None,
    days: int = 30,
) -> dict:
    """
    Сводка биллингового реестра за период.
    tenant_id=None → агрегация по всей платформе (для суперадмина).
    """
    since = datetime.utcnow() - timedelta(days=days)

    q = (
        select(
            BillingLedger.entry_type,
            BillingLedger.direction,
            func.sum(BillingLedger.amount).label("total"),
            func.count(BillingLedger.id).label("count"),
        )
        .where(BillingLedger.created_at >= since)
        .where(BillingLedger.is_split == False)  # только gross записи, без split
        .group_by(BillingLedger.entry_type, BillingLedger.direction)
    )
    if tenant_id:
        q = q.where(BillingLedger.tenant_id == tenant_id)

    rows = (await db.execute(q)).all()

    breakdown: dict = {}
    total_credit = Decimal("0")
    total_debit  = Decimal("0")
    for entry_type, direction, total, count in rows:
        key = f"{entry_type}_{direction}"
        breakdown[key] = {"amount": float(total), "count": count}
        if direction == Direction.CREDIT:
            total_credit += total
        else:
            total_debit += total

    # Платформенный доход (split записи)
    platform_q = (
        select(func.sum(BillingLedger.amount))
        .where(
            BillingLedger.entry_type == EntryType.PLATFORM_INCOME,
            BillingLedger.direction == Direction.CREDIT,
            BillingLedger.created_at >= since,
        )
    )
    platform_income = Decimal(str((await db.execute(platform_q)).scalar() or 0))

    return {
        "period_days": days,
        "total_credit": float(total_credit),
        "total_debit": float(total_debit),
        "net": float(total_credit - total_debit),
        "platform_income": float(platform_income),
        "breakdown": breakdown,
    }
