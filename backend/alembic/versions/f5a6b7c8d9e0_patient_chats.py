"""patient_chats — гибридный чат AI + регистратура (вариант D)

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'f5a6b7c8d9e0'
down_revision = 'e4f5a6b7c8d9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── PatientChat ──────────────────────────────────────────────────────────
    op.create_table(
        'patient_chats',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='SET NULL'), nullable=True),
        sa.Column('patient_phone', sa.String(30), nullable=False),
        sa.Column('patient_name', sa.String(200), nullable=True),
        sa.Column('mode', sa.String(20), nullable=False, server_default='ai'),
        sa.Column('title', sa.String(200), nullable=True),
        sa.Column('ai_messages_today', sa.Integer, nullable=False, server_default='0'),
        sa.Column('ai_messages_reset_date', sa.Date, nullable=True),
        sa.Column('unread_admin', sa.Integer, nullable=False, server_default='0'),
        sa.Column('last_message_at', sa.DateTime, nullable=True),
        sa.Column('last_message_preview', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_patient_chats_tenant_id', 'patient_chats', ['tenant_id'])
    op.create_index('ix_patient_chats_patient_phone', 'patient_chats', ['patient_phone'])
    op.create_index('ix_patient_chats_tenant_phone', 'patient_chats',
                    ['tenant_id', 'patient_phone'])

    # ── PatientChatMessage ───────────────────────────────────────────────────
    op.create_table(
        'patient_chat_messages',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('chat_id', UUID(as_uuid=True),
                  sa.ForeignKey('patient_chats.id', ondelete='CASCADE'), nullable=False),
        sa.Column('sender', sa.String(20), nullable=False),
        sa.Column('text', sa.Text, nullable=False),
        sa.Column('tokens_in', sa.Integer, nullable=True),
        sa.Column('tokens_out', sa.Integer, nullable=True),
        sa.Column('is_cached', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('handed_off', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('is_read_by_patient', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('admin_user_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_patient_chat_messages_chat_id', 'patient_chat_messages', ['chat_id'])
    op.create_index('ix_patient_chat_messages_created_at', 'patient_chat_messages', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_patient_chat_messages_created_at', table_name='patient_chat_messages')
    op.drop_index('ix_patient_chat_messages_chat_id', table_name='patient_chat_messages')
    op.drop_table('patient_chat_messages')

    op.drop_index('ix_patient_chats_tenant_phone', table_name='patient_chats')
    op.drop_index('ix_patient_chats_patient_phone', table_name='patient_chats')
    op.drop_index('ix_patient_chats_tenant_id', table_name='patient_chats')
    op.drop_table('patient_chats')
