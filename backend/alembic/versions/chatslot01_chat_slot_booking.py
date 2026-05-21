"""chatslot01 — chat slot booking + patient MIS auto-link

Revision ID: chatslot01
Revises: partneroffers01
Create Date: 2026-05-21

Изменения:
1. patient_chat_messages: + message_type enum (default 'text'), + payload JSONB nullable.
   text: становится nullable (для slot_booked/slot_expired без текста).
2. appointments: + chat_thread_id UUID nullable FK -> patient_chats.id,
   + source enum (default 'direct'). Backfill: source='direct' для всех existing.
3. patient_accounts: + mis_patient_id, mis_synced_at, mis_sync_state.
4. mis_outbox: новая таблица для retry-очереди MIS-вызовов.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "chatslot01"
down_revision = "partneroffers01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─── 1. patient_chat_messages ─────────────────────────────────────────
    op.add_column(
        "patient_chat_messages",
        sa.Column(
            "message_type",
            sa.String(20),
            nullable=False,
            server_default="text",
        ),
    )
    op.create_index(
        "ix_patient_chat_messages_message_type",
        "patient_chat_messages",
        ["message_type"],
    )
    op.add_column(
        "patient_chat_messages",
        sa.Column("payload", JSONB, nullable=True),
    )
    # text становится nullable (slot_booked/slot_expired могут не иметь текста)
    op.alter_column("patient_chat_messages", "text", nullable=True)

    # ─── 2. appointments ──────────────────────────────────────────────────
    op.add_column(
        "appointments",
        sa.Column(
            "chat_thread_id",
            UUID(as_uuid=True),
            sa.ForeignKey("patient_chats.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_appointments_chat_thread_id",
        "appointments",
        ["chat_thread_id"],
    )
    op.add_column(
        "appointments",
        sa.Column(
            "source",
            sa.String(16),
            nullable=False,
            server_default="direct",
        ),
    )

    # ─── 3. patient_accounts ──────────────────────────────────────────────
    op.add_column(
        "patient_accounts",
        sa.Column("mis_patient_id", sa.Integer, nullable=True),
    )
    op.create_index(
        "ix_patient_accounts_mis_patient_id",
        "patient_accounts",
        ["mis_patient_id"],
    )
    op.add_column(
        "patient_accounts",
        sa.Column("mis_synced_at", sa.DateTime, nullable=True),
    )
    op.add_column(
        "patient_accounts",
        sa.Column(
            "mis_sync_state",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
    )

    # ─── 4. mis_outbox ────────────────────────────────────────────────────
    op.create_table(
        "mis_outbox",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("attempt_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("next_retry_at", sa.DateTime, nullable=False),
        sa.Column("last_error", sa.String(2000), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_mis_outbox_event_type", "mis_outbox", ["event_type"])
    op.create_index("ix_mis_outbox_status", "mis_outbox", ["status"])
    op.create_index("ix_mis_outbox_next_retry_at", "mis_outbox", ["next_retry_at"])


def downgrade() -> None:
    # mis_outbox
    op.drop_index("ix_mis_outbox_next_retry_at", table_name="mis_outbox")
    op.drop_index("ix_mis_outbox_status", table_name="mis_outbox")
    op.drop_index("ix_mis_outbox_event_type", table_name="mis_outbox")
    op.drop_table("mis_outbox")
    # patient_accounts
    op.drop_column("patient_accounts", "mis_sync_state")
    op.drop_column("patient_accounts", "mis_synced_at")
    op.drop_index("ix_patient_accounts_mis_patient_id", table_name="patient_accounts")
    op.drop_column("patient_accounts", "mis_patient_id")
    # appointments
    op.drop_column("appointments", "source")
    op.drop_index("ix_appointments_chat_thread_id", table_name="appointments")
    op.drop_column("appointments", "chat_thread_id")
    # patient_chat_messages
    op.alter_column("patient_chat_messages", "text", nullable=False)
    op.drop_column("patient_chat_messages", "payload")
    op.drop_index("ix_patient_chat_messages_message_type", table_name="patient_chat_messages")
    op.drop_column("patient_chat_messages", "message_type")
