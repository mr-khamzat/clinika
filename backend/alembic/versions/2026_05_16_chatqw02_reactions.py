"""chat_message_reactions — реакции на сообщения чата

Revision ID: chatqw02_react
Revises: chatqw01_typing
Create Date: 2026-05-16

Quick Wins #2/4: реакции на сообщения (👍 ❤ 😂 …).

Структура:
  id           uuid pk
  message_id   uuid fk chat_messages.id ON DELETE CASCADE
  user_type    varchar(20) — 'patient' или 'staff'
  user_id      uuid — id пациента (PatientAccount) или сотрудника (User)
  emoji        varchar(8) — короткий тег ('thumbs_up','heart','laugh', ...)
  created_at   timestamp default now

Уникальность: один user не может поставить одну и ту же реакцию дважды
→ UNIQUE (message_id, user_type, user_id, emoji). Toggle-эндпоинт сам
вставляет или удаляет строку.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "chatqw02_react"
down_revision = "chatqw01_typing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_message_reactions",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", UUID(as_uuid=True), nullable=False),
        sa.Column("user_type", sa.String(20), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("emoji", sa.String(16), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["message_id"], ["chat_messages.id"], ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "message_id", "user_type", "user_id", "emoji",
            name="uq_chat_msg_reaction",
        ),
    )
    op.create_index(
        "ix_chat_msg_reactions_msg", "chat_message_reactions", ["message_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_chat_msg_reactions_msg", table_name="chat_message_reactions")
    op.drop_table("chat_message_reactions")
