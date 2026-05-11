"""
Модели Главы 7 — «Регламент-конструктор» (SOP для франшиз).

Описание:
  • Regulation — карточка регламента (название, описание, категория, статус,
    назначенные роли, ссылка на текущую опубликованную версию).
  • RegulationVersion — снапшот содержимого регламента (массив шагов).
    Каждый publish создаёт новую версию с увеличенным version_number.
  • RegulationAssignment — точечное назначение регламента конкретному
    пользователю (user_id) или всей клинике (clinic_id). При user_id IS NULL
    и clinic_id IS NULL — назначение «по всем», в дополнение к assigned_roles.
  • RegulationCompletion — е-подпись (ФИО) пользователя под конкретной версией
    регламента. Уникальность: (regulation_id, version_id, user_id).

Все таблицы — tenant-aware: tenant_id хранится только в Regulation
(дочерние таблицы наследуют доступ через FK).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Integer, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


# ─────────────────────────────────────────────────────────────────────
# Константы
# ─────────────────────────────────────────────────────────────────────
class RegulationStatus:
    DRAFT     = "draft"
    PUBLISHED = "published"
    ARCHIVED  = "archived"


class RegulationStepType:
    TEXT     = "text"
    CHECKBOX = "checkbox"
    ACTION   = "action"
    FILE     = "file"


ALLOWED_STEP_TYPES = (
    RegulationStepType.TEXT,
    RegulationStepType.CHECKBOX,
    RegulationStepType.ACTION,
    RegulationStepType.FILE,
)

ALLOWED_STATUSES = (
    RegulationStatus.DRAFT,
    RegulationStatus.PUBLISHED,
    RegulationStatus.ARCHIVED,
)


# ─────────────────────────────────────────────────────────────────────
# Regulation — карточка регламента
# ─────────────────────────────────────────────────────────────────────
class Regulation(Base):
    """Карточка регламента (метаданные + ссылка на текущую опубликованную версию)."""
    __tablename__ = "regulations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)

    # FK на regulation_versions.id — присваивается после первого publish.
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

    # Массив строк ролей: ["manager","reg","doctor", ...]
    assigned_roles: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=RegulationStatus.DRAFT
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


# ─────────────────────────────────────────────────────────────────────
# RegulationVersion — снапшот содержимого
# ─────────────────────────────────────────────────────────────────────
class RegulationVersion(Base):
    """Снапшот регламента (содержимое + changelog). version_number растёт от 1."""
    __tablename__ = "regulation_versions"
    __table_args__ = (
        UniqueConstraint(
            "regulation_id", "version_number", name="uq_regulation_version_number"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    regulation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("regulations.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # content: массив шагов [{order,type,content,required}, ...]
    content: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    changelog: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    published_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )


# ─────────────────────────────────────────────────────────────────────
# RegulationAssignment — точечное назначение
# ─────────────────────────────────────────────────────────────────────
class RegulationAssignment(Base):
    """Точечное назначение регламента (в дополнение к assigned_roles).

    Семантика:
      user_id NOT NULL                — назначен лично юзеру.
      user_id NULL, clinic_id NOT NULL — назначен всем юзерам клиники.
      user_id NULL, clinic_id NULL    — назначен «на всех» tenant'а
                                        (в дополнение к assigned_roles).
    """
    __tablename__ = "regulation_assignments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    regulation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("regulations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    assigned_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


# ─────────────────────────────────────────────────────────────────────
# RegulationCompletion — е-подпись пользователя
# ─────────────────────────────────────────────────────────────────────
class RegulationCompletion(Base):
    """Е-подпись пользователя под конкретной версией регламента.

    Уникальность (regulation_id, version_id, user_id) — повторное чтение
    той же версии не дублирует запись. Перевыпуск регламента (publish v2)
    автоматически требует переподписания.
    """
    __tablename__ = "regulation_completions"
    __table_args__ = (
        UniqueConstraint(
            "regulation_id", "version_id", "user_id", name="uq_regulation_completion"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    regulation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("regulations.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("regulation_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    signature_text: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # {"step2": true, "step5": false, ...}
    checkboxes_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
