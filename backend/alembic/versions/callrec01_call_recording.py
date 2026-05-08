"""call_recording module — recordings + transcripts (W5)

Revision ID: callrec01
Revises: smsmkt01
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'callrec01'
down_revision = 'smsmkt01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ===== ENUM-типы =====
    session_type = postgresql.ENUM(
        'staff', 'telemed', 'external',
        name='call_session_type',
        create_type=True,
    )
    rec_status = postgresql.ENUM(
        'uploading', 'ready', 'transcribing', 'done', 'failed',
        name='call_recording_status',
        create_type=True,
    )
    bind = op.get_bind()
    session_type.create(bind, checkfirst=True)
    rec_status.create(bind, checkfirst=True)

    # ===== call_recordings =====
    op.create_table(
        'call_recordings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'call_log_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('call_logs.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'session_type',
            postgresql.ENUM(
                'staff', 'telemed', 'external',
                name='call_session_type',
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column('participants', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('recording_path', sa.String(length=500), nullable=True),
        sa.Column('file_size_bytes', sa.BigInteger(), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=True),
        sa.Column('mime', sa.String(length=100), nullable=True),
        sa.Column(
            'status',
            postgresql.ENUM(
                'uploading', 'ready', 'transcribing', 'done', 'failed',
                name='call_recording_status',
                create_type=False,
            ),
            nullable=False,
            server_default='uploading',
        ),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column(
            'started_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column('ended_at', sa.DateTime(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        'ix_call_recordings_tenant_id', 'call_recordings', ['tenant_id']
    )
    op.create_index(
        'ix_call_recordings_call_log_id', 'call_recordings', ['call_log_id']
    )
    op.create_index(
        'ix_call_recordings_status', 'call_recordings', ['status']
    )
    op.create_index(
        'ix_call_recordings_started_at', 'call_recordings', ['started_at']
    )

    # ===== call_transcripts =====
    op.create_table(
        'call_transcripts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'recording_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('call_recordings.id', ondelete='CASCADE'),
            nullable=False,
            unique=True,
        ),
        sa.Column('segments', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('full_text', sa.Text(), nullable=False, server_default=''),
        sa.Column('language', sa.String(length=10), nullable=True),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('tokens_used', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('model', sa.String(length=50), nullable=False, server_default='whisper-1'),
        sa.Column('cost_usd', sa.Numeric(10, 4), nullable=False, server_default='0'),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        'ix_call_transcripts_recording_id',
        'call_transcripts',
        ['recording_id'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_call_transcripts_recording_id', table_name='call_transcripts'
    )
    op.drop_table('call_transcripts')

    op.drop_index('ix_call_recordings_started_at', table_name='call_recordings')
    op.drop_index('ix_call_recordings_status', table_name='call_recordings')
    op.drop_index('ix_call_recordings_call_log_id', table_name='call_recordings')
    op.drop_index('ix_call_recordings_tenant_id', table_name='call_recordings')
    op.drop_table('call_recordings')

    bind = op.get_bind()
    sa.Enum(name='call_recording_status').drop(bind, checkfirst=True)
    sa.Enum(name='call_session_type').drop(bind, checkfirst=True)
