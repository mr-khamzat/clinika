"""
Модели Patient Portal v2: аккаунты пациентов + OTP-коды для входа.
"""
import uuid
from datetime import datetime, date
from sqlalchemy import Integer, String, Boolean, DateTime, Date
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class PatientAccount(Base):
    __tablename__ = "patient_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # === ce01: engagement tracking ===
    login_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    marketing_opt_in: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    # chatslot01: связь с МИС (заполняется patient_identifier service)
    mis_patient_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    mis_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # 'pending' | 'linked' | 'created' | 'manual_required' | 'ambiguous' | 'no_phone' | 'error'
    mis_sync_state: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )


class PatientOTP(Base):
    __tablename__ = "patient_otps"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(6), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
