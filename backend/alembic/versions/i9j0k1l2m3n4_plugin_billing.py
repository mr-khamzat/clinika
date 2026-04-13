"""add plugin billing fields to tenant_plugins

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-04-13 20:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'i9j0k1l2m3n4'
down_revision = 'h8i9j0k1l2m3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('tenant_plugins', sa.Column('trial_until', sa.DateTime, nullable=True))
    op.add_column('tenant_plugins', sa.Column('paid_until', sa.DateTime, nullable=True))
    op.add_column('tenant_plugins', sa.Column('price_monthly', sa.Numeric(12, 2), nullable=True))


def downgrade() -> None:
    op.drop_column('tenant_plugins', 'price_monthly')
    op.drop_column('tenant_plugins', 'paid_until')
    op.drop_column('tenant_plugins', 'trial_until')
