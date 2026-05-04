"""
Семейный аккаунт пациента.
Owner может добавлять members (по телефону), затем переключаться между профилями.
Безопасность: при switch требуется short_code активного направления члена семьи.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class PatientFamilyMember(Base):
    __tablename__ = 'patient_family_members'
    __table_args__ = (
        UniqueConstraint('owner_phone', 'member_phone', name='uq_family_owner_member'),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Хозяин семейного списка (нормализованный телефон)
    owner_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # Член семьи — нормализованный телефон
    member_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # ФИО члена семьи (для отображения в селекторе)
    member_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Тип отношения: «Супруг(а)», «Ребёнок», «Родитель» и т.п.
    relation: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
