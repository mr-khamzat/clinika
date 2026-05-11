"""
Глава 9 — Подписка пациента «Здоровье+» (и совместимые планы).

Планы:
  health_plus  — ₽290/мес: безлимит чата, скидка 10%, расходник 1×/мес, приоритет
  family_plus  — ₽590/мес: то же + до 4 членов семьи
  pro          — ₽990/мес: + телемедицина / приоритет 24/7
"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import (
    String, Boolean, DateTime, ForeignKey, Numeric, Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class PatientSubscription(Base):
    __tablename__ = "patient_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # health_plus | family_plus | pro
    plan: Mapped[str] = mapped_column(String(40), nullable=False)
    # active | paused | cancelled | expired | trial
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="trial", index=True
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=datetime.utcnow
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    auto_renew: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    price_monthly: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(40), nullable=True)
    external_subscription_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow,
        nullable=False,
    )


class PatientSubscriptionHistory(Base):
    __tablename__ = "patient_subscription_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    subscription_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_subscriptions.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # created | activated | renewed | paused | cancelled | expired | payment_failed | resumed
    event: Mapped[str] = mapped_column(String(40), nullable=False)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
