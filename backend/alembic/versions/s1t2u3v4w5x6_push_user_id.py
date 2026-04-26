"""add user_id to push_subscriptions

Revision ID: s1t2u3v4w5x6
Revises: r0s1t2u3v4w5
Create Date: 2026-04-26
"""
from alembic import op
import sqlalchemy as sa

revision = 's1t2u3v4w5x6'
down_revision = 'r0s1t2u3v4w5'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('push_subscriptions', sa.Column('user_id', sa.String(36), nullable=True))
    op.create_index('ix_push_subscriptions_user_id', 'push_subscriptions', ['user_id'])

def downgrade():
    op.drop_index('ix_push_subscriptions_user_id', 'push_subscriptions')
    op.drop_column('push_subscriptions', 'user_id')
