"""chat_typing_indicator — поля last_typing_at_clinic/patient для индикатора набора

Revision ID: chatqw01_typing
Revises: announce01
Create Date: 2026-05-16

Quick Wins для чата клиника↔пациент (Этап 1/4):
* ChatThread.last_typing_at_clinic — когда последний раз "клиника печатает"
* ChatThread.last_typing_at_patient — когда последний раз "пациент печатает"

Используются эндпоинтами POST /clinic/chat/threads/{id}/typing и
POST /patient/chat/threads/{id}/typing. Фронт опрашивает значения через
serialize_thread() и показывает "печатает...", если timestamp < 7 сек назад.
"""
from alembic import op
import sqlalchemy as sa


revision = "chatqw01_typing"
# Мерджим параллельные head'ы: announce01 (platform_announcements) и
# pushsub02 (push_subscriptions extension) — оба от одного предка.
down_revision = ("announce01", "pushsub02")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_threads",
        sa.Column("last_typing_at_clinic", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "chat_threads",
        sa.Column("last_typing_at_patient", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_threads", "last_typing_at_patient")
    op.drop_column("chat_threads", "last_typing_at_clinic")
