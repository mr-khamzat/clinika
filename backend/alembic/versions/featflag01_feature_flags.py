"""featflag01 — feature flags + tenant overrides

Revision ID: featflag01
Revises: quota01
Create Date: 2026-05-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "featflag01"
down_revision = "quota01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enum создаём явно с IF NOT EXISTS, чтобы повторный запуск не падал.
    op.execute(
        "DO $$ BEGIN "
        "  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feature_flag_rollout_strategy') THEN "
        "    CREATE TYPE feature_flag_rollout_strategy AS ENUM ('all','tenants','percentage','ab_test'); "
        "  END IF; "
        "END $$;"
    )

    op.create_table(
        "feature_flags",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("default_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "rollout_strategy",
            postgresql.ENUM(
                "all", "tenants", "percentage", "ab_test",
                name="feature_flag_rollout_strategy",
                create_type=False,
            ),
            nullable=False,
            server_default="all",
        ),
        sa.Column("rollout_value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_feature_flags_key"),
    )
    op.create_index("ix_feature_flags_key", "feature_flags", ["key"], unique=False)

    op.create_table(
        "tenant_feature_flags",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("feature_flag_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("variant", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["feature_flag_id"], ["feature_flags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tenant_feature_flags_tenant_id", "tenant_feature_flags", ["tenant_id"])
    op.create_index("ix_tenant_feature_flags_feature_flag_id", "tenant_feature_flags", ["feature_flag_id"])
    op.create_index(
        "uq_tenant_feature_flag_tenant_flag",
        "tenant_feature_flags",
        ["tenant_id", "feature_flag_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_tenant_feature_flag_tenant_flag", table_name="tenant_feature_flags")
    op.drop_index("ix_tenant_feature_flags_feature_flag_id", table_name="tenant_feature_flags")
    op.drop_index("ix_tenant_feature_flags_tenant_id", table_name="tenant_feature_flags")
    op.drop_table("tenant_feature_flags")
    op.drop_index("ix_feature_flags_key", table_name="feature_flags")
    op.drop_table("feature_flags")
    op.execute("DROP TYPE IF EXISTS feature_flag_rollout_strategy")
