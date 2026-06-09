"""Refresh-token rotation: add revoked_at, replaced_by_id, reused_at

Revision ID: refrot_01
Revises: fern_pay01
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'refrot_01'
down_revision = 'fern_pay01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('refresh_tokens', sa.Column('revoked_at', sa.DateTime(), nullable=True))
    op.add_column('refresh_tokens', sa.Column('replaced_by_id', UUID(as_uuid=True),
                                              sa.ForeignKey('refresh_tokens.id', ondelete='SET NULL'),
                                              nullable=True))
    op.add_column('refresh_tokens', sa.Column('reused_at', sa.DateTime(), nullable=True))
    op.create_index('ix_refresh_tokens_replaced_by_id', 'refresh_tokens', ['replaced_by_id'])


def downgrade() -> None:
    op.drop_index('ix_refresh_tokens_replaced_by_id', 'refresh_tokens')
    op.drop_column('refresh_tokens', 'reused_at')
    op.drop_column('refresh_tokens', 'replaced_by_id')
    op.drop_column('refresh_tokens', 'revoked_at')
