"""avatar01 — users.avatar_url для аватарок личного кабинета сотрудника.

Добавляет nullable VARCHAR(500) колонку в users. Аватар каждый сотрудник
может загрузить в своём кабинете (PATCH/POST /profile/me/avatar). Файлы
лежат в /app/uploads/avatars/<user_id>.<ext> и отдаются backend-эндпоинтом
GET /profile/uploads/avatars/{filename}.

Revision ID: avatar01_user_avatar_url
Revises: scrr01_staff_chat_read_receipts
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa


revision = "avatar01_user_avatar_url"
down_revision = "scrr01_staff_chat_read_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Колонка avatar_url ──────────────────────────────────────────────
    # Хранит относительный URL вида "/uploads/avatars/<uuid>.<ext>?v=<ts>".
    # nullable=True — у существующих пользователей аватарки нет до первого
    # сохранения; UI показывает инициалы (см. <Avatar> в дизайн-системе).
    op.add_column(
        "users",
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "avatar_url")
