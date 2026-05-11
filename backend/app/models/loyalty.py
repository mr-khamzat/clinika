"""
Loyalty (программа лояльности пациента).

Отдельная от bonus-системы (та — рефералы/кэшбек). Эта программа:
- начисляет баллы за траты пациента (1 балл = 100₽);
- двигает по уровням (bronze → silver → gold → platinum);
- даёт перки (% скидка, приоритет, бесплатные консультации).

Транзакции — append-only (иммутабельны).
"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, DateTime, ForeignKey, Numeric, Integer, Text, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base


class LoyaltyAccount(Base):
    """Аккаунт пациента в программе лояльности (один на пациента в рамках тенанта)."""
    __tablename__ = "loyalty_accounts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "patient_phone", name="uq_loyalty_account_tenant_phone"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    patient_phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    points_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    points_balance: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tier: Mapped[str] = mapped_column(String(20), nullable=False, default="bronze")
    tier_progress: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))

    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class LoyaltyTransaction(Base):
    """Транзакция программы лояльности (append-only). delta>0 — начисление, <0 — списание."""
    __tablename__ = "loyalty_transactions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("loyalty_accounts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    patient_phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    # 'earn' | 'redeem' | 'expire' | 'tier_bonus' | 'manual_credit' | 'manual_debit'
    op_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    reference_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class LoyaltyTier(Base):
    """Конфиг уровня (порог в рублях, % скидки, перки JSON)."""
    __tablename__ = "loyalty_tiers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_loyalty_tier_tenant_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(20), nullable=False)
    threshold_rub: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("0"))
    perks: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class PatientAIConversation(Base):
    """Лог диалогов с медицинским AI-ассистентом (для аудита и анализа)."""
    __tablename__ = "patient_ai_conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    patient_phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(20), nullable=True)  # llm/cache/fallback
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


# ─────────────────────────── W5 Loyalty UI ─────────────────────────────────
# Расширения для UI: правила автоначисления + каталог обмена.

class LoyaltyRule(Base):
    """Правило автоматического начисления баллов (visit/referral/birthday/specialist)."""
    __tablename__ = "loyalty_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # 'visit' | 'referral' | 'birthday' | 'specialist'
    rule_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    bonus_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bonus_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # conditions — произвольный JSON: {"service_ids":[...], "doctor_ids":[...], "min_amount":...}
    conditions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class LoyaltyReward(Base):
    """Каталог наград (что пациент может купить за баллы)."""
    __tablename__ = "loyalty_rewards"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 'free_service' | 'service_discount' | 'gift'
    reward_type: Mapped[str] = mapped_column(String(30), nullable=False)
    cost_points: Mapped[int] = mapped_column(Integer, nullable=False)
    discount_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    service_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    icon: Mapped[str | None] = mapped_column(String(40), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Глава 8: фильтр по тиру (bronze/silver/gold/platinum) и stock (NULL = безлимит)
    min_tier: Mapped[str] = mapped_column(String(20), nullable=False, default="bronze", server_default="bronze")
    stock: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
