"""tel01: telephony_configs + did_numbers + phone_calls"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = 'tel01_telephony'
down_revision = 'sf04_pinned'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('telephony_configs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, unique=True, index=True),
        sa.Column('provider', sa.String(20), nullable=False, server_default='null'),
        sa.Column('api_url', sa.String(300), nullable=True),
        sa.Column('api_key_encrypted', sa.Text, nullable=True),
        sa.Column('api_secret_encrypted', sa.Text, nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('features', JSONB, nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    op.create_table('did_numbers',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('clinic_id', UUID(as_uuid=True),
            sa.ForeignKey('clinics.id', ondelete='SET NULL'), nullable=True),
        sa.Column('number', sa.String(20), nullable=False),
        sa.Column('display_name', sa.String(200), nullable=False),
        sa.Column('default_assignee_id', UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('ivr_config', JSONB, nullable=True),
        sa.Column('record_calls', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('tenant_id', 'number', name='uq_did_tenant_number'),
    )
    op.create_table('phone_calls',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('clinic_id', UUID(as_uuid=True),
            sa.ForeignKey('clinics.id', ondelete='SET NULL'), nullable=True),
        sa.Column('direction', sa.String(3), nullable=False),
        sa.Column('external_number', sa.String(20), nullable=False, index=True),
        sa.Column('internal_did', sa.String(20), nullable=True),
        sa.Column('operator_id', UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('patient_id', UUID(as_uuid=True),
            sa.ForeignKey('patient_accounts.id', ondelete='SET NULL'), nullable=True),
        sa.Column('started_at', sa.DateTime, server_default=sa.func.now(), nullable=False, index=True),
        sa.Column('answered_at', sa.DateTime, nullable=True),
        sa.Column('ended_at', sa.DateTime, nullable=True),
        sa.Column('duration_sec', sa.Integer, nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='initiated'),
        sa.Column('recording_url', sa.String(500), nullable=True),
        sa.Column('provider_call_id', sa.String(100), nullable=True, index=True),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_phone_calls_started', 'phone_calls', ['tenant_id', 'started_at'])


def downgrade():
    op.drop_index('ix_phone_calls_started', table_name='phone_calls')
    op.drop_table('phone_calls')
    op.drop_table('did_numbers')
    op.drop_table('telephony_configs')
