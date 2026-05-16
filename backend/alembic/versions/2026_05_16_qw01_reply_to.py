"""qw01: reply_to_id в chat_messages

Revision ID: qw01_reply_to
Revises: tel01_telephony
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'qw01_reply_to'
down_revision = 'tel01_telephony'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'chat_messages',
        sa.Column(
            'reply_to_id',
            UUID(as_uuid=True),
            sa.ForeignKey('chat_messages.id', ondelete='SET NULL'),
            nullable=True,
        ),
    )
    op.create_index(
        'ix_chat_messages_reply_to_id',
        'chat_messages',
        ['reply_to_id'],
    )


def downgrade():
    op.drop_index('ix_chat_messages_reply_to_id', table_name='chat_messages')
    op.drop_column('chat_messages', 'reply_to_id')
