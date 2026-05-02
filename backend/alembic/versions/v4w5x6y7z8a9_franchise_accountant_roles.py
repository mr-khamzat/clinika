"""franchise_accountant_roles

Revision ID: v4w5x6y7z8a9
Revises: u3v4w5x6y7z8
Create Date: 2026-05-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'v4w5x6y7z8a9'
down_revision = 'u3v4w5x6y7z8'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'franchise_owner'")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'accountant'")
    
    # franchise_owner_id on tenants - which user owns this franchise
    op.add_column('tenants', sa.Column(
        'franchise_owner_id',
        UUID(as_uuid=True),
        sa.ForeignKey('users.id', ondelete='SET NULL'),
        nullable=True
    ))
    # legal info for billing/acts
    op.add_column('tenants', sa.Column('legal_name', sa.String(300), nullable=True))
    op.add_column('tenants', sa.Column('legal_inn', sa.String(20), nullable=True))
    op.add_column('tenants', sa.Column('legal_address', sa.String(500), nullable=True))
    op.add_column('tenants', sa.Column('royalty_percent', sa.Numeric(5, 2), nullable=True, server_default='0'))


def downgrade():
    op.drop_column('tenants', 'royalty_percent')
    op.drop_column('tenants', 'legal_address')
    op.drop_column('tenants', 'legal_inn')
    op.drop_column('tenants', 'legal_name')
    op.drop_column('tenants', 'franchise_owner_id')
