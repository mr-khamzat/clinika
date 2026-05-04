"""
Журнал аудита — append-only.
Каждая значимая мутация данных порождает запись с состоянием до/после.
Этап 8 SaaS-трансформации.
"""
import uuid
from decimal import Decimal
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Text, Numeric
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base


class AuditEntry(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Кто совершил действие
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Что изменилось
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    # Состояние до и после (JSONB, null если не применимо)
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Контекст запроса
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Гео-IP (заполняется через geoip_service.lookup, может быть None)
    geo_country:      Mapped[str | None]     = mapped_column(String(2),     nullable=True, index=True)
    geo_country_name: Mapped[str | None]     = mapped_column(String(80),    nullable=True)
    geo_region:       Mapped[str | None]     = mapped_column(String(120),   nullable=True)
    geo_city:         Mapped[str | None]     = mapped_column(String(120),   nullable=True)
    geo_lat:          Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    geo_lon:          Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    # Метаданные
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
