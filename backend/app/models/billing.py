"""
Биллинг: подписки, счета, платежи.
Этап 9 SaaS-трансформации.

Связи:
  Tenant 1──* Subscription (история тарифных планов)
  Subscription 1──* Invoice   (периодические счета)
  Invoice 1──* Payment        (платежи по счёту)
"""
import uuid
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import String, DateTime, Date, ForeignKey, Numeric, Text, Boolean, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base


# ── Статусы ───────────────────────────────────────────────────────────────────

class SubStatus:
    TRIAL      = "trial"
    ACTIVE     = "active"
    PAST_DUE   = "past_due"    # просрочен, ждёт оплаты
    PAUSED     = "paused"
    CANCELLED  = "cancelled"

class InvoiceStatus:
    DRAFT    = "draft"
    SENT     = "sent"
    PAID     = "paid"
    OVERDUE  = "overdue"
    VOID     = "void"

class PaymentStatus:
    PENDING   = "pending"
    COMPLETED = "completed"
    FAILED    = "failed"
    REFUNDED  = "refunded"


# ── Прайс-лист (статичный, хранится в коде) ───────────────────────────────────
PLAN_PRICES: dict[str, dict[str, Decimal]] = {
    "basic": {"monthly": Decimal("9900"), "quarterly": Decimal("28200"), "semi_annual": Decimal("53400"), "nine_months": Decimal("77500"), "annual": Decimal("99000")},
    "professional": {"monthly": Decimal("24900"), "quarterly": Decimal("70900"), "semi_annual": Decimal("134400"), "nine_months": Decimal("194900"), "annual": Decimal("249000")},
    "enterprise": {"monthly": Decimal("49900"), "quarterly": Decimal("142200"), "semi_annual": Decimal("269400"), "nine_months": Decimal("390700"), "annual": Decimal("499000")},
}


class Subscription(Base):
    """Подписка тенанта на тарифный план."""
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    plan: Mapped[str] = mapped_column(String(50), nullable=False)            # basic/professional/enterprise
    billing_cycle: Mapped[str] = mapped_column(String(20), default="monthly", nullable=False)  # monthly/annual
    status: Mapped[str] = mapped_column(String(30), default=SubStatus.TRIAL, nullable=False, index=True)
    # Период действия
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    current_period_start: Mapped[date] = mapped_column(Date, nullable=False)
    current_period_end: Mapped[date] = mapped_column(Date, nullable=False)
    # Следующий цикл выставления счёта
    next_invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Сколько стоит каждый период
    amount_per_period: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    # Автопродление
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Дополнительные поля (скидки, промо, metainfo)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    invoices: Mapped[list["Invoice"]] = relationship(
        "Invoice", back_populates="subscription", cascade="all, delete-orphan"
    )


class Invoice(Base):
    """Счёт на оплату за период подписки."""
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subscription_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subscriptions.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    # Номер счёта (человекочитаемый)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(30), default=InvoiceStatus.DRAFT, nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Период, за который выставлен счёт
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Платёжные данные
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paid_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    # Детали (строки счёта, налоги и т.п.)
    line_items: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    subscription: Mapped["Subscription"] = relationship("Subscription", back_populates="invoices")
    payments: Mapped[list["Payment"]] = relationship(
        "Payment", back_populates="invoice", cascade="all, delete-orphan"
    )


class Payment(Base):
    """Факт оплаты счёта."""
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default=PaymentStatus.PENDING, nullable=False, index=True)
    method: Mapped[str | None] = mapped_column(String(50), nullable=True)   # card/bank/cash/crypto
    transaction_id: Mapped[str | None] = mapped_column(String(200), nullable=True, unique=True)
    gateway: Mapped[str | None] = mapped_column(String(50), nullable=True)  # stripe/yookassa/manual
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    invoice: Mapped["Invoice"] = relationship("Invoice", back_populates="payments")


# ── Подписки на платные плагины ────────────────────────────────────────────────

class PluginSubStatus:
    TRIAL     = "trial"      # пробный период (бесплатно)
    ACTIVE    = "active"     # оплачен, активен
    EXPIRED   = "expired"    # истёк, ожидает продления
    CANCELLED = "cancelled"  # отменён тенантом


class TenantPluginSubscription(Base):
    """
    Финансовый lifecycle платного плагина/фичи для тенанта.

    Отличие от TenantPlugin (tenant.py):
      TenantPlugin — конфиг и enabled флаг (технический уровень)
      TenantPluginSubscription — финансовый lifecycle (этот класс)

    UniqueConstraint(tenant_id, feature_key):
      - Гарантирует одну активную подписку на фичу
      - enable_plugin() проверяет before insert → идемпотентность

    Связь с BillingLedger: через reference_id=self.id, reference_type='plugin_subscription'
    """
    __tablename__ = "tenant_plugin_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    # Ключ фичи из plugin_features.key
    feature_key: Mapped[str] = mapped_column(String(150), nullable=False, index=True)

    status: Mapped[str] = mapped_column(String(20), default=PluginSubStatus.TRIAL, nullable=False, index=True)
    billing_cycle: Mapped[str] = mapped_column(String(20), default="monthly", nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))

    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_charged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    auto_renew: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    from sqlalchemy import UniqueConstraint
    __table_args__ = (
        UniqueConstraint("tenant_id", "feature_key", name="uq_plugin_sub_tenant_feature"),
    )
