"""sf01: description на staff_chat_rooms"""
from alembic import op
import sqlalchemy as sa

revision = 'sf01_channels'
down_revision = 'wf03_templates'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('staff_chat_rooms',
        sa.Column('description', sa.Text, nullable=True))


def downgrade():
    op.drop_column('staff_chat_rooms', 'description')
