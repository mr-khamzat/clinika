"""Add doctor role and user_id to doctors table

Revision ID: g7h8i9j0k1l2
Revises: f6a7b8c9d0e1
Create Date: 2026-04-13 14:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = 'g7h8i9j0k1l2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    # Add 'doctor' to userrole enum
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'doctor'")
    
    # Add user_id FK to doctors table (nullable - not all doctors have accounts)
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = [c['name'] for c in inspector.get_columns('doctors')]
    if 'user_id' not in cols:
        op.add_column('doctors', sa.Column('user_id', sa.UUID(), nullable=True))
        op.create_foreign_key(
            'fk_doctors_user_id',
            'doctors', 'users',
            ['user_id'], ['id'],
            ondelete='SET NULL'
        )
        op.create_index('ix_doctors_user_id', 'doctors', ['user_id'], unique=True)


def downgrade():
    op.drop_index('ix_doctors_user_id', 'doctors')
    op.drop_constraint('fk_doctors_user_id', 'doctors', type_='foreignkey')
    op.drop_column('doctors', 'user_id')
