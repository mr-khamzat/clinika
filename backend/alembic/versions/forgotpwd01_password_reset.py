"""forgotpwd01 — таблица password_reset_tokens для self-service сброса пароля

Создаёт password_reset_tokens с FK→users.id (CASCADE), уникальным token_hash
(SHA-256 hex от raw_token, raw_token не хранится), TTL через expires_at,
одноразовость через used_at.

Revision ID: forgotpwd01
Revises: bonusunique01
Create Date: 2026-05-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'forgotpwd01'
down_revision = 'bonusunique01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'password_reset_tokens',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_hash', sa.String(length=128), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('used_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('requested_ip', sa.String(length=45), nullable=True),
        sa.UniqueConstraint('token_hash', name='uq_password_reset_tokens_token_hash'),
    )
    op.create_index('ix_password_reset_tokens_user_id', 'password_reset_tokens', ['user_id'])
    op.create_index('ix_password_reset_tokens_token_hash', 'password_reset_tokens', ['token_hash'])
    op.create_index('ix_password_reset_tokens_expires_at', 'password_reset_tokens', ['expires_at'])


def downgrade() -> None:
    op.drop_index('ix_password_reset_tokens_expires_at', table_name='password_reset_tokens')
    op.drop_index('ix_password_reset_tokens_token_hash', table_name='password_reset_tokens')
    op.drop_index('ix_password_reset_tokens_user_id', table_name='password_reset_tokens')
    op.drop_table('password_reset_tokens')
