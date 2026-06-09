"""Cost Attribution — снимки оценочной стоимости тенанта для платформы.

TenantCostSnapshot — храним сколько тенант стоит платформе (storage, API,
звонки) в рамках одного периода (= месяца).

Используется в дашборде super_admin → /admin/cost-attribution: топ-20
самых дорогих тенантов, тренды, total cost платформы.

Связан с QuotaUsage (api_quotas) — оттуда берём storage_mb / api_requests /
calls_minutes за period. Если QuotaUsage пуст — считаем эвристики
по таблицам uploads/call_recording.

est_cost_rub формула (можно крутить как параметры в cost_service):
    storage_mb * 0.5 + api_requests * 0.001 + calls_minutes * 0.5
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Index, Integer, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TenantCostSnapshot(Base):
    """Снимок стоимости тенанта за период (= календарный месяц, period = 1-е число).

    Один тенант × period — одна строка (UNIQUE). При повторном snapshot за
    тот же период строка обновляется в сервисе (upsert).
    """

    __tablename__ = "tenant_cost_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Период = 1-е число месяца. Удобно фильтровать «за май 2026» = period = 2026-05-01.
    period: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    # Хранилище в МБ за период (накопительно — сколько суммарно держал тенант).
    storage_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Сколько API-запросов сделал тенант за период.
    api_requests: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    # Грубая оценка количества строк в основных таблицах тенанта.
    db_rows_estimate: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    # Сколько минут звонков (телефония + телемед) сожгли за период.
    calls_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Оценочная стоимость в рублях. Используем Numeric, чтобы не терять копейки.
    est_cost_rub: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=0
    )

    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "period", name="uq_tenant_cost_snapshots_tenant_period"
        ),
        # Топ-20 за конкретный период — index по period + est_cost DESC.
        Index(
            "ix_tenant_cost_snap_period_cost",
            "period",
            "est_cost_rub",
        ),
    )
