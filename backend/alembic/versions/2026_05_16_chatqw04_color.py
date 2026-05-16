"""chat_thread.color_label — цветовая метка треда

Revision ID: chatqw04_color
Revises: chatqw03_pin
Create Date: 2026-05-16

Quick Wins #4/4: цветовая метка треда (red / yellow / green / blue / NULL).

Используется клиникой для визуальной приоритизации (срочно / обычное /
завершено / отложено и т.п.). NULL = метки нет.
"""
from alembic import op
import sqlalchemy as sa


revision = "chatqw04_color"
down_revision = "chatqw03_pin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_threads",
        sa.Column("color_label", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_threads", "color_label")
