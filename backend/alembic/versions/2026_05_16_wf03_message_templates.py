"""wf03: message_templates таблица"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'wf03_templates'
down_revision = 'wf02_tenant_settings'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('message_templates',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('created_by_user_id', UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('shortcut', sa.String(50), nullable=False),
        sa.Column('title', sa.String(100), nullable=False),
        sa.Column('body', sa.Text, nullable=False),
        sa.Column('category', sa.String(50), nullable=True),
        sa.Column('usage_count', sa.Integer, server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    # Уникальность shortcut в пределах tenant+автор (NULL = общий для всех)
    op.create_index('ix_message_templates_tenant_shortcut',
        'message_templates', ['tenant_id', 'created_by_user_id', 'shortcut'],
        unique=True)


def downgrade():
    op.drop_index('ix_message_templates_tenant_shortcut', table_name='message_templates')
    op.drop_table('message_templates')
