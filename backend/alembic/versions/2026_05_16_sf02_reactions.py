"""sf02: staff_chat_message_reactions"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'sf02_reactions'
down_revision = 'sf01_channels'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('staff_chat_message_reactions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('message_id', UUID(as_uuid=True),
            sa.ForeignKey('staff_chat_messages.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('emoji', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_sf_reactions_unique',
        'staff_chat_message_reactions',
        ['message_id', 'user_id', 'emoji'], unique=True)


def downgrade():
    op.drop_index('ix_sf_reactions_unique', table_name='staff_chat_message_reactions')
    op.drop_table('staff_chat_message_reactions')
