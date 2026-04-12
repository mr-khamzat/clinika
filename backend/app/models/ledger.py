"""
Финансовый реестр (append-only).
ПРАВИЛО: записи НИКОГДА не изменяются и не удаляются.
Баланс = SUM(amount) по user_id. Положительный amount = кредит, отрицательный = дебет.

Этап 6 SaaS-трансформации.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, DateTime, ForeignKey, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Кому принадлежит запись
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Сумма: > 0 = зачисление, < 0 = списание
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Тип операции
    operation_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # Ссылка на источник (bonus.id, referral.id и т.д.)
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    reference_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Пояснение (денормализовано для истории)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Кто создал (NULL = система)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Время создания — иммутабельно
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
