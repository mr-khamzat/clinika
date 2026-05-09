"""appointment priority — normal/high/urgent

Revision ID: apptprio01
Revises: regionlock02
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa


revision = 'apptprio01'
down_revision = 'regionlock02'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Поле уже было добавлено через прямой SQL ALTER TABLE — проверяем idempotent.
    # Если идём с чистой БД (тест/новая среда) — выполняется ALTER TABLE.
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='appointments' AND column_name='priority') THEN
                ALTER TABLE appointments
                  ADD COLUMN priority varchar(10) NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('normal', 'high', 'urgent'));
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_column('appointments', 'priority')
