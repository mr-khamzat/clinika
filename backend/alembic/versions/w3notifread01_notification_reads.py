"""notification_reads — отметки прочитанности уведомлений (W3 UX)

Revision ID: w3notifread01
Revises: cleanup1plugin1
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'w3notifread01'
down_revision = 'cleanup1plugin1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'notification_reads',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('source_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('user_id', 'kind', 'source_id', name='uq_notif_read'),
    )


def downgrade() -> None:
    op.drop_table('notification_reads')
