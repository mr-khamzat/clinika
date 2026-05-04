"""ai_knowledge — база знаний AI (FAQ) + поле source в patient_chat_messages

Revision ID: a7b8c9d0e1f2
Revises: f5a6b7c8d9e0
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'a7b8c9d0e1f2'
down_revision = 'f5a6b7c8d9e0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── ai_knowledge_entries ─────────────────────────────────────────────────
    op.create_table(
        'ai_knowledge_entries',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True),
        sa.Column('franchise_owner_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('question', sa.String(500), nullable=False),
        sa.Column('answer', sa.Text, nullable=False),
        sa.Column('keywords', sa.Text, nullable=True),
        sa.Column('priority', sa.Integer, nullable=False, server_default='5'),
        sa.Column('hits', sa.Integer, nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_ai_knowledge_entries_tenant_id', 'ai_knowledge_entries', ['tenant_id'])
    op.create_index('ix_ai_knowledge_entries_franchise_owner_id', 'ai_knowledge_entries', ['franchise_owner_id'])
    op.create_index(
        'ix_ai_knowledge_active_priority',
        'ai_knowledge_entries',
        ['tenant_id', 'is_active', 'priority'],
    )

    # ── patient_chat_messages.source ────────────────────────────────────────
    # 'llm' — ответ через OpenAI; 'knowledge' — из FAQ; 'cache' — Redis-кэш;
    # 'fallback' — заглушка/уход к админу.
    op.add_column(
        'patient_chat_messages',
        sa.Column('source', sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('patient_chat_messages', 'source')

    op.drop_index('ix_ai_knowledge_active_priority', table_name='ai_knowledge_entries')
    op.drop_index('ix_ai_knowledge_entries_franchise_owner_id', table_name='ai_knowledge_entries')
    op.drop_index('ix_ai_knowledge_entries_tenant_id', table_name='ai_knowledge_entries')
    op.drop_table('ai_knowledge_entries')
