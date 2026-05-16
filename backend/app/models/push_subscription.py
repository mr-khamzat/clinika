"""PushSubscription model.

Web Push (VAPID) подписки для уведомлений.

Поля user_id / patient_id — взаимоисключающие:
 - user_id заполнен для сотрудников (врач/менеджер/администратор)
 - patient_id заполнен для пациентов (PatientAccount, аккаунт пациента)
 - оба null допустимо в legacy-записях, где использовался только phone

Историческое: patient_phone оставлено для обратной совместимости со
старыми мобильными подписками, где аккаунта ещё не было; новые подписки
должны проставлять patient_id.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Кто подписался: либо сотрудник, либо пациент
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    patient_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # Телефон пациента (legacy, для старых подписок без patient_id)
    patient_phone: Mapped[str | None] = mapped_column(String(20), index=True, nullable=True)
    # Endpoint Web Push API
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # Ключи подписки (Base64URL, в браузерных подписках до ~88 символов)
    p256dh: Mapped[str] = mapped_column(String(200), nullable=False)
    auth: Mapped[str] = mapped_column(String(200), nullable=False)
    # User-Agent браузера/устройства (для отладки/инвалидации)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Tenant (для изоляции мульти-арендатор)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
