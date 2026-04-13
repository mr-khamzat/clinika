"""add patient_support_messages table

Revision ID: f6a7b8c9d0e1
Revises: e5f6a1b2c3d4
Create Date: 2026-04-13 13:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a1b2c3d4'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'patient_support_messages' not in inspector.get_table_names():
        op.create_table(
            'patient_support_messages',
            sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
            sa.Column('patient_phone', sa.String(20), nullable=False),
            sa.Column('text', sa.Text(), nullable=False),
            sa.Column('sender', sa.String(10), nullable=False),
            sa.Column('staff_name', sa.String(200), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('is_read', sa.Boolean(), server_default='false'),
            sa.PrimaryKeyConstraint('id'),
        )


def downgrade():
    op.drop_table('patient_support_messages')
