"""
Модель PendingSubscriptionRequest — заявка пациента на подписку,
ожидающая ручного одобрения менеджером клиники.

Workflow:
  1. Пациент отправляет POST /patient/subscription/request → создаётся
     запись со status='pending'. Подписка ещё НЕ активна.
  2. Менеджер видит список в кабинете (/manager/subscription-pending),
     одобряет или отклоняет.
  3. При одобрении — создаётся PatientSubscription (через
     subscription_cash_service.activate_cash для cash или через
     subscription_service.start_subscription для online),
     resulting_subscription_id ссылается на новую подписку.

Поля payment_method: 'cash' | 'online' | 'unknown' — что хочет пациент
(не финальное решение, менеджер может уточнить).
"""
import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PendingSubscriptionRequest(Base):
    __tablename__ = "pending_subscription_requests"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clinics.id", ondelete="SET NULL"),
        nullable=True,
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    plan_key: Mapped[str] = mapped_column(String(40), nullable=False)
    months: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 'cash' | 'online' | 'unknown'
    payment_method: Mapped[str | None] = mapped_column(String(40), nullable=True)
    patient_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # pending | approved | rejected | expired
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    resulting_subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_subscriptions.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=datetime.utcnow, nullable=False
    )
