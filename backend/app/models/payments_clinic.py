"""
Модели для платёжного каркаса клиники (online_payments_pro + fiscal_54fz_pro).

Архитектура:
  ── ClinicPayment           — оплата пациентом услуги клиники (картой онлайн)
  ── PaymentGatewayConfig    — конфиг шлюза (Юкасса/Т-Банк/...) для конкретной клиники
  ── FiscalReceipt           — фискальный чек 54-ФЗ (получен из ОФД)
  ── OFDConfig               — конфиг ОФД-провайдера (Платформа/Первый/Такском/Атол.Онлайн)

ВАЖНО: эти модели НЕ путать с app.models.billing.Payment — там подписки платформы
(тенант → платформа), здесь оплаты пациента клинике.

Шифрование секретов: secret_key (PaymentGatewayConfig) и api_key (OFDConfig)
хранятся в колонке как есть, но значение прогоняется через encryption_service
(префикс 'enc:'/'plain:', см. router при записи). Чтение — через property
decrypted_secret_key / decrypted_api_key (lazy import, decrypt совместим со
старыми записями без префикса). Имя колонки оставлено прежним (secret_key/
api_key), чтобы не требовать миграции; property названы decrypted_*, чтобы не
конфликтовать с mapped_column.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


# ── Константы шлюзов и ОФД-провайдеров ───────────────────────────────────────

class PaymentGateway:
    """Поддерживаемые шлюзы интернет-эквайринга."""
    YOOKASSA      = "yookassa"
    TINKOFF       = "tinkoff"
    SBER          = "sber"
    CLOUDPAYMENTS = "cloudpayments"
    ROBOKASSA     = "robokassa"


class OFDProvider:
    """Поддерживаемые ОФД (операторы фискальных данных)."""
    PLATFORMA_OFD = "platforma_ofd"
    PERV_OFD      = "perv_ofd"
    TAKSKOM       = "takskom"
    ATOL_ONLINE   = "atol_online"


class ClinicPaymentStatus:
    """Статусы платежа от пациента."""
    PENDING   = "pending"
    SUCCEEDED = "succeeded"
    CANCELLED = "cancelled"
    REFUNDED  = "refunded"


class FiscalOperationType:
    """Типы фискальных операций (54-ФЗ)."""
    SALE             = "sale"
    REFUND_SALE      = "refund_sale"
    SALE_CORRECTION  = "sale_correction"


# ── Платёж пациента ──────────────────────────────────────────────────────────

class ClinicPayment(Base):
    """Платёж пациента (через интернет-эквайринг). НЕ путать с подпиской платформы."""
    __tablename__ = "clinic_payments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("appointments.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    # Идентификация пациента (телефон — стабильный ключ)
    patient_phone: Mapped[str] = mapped_column(String(32), nullable=False)
    patient_name:  Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Сумма и шлюз
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    gateway: Mapped[str] = mapped_column(String(40), nullable=False)
    gateway_payment_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    # Статус и сопровождающие поля
    status: Mapped[str] = mapped_column(
        String(30), default=ClinicPaymentStatus.PENDING, nullable=False, index=True,
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    return_url:  Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Сырая полезная нагрузка от шлюза + наши служебные поля (idempotency_key и др.)
    payment_metadata: Mapped[dict] = mapped_column(
        JSONB, default=dict, nullable=False, server_default="{}",
    )

    created_at:  Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at:  Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    paid_at:     Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ── Конфиг шлюза для клиники ─────────────────────────────────────────────────

class PaymentGatewayConfig(Base):
    """Настройки одного шлюза (Юкасса/Т-Банк/...) для конкретной клиники."""
    __tablename__ = "payment_gateway_configs"
    __table_args__ = (
        UniqueConstraint("clinic_id", "gateway", name="uq_clinic_gateway"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    gateway:    Mapped[str] = mapped_column(String(40), nullable=False)
    shop_id:    Mapped[str] = mapped_column(String(255), nullable=False)
    # Секрет хранится зашифрованным (encryption_service: 'enc:'/'plain:'); запись
    # шифрует роутер, чтение — через property decrypted_secret_key ниже.
    secret_key: Mapped[str] = mapped_column(Text, nullable=False)

    is_active:    Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_test_mode: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Доп. параметры (return_url по умолчанию, taxation_system, vat_code и т.д.)
    config: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False, server_default="{}")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    @property
    def decrypted_secret_key(self) -> str | None:
        """Расшифрованный secret_key для использования адаптером эквайринга.

        Возвращает None, если секрет не задан или расшифровка не удалась
        (например, при несовпадении SECRET_KEY на проде) — вызывающий обязан
        трактовать None как «шлюз неработоспособен» и НЕ молча уходить в чужой
        ENV платформы. Совместимо со старыми записями без префикса (decrypt
        отдаёт их как есть).
        """
        raw = self.secret_key
        if not raw:
            return None
        from app.services.encryption_service import decrypt  # lazy: избегаем циклов
        return decrypt(raw)


# ── Фискальный чек 54-ФЗ ─────────────────────────────────────────────────────

class FiscalReceipt(Base):
    """Чек, полученный из ОФД (через pull или push)."""
    __tablename__ = "fiscal_receipts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("appointments.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinic_payments.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    inn: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    operation_type: Mapped[str] = mapped_column(String(40), nullable=False)
    total_sum: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    # QR-ссылка проверки чека ФНС: t=...&s=...&fn=...
    qr_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    fiscal_doc_number:     Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)  # ФД
    fiscal_storage_number: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)  # ФН
    fiscal_sign:           Mapped[str | None] = mapped_column(String(40), nullable=True)              # ФП

    receipt_at:   Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    raw_payload:  Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False, server_default="{}")
    ofd_provider: Mapped[str] = mapped_column(String(40), nullable=False)

    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


# ── Конфиг ОФД ───────────────────────────────────────────────────────────────

class OFDConfig(Base):
    """Настройки ОФД-провайдера для клиники (одна клиника = один ОФД)."""
    __tablename__ = "ofd_configs"
    __table_args__ = (
        UniqueConstraint("clinic_id", name="uq_ofd_config_clinic"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    inn: Mapped[str] = mapped_column(String(20), nullable=False)
    # Хранится зашифрованным (encryption_service: 'enc:'/'plain:'); запись шифрует
    # роутер, чтение — через property decrypted_api_key ниже.
    api_key: Mapped[str] = mapped_column(Text, nullable=False)

    is_active:      Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_pulled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    config: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False, server_default="{}")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    @property
    def decrypted_api_key(self) -> str | None:
        """Расшифрованный api_key ('login:password' и т.п.) для ОФД-адаптера.

        None при отсутствии/ошибке расшифровки. Совместимо со старыми записями
        без префикса (decrypt отдаёт их как есть).
        """
        raw = self.api_key
        if not raw:
            return None
        from app.services.encryption_service import decrypt  # lazy
        return decrypt(raw)
