"""chatsettings01 — Глобальные настройки чата (per-tenant)."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "chatsettings01"
down_revision = "staffchat01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_global_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("file_ttl_hours", sa.Integer(), nullable=False, server_default="48"),
        sa.Column("max_file_mb", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("inter_clinic_allowed", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("tg_notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("tg_notify_super_admin", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("tg_notify_franchise_owner", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("patient_chat_tg_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id"),
    )
    op.create_index("ix_chat_global_settings_tenant_id", "chat_global_settings", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_global_settings_tenant_id", table_name="chat_global_settings")
    op.drop_table("chat_global_settings")
