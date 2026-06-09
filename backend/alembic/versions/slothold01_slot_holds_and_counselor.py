"""slot_holds + patient_accounts.counselor — Slot Hold + VIP Counselor.

Revision ID: slothold01
Revises: chatmsgtpl01
Create Date: 2026-05-24
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "slothold01"
down_revision = "chatmsgtpl01"
branch_labels = None
depends_on = None


def upgrade():
    # === Slot Hold ===
    op.create_table(
        "slot_holds",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "doctor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("doctors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("appointment_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=True),
        sa.Column("patient_phone", sa.String(20), nullable=False),
        sa.Column("patient_name", sa.String(200), nullable=True),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "held_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("hold_expires_at", sa.DateTime(), nullable=False),
        sa.Column("converted_to_appointment_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("released_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_slot_holds_doctor_id", "slot_holds", ["doctor_id"])
    op.create_index("ix_slot_holds_appointment_date", "slot_holds", ["appointment_date"])
    op.create_index("ix_slot_holds_thread_id", "slot_holds", ["thread_id"])
    op.create_index("ix_slot_holds_hold_expires_at", "slot_holds", ["hold_expires_at"])

    # === VIP Counselor ===
    op.add_column(
        "patient_accounts",
        sa.Column(
            "default_counselor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "patient_accounts",
        sa.Column("counselor_since", sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_column("patient_accounts", "counselor_since")
    op.drop_column("patient_accounts", "default_counselor_user_id")
    op.drop_index("ix_slot_holds_hold_expires_at", table_name="slot_holds")
    op.drop_index("ix_slot_holds_thread_id", table_name="slot_holds")
    op.drop_index("ix_slot_holds_appointment_date", table_name="slot_holds")
    op.drop_index("ix_slot_holds_doctor_id", table_name="slot_holds")
    op.drop_table("slot_holds")
