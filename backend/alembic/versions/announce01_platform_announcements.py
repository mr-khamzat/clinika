"""platform_announcements — super_admin рассылает уведомления всем тенантам

Revision ID: announce01
Revises: deputydir01
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "announce01"
down_revision = "deputydir01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_announcements",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False, server_default="info"),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_platform_announcements_created_at", "platform_announcements", ["created_at"])
    op.create_index("ix_platform_announcements_expires_at", "platform_announcements", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_platform_announcements_expires_at", table_name="platform_announcements")
    op.drop_index("ix_platform_announcements_created_at", table_name="platform_announcements")
    op.drop_table("platform_announcements")
