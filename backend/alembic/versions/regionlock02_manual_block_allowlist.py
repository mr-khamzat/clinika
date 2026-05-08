"""region lock Phase 2 v2 — manual block + IP allowlist

Revision ID: regionlock02
Revises: inventory01
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'regionlock02'
down_revision = 'inventory01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Manual Block — поля для ручной блокировки франшизы ────────────────────
    # Только владелец платформы (super_admin) выставляет вручную из UI.
    # Никакой автоматики — не зависит от региона.
    op.add_column(
        'franchises',
        sa.Column('is_blocked', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column('franchises', sa.Column('blocked_until', sa.DateTime(), nullable=True))
    op.add_column('franchises', sa.Column('block_reason', sa.Text(), nullable=True))
    op.add_column(
        'franchises',
        sa.Column('blocked_by', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column('franchises', sa.Column('blocked_at', sa.DateTime(), nullable=True))
    op.create_foreign_key(
        'fk_franchises_blocked_by_users',
        'franchises', 'users',
        ['blocked_by'], ['id'],
        ondelete='SET NULL',
    )

    # ── IP allowlist — bypass для Region Lock ────────────────────────────────
    op.create_table(
        'franchise_ip_allowlist',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('franchise_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('ip_cidr', postgresql.INET(), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column(
            'bypass_block', sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(),
            server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False,
        ),
        sa.ForeignKeyConstraint(['franchise_id'], ['franchises.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index(
        'ix_franchise_ip_allowlist_franchise',
        'franchise_ip_allowlist',
        ['franchise_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_franchise_ip_allowlist_franchise', table_name='franchise_ip_allowlist')
    op.drop_table('franchise_ip_allowlist')
    op.drop_constraint('fk_franchises_blocked_by_users', 'franchises', type_='foreignkey')
    op.drop_column('franchises', 'blocked_at')
    op.drop_column('franchises', 'blocked_by')
    op.drop_column('franchises', 'block_reason')
    op.drop_column('franchises', 'blocked_until')
    op.drop_column('franchises', 'is_blocked')
