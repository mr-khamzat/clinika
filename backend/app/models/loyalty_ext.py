"""
Глава 8 — Расширение программы лояльности.

Старые модели (LoyaltyAccount по phone, LoyaltyTransaction, LoyaltyRule,
LoyaltyTier, LoyaltyReward) уже существуют в app.models.loyalty —
их трогать НЕЛЬЗЯ (legacy router /loyalty/* зависит).

Здесь добавляем:
  LoyaltyAccountExt   — расширенный аккаунт (по patient_account_id) с тиром
                         и total_spent (8 глава). Совместный ключ tenant+patient.
  LoyaltyEvent        — приходы баллов с привязкой к appointment/referral.
  LoyaltyClaim        — заявки пациентов на награды (статусы requested|approved|
                         delivered|cancelled).
"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import (
    String, Integer, DateTime, ForeignKey, Numeric, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class LoyaltyAccountExt(Base):
    """Расширенный аккаунт лояльности — с тиром и total_spent (Глава 8)."""
    __tablename__ = "loyalty_accounts_ext"
    __table_args__ = (
        UniqueConstraint("tenant_id", "patient_id", name="uq_loyalty_ext_tenant_patient"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    patient_phone: Mapped[str] = mapped_column(String(32), nullable=False, index=True)

    points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # bronze | silver | gold | platinum
    tier: Mapped[str] = mapped_column(String(20), nullable=False, default="bronze")
    total_spent: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class LoyaltyEvent(Base):
    """Событие начисления/списания баллов (привязка к appointment/referral)."""
    __tablename__ = "loyalty_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loyalty_accounts_ext.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    # appointment_completed | referral_made | birthday_bonus | manual_admin | reward_claimed
    reason: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    referral_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("referrals.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False, index=True
    )


class LoyaltyClaim(Base):
    """Заявка пациента на получение награды из каталога LoyaltyReward."""
    __tablename__ = "loyalty_claims"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loyalty_accounts_ext.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    reward_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loyalty_rewards.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    points_spent: Mapped[int] = mapped_column(Integer, nullable=False)
    # requested | approved | delivered | cancelled
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="requested", index=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
