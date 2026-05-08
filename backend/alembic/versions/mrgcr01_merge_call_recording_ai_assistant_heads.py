"""merge call_recording + ai_assistant heads

Revision ID: mrgcr01
Revises: callrec01, aiasst01
Create Date: 2026-05-08 06:32:53.148708

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'mrgcr01'
down_revision: Union[str, None] = ('callrec01', 'aiasst01')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
