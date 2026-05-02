"""appointment_payment_method

Revision ID: y7z8a9b0c1d2
Revises: x6y7z8a9b0c1
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa

revision = 'y7z8a9b0c1d2'
down_revision = 'x6y7z8a9b0c1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('appointments', sa.Column('payment_method', sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column('appointments', 'payment_method')
