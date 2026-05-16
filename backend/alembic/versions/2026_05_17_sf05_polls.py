"""sf05: polls в StaffChat (staff_chat_polls + staff_chat_poll_votes)

Revision ID: sf05_polls
Revises: qw01_reply_to
Create Date: 2026-05-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = 'sf05_polls'
down_revision = 'qw01_reply_to'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'staff_chat_polls',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'message_id', UUID(as_uuid=True),
            sa.ForeignKey('staff_chat_messages.id', ondelete='CASCADE'),
            nullable=False, unique=True,
        ),
        sa.Column(
            'room_id', UUID(as_uuid=True),
            sa.ForeignKey('staff_chat_rooms.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'creator_id', UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('question', sa.String(500), nullable=False),
        sa.Column('options', JSONB, nullable=False),
        sa.Column('multi_select', sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column('closes_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_staff_chat_polls_room', 'staff_chat_polls', ['room_id'])
    op.create_index('ix_staff_chat_polls_message', 'staff_chat_polls', ['message_id'])

    op.create_table(
        'staff_chat_poll_votes',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'poll_id', UUID(as_uuid=True),
            sa.ForeignKey('staff_chat_polls.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'user_id', UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('option_index', sa.Integer, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('poll_id', 'user_id', 'option_index', name='uq_poll_vote_user_option'),
    )
    op.create_index('ix_staff_chat_poll_votes_poll', 'staff_chat_poll_votes', ['poll_id'])
    op.create_index('ix_staff_chat_poll_votes_user', 'staff_chat_poll_votes', ['user_id'])


def downgrade():
    op.drop_index('ix_staff_chat_poll_votes_user', table_name='staff_chat_poll_votes')
    op.drop_index('ix_staff_chat_poll_votes_poll', table_name='staff_chat_poll_votes')
    op.drop_table('staff_chat_poll_votes')
    op.drop_index('ix_staff_chat_polls_message', table_name='staff_chat_polls')
    op.drop_index('ix_staff_chat_polls_room', table_name='staff_chat_polls')
    op.drop_table('staff_chat_polls')
