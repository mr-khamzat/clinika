"""patient_sessions

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'd3e4f5a6b7c8'
down_revision = 'c2d3e4f5a6b7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'patient_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('phone', sa.String(30), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('refresh_hash', sa.String(128), nullable=False),
        sa.Column('device_info', sa.Text, nullable=True),
        sa.Column('last_used_at', sa.DateTime, nullable=False),
        sa.Column('expires_at', sa.DateTime, nullable=False),
        sa.Column('revoked', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime, nullable=False),
    )
    op.create_index('ix_patient_sessions_phone_tenant', 'patient_sessions', ['phone', 'tenant_id'])
    op.create_index('ix_patient_sessions_refresh_hash', 'patient_sessions', ['refresh_hash'])


def downgrade() -> None:
    op.drop_index('ix_patient_sessions_refresh_hash', table_name='patient_sessions')
    op.drop_index('ix_patient_sessions_phone_tenant', table_name='patient_sessions')
    op.drop_table('patient_sessions')
