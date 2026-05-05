"""franchise platform fee + invoices

Revision ID: v8w9x0y1z2a3
Revises: u7v8w9x0y1z2
Create Date: 2026-05-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "v8w9x0y1z2a3"
down_revision = "u7v8w9x0y1z2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Поля биллинга в franchises
    op.add_column("franchises", sa.Column("platform_fee_per_bonus", sa.Numeric(12, 2), nullable=False, server_default="100"))
    op.add_column("franchises", sa.Column("min_bonus_amount", sa.Numeric(12, 2), nullable=False, server_default="300"))
    op.add_column("franchises", sa.Column("refund_fee_on_cancel", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("franchises", sa.Column("billing_period_days", sa.Integer(), nullable=False, server_default="30"))
    op.add_column("franchises", sa.Column("last_invoice_at", sa.DateTime(), nullable=True))

    # 2. Счета от платформы франшизе
    op.create_table(
        "franchise_invoices",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("franchise_id", UUID(as_uuid=True), sa.ForeignKey("franchises.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("number", sa.String(50), nullable=True),  # FR-2026-0001
        sa.Column("period_start", sa.DateTime(), nullable=False),
        sa.Column("period_end", sa.DateTime(), nullable=False),
        sa.Column("bonuses_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),  # pending|paid|cancelled
        sa.Column("due_date", sa.DateTime(), nullable=True),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("franchise_invoices")
    op.drop_column("franchises", "last_invoice_at")
    op.drop_column("franchises", "billing_period_days")
    op.drop_column("franchises", "refund_fee_on_cancel")
    op.drop_column("franchises", "min_bonus_amount")
    op.drop_column("franchises", "platform_fee_per_bonus")
