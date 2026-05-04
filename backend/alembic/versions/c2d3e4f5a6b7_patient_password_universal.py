"""patient password и universal portal

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'c2d3e4f5a6b7'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('patient_accounts', sa.Column('password_hash', sa.String(200), nullable=True))


def downgrade():
    op.drop_column('patient_accounts', 'password_hash')
