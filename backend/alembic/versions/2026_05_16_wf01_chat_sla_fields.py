"""wf01: chat SLA fields (auto-escalate + reassign history)"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'wf01_sla'
down_revision = 'chatqw04_color'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('chat_threads',
        sa.Column('last_inbound_message_at', sa.DateTime, nullable=True))
    op.add_column('chat_threads',
        sa.Column('sla_breached_level', sa.String(20), nullable=True))
    op.add_column('chat_threads',
        sa.Column('sla_breached_at', sa.DateTime, nullable=True))
    op.add_column('chat_threads',
        sa.Column('reassigned_history', JSONB, server_default='[]', nullable=False))
    op.create_index('ix_chat_threads_last_inbound',
        'chat_threads', ['status', 'last_inbound_message_at'])


def downgrade():
    op.drop_index('ix_chat_threads_last_inbound', table_name='chat_threads')
    op.drop_column('chat_threads', 'reassigned_history')
    op.drop_column('chat_threads', 'sla_breached_at')
    op.drop_column('chat_threads', 'sla_breached_level')
    op.drop_column('chat_threads', 'last_inbound_message_at')
