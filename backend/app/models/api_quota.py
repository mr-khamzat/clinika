"""Модели API Quotas и Rate Limits по тенантам.

TenantQuota — настройки лимитов для конкретного tenant (RPM, RPD, storage MB,
   users count, calls minutes/month). Один tenant — одна строка (UNIQUE).
QuotaUsage — daily-aggregate использование, копится в Redis и периодически
   сбрасывается в БД (flush_to_db в quota_service). Один tenant + period (date) —
   одна строка (UNIQUE composite).

Лимиты задаёт super_admin через POST/PUT /admin/quotas/{tenant_id}.
"""
import uuid
from datetime import datetime, date
from sqlalchemy import Integer, Boolean, DateTime, Date, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


# ── Дефолтные лимиты ─────────────────────────────────────────────────────────
# Используются при создании новой строки TenantQuota и в quota_service когда
# квота отсутствует в БД (fallback). Совпадают с значениями server_default ниже.
DEFAULT_REQUESTS_PER_MINUTE: int = 6000
DEFAULT_REQUESTS_PER_DAY: int = 100_000
DEFAULT_STORAGE_MB_LIMIT: int = 5000
DEFAULT_USERS_LIMIT: int = 50
DEFAULT_CALLS_MINUTES_PER_MONTH: int = 1000


class TenantQuota(Base):
    """Настройки квот для конкретного tenant. Один tenant — одна строка."""
    __tablename__ = "tenant_quotas"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    requests_per_minute: Mapped[int] = mapped_column(Integer, nullable=False, default=DEFAULT_REQUESTS_PER_MINUTE)
    requests_per_day: Mapped[int] = mapped_column(Integer, nullable=False, default=DEFAULT_REQUESTS_PER_DAY)
    storage_mb_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=DEFAULT_STORAGE_MB_LIMIT)
    users_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=DEFAULT_USERS_LIMIT)
    calls_minutes_per_month: Mapped[int] = mapped_column(Integer, nullable=False, default=DEFAULT_CALLS_MINUTES_PER_MONTH)
    # plan_default — флаг "это копия дефолтного шаблона тарифа" (super_admin
    # может пометить, что лимиты не редактировались индивидуально).
    plan_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class QuotaUsage(Base):
    """Daily aggregate использования. Заполняется flush_to_db из Redis."""
    __tablename__ = "quota_usage"
    __table_args__ = (
        UniqueConstraint("tenant_id", "period", name="uq_quota_usage_tenant_period"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    period: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    requests_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    storage_mb_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    calls_minutes_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
