"""chat_message_templates — отдельная таблица для шаблонов быстрых ответов.

Revision ID: chatmsgtpl01
Revises: arrltv01
Create Date: 2026-05-24

Изолирована от существующей `message_templates`.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "chatmsgtpl01"
down_revision = "arrltv01"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "chat_message_templates",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "clinic_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("clinics.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("category", sa.String(40), nullable=False, server_default="other"),
        sa.Column("shortcut", sa.String(40), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column(
            "created_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "is_default",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("usage_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_chat_message_templates_tenant",
        "chat_message_templates",
        ["tenant_id"],
    )
    op.create_index(
        "ix_chat_message_templates_shortcut",
        "chat_message_templates",
        ["shortcut"],
    )
    op.create_index(
        "ix_chat_message_templates_is_default",
        "chat_message_templates",
        ["is_default"],
    )


def downgrade():
    op.drop_index("ix_chat_message_templates_is_default", "chat_message_templates")
    op.drop_index("ix_chat_message_templates_shortcut", "chat_message_templates")
    op.drop_index("ix_chat_message_templates_tenant", "chat_message_templates")
    op.drop_table("chat_message_templates")
