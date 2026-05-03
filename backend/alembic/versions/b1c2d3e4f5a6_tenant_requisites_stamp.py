"""add tenant requisites and stamp for acts

Revision ID: b1c2d3e4f5a6
Revises: a0b1c2d3e4f5
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa

revision = 'b1c2d3e4f5a6'
down_revision = 'a0b1c2d3e4f5'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('tenants', sa.Column('legal_kpp',            sa.String(20),  nullable=True))
    op.add_column('tenants', sa.Column('legal_ogrn',           sa.String(20),  nullable=True))
    op.add_column('tenants', sa.Column('legal_phone',          sa.String(30),  nullable=True))
    op.add_column('tenants', sa.Column('legal_email',          sa.String(200), nullable=True))
    op.add_column('tenants', sa.Column('legal_bank_name',      sa.String(300), nullable=True))
    op.add_column('tenants', sa.Column('legal_bank_account',   sa.String(30),  nullable=True))
    op.add_column('tenants', sa.Column('legal_bank_bik',       sa.String(12),  nullable=True))
    op.add_column('tenants', sa.Column('legal_bank_corr',      sa.String(30),  nullable=True))
    op.add_column('tenants', sa.Column('legal_signer_name',    sa.String(200), nullable=True))
    op.add_column('tenants', sa.Column('legal_signer_pos',     sa.String(200), nullable=True))
    op.add_column('tenants', sa.Column('stamp_url',            sa.String(500), nullable=True))

def downgrade():
    for col in ['legal_kpp','legal_ogrn','legal_phone','legal_email',
                'legal_bank_name','legal_bank_account','legal_bank_bik',
                'legal_bank_corr','legal_signer_name','legal_signer_pos','stamp_url']:
        op.drop_column('tenants', col)
