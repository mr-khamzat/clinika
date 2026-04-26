"""add address and specialization to users"""
from alembic import op
import sqlalchemy as sa

revision = 'r0s1t2u3v4w5'
down_revision = 'q8r9s0t1u2v3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('address', sa.String(300), nullable=True))
    op.add_column('users', sa.Column('specialization', sa.String(100), nullable=True))


def downgrade():
    op.drop_column('users', 'address')
    op.drop_column('users', 'specialization')
