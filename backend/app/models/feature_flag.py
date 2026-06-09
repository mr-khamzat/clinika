"""Feature Flags — управление фичами платформы (super_admin → тенанты + A/B).

Две таблицы:
  FeatureFlag         — каталог фич: ключ, стратегия раскатки, дефолт.
  TenantFeatureFlag   — override на уровне тенанта (включена/выключена + вариант
                        для A/B-теста).

rollout_strategy:
  all         — флаг включён для всех (значение default_enabled).
  tenants     — явно перечисленные тенанты через override (без overrride → выкл).
  percentage  — детерминистический rollout по hash(tenant_id) под % из rollout_value.
  ab_test     — детерминистическое распределение между вариантами A/B (rollout_value).

rollout_value (JSONB):
  {"percentage": 25}                     — для percentage
  {"variants": {"A": 50, "B": 50}}        — для ab_test (сумма должна давать 100)
  {} или null                            — для all/tenants
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RolloutStrategy(str, enum.Enum):
    """Стратегия раскатки фичи на тенантов."""

    all = "all"
    tenants = "tenants"
    percentage = "percentage"
    ab_test = "ab_test"


class FeatureFlag(Base):
    """Каталог фич платформы — управляет super_admin."""

    __tablename__ = "feature_flags"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Машинный ключ: только snake_case ASCII. Используется в коде через is_enabled.
    key: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    rollout_strategy: Mapped[RolloutStrategy] = mapped_column(
        SAEnum(
            RolloutStrategy,
            name="feature_flag_rollout_strategy",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=RolloutStrategy.all,
        server_default=RolloutStrategy.all.value,
    )
    rollout_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    overrides: Mapped[list["TenantFeatureFlag"]] = relationship(
        "TenantFeatureFlag",
        back_populates="flag",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class TenantFeatureFlag(Base):
    """Override фичи на уровне тенанта.

    enabled — жёсткое значение (true/false), полностью перебивает стратегию.
    variant — опциональный вариант A/B (например 'A' / 'B'); фиксируется
              супер-админом или формируется из percentage-распределения
              когда нужно «прибить» тенанта к конкретной ветке.
    """

    __tablename__ = "tenant_feature_flags"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    feature_flag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("feature_flags.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    variant: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    flag: Mapped["FeatureFlag"] = relationship("FeatureFlag", back_populates="overrides")

    __table_args__ = (
        Index(
            "uq_tenant_feature_flag_tenant_flag",
            "tenant_id",
            "feature_flag_id",
            unique=True,
        ),
    )
