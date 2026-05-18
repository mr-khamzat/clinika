"""Patient Engagement Hub — ORM-модели (миграция ce01_patient_engagement).

Сводит в один файл:
- PatientTag, PatientNote, PatientCommPrefs
- PatientSegment
- PushTemplate, PushCampaign
- EngagementSuggestion
- NpsResponse
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, Integer, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


# ============================================================
# Профиль пациента в CRM (теги/заметки/преференсы)
# ============================================================

class PatientTag(Base):
    __tablename__ = "patient_tags"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patient_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    tag: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("patient_id", "tag", name="uq_patient_tag"),)


class PatientNote(Base):
    __tablename__ = "patient_notes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patient_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class PatientCommPrefs(Base):
    __tablename__ = "patient_comm_prefs"

    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patient_accounts.id", ondelete="CASCADE"), primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    promo: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    reminders: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    loyalty: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    news: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    quiet_hours_from: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quiet_hours_to: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


# ============================================================
# Сегменты + шаблоны + кампании
# ============================================================

class PatientSegment(Base):
    __tablename__ = "patient_segments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    filter_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_dynamic: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    snapshot_patient_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    last_resolved_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class PushTemplate(Base):
    __tablename__ = "push_templates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    variables_used: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class PushCampaign(Base):
    __tablename__ = "push_campaigns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("push_templates.id", ondelete="SET NULL"), nullable=True)
    template_b_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("push_templates.id", ondelete="SET NULL"), nullable=True)
    segment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("patient_segments.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    ab_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft", nullable=False, index=True)
    sent_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    delivered_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    click_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    conversion_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    a_sent: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    b_sent: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    a_click: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    b_click: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


# ============================================================
# Подсказки и NPS
# ============================================================

class EngagementSuggestion(Base):
    __tablename__ = "engagement_suggestions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patient_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("push_templates.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending", nullable=False, index=True)
    postponed_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sent_campaign_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("push_campaigns.id", ondelete="SET NULL"), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class NpsResponse(Base):
    __tablename__ = "nps_responses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patient_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


# Триггер-типы (хардкод-константы; используются suggestion_engine.py и UI)
class SuggestionKind:
    WELCOME      = "welcome"
    BIRTHDAY     = "birthday"
    ABANDONMENT  = "abandonment"
    NPS          = "nps"
    ANNIVERSARY  = "anniversary"
    CHURN_30D    = "churn_30d"
    CHURN_60D    = "churn_60d"
    CHURN_90D    = "churn_90d"
    CUSTOM       = "custom"


class TemplateCategory:
    WELCOME      = "welcome"
    BIRTHDAY     = "birthday"
    ABANDONMENT  = "abandonment"
    NPS          = "nps"
    ANNIVERSARY  = "anniversary"
    CHURN        = "churn"
    PROMO        = "promo"
    REMINDER     = "reminder"
    CUSTOM       = "custom"
