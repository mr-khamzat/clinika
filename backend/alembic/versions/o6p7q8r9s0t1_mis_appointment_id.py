"""add mis_appointment_id and mis_doctor_id to referrals

Revision ID: o6p7q8r9s0t1
Revises: n5o6p7q8r9s0
Create Date: 2026-04-25
"""
from alembic import op
import sqlalchemy as sa

revision = 'o6p7q8r9s0t1'
down_revision = 'n5o6p7q8r9s0'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('referrals', sa.Column('mis_appointment_id', sa.Integer(), nullable=True))
    op.add_column('referrals', sa.Column('mis_doctor_id', sa.Integer(), nullable=True))
    op.create_index('ix_referrals_mis_appointment_id', 'referrals', ['mis_appointment_id'])

def downgrade():
    op.drop_index('ix_referrals_mis_appointment_id', table_name='referrals')
    op.drop_column('referrals', 'mis_doctor_id')
    op.drop_column('referrals', 'mis_appointment_id')
