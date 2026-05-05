"""module grace + call_rules

Revision ID: u7v8w9x0y1z2
Revises: s5t6u7v8w9x0
Create Date: 2026-05-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "u7v8w9x0y1z2"
down_revision = "s5t6u7v8w9x0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. grace_until для tenant_module_subscriptions
    op.add_column(
        "tenant_module_subscriptions",
        sa.Column("grace_until", sa.DateTime(), nullable=True),
    )

    # 2. call_rules — матрица правил звонков по ролям и scope (same/cross/any клиника)
    op.create_table(
        "call_rules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("from_role", sa.String(50), nullable=False),
        sa.Column("to_role", sa.String(50), nullable=False),
        sa.Column("scope", sa.String(20), nullable=False, server_default="any"),  # same_clinic | cross_clinic | any
        sa.Column("allow_audio", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("allow_video", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "from_role", "to_role", "scope", name="uq_call_rule"),
    )


def downgrade() -> None:
    op.drop_table("call_rules")
    op.drop_column("tenant_module_subscriptions", "grace_until")
