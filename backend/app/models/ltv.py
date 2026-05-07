"""
Модель LTV-аналитики пациентов (модуль ltv_pro).

PatientLtvSnapshot — агрегированный снимок ценности одного пациента в рамках
тенанта/клиники. Пересчитывается ежедневно cron-задачей run_ltv_job по данным
МИС (Renovatio) либо вручную через POST /analytics/ltv/recompute.

Расчёт LTV (упрощённый):
  ltv_estimate = avg_check × visits_per_year × 3   (горизонт 3 года, по sum_value визита)
  net_ltv      = avg_paid × visits_per_year × 3   (горизонт 3 года, по фактическим оплатам из getPayments)

Группировка по телефону (нормализованному) — pesticidedouble в МИС
у одного пациента может быть несколько id, но телефон стабильный ключ.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PatientLtvSnapshot(Base):
    """Снимок LTV пациента — пересчитывается крон-задачей раз в сутки."""

    __tablename__ = "patient_ltv_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "clinic_id", "patient_phone",
            name="uq_ltv_snapshot_tenant_clinic_phone",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clinics.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Ключ агрегации — нормализованный телефон пациента
    patient_phone: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    patient_name: Mapped[str | None] = mapped_column(String(300), nullable=True)

    # Метрики
    visits_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_spent: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    avg_check: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    first_visit_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_visit_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Производные
    visits_per_year: Mapped[Decimal] = mapped_column(
        Numeric(6, 2), nullable=False, default=Decimal("0")
    )
    ltv_estimate: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )

    # NetLTV — по фактическим оплатам из getPayments
    # (если Renovatio открыл доступ к методу). Если данных нет — равен 0.
    net_ltv: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )

    # Когорта (квартал первого визита, например "2026-Q1")
    cohort_quarter: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)

    # Риск оттока: 'low' | 'medium' | 'high'
    # low    — последний визит ≤90 дней назад
    # medium — 91..180 дней
    # high   — >180 дней
    churn_risk: Mapped[str] = mapped_column(
        String(10), nullable=False, default="low", index=True
    )

    computed_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
