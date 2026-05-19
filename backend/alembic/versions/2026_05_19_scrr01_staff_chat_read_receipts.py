"""staff_chat_message_reads — read receipts (галочки ✓/✓✓) для StaffChat

Revision ID: scrr01_staff_chat_read_receipts
Revises: tvis01_tenant_visibility
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa


revision = "scrr01_staff_chat_read_receipts"
down_revision = "tvis01_tenant_visibility"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "staff_chat_message_reads",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "message_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("staff_chat_messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "read_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "message_id", "user_id", name="uq_staff_chat_message_reads_pair",
        ),
    )
    op.create_index(
        "ix_staff_chat_message_reads_message_id",
        "staff_chat_message_reads",
        ["message_id"],
    )
    op.create_index(
        "ix_staff_chat_message_reads_user_id",
        "staff_chat_message_reads",
        ["user_id"],
    )


def downgrade():
    op.drop_index(
        "ix_staff_chat_message_reads_user_id",
        table_name="staff_chat_message_reads",
    )
    op.drop_index(
        "ix_staff_chat_message_reads_message_id",
        table_name="staff_chat_message_reads",
    )
    op.drop_table("staff_chat_message_reads")
