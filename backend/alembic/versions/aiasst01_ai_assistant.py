"""ai_assistant module — conversations + messages

Revision ID: aiasst01
Revises: smsmkt01
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'aiasst01'
down_revision = 'smsmkt01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ===== ai_conversations =====
    op.create_table(
        'ai_conversations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('patient_phone', sa.String(length=30), nullable=False),
        sa.Column(
            'status',
            sa.String(length=20),
            nullable=False,
            server_default='active',
        ),
        sa.Column('context', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        sa.Column('last_message_at', sa.DateTime(), nullable=True),
    )
    op.create_index(
        'ix_ai_conversations_tenant_id', 'ai_conversations', ['tenant_id']
    )
    op.create_index(
        'ix_ai_conversations_patient_phone',
        'ai_conversations',
        ['patient_phone'],
    )
    op.create_index(
        'ix_ai_conversations_status', 'ai_conversations', ['status']
    )
    op.create_index(
        'ix_ai_conversations_created_at', 'ai_conversations', ['created_at']
    )

    # ===== ai_messages =====
    op.create_table(
        'ai_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'conversation_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('ai_conversations.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('tokens_in', sa.Integer(), nullable=True),
        sa.Column('tokens_out', sa.Integer(), nullable=True),
        sa.Column('model', sa.String(length=50), nullable=True),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('cost_usd', sa.Numeric(10, 5), nullable=True),
        sa.Column(
            'escalated',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
    )
    op.create_index(
        'ix_ai_messages_conversation_id', 'ai_messages', ['conversation_id']
    )
    op.create_index(
        'ix_ai_messages_created_at', 'ai_messages', ['created_at']
    )


def downgrade() -> None:
    op.drop_index('ix_ai_messages_created_at', table_name='ai_messages')
    op.drop_index('ix_ai_messages_conversation_id', table_name='ai_messages')
    op.drop_table('ai_messages')

    op.drop_index('ix_ai_conversations_created_at', table_name='ai_conversations')
    op.drop_index('ix_ai_conversations_status', table_name='ai_conversations')
    op.drop_index(
        'ix_ai_conversations_patient_phone', table_name='ai_conversations'
    )
    op.drop_index('ix_ai_conversations_tenant_id', table_name='ai_conversations')
    op.drop_table('ai_conversations')
