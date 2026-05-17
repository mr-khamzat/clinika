"""TenantMisSubscriptionWebhook — внешние МИС-вебхуки на события подписки.

См. миграцию miswebhook01.

Когда менеджер активирует подписку наличными (subscription_cash_service),
либо пациент сам активирует онлайн (patient_subscription), либо подписка
автопродлевается / отменяется — отправляется webhook на все активные
endpoints тенанта.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TenantMisSubscriptionWebhook(Base):
    __tablename__ = "tenant_mis_subscription_webhooks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    mis_type: Mapped[str] = mapped_column(String(30), nullable=False)
    webhook_url: Mapped[str] = mapped_column(String(500), nullable=False)
    auth_header: Mapped[str | None] = mapped_column(String(200), nullable=True)
    events: Mapped[list] = mapped_column(
        JSONB, nullable=False,
        default=lambda: ["subscription.activated", "subscription.cancelled"],
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true",
    )
    last_success_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_error_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    retry_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow,
    )
