"""
Модель TenantPermissionOverride — переопределение RBAC для конкретного тенанта.

Этап 8 ROADMAP: «RBAC как данные».

Базовая матрица прав хранится в коде (app.core.permissions.ROLE_PERMISSIONS).
Тенант может переопределить отдельные действия для своих ролей через эту таблицу:

    permissions: dict[action: str, allowed: bool]

— значение True/False имеет приоритет над захардкоженной матрицей; если ключа
нет в override — fallback на ROLE_PERMISSIONS.

Уникальный ключ: (tenant_id, role).
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class TenantPermissionOverride(Base):
    __tablename__ = "tenant_permission_overrides"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Тенант, для которого переопределяем права. ON DELETE CASCADE — при
    # удалении тенанта overrides уходят вместе с ним.
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Имя роли (UserRole.value): manager / doctor / reg / nurse / recruiter /
    # partner_doctor / visiting_doctor. Храним как строку, чтобы легко
    # добавлять новые роли без миграций.
    role: Mapped[str] = mapped_column(String(30), nullable=False)
    # Карта переопределений: {"referrals:read": true, "bonuses:write": false}.
    # Действия, которых нет в карте — не переопределены (fallback на код).
    permissions: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    # Кто последний раз менял (для аудита). NULL допустим (миграции/системные).
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "role", name="uq_tenant_role"),
    )
