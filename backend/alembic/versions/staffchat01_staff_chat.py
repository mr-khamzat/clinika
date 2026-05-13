"""staffchat01 — Чат сотрудник↔сотрудник (StaffChat).

Добавляет три таблицы:
  staff_chat_rooms     — комнаты (direct/clinic/group/broadcast) с привязкой к tenant
  staff_chat_members   — участники + read-state + mute
  staff_chat_messages  — сообщения с attachments/reply_to/soft-delete

Inter-clinic чат разрешён только внутри одной франшизы (tenant_id).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "staffchat01"
down_revision = "health_module01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── staff_chat_rooms ─────────────────────────────────────────────────────
    op.create_table(
        "staff_chat_rooms",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_staff_chat_rooms_tenant_id", "staff_chat_rooms", ["tenant_id"])
    op.create_index("ix_staff_chat_rooms_type", "staff_chat_rooms", ["type"])
    op.create_index("ix_staff_chat_rooms_clinic_id", "staff_chat_rooms", ["clinic_id"])
    op.create_index("ix_staff_chat_rooms_last_message_at", "staff_chat_rooms", ["last_message_at"])

    # ── staff_chat_members ───────────────────────────────────────────────────
    op.create_table(
        "staff_chat_members",
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("member_role", sa.String(length=10), nullable=False, server_default="member"),
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("muted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["staff_chat_rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("room_id", "user_id"),
    )
    op.create_index("ix_staff_chat_members_user_id", "staff_chat_members", ["user_id"])

    # ── staff_chat_messages ──────────────────────────────────────────────────
    op.create_table(
        "staff_chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sender_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("attachments", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("reply_to_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["staff_chat_rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reply_to_id"], ["staff_chat_messages.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_staff_chat_messages_room_id", "staff_chat_messages", ["room_id"])
    op.create_index("ix_staff_chat_messages_sender_id", "staff_chat_messages", ["sender_id"])
    op.create_index("ix_staff_chat_messages_created_at", "staff_chat_messages", ["created_at"])
    op.create_index("ix_staff_chat_messages_room_created", "staff_chat_messages", ["room_id", "created_at"])

    # ── staff_chat_files (файлы-вложения, TTL 48 часов) ──────────────────────
    op.create_table(
        "staff_chat_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("uploaded_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("filename", sa.String(length=300), nullable=False),
        sa.Column("mime", sa.String(length=120), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["staff_chat_rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_staff_chat_files_room_id", "staff_chat_files", ["room_id"])
    op.create_index("ix_staff_chat_files_expires_at", "staff_chat_files", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_staff_chat_files_expires_at", table_name="staff_chat_files")
    op.drop_index("ix_staff_chat_files_room_id", table_name="staff_chat_files")
    op.drop_table("staff_chat_files")

    op.drop_index("ix_staff_chat_messages_room_created", table_name="staff_chat_messages")
    op.drop_index("ix_staff_chat_messages_created_at", table_name="staff_chat_messages")
    op.drop_index("ix_staff_chat_messages_sender_id", table_name="staff_chat_messages")
    op.drop_index("ix_staff_chat_messages_room_id", table_name="staff_chat_messages")
    op.drop_table("staff_chat_messages")

    op.drop_index("ix_staff_chat_members_user_id", table_name="staff_chat_members")
    op.drop_table("staff_chat_members")

    op.drop_index("ix_staff_chat_rooms_last_message_at", table_name="staff_chat_rooms")
    op.drop_index("ix_staff_chat_rooms_clinic_id", table_name="staff_chat_rooms")
    op.drop_index("ix_staff_chat_rooms_type", table_name="staff_chat_rooms")
    op.drop_index("ix_staff_chat_rooms_tenant_id", table_name="staff_chat_rooms")
    op.drop_table("staff_chat_rooms")
