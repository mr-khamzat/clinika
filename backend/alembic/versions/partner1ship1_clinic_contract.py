"""partner1ship1 — clinic contract fields (Этап 14)

Партнёрские клиники: каждая Clinic под Tenant'ом получает поля контракта
(royalty / per_referral / hybrid), даты подписания/истечения, статус
партнёрства и источник выручки.

Revision ID: partner1ship1
Revises: rbac1per1mis1
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa


revision = 'partner1ship1'
down_revision = 'rbac1per1mis1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Тип контракта: royalty | per_referral | hybrid ────────────────────
    op.add_column('clinics', sa.Column('contract_type', sa.String(length=20), nullable=True))
    # ── Ставка роялти (% с выручки), 0..100 ───────────────────────────────
    op.add_column('clinics', sa.Column('royalty_percent', sa.Numeric(5, 2), nullable=True))
    # ── Бонус за каждое подтверждённое направление, в ₽ ───────────────────
    op.add_column('clinics', sa.Column('bonus_per_referral', sa.Numeric(12, 2), nullable=True))
    # ── Даты подписания и истечения контракта ─────────────────────────────
    op.add_column('clinics', sa.Column('contract_signed_at', sa.DateTime(), nullable=True))
    op.add_column('clinics', sa.Column('contract_expires_at', sa.DateTime(), nullable=True))
    # ── Статус партнёрства: active | paused | terminated ──────────────────
    op.add_column(
        'clinics',
        sa.Column(
            'partner_status',
            sa.String(length=20),
            nullable=False,
            server_default='active',
        ),
    )
    # ── Источник данных о выручке: mis | manual | export ──────────────────
    op.add_column('clinics', sa.Column('revenue_source', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('clinics', 'revenue_source')
    op.drop_column('clinics', 'partner_status')
    op.drop_column('clinics', 'contract_expires_at')
    op.drop_column('clinics', 'contract_signed_at')
    op.drop_column('clinics', 'bonus_per_referral')
    op.drop_column('clinics', 'royalty_percent')
    op.drop_column('clinics', 'contract_type')
