"""
Webhooks — исходящие уведомления клиентам о событиях в системе.
Тенант регистрирует URL → мы отправляем POST при событии.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Integer, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class WebhookEndpoint(Base):
    """Зарегистрированный URL для получения событий тенанта."""
    __tablename__ = "webhook_endpoints"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    # Список событий через запятую: referral_created,bonus_paid,patient_registered
    events: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    secret: Mapped[str | None] = mapped_column(String(200), nullable=True)  # HMAC подпись
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Статистика
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fail_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class WebhookDelivery(Base):
    """Лог доставки каждого события (для отладки и retry)."""
    __tablename__ = "webhook_deliveries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    endpoint_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("webhook_endpoints.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    event: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    delivered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
