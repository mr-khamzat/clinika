"""Encrypt safe PII (no-LIKE-search): users.address, signup_requests.full_name

Revision ID: piimed_02
Revises: piimed_01
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa


revision = 'piimed_02'
down_revision = 'piimed_01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('users', 'address', new_column_name='address_encrypted', type_=sa.Text())
    op.alter_column('signup_requests', 'full_name', new_column_name='full_name_encrypted', type_=sa.Text())

    for tbl, col in [
        ('users', 'address_encrypted'),
        ('signup_requests', 'full_name_encrypted'),
    ]:
        op.execute(
            f"UPDATE {tbl} SET {col} = 'plain:' || {col} "
            f"WHERE {col} IS NOT NULL AND {col} != '' "
            f"AND {col} NOT LIKE 'enc:%' AND {col} NOT LIKE 'plain:%'"
        )


def downgrade() -> None:
    for tbl, col in [
        ('users', 'address_encrypted'),
        ('signup_requests', 'full_name_encrypted'),
    ]:
        op.execute(f"UPDATE {tbl} SET {col} = SUBSTRING({col} FROM 7) WHERE {col} LIKE 'plain:%'")

    op.alter_column('signup_requests', 'full_name_encrypted', new_column_name='full_name', type_=sa.String(200))
    op.alter_column('users', 'address_encrypted', new_column_name='address', type_=sa.String(300))
