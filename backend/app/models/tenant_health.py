"""Tenant Health Score — модели для отслеживания здоровья тенантов.

TenantHealthSnapshot — append-only снимки здоровья: чем ниже score, тем выше
риск отвала тенанта. Считается раз в день (job, подключается отдельно)
сервисом tenant_health_service.

factors (JSONB) хранит компоненты score:
  {
    "activity_30d":         float (0..1) — доля активных дней за 30 дней,
    "payment_status":       "ok"|"overdue"|"failed"|"unknown",
    "churn_risk_pct":       float (0..100),
    "support_tickets_30d":  int,
    "feature_adoption_pct": float (0..100),
    "users_active_pct":     float (0..100),
    "_source":              "real"|"stub"  — заглушка или реальные данные
  }

alert_level:
  green  — score >= 70
  yellow — 40 <= score < 70
  red    — score < 40
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TenantHealthAlertLevel(str, enum.Enum):
    """Уровень тревоги для тенанта по score."""

    green = "green"
    yellow = "yellow"
    red = "red"


class TenantHealthSnapshot(Base):
    """Снимок здоровья тенанта на момент captured_at.

    Append-only — историю используем для построения трендов в админке.
    Один и тот же tenant может иметь сотни снимков (по одному в день).
    """

    __tablename__ = "tenant_health_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Момент расчёта снимка (UTC). Индекс DESC помогает быстро доставать
    # последний снимок каждого тенанта (DISTINCT ON в Postgres).
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True
    )
    # Интегральный score 0..100.
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    # Все компоненты + флаг _source (real/stub).
    factors: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # Уровень тревоги — денормализован для быстрого фильтра в /alerts.
    alert_level: Mapped[TenantHealthAlertLevel] = mapped_column(
        SAEnum(
            TenantHealthAlertLevel,
            name="tenant_health_alert_level",
            values_callable=lambda e: [m.value for m in e],
            create_type=False,
        ),
        nullable=False,
        index=True,
    )

    __table_args__ = (
        # Главный паттерн доступа: «последний снимок каждого тенанта».
        Index(
            "ix_tenant_health_snap_tenant_captured",
            "tenant_id",
            "captured_at",
        ),
    )
