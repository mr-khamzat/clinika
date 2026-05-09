"""svcfin01 — service.referral_payout (split price/payout/platform_fee)

Финансовая модель платформы:
  Service.price            — цена пациенту
  Service.referral_payout  — сумма видимая создающему направление
                             (что получит партнёр / клиника-источник)
  platform_fee = price - referral_payout (берём max(этого, Franchise.platform_fee_per_bonus))

Backfill: новое поле = bonus_amount (старое значение, которое раньше было «бонусом услуги»).
Существующие услуги продолжают работать без правок.

Revision ID: svcfin01
Revises: tenantsplit01
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa


revision = 'svcfin01'
down_revision = 'tenantsplit01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Новое поле — nullable, с backfill из существующего bonus_amount.
    op.add_column(
        'services',
        sa.Column('referral_payout', sa.Numeric(10, 2), nullable=True),
    )
    # Backfill: для всех услуг ставим referral_payout = bonus_amount (старое значение).
    op.execute(
        "UPDATE services SET referral_payout = bonus_amount WHERE referral_payout IS NULL"
    )


def downgrade() -> None:
    op.drop_column('services', 'referral_payout')
