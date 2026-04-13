"""SaaS Platform: super_admin role, tenant_modules, tenant_plugins

Revision ID: c3d4e5f6a1b2
Revises: b2c3d4e5f6a1
Create Date: 2026-04-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'c3d4e5f6a1b2'
down_revision = 'b2c3d4e5f6a1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Добавляем super_admin к enum (PostgreSQL 12+ можно в транзакции)
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'super_admin'")

    # 2. Таблица модулей тенанта (переопределение plan_features на уровне тенанта)
    op.create_table(
        'tenant_modules',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('module', sa.String(100), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('config', postgresql.JSONB(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'module', name='uq_tenant_module'),
    )
    op.create_index('ix_tenant_modules_tenant_id', 'tenant_modules', ['tenant_id'])

    # 3. Таблица плагинов тенанта (конфиг плагинов на уровне тенанта)
    op.create_table(
        'tenant_plugins',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('plugin', sa.String(100), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('config', postgresql.JSONB(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'plugin', name='uq_tenant_plugin'),
    )
    op.create_index('ix_tenant_plugins_tenant_id', 'tenant_plugins', ['tenant_id'])


def downgrade() -> None:
    op.drop_index('ix_tenant_plugins_tenant_id', table_name='tenant_plugins')
    op.drop_table('tenant_plugins')
    op.drop_index('ix_tenant_modules_tenant_id', table_name='tenant_modules')
    op.drop_table('tenant_modules')
    # NOTE: PostgreSQL не поддерживает удаление значений из enum
