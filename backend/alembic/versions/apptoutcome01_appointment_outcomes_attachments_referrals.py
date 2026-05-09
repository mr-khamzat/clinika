"""appointment_outcomes + appointment_attachments + internal_referrals

Revision ID: apptoutcome01
Revises: apptprio01
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'apptoutcome01'
down_revision = 'apptprio01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── appointment_outcomes ────────────────────────────────────────────
    op.create_table(
        'appointment_outcomes',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'appointment_id',
            UUID(as_uuid=True),
            sa.ForeignKey('appointments.id', ondelete='CASCADE'),
            nullable=False,
            unique=True,
        ),
        sa.Column('conclusion', sa.Text(), nullable=False),
        sa.Column('recommendations', sa.Text(), nullable=True),
        sa.Column(
            'created_by_id',
            UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(
        'ix_appointment_outcomes_appointment_id',
        'appointment_outcomes', ['appointment_id'],
    )

    # ── appointment_attachments ─────────────────────────────────────────
    op.create_table(
        'appointment_attachments',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'appointment_id',
            UUID(as_uuid=True),
            sa.ForeignKey('appointments.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('file_url', sa.Text(), nullable=False),
        sa.Column('file_name', sa.String(length=300), nullable=False),
        sa.Column('mime_type', sa.String(length=100), nullable=True),
        sa.Column('size_bytes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column(
            'uploaded_by_id',
            UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('uploaded_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(
        'ix_appointment_attachments_appointment_id',
        'appointment_attachments', ['appointment_id'],
    )

    # ── internal_referrals ──────────────────────────────────────────────
    op.create_table(
        'internal_referrals',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'tenant_id',
            UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'source_appointment_id',
            UUID(as_uuid=True),
            sa.ForeignKey('appointments.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('patient_phone', sa.String(length=30), nullable=False),
        sa.Column('patient_name', sa.String(length=200), nullable=True),
        sa.Column('target_type', sa.String(length=20), nullable=False),
        sa.Column(
            'target_doctor_id',
            UUID(as_uuid=True),
            sa.ForeignKey('doctors.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('target_service', sa.String(length=300), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column(
            'created_by_id',
            UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'scheduled_appointment_id',
            UUID(as_uuid=True),
            sa.ForeignKey('appointments.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(
        'ix_internal_referrals_source_appointment_id',
        'internal_referrals', ['source_appointment_id'],
    )
    op.create_index(
        'ix_internal_referrals_patient_phone',
        'internal_referrals', ['patient_phone'],
    )
    op.create_index(
        'ix_internal_referrals_tenant_id',
        'internal_referrals', ['tenant_id'],
    )
    op.create_index(
        'ix_internal_referrals_status',
        'internal_referrals', ['status'],
    )
    op.create_index(
        'ix_internal_referrals_target_type',
        'internal_referrals', ['target_type'],
    )


def downgrade() -> None:
    op.drop_index('ix_internal_referrals_target_type', table_name='internal_referrals')
    op.drop_index('ix_internal_referrals_status', table_name='internal_referrals')
    op.drop_index('ix_internal_referrals_tenant_id', table_name='internal_referrals')
    op.drop_index('ix_internal_referrals_patient_phone', table_name='internal_referrals')
    op.drop_index('ix_internal_referrals_source_appointment_id', table_name='internal_referrals')
    op.drop_table('internal_referrals')

    op.drop_index('ix_appointment_attachments_appointment_id', table_name='appointment_attachments')
    op.drop_table('appointment_attachments')

    op.drop_index('ix_appointment_outcomes_appointment_id', table_name='appointment_outcomes')
    op.drop_table('appointment_outcomes')
