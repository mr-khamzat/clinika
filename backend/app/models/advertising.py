"""
Рекламная система.

Ad       — объявление тенанта (баннер / push / interstitial).
AdEvent  — событие взаимодействия (показ, клик, конверсия).

Улучшения vs минимального плана:
  - pricing_model (flat/cpc/cpm) — разные модели оплаты без миграций
  - ip_hash вместо raw IP — соответствие 152-ФЗ
  - impressions_count/clicks_count денормализованы для быстрой агрегации
  - Индексы на (tenant_id, status) и (start_date, end_date) для планировщика
"""
import uuid
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import String, Boolean, DateTime, Date, Numeric, Integer, Text, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class AdStatus:
    DRAFT     = "draft"       # черновик, не активен
    ACTIVE    = "active"      # идут показы
    PAUSED    = "paused"      # приостановлен тенантом
    COMPLETED = "completed"   # закончился по датам или лимитам
    CANCELLED = "cancelled"   # отменён (возврат)


class AdType:
    BANNER       = "banner"        # баннер внутри mini-app
    PUSH         = "push"          # push-уведомление
    INTERSTITIAL = "interstitial"  # полноэкранный при входе


class PricingModel:
    FLAT = "flat"   # фиксированная цена за период размещения
    CPC  = "cpc"    # cost per click
    CPM  = "cpm"    # cost per 1000 impressions


class AdEventType:
    IMPRESSION = "impression"  # показ (уникальный per ip_hash per day)
    CLICK      = "click"       # клик по объявлению
    CONVERSION = "conversion"  # целевое действие (регистрация, запись)
    SCHEDULE_BOOK = "schedule_book"  # явная запись на приём (для отдельной атрибуции)


class Ad(Base):
    """Рекламное объявление тенанта."""
    __tablename__ = "ads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    link: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    ad_type: Mapped[str] = mapped_column(String(30), default=AdType.BANNER, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=AdStatus.DRAFT, nullable=False, index=True)

    # Период показа
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Ценообразование
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    # flat = фиксированная за период, cpc = за клик, cpm = за 1000 показов
    pricing_model: Mapped[str] = mapped_column(String(20), default=PricingModel.FLAT, nullable=False)

    # Лимиты (None = без ограничений)
    impressions_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    clicks_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Счётчики (денормализованы для быстрой агрегации без JOIN к ad_events)
    impressions_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    clicks_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    conversions_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Бюджет (в рублях). Авто-пауза при достижении spent_total >= budget_total.
    budget_total: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    spent_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0")

    # Frequency capping: max показов одному ip_hash в день/час
    freq_per_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    freq_per_hour: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Health-checker: автопауза если N дней без показов
    last_impression_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    auto_pause_idle_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7, server_default="7")

    # A/B-тесты: variant связан с parent_ad_id
    parent_ad_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ads.id", ondelete="SET NULL"), nullable=True, index=True
    )
    ab_variant: Mapped[str | None] = mapped_column(String(8), nullable=True)
    ab_winner: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    # Targeting: фильтры аудитории (gender, age_min, age_max, city, ltv_min, ltv_max, has_appointments)
    audience: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Conversion attribution
    revenue_attributed: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0")
    attribution_window_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7, server_default="7")

    # === ads02_improvements (2026-05-18) ===
    # Approval workflow: approved (default, обратная совместимость) / pending / rejected
    approval_status: Mapped[str] = mapped_column(String(20), default="approved", server_default="approved", nullable=False)
    approval_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Категория: promo / doctor / reminder / review / other
    category: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    tags: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)

    # Sharing между филиалами франшизы — id исходного баннера
    share_origin_ad_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ads.id", ondelete="SET NULL"), nullable=True, index=True
    )


    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        # Быстрая выборка активных объявлений тенанта
        Index("ix_ads_tenant_status", "tenant_id", "status"),
        # Планировщик: найти объявления у которых начался/закончился период
        Index("ix_ads_dates", "start_date", "end_date"),
    )


class AdEvent(Base):
    """
    Событие взаимодействия с рекламой.

    ip_hash — SHA-256 от IP клиента (не хранить raw IP — 152-ФЗ).
    Используется для дедупликации показов (1 показ per ip_hash per day).
    """
    __tablename__ = "ad_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ad_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ads.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    # None если анонимный пользователь
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )

    event_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)

    # SHA-256(ip + date) — для дедупликации без хранения PII
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Для conversion: связанный referral и его выручка (из service.price)
    referral_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("referrals.id", ondelete="SET NULL"), nullable=True, index=True
    )
    revenue: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
