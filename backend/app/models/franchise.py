# ===== БЛОК: Модель Franchise =====
# Франшиза — промежуточный уровень между Платформой и Тенантами.
# Один владелец (User с role=franchise_owner) может управлять несколькими тенантами,
# объединёнными в одну франшизу (общий бренд, цвет, контакты).
#
# Иерархия:
#   Платформа (super_admin)
#     └─ Franchise (создаёт super_admin)
#          └─ Tenant.franchise_id (создаёт franchise_owner внутри своей франшизы)
#               └─ Clinic
#
# Пример: «Клиника Сеть Юг» (Franchise) → 3 тенанта (Краснодар, Сочи, Ростов).

import uuid
from decimal import Decimal
from datetime import datetime
from sqlalchemy import Numeric, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Franchise(Base):
    """Сущность «Франшиза» — группа тенантов под управлением одного franchise_owner."""

    __tablename__ = "franchises"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # slug — короткий идентификатор для URL/админки
    slug: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    # Владелец франшизы — User с role=franchise_owner
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Контактные данные франшизы
    contact_email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Брендирование на уровне франшизы
    brand_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Биллинг платформы: % с бонусов франшизы
    fee_per_bonus_from_clinic: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal('100'), server_default='100')
    platform_fee_per_bonus: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("100"))
    min_bonus_amount:       Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("300"))
    refund_fee_on_cancel:   Mapped[bool]    = mapped_column(Boolean, nullable=False, default=False)
    billing_period_days:    Mapped[int]     = mapped_column(Integer, nullable=False, default=30)
    last_invoice_at:        Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # ── Region Lock (географический контроль франшизы) ─────────────────────────
    # Регион, в котором франшиза имеет право работать (например "Ingushetia",
    # "Чеченская Республика", "RU-IN"). NULL — проверки выключены.
    # Сравнение делается с geo_region из GeoLite2-City по IP пользователя.
    allowed_region: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    # False — только алерт владельцу платформы (Phase 1, по умолчанию).
    # True — нарушение блокирует действие (Phase 2, пока не задействовано).
    region_strict: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    # ── Manual Block (Phase 2 v2) ──────────────────────────────────────────────
    # Ручная блокировка франшизы владельцем платформы. Никогда не выставляется
    # автоматически — только из UI «Нарушения регионов» / форма редактирования.
    # При is_blocked=True (или blocked_until > NOW()) защищённые endpoints возвращают
    # 403 «Доступ заблокирован администратором платформы».
    # Реализовано в core.region_lock.enforce_region_lock — bypass'ится IP allowlist'ом.
    is_blocked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    blocked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    block_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    blocked_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    blocked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # ── Onboarding wizard (W4) ─────────────────────────────────────────────────
    # Состояние пошагового мастера для нового franchise_owner. После завершения
    # `onboarding_done=True` — кабинет открывается в обычном режиме.
    onboarding_done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    onboarding_step: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    onboarding_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Связь: одна франшиза может содержать множество тенантов
    tenants: Mapped[list["Tenant"]] = relationship(
        "Tenant", back_populates="franchise", foreign_keys="Tenant.franchise_id"
    )
