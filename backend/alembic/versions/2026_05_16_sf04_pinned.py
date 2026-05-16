"""sf04: pinned_at + pinned_by_user_id на staff_chat_messages"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'sf04_pinned'
down_revision = 'sf03_mentions'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('staff_chat_messages',
        sa.Column('pinned_at', sa.DateTime, nullable=True))
    op.add_column('staff_chat_messages',
        sa.Column('pinned_by_user_id', UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))
    op.create_index('ix_sf_messages_pinned', 'staff_chat_messages',
        ['room_id', 'pinned_at'])


def downgrade():
    op.drop_index('ix_sf_messages_pinned', table_name='staff_chat_messages')
    op.drop_column('staff_chat_messages', 'pinned_by_user_id')
    op.drop_column('staff_chat_messages', 'pinned_at')
