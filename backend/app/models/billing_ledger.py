"""
Биллинговый реестр платформы (append-only).

ВАЖНО — разграничение с ledger.py:
  LedgerEntry (ledger.py)  — бонусы пациентов/сотрудников, клиентская сторона
  BillingLedger (здесь)    — финансы платформы: подписки, плагины, реклама, split

Revenue split: одна gross-запись + 2-3 split-записи (platform / tenant / franchise),
связанные через split_parent_id. Полный аудит одним JOIN.

Правило: записи НИКОГДА не изменяются и не удаляются.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, DateTime, ForeignKey, Numeric, Boolean, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class EntryType:
    """Типы записей в billing_ledger."""
    # Подписки на платформу
    SUBSCRIPTION_CHARGE  = "subscription_charge"    # списание за подписку
    SUBSCRIPTION_CREDIT  = "subscription_credit"    # возврат / кредит
    SUBSCRIPTION_TRIAL   = "subscription_trial"     # начало trial (amount=0, для аудита)

    # Плагины
    PLUGIN_CHARGE        = "plugin_charge"          # первичное включение платного плагина
    PLUGIN_RENEWAL       = "plugin_renewal"         # автопродление плагина
    PLUGIN_REFUND        = "plugin_refund"          # возврат за плагин

    # Реклама
    AD_CHARGE            = "ad_charge"              # размещение рекламы (flat)
    AD_CLICK_INCOME      = "ad_click_income"        # доход CPC
    AD_IMPRESSION_INCOME = "ad_impression_income"   # доход CPM

    # Revenue split (дочерние записи от gross)
    PLATFORM_INCOME      = "platform_income"        # доля платформы
    TENANT_INCOME        = "tenant_income"          # доля тенанта
    FRANCHISE_FEE        = "franchise_fee"          # франшизный сбор (дебет тенанта)

    # Платежи
    PAYMENT_RECEIVED     = "payment_received"       # получение платежа от тенанта
    REFUND               = "refund"                 # возврат тенанту

    # Ручная корректировка суперадмином
    MANUAL_ADJUSTMENT    = "manual_adjustment"


class Direction:
    """Направление движения денег с точки зрения платформы."""
    CREDIT = "credit"   # деньги пришли (платформа или тенант получил)
    DEBIT  = "debit"    # деньги ушли (платформа или тенант потратил)


class BillingLedger(Base):
    """
    Append-only реестр всех биллинговых операций платформы.

    Revenue split pattern:
      1. gross запись (PLUGIN_CHARGE, direction=debit, is_split=False)
      2. → PLATFORM_INCOME (credit, is_split=True, split_parent_id=gross.id, split_actor='platform')
      3. → TENANT_INCOME   (credit, is_split=True, split_parent_id=gross.id, split_actor='tenant')
      4. → FRANCHISE_FEE   (debit,  is_split=True, split_parent_id=gross.id, split_actor='franchise')  # если задан

    Запрос суммарного дохода платформы:
      SELECT SUM(amount) FROM billing_ledger
      WHERE entry_type='platform_income' AND direction='credit'
    """
    __tablename__ = "billing_ledger"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # None = запись принадлежит самой платформе (н-р суммарный platform_income)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True, index=True
    )
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"),
        nullable=True
    )

    # Тип операции и направление денег
    entry_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)   # credit / debit

    # Сумма всегда > 0 (направление определяет direction)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="RUB")

    # Ссылка на исходный объект (invoice_id, plugin_sub_id, ad_id, ...)
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    reference_type: Mapped[str | None] = mapped_column(String(60), nullable=True)

    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Revenue split: является ли эта запись частью разбивки
    is_split: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Ссылка на родительскую (gross) запись
    split_parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("billing_ledger.id", ondelete="SET NULL"),
        nullable=True, index=True
    )
    # Кто получает: platform / tenant / franchise
    split_actor: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Иммутабельная временная метка
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (
        # Быстрая выборка по тенанту + тип (финансовые отчёты)
        Index("ix_billing_ledger_tenant_type", "tenant_id", "entry_type"),
        # Временные ряды с фильтром по тенанту (мониторинг)
        Index("ix_billing_ledger_created_tenant", "created_at", "tenant_id"),
    )
