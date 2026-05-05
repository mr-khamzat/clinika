"""Модель правил звонков по ролям и scope (same/cross/any клиника)."""
import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CallScope:
    """Область действия правила относительно клиники инициатора и получателя."""
    SAME_CLINIC = "same_clinic"   # обе стороны в одной клинике
    CROSS_CLINIC = "cross_clinic" # стороны в разных клиниках
    ANY = "any"                   # без учёта клиники


class CallRule(Base):
    """Правило: пользователь с ролью from_role может звонить пользователю с ролью to_role
    при заданном scope. Правило отсутствует → используется дефолт (см. call_rules_service)."""
    __tablename__ = "call_rules"
    __table_args__ = (
        UniqueConstraint("tenant_id", "from_role", "to_role", "scope", name="uq_call_rule"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_role: Mapped[str] = mapped_column(String(50), nullable=False)
    to_role: Mapped[str] = mapped_column(String(50), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False, default=CallScope.ANY)
    allow_audio: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_video: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )
