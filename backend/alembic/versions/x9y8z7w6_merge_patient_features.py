"""merge patient medical + vitals heads

Revision ID: x9y8z7w65432
Revises: m1n2o3p4q5r6, v1t2a3l4s5x6
Create Date: 2026-05-05
"""
from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401


revision = "x9y8z7w65432"
down_revision = ("m1n2o3p4q5r6", "v1t2a3l4s5x6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
