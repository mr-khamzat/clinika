"""etap12_ledger_commission_breakdown

Revision ID: b2c3d4e5f6a1
Revises: a1b2c3d4e5f6
Create Date: 2026-04-12 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'b2c3d4e5f6a1'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('ledger_entries', sa.Column('clinic_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('ledger_entries', sa.Column('admin_amount', sa.Numeric(12, 2), nullable=True))
    op.add_column('ledger_entries', sa.Column('manager_amount', sa.Numeric(12, 2), nullable=True))
    op.add_column('ledger_entries', sa.Column('platform_amount', sa.Numeric(12, 2), nullable=True))
    op.create_foreign_key(None, 'ledger_entries', 'clinics', ['clinic_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_ledger_entries_clinic_id', 'ledger_entries', ['clinic_id'])


def downgrade() -> None:
    op.drop_index('ix_ledger_entries_clinic_id', 'ledger_entries')
    op.drop_column('ledger_entries', 'platform_amount')
    op.drop_column('ledger_entries', 'manager_amount')
    op.drop_column('ledger_entries', 'admin_amount')
    op.drop_column('ledger_entries', 'clinic_id')
