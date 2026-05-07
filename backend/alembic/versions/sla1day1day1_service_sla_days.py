"""service_sla_days — SLA направлений per-service (Этап 9 ROADMAP)

Добавляет колонку services.sla_days INTEGER NOT NULL DEFAULT 14.
Используется для расчёта дедлайна направления:
    sla_deadline = referral.created_at + service.sla_days дней

Revision ID: sla1day1day1
Revises: loy1ty1ty1ty
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa


revision = 'sla1day1day1'
down_revision = 'loy1ty1ty1ty'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Добавляем колонку с server_default чтобы существующие строки получили 14
    op.add_column(
        'services',
        sa.Column('sla_days', sa.Integer(), nullable=False, server_default='14'),
    )


def downgrade() -> None:
    op.drop_column('services', 'sla_days')
