"""tenanthealth01 — tenant_health_snapshots + tenant_cost_snapshots

Revision ID: tenanthealth01
Revises: featflag01
Create Date: 2026-05-23

Создаём ОБЕ таблицы за одну миграцию (логически связаны — обе про мониторинг
тенантов для super_admin). Enum tenant_health_alert_level — через IF NOT EXISTS
чтобы повторный запуск не падал.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "tenanthealth01"
down_revision = "featflag01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── enum: tenant_health_alert_level ──
    op.execute(
        "DO $$ BEGIN "
        "  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_health_alert_level') THEN "
        "    CREATE TYPE tenant_health_alert_level AS ENUM ('green','yellow','red'); "
        "  END IF; "
        "END $$;"
    )

    # ── tenant_health_snapshots ──
    op.create_table(
        "tenant_health_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "captured_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column(
            "factors",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "alert_level",
            postgresql.ENUM(
                "green",
                "yellow",
                "red",
                name="tenant_health_alert_level",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_tenant_health_snapshots_tenant_id",
        "tenant_health_snapshots",
        ["tenant_id"],
    )
    op.create_index(
        "ix_tenant_health_snapshots_captured_at",
        "tenant_health_snapshots",
        [sa.text("captured_at DESC")],
    )
    op.create_index(
        "ix_tenant_health_snapshots_alert_level",
        "tenant_health_snapshots",
        ["alert_level"],
    )
    op.create_index(
        "ix_tenant_health_snap_tenant_captured",
        "tenant_health_snapshots",
        ["tenant_id", sa.text("captured_at DESC")],
    )

    # ── tenant_cost_snapshots ──
    op.create_table(
        "tenant_cost_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column(
            "storage_mb", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "api_requests",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "db_rows_estimate",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "calls_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "est_cost_rub",
            sa.Numeric(12, 2),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "captured_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "period", name="uq_tenant_cost_snapshots_tenant_period"
        ),
    )
    op.create_index(
        "ix_tenant_cost_snapshots_tenant_id",
        "tenant_cost_snapshots",
        ["tenant_id"],
    )
    op.create_index(
        "ix_tenant_cost_snapshots_period",
        "tenant_cost_snapshots",
        ["period"],
    )
    op.create_index(
        "ix_tenant_cost_snap_period_cost",
        "tenant_cost_snapshots",
        ["period", sa.text("est_cost_rub DESC")],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_tenant_cost_snap_period_cost", table_name="tenant_cost_snapshots"
    )
    op.drop_index(
        "ix_tenant_cost_snapshots_period", table_name="tenant_cost_snapshots"
    )
    op.drop_index(
        "ix_tenant_cost_snapshots_tenant_id", table_name="tenant_cost_snapshots"
    )
    op.drop_table("tenant_cost_snapshots")

    op.drop_index(
        "ix_tenant_health_snap_tenant_captured",
        table_name="tenant_health_snapshots",
    )
    op.drop_index(
        "ix_tenant_health_snapshots_alert_level",
        table_name="tenant_health_snapshots",
    )
    op.drop_index(
        "ix_tenant_health_snapshots_captured_at",
        table_name="tenant_health_snapshots",
    )
    op.drop_index(
        "ix_tenant_health_snapshots_tenant_id",
        table_name="tenant_health_snapshots",
    )
    op.drop_table("tenant_health_snapshots")
    op.execute("DROP TYPE IF EXISTS tenant_health_alert_level")
