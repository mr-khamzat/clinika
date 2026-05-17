"""inventory import logs (1C Excel/CSV import).

Revision ID: onec01
Revises: franchisebonusfee01
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "onec01"
down_revision = "franchisebonusfee01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_import_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "clinic_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("clinics.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("file_hash", sa.String(64), nullable=False),
        sa.Column("rows_total", sa.Integer, nullable=False, server_default="0"),
        sa.Column("rows_created", sa.Integer, nullable=False, server_default="0"),
        sa.Column("rows_updated", sa.Integer, nullable=False, server_default="0"),
        sa.Column("rows_skipped", sa.Integer, nullable=False, server_default="0"),
        sa.Column("rows_failed", sa.Integer, nullable=False, server_default="0"),
        sa.Column("mapping_used", postgresql.JSONB, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("result_summary", postgresql.JSONB, nullable=True),
        sa.Column("errors", postgresql.JSONB, nullable=True),
        sa.Column(
            "created_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_inventory_import_logs_tenant_id",
        "inventory_import_logs",
        ["tenant_id"],
    )
    op.create_index(
        "ix_inventory_import_logs_file_hash",
        "inventory_import_logs",
        ["file_hash"],
    )
    op.create_index(
        "ix_inventory_import_logs_tenant_created",
        "inventory_import_logs",
        ["tenant_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_inventory_import_logs_tenant_created", table_name="inventory_import_logs")
    op.drop_index("ix_inventory_import_logs_file_hash", table_name="inventory_import_logs")
    op.drop_index("ix_inventory_import_logs_tenant_id", table_name="inventory_import_logs")
    op.drop_table("inventory_import_logs")
