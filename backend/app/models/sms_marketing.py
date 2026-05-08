"""
SMS-маркетинг — модуль W5 master plan.

3 таблицы:
- SmsTemplate: шаблон сообщения с плейсхолдерами {{patient_name}}, {{date}} и т.д.
- SmsCampaign: рассылка по сегменту (sleeping_30d, ltv_segment, custom_phones и т.д.)
- SmsMessageLog: лог отправки каждого сообщения (статус, провайдер, ошибки)
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ─────────────────────────── ENUM-типы ────────────────────────────────────


class SmsCampaignStatus(str, enum.Enum):
    """Статус кампании в её жизненном цикле."""
    DRAFT     = "draft"
    SCHEDULED = "scheduled"
    SENDING   = "sending"
    SENT      = "sent"
    FAILED    = "failed"
    CANCELLED = "cancelled"


class SmsAudienceType(str, enum.Enum):
    """Тип аудитории кампании — определяет логику фильтрации получателей."""
    SLEEPING_30D      = "sleeping_30d"      # пациенты без визита 30+ дней
    SLEEPING_90D      = "sleeping_90d"      # пациенты без визита 90+ дней
    SPECIFIC_SEGMENT  = "specific_segment"  # сегмент по LTV / типу услуг (см. audience_filter)
    CUSTOM_PHONES     = "custom_phones"     # точечный список телефонов из audience_filter
    ALL_PATIENTS      = "all_patients"      # вся база тенанта


class SmsMessageStatus(str, enum.Enum):
    """Статус доставки одного SMS-сообщения."""
    QUEUED    = "queued"     # ожидает отправки воркером
    SENT      = "sent"       # передано провайдеру
    DELIVERED = "delivered"  # доставлено абоненту (по callback'у провайдера)
    FAILED    = "failed"     # ошибка отправки
    OPTED_OUT = "opted_out"  # пациент отписался от рассылки


class SmsProvider(str, enum.Enum):
    """SMS-провайдер. 'internal' — заглушка/тест, остальные — реальные."""
    SMSC      = "smsc"
    SMS_AERO  = "sms_aero"
    PLIVO     = "plivo"
    INTERNAL  = "internal"


# ─────────────────────────── Модели ───────────────────────────────────────


class SmsTemplate(Base):
    """Шаблон SMS — переиспользуемое тело сообщения с плейсхолдерами."""
    __tablename__ = "sms_templates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Список ожидаемых плейсхолдеров: ["patient_name","date","clinic_name"]
    variables: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    tenant = relationship("Tenant")
    campaigns: Mapped[list["SmsCampaign"]] = relationship(
        "SmsCampaign", back_populates="template"
    )


class SmsCampaign(Base):
    """Кампания — конкретная рассылка по выбранной аудитории."""
    __tablename__ = "sms_campaigns"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sms_templates.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[SmsCampaignStatus] = mapped_column(
        SAEnum(
            SmsCampaignStatus,
            name="sms_campaign_status",
            values_callable=lambda x: [e.value for e in x],
            native_enum=True,
        ),
        default=SmsCampaignStatus.DRAFT,
        nullable=False,
        index=True,
    )
    scheduled_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, index=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    audience_type: Mapped[SmsAudienceType] = mapped_column(
        SAEnum(
            SmsAudienceType,
            name="sms_audience_type",
            values_callable=lambda x: [e.value for e in x],
            native_enum=True,
        ),
        nullable=False,
    )
    # Доп. фильтры аудитории: LTV-сегмент, типы услуг, диапазон дат, список телефонов и т.д.
    audience_filter: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    total_recipients: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sent_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    tenant = relationship("Tenant")
    template: Mapped["SmsTemplate"] = relationship(
        "SmsTemplate", back_populates="campaigns"
    )
    creator = relationship("User")
    messages: Mapped[list["SmsMessageLog"]] = relationship(
        "SmsMessageLog", back_populates="campaign", cascade="all, delete-orphan"
    )


class SmsMessageLog(Base):
    """Лог отправки одного SMS — append-only, нужен для аудита и ретраев."""
    __tablename__ = "sms_messages_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sms_campaigns.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    patient_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # Финальный текст после подстановки плейсхолдеров
    message_text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[SmsMessageStatus] = mapped_column(
        SAEnum(
            SmsMessageStatus,
            name="sms_message_status",
            values_callable=lambda x: [e.value for e in x],
            native_enum=True,
        ),
        default=SmsMessageStatus.QUEUED,
        nullable=False,
        index=True,
    )
    provider: Mapped[SmsProvider | None] = mapped_column(
        SAEnum(
            SmsProvider,
            name="sms_provider",
            values_callable=lambda x: [e.value for e in x],
            native_enum=True,
        ),
        nullable=True,
    )
    provider_message_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, index=True
    )
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    campaign: Mapped["SmsCampaign"] = relationship(
        "SmsCampaign", back_populates="messages"
    )
