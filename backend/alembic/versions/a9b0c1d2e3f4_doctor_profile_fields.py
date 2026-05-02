"""doctor_profile_fields — experience_years + education

Revision ID: a9b0c1d2e3f4
Revises: z8a9b0c1d2e3
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa

revision = 'a9b0c1d2e3f4'
down_revision = 'z8a9b0c1d2e3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('doctors', sa.Column('experience_years', sa.Integer, nullable=True))
    op.add_column('doctors', sa.Column('education', sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column('doctors', 'education')
    op.drop_column('doctors', 'experience_years')
