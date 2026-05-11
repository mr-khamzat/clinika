"""
Глава 8 — Семейный профиль пациента (расширенная модель).

Старая модель PatientFamilyMember (parent_phone + member_phone) сохраняется для
обратной совместимости. Эта модель — новая, основанная на UUID-аккаунтах:

  FamilyGroup   — одна группа на семью (owner — главный пациент).
  FamilyMember  — связь patient_account_id ↔ family_group (с правами доступа).
  FamilyInvite  — pending-приглашения по телефону (если такой пациент уже есть).
"""
import uuid
from datetime import datetime, timedelta
from sqlalchemy import (
    String, Boolean, DateTime, ForeignKey, UniqueConstraint, Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class FamilyGroup(Base):
    """Семейная группа пациента (один владелец, несколько членов)."""
    __tablename__ = "family_groups"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    owner_patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=False, index=True, unique=True,
    )
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class FamilyMember(Base):
    """Член семейной группы (patient_account + флаги прав)."""
    __tablename__ = "family_members"
    __table_args__ = (
        UniqueConstraint("group_id", "patient_id", name="uq_family_group_patient"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("family_groups.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # self|spouse|child|parent|sibling|other
    relation: Mapped[str] = mapped_column(String(40), nullable=False, default="other")
    can_view_records: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    can_book_appointments: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    can_manage_payments: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    added_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )


class FamilyInvite(Base):
    """Pending-приглашение в семейную группу (если такой пациент уже есть)."""
    __tablename__ = "family_invites"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("family_groups.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    inviter_patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    invitee_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    invitee_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    relation: Mapped[str] = mapped_column(String(40), nullable=False, default="other")
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    # pending | accepted | expired | cancelled
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False,
        default=lambda: datetime.utcnow() + timedelta(days=14),
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
