"""
Модель ManagerClinicAccess — multi-clinic доступ для менеджера.

Глава 4 (mgr_templates01): менеджер может управлять несколькими клиниками
тенанта одновременно. Связь — N:M через эту таблицу. Если у пользователя
нет ни одной записи здесь — fallback на User.clinic_id (одна клиника).

Используется в:
  • routers.manager.multi_clinic — список доступных клиник и live-обзор;
  • routers.manager.clinics_access.get_user_clinic_ids — расширяет список
    доступных клиник менеджера до всех назначенных.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ManagerClinicAccess(Base):
    __tablename__ = "manager_clinic_access"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "clinic_id", name="uq_manager_clinic_access_user_clinic"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    granted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
