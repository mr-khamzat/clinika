"""sf03: mentioned_user_ids на staff_chat_messages"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'sf03_mentions'
down_revision = 'sf02_reactions'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('staff_chat_messages',
        sa.Column('mentioned_user_ids', JSONB, server_default='[]', nullable=False))


def downgrade():
    op.drop_column('staff_chat_messages', 'mentioned_user_ids')
