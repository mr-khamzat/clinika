"""
Module Monitoring System — модель состояния платных модулей per-tenant.

Используется services/module_health_service.py для:
  - Регулярных health-проверок (cron каждые 30 мин).
  - Telegram-алертов при переходе ok→error.
  - UI-индикаторов в кабинетах (franchise_owner / super_admin).

Семантика статусов:
  unknown   — ещё не проверяли (default при первой записи)
  ok        — модуль работает штатно
  degraded  — работает, но с предупреждениями (slow / частичные ошибки)
  error     — упал (нет успешных операций / критическая ошибка)
  idle      — модуль подписан, но не используется > N дней (informational)

Поле metrics (JSONB) хранит ключевые цифры адаптера (count активных сессий,
delivery rate, last receipt timestamp и т.д.) для отображения в UI tooltip.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ModuleHealthStatus(str, enum.Enum):
    UNKNOWN  = "unknown"
    OK       = "ok"
    DEGRADED = "degraded"
    ERROR    = "error"
    IDLE     = "idle"


class ModuleHealthCheck(Base):
    """Состояние одного модуля у одного тенанта (last-known)."""
    __tablename__ = "module_health_checks"
    __table_args__ = (
        UniqueConstraint("tenant_id", "module_key", name="uq_module_health_tenant_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    module_key: Mapped[str] = mapped_column(String(100), nullable=False)
    # Хранится как varchar (а не SAEnum) — миграция уже создала VARCHAR(16);
    # совместимо с существующей таблицей и проще менять статусы без alter type.
    status: Mapped[str] = mapped_column(
        String(16), default=ModuleHealthStatus.UNKNOWN.value, nullable=False, index=True
    )
    last_check_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_count_24h: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_alert_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    metrics: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
