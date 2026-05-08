# ===== БЛОК: Модель FranchiseIpAllowlist =====
# IP whitelist для франшизы — обходит проверку Region Lock.
# Если IP клиента попадает в один из cidr — нарушение НЕ фиксируется (нет записи
# region.violation, нет Telegram алерта). Также bypass'ит manual block по is_blocked,
# если запись помечена как `bypass_block=True` (для случаев временного доступа
# конкретному IP во время блокировки франшизы).
#
# Бизнес-кейс: в Чечне/Ингушетии массово используются VPN и спутниковые провайдеры,
# из-за чего GeoIP даёт левый регион. Владелец платформы уточняет реальный IP
# у клиента и добавляет его сюда — алерты по этому IP больше не приходят.

import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Text, Boolean, Index
from sqlalchemy.dialects.postgresql import UUID, INET
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class FranchiseIpAllowlist(Base):
    """IP whitelist франшизы — bypass для Region Lock."""

    __tablename__ = "franchise_ip_allowlist"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    franchise_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("franchises.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # INET — допускает и одиночный IP (1.2.3.4), и CIDR (1.2.0.0/16).
    # При проверке используем оператор `<<=`: `:ip::inet <<= ip_cidr`.
    ip_cidr: Mapped[str] = mapped_column(INET, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Если True — этот IP обходит и manual block (is_blocked=True). По умолчанию False:
    # whitelist обходит только region check, но не блокировку администратором.
    bypass_block: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_franchise_ip_allowlist_franchise", "franchise_id"),
    )
