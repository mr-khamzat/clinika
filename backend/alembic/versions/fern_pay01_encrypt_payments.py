"""Encrypt payment secrets via Fernet

Revision ID: fern_pay01
Revises: npssurvey01
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa


revision = 'fern_pay01'
down_revision = 'npssurvey01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Таблицы payment_gateway_configs и ofd_configs пустые (проверено вручную).
    # Просто переименовываем колонки в *_encrypted.
    op.alter_column('payment_gateway_configs', 'secret_key',
                    new_column_name='secret_key_encrypted')
    op.alter_column('ofd_configs', 'api_key',
                    new_column_name='api_key_encrypted')


def downgrade() -> None:
    op.alter_column('payment_gateway_configs', 'secret_key_encrypted',
                    new_column_name='secret_key')
    op.alter_column('ofd_configs', 'api_key_encrypted',
                    new_column_name='api_key')
