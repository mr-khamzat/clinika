"""add webhook tables

Revision ID: h8i9j0k1l2m3
Revises: e5f6a1b2c3d4
Create Date: 2026-04-13 18:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = 'h8i9j0k1l2m3'
down_revision = 'g7h8i9j0k1l2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'webhook_endpoints',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('url', sa.String(500), nullable=False),
        sa.Column('events', JSONB, nullable=True),
        sa.Column('secret', sa.String(200), nullable=True),
        sa.Column('is_active', sa.Boolean, default=True, nullable=False),
        sa.Column('description', sa.String(300), nullable=True),
        sa.Column('last_triggered_at', sa.DateTime, nullable=True),
        sa.Column('last_status_code', sa.Integer, nullable=True),
        sa.Column('fail_count', sa.Integer, default=0, nullable=False),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        'webhook_deliveries',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('endpoint_id', UUID(as_uuid=True), sa.ForeignKey('webhook_endpoints.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('event', sa.String(100), nullable=False),
        sa.Column('payload', JSONB, nullable=True),
        sa.Column('status_code', sa.Integer, nullable=True),
        sa.Column('response_body', sa.Text, nullable=True),
        sa.Column('attempt', sa.Integer, default=1, nullable=False),
        sa.Column('success', sa.Boolean, default=False, nullable=False),
        sa.Column('delivered_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('webhook_deliveries')
    op.drop_table('webhook_endpoints')
