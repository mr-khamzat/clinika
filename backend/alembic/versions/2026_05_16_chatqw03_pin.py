"""chat_thread.pinned_at — поле для закрепления треда в списке

Revision ID: chatqw03_pin
Revises: chatqw02_react
Create Date: 2026-05-16

Quick Wins #3/4: pin-треды.

* ChatThread.pinned_at TIMESTAMP NULLABLE — когда тред запиннен (NULL = нет).
* list_clinic_threads() сортирует pinned_at DESC NULLS LAST, потом
  last_message_at DESC.
"""
from alembic import op
import sqlalchemy as sa


revision = "chatqw03_pin"
down_revision = "chatqw02_react"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_threads",
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_chat_threads_pinned_at", "chat_threads", ["pinned_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_chat_threads_pinned_at", table_name="chat_threads")
    op.drop_column("chat_threads", "pinned_at")
