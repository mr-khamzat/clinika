"""
Модель SignupRequest — драфт самостоятельной регистрации франшизы.

Используется публичным wizard-ом (/signup → /onboarding/*) для безопасного
двухфазного создания тенанта:
    1. start:  собираем данные + шлём OTP на email, status=draft
    2. verify: пользователь вводит код,                status=verified
    3. complete: создаём Franchise/Tenant/User/Clinics, status=completed

Полные данные шагов wizard-а лежат в payload (JSONB), сама модель — только
"шапка" для индексов, антифрода и админских отчётов.
"""
import uuid
from datetime import datetime
import sqlalchemy as sa
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB, INET
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SignupRequest(Base):
    __tablename__ = "signup_requests"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # ── Контакты будущего владельца франшизы ──────────────────────────────
    email:          Mapped[str]       = mapped_column(String(200), nullable=False, index=True)
    phone:          Mapped[str | None]= mapped_column(String(50),  nullable=True)
    full_name_encrypted: Mapped[str] = mapped_column("full_name_encrypted", sa.Text, nullable=False)

    # ── Идентификаторы будущего тенанта ───────────────────────────────────
    franchise_name: Mapped[str]       = mapped_column(String(200), nullable=False)
    tenant_slug:    Mapped[str]       = mapped_column(String(100), nullable=False, index=True)

    # Полные данные wizard-а: клиники, модули, выбранный план
    payload:        Mapped[dict]      = mapped_column(JSONB, nullable=False, default=dict)

    # ── OTP-верификация ───────────────────────────────────────────────────
    verification_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    attempts:          Mapped[int]        = mapped_column(Integer, nullable=False, default=0)
    verified_at:       Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ── Связь с созданным тенантом (после complete) ───────────────────────
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
    )

    # draft | verified | completed | failed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)

    # ── Антифрод-метаданные ───────────────────────────────────────────────
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Последняя ошибка complete (если failed)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    def __init__(self, **kwargs):
        from app.services.encryption_service import encrypt as _enc
        for plain, enc_col in [('full_name', 'full_name_encrypted')]:
            if plain in kwargs:
                val = kwargs.pop(plain)
                kwargs[enc_col] = _enc(val) if val is not None else None
        super().__init__(**kwargs)

    @property
    def full_name(self):
        from app.services.encryption_service import decrypt
        return decrypt(self.full_name_encrypted)

    @full_name.setter
    def full_name(self, value):
        from app.services.encryption_service import encrypt
        self.full_name_encrypted = encrypt(value) if value is not None else None
