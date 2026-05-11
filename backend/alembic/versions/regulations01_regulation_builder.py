"""regulations01 — Глава 7: Регламент-конструктор (SOP для франшиз).

Revises: doctor_ai01
Create Date: 2026-05-11

Добавляет инфраструктуру для:
  • Создания регламентов (SOP) владельцем франшизы — с шагами разных
    типов (text/checkbox/action/file).
  • Версионирования регламентов (каждый publish — новая версия).
  • Назначения регламентов как по ролям (assigned_roles JSONB),
    так и точечно — на конкретного пользователя или всю клинику.
  • Учёта прочтения / е-подписи: regulation_completions содержит подписи
    пользователей под конкретной версией.

Структура таблиц:
  regulations            — карточка регламента (метаданные)
  regulation_versions    — снапшоты содержимого (шаги) с changelog
  regulation_assignments — точечные назначения (user_id / clinic_id)
  regulation_completions — е-подписи пользователей под версией

Индексы оптимизированы под типичные выборки:
  • my-assigned (по tenant_id + assigned_roles)
  • detail + история версий (regulation_id + version_number DESC)
  • статистика чтений (regulation_id, version_id, user_id)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "regulations01"
down_revision = "doctor_ai01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─── regulations ──────────────────────────────────────────────────
    op.create_table(
        "regulations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("category", sa.String(80), nullable=True),
        sa.Column("current_version_id", UUID(as_uuid=True), nullable=True),
        sa.Column("assigned_roles", JSONB, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("created_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_regulations_tenant_status", "regulations", ["tenant_id", "status"])
    op.create_index("ix_regulations_category", "regulations", ["category"])
    op.create_index("ix_regulations_tenant", "regulations", ["tenant_id"])

    # ─── regulation_versions ──────────────────────────────────────────
    op.create_table(
        "regulation_versions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "regulation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("regulations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer, nullable=False),
        sa.Column("content", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("changelog", sa.Text, nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "published_by_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("regulation_id", "version_number", name="uq_regulation_version_number"),
    )
    op.create_index(
        "ix_regulation_versions_reg_ver",
        "regulation_versions",
        ["regulation_id", sa.text("version_number DESC")],
    )

    # FK current_version_id -> regulation_versions добавляем после создания
    op.create_foreign_key(
        "fk_regulations_current_version",
        "regulations",
        "regulation_versions",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ─── regulation_assignments ───────────────────────────────────────
    op.create_table(
        "regulation_assignments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "regulation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("regulations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "clinic_id",
            UUID(as_uuid=True),
            sa.ForeignKey("clinics.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "assigned_by_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_regulation_assignments_reg", "regulation_assignments", ["regulation_id"])
    op.create_index("ix_regulation_assignments_user", "regulation_assignments", ["user_id"])
    op.create_index("ix_regulation_assignments_clinic", "regulation_assignments", ["clinic_id"])

    # ─── regulation_completions ───────────────────────────────────────
    op.create_table(
        "regulation_completions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "regulation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("regulations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "version_id",
            UUID(as_uuid=True),
            sa.ForeignKey("regulation_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("signature_text", sa.String(200), nullable=True),
        sa.Column("checkboxes_state", JSONB, nullable=True),
        sa.UniqueConstraint(
            "regulation_id", "version_id", "user_id", name="uq_regulation_completion"
        ),
    )
    op.create_index(
        "ix_regulation_completions_user_date",
        "regulation_completions",
        ["user_id", sa.text("completed_at DESC")],
    )
    op.create_index(
        "ix_regulation_completions_reg_ver",
        "regulation_completions",
        ["regulation_id", "version_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_regulation_completions_reg_ver", table_name="regulation_completions")
    op.drop_index("ix_regulation_completions_user_date", table_name="regulation_completions")
    op.drop_table("regulation_completions")

    op.drop_index("ix_regulation_assignments_clinic", table_name="regulation_assignments")
    op.drop_index("ix_regulation_assignments_user", table_name="regulation_assignments")
    op.drop_index("ix_regulation_assignments_reg", table_name="regulation_assignments")
    op.drop_table("regulation_assignments")

    op.drop_constraint("fk_regulations_current_version", "regulations", type_="foreignkey")
    op.drop_index("ix_regulation_versions_reg_ver", table_name="regulation_versions")
    op.drop_table("regulation_versions")

    op.drop_index("ix_regulations_tenant", table_name="regulations")
    op.drop_index("ix_regulations_category", table_name="regulations")
    op.drop_index("ix_regulations_tenant_status", table_name="regulations")
    op.drop_table("regulations")
