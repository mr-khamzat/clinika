"""contact_requests table"""
revision = 'a0b1c2d3e4f5'
down_revision = 'a9b0c1d2e3f4'
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

def upgrade():
    op.create_table('contact_requests',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.String(200), nullable=True),
        sa.Column('phone', sa.String(50), nullable=False),
        sa.Column('email', sa.String(200), nullable=True),
        sa.Column('message', sa.Text, nullable=False),
        sa.Column('is_read', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime, server_default=sa.text('now()')),
    )

def downgrade():
    op.drop_table('contact_requests')
