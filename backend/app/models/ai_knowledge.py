"""
База знаний AI (FAQ) — экономия токенов LLM.

Перед обращением к LLM patient_chat_ai пробует найти подходящий ответ
в локальной таблице AIKnowledgeEntry. Если совпадение по ключевым словам
выше threshold — отдаём заранее заготовленный ответ.

Записи бывают двух уровней:
* tenant_id is NULL — общие для всей платформы (создаёт super_admin).
* tenant_id != NULL — собственные записи тенанта (создаёт franchise_owner / manager).

franchise_owner_id хранится для удобной фильтрации по франшизе
(в случаях, когда у владельца несколько тенантов).
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    String, Integer, Boolean, DateTime, ForeignKey, Text, Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AIKnowledgeEntry(Base):
    """Запись FAQ для AI-чата пациента."""

    __tablename__ = "ai_knowledge_entries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # NULL = платформенная запись (общая для всех тенантов)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )
    # Для удобной выборки по франшизе (если у владельца несколько тенантов).
    franchise_owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    question: Mapped[str] = mapped_column(String(500), nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    # Ключевые слова через запятую — упрощённый поиск (ILIKE / token-overlap).
    keywords: Mapped[str | None] = mapped_column(Text, nullable=True)

    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    hits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


# Дополнительный индекс: активные записи по тенанту, отсортированные по приоритету.
Index(
    "ix_ai_knowledge_active_priority",
    AIKnowledgeEntry.tenant_id,
    AIKnowledgeEntry.is_active,
    AIKnowledgeEntry.priority,
)
