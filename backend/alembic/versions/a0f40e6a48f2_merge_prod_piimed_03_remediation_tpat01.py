"""merge prod(piimed_03)+remediation(tpat01)

Revision ID: a0f40e6a48f2
Revises: piimed_03, tpat01
Create Date: 2026-06-09 06:35:13.114828

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'a0f40e6a48f2'
down_revision: Union[str, None] = ('piimed_03', 'tpat01')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
