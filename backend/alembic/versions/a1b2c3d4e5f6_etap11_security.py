"""etap11_security_rbac_consent

Revision ID: a1b2c3d4e5f6
Revises: e89da3cb7f0d
Create Date: 2026-04-12 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'a1b2c3d4e5f6'
down_revision = 'e89da3cb7f0d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Добавляем 152-ФЗ поля в users
    op.add_column('users', sa.Column('consent_given', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('users', sa.Column('consent_given_at', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('consent_version', sa.String(10), nullable=True))

    # 2. Таблица refresh_tokens
    op.create_table(
        'refresh_tokens',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False),
        sa.Column('device_info', sa.String(200), nullable=True),
        sa.Column('ip', sa.String(50), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('revoked', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_refresh_tokens_user_id', 'refresh_tokens', ['user_id'])
    op.create_index('ix_refresh_tokens_token_hash', 'refresh_tokens', ['token_hash'], unique=True)

    # 3. Таблица consent_records
    op.create_table(
        'consent_records',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('event', sa.String(30), nullable=False),
        sa.Column('ip', sa.String(50), nullable=True),
        sa.Column('user_agent', sa.String(300), nullable=True),
        sa.Column('policy_version', sa.String(10), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_consent_records_user_id', 'consent_records', ['user_id'])


def downgrade() -> None:
    op.drop_table('consent_records')
    op.drop_table('refresh_tokens')
    op.drop_column('users', 'consent_version')
    op.drop_column('users', 'consent_given_at')
    op.drop_column('users', 'consent_given')
