"""telemedicine module — sessions + chat + prescriptions

Revision ID: telemed01
Revises: regionlock01
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'telemed01'
down_revision = 'regionlock01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ===== ENUM types =====
    session_status = postgresql.ENUM(
        'scheduled', 'active', 'ended', 'expired', 'no_show',
        name='telemedicine_session_status',
        create_type=True,
    )
    chat_role = postgresql.ENUM(
        'doctor', 'patient', 'system',
        name='telemedicine_chat_role',
        create_type=True,
    )
    bind = op.get_bind()
    session_status.create(bind, checkfirst=True)
    chat_role.create(bind, checkfirst=True)

    # ===== telemedicine_sessions =====
    op.create_table(
        'telemedicine_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'appointment_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('appointments.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'doctor_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('doctors.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('patient_phone', sa.String(length=30), nullable=False),
        sa.Column('room_id', sa.String(length=64), nullable=False, unique=True),
        sa.Column('join_token_hash', sa.String(length=128), nullable=False),
        sa.Column(
            'status',
            postgresql.ENUM(
                'scheduled', 'active', 'ended', 'expired', 'no_show',
                name='telemedicine_session_status',
                create_type=False,
            ),
            nullable=False,
            server_default='scheduled',
        ),
        sa.Column('scheduled_at', sa.DateTime(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('ended_at', sa.DateTime(), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=True),
        sa.Column(
            'recording_enabled',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column('recording_path', sa.String(length=500), nullable=True),
        sa.Column('chat_log_path', sa.String(length=500), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        'ix_telemedicine_sessions_tenant_id',
        'telemedicine_sessions',
        ['tenant_id'],
    )
    op.create_index(
        'ix_telemedicine_sessions_appointment_id',
        'telemedicine_sessions',
        ['appointment_id'],
    )
    op.create_index(
        'ix_telemedicine_sessions_doctor_id',
        'telemedicine_sessions',
        ['doctor_id'],
    )
    op.create_index(
        'ix_telemedicine_sessions_patient_phone',
        'telemedicine_sessions',
        ['patient_phone'],
    )
    op.create_index(
        'ix_telemedicine_sessions_room_id',
        'telemedicine_sessions',
        ['room_id'],
    )
    op.create_index(
        'ix_telemedicine_sessions_status',
        'telemedicine_sessions',
        ['status'],
    )

    # ===== telemedicine_chat_messages =====
    op.create_table(
        'telemedicine_chat_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'session_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('telemedicine_sessions.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'from_role',
            postgresql.ENUM(
                'doctor', 'patient', 'system',
                name='telemedicine_chat_role',
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column('text', sa.Text(), nullable=True),
        sa.Column('file_path', sa.String(length=500), nullable=True),
        sa.Column('file_mime', sa.String(length=100), nullable=True),
        sa.Column('file_size_bytes', sa.BigInteger(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        'ix_telemedicine_chat_messages_session_id',
        'telemedicine_chat_messages',
        ['session_id'],
    )
    op.create_index(
        'ix_telemedicine_chat_messages_created_at',
        'telemedicine_chat_messages',
        ['created_at'],
    )

    # ===== telemedicine_prescriptions =====
    op.create_table(
        'telemedicine_prescriptions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'session_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('telemedicine_sessions.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'appointment_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('appointments.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('signature_hash', sa.String(length=128), nullable=False),
        sa.Column('signed_at', sa.DateTime(), nullable=False),
        sa.Column(
            'signed_by_user_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('pdf_path', sa.String(length=500), nullable=True),
        sa.Column('sent_to_patient_at', sa.DateTime(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        'ix_telemedicine_prescriptions_session_id',
        'telemedicine_prescriptions',
        ['session_id'],
    )
    op.create_index(
        'ix_telemedicine_prescriptions_appointment_id',
        'telemedicine_prescriptions',
        ['appointment_id'],
    )
    op.create_index(
        'ix_telemedicine_prescriptions_signed_by_user_id',
        'telemedicine_prescriptions',
        ['signed_by_user_id'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_telemedicine_prescriptions_signed_by_user_id',
        table_name='telemedicine_prescriptions',
    )
    op.drop_index(
        'ix_telemedicine_prescriptions_appointment_id',
        table_name='telemedicine_prescriptions',
    )
    op.drop_index(
        'ix_telemedicine_prescriptions_session_id',
        table_name='telemedicine_prescriptions',
    )
    op.drop_table('telemedicine_prescriptions')

    op.drop_index(
        'ix_telemedicine_chat_messages_created_at',
        table_name='telemedicine_chat_messages',
    )
    op.drop_index(
        'ix_telemedicine_chat_messages_session_id',
        table_name='telemedicine_chat_messages',
    )
    op.drop_table('telemedicine_chat_messages')

    op.drop_index(
        'ix_telemedicine_sessions_status', table_name='telemedicine_sessions'
    )
    op.drop_index(
        'ix_telemedicine_sessions_room_id', table_name='telemedicine_sessions'
    )
    op.drop_index(
        'ix_telemedicine_sessions_patient_phone',
        table_name='telemedicine_sessions',
    )
    op.drop_index(
        'ix_telemedicine_sessions_doctor_id', table_name='telemedicine_sessions'
    )
    op.drop_index(
        'ix_telemedicine_sessions_appointment_id',
        table_name='telemedicine_sessions',
    )
    op.drop_index(
        'ix_telemedicine_sessions_tenant_id',
        table_name='telemedicine_sessions',
    )
    op.drop_table('telemedicine_sessions')

    bind = op.get_bind()
    sa.Enum(name='telemedicine_chat_role').drop(bind, checkfirst=True)
    sa.Enum(name='telemedicine_session_status').drop(bind, checkfirst=True)
