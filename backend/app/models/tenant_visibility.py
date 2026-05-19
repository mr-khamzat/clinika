"""TenantVisibility — асимметричная матрица видимости тенантов внутри франшизы.

Запись `(viewer_tenant_id=A, target_tenant_id=B, allow_chat=False, allow_calls=True)`
означает: пользователи тенанта A НЕ видят пользователей тенанта B в StaffChat,
но видят их в Calls.

Если для пары (A, B) записи нет — по умолчанию считаем `allow_chat=True` и
`allow_calls=True` (т.е. в рамках одной франшизы видны все, как сейчас).
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TenantVisibility(Base):
    __tablename__ = "tenant_visibility"
    __table_args__ = (
        UniqueConstraint("viewer_tenant_id", "target_tenant_id", name="uq_tenant_visibility_pair"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    viewer_tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    allow_chat: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_calls: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow,
                                                  onupdate=datetime.utcnow)
