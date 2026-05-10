"""
TenantApiKey — внешний API-ключ для интеграций тенанта (CRM, BI, и пр.).

Сырое значение ключа хранится ТОЛЬКО в виде sha256-хэша. Префикс (первые 8 символов
после `clk_live_`) хранится в открытом виде для отображения в UI.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class TenantApiKey(Base):
    __tablename__ = "tenant_api_keys"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    # sha256-хэш сырого ключа (hex, 64 символа). Уникален.
    key_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    # Префикс «clk_live_<8 chars>» для опознавания ключа в UI.
    key_prefix: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Список разрешённых скоупов: ["read:referrals", "write:patients", ...]
    scopes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_used_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # IP allowlist (опционально): ["1.2.3.4", "10.0.0.0/24"]. None/пусто = любой IP.
    allowed_ips: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Счётчик запросов (для UI / rate-limit подсчётов)
    request_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
