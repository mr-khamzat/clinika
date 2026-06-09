"""merge_slothold_chatpromo

Revision ID: ddbe13b8a531
Revises: chatpromo01, slothold01
Create Date: 2026-05-24 06:03:12.503100

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'ddbe13b8a531'
down_revision: Union[str, None] = ('chatpromo01', 'slothold01')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
