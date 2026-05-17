"""Merge heads: miswebhook01 + pendingsubs01.

Revision ID: mergeheads01
Revises: miswebhook01, pendingsubs01
Create Date: 2026-05-15

Технический merge двух параллельных веток, разошедшихся от invcost0203:
  • миграции пересечения подписок (pendingsubs01),
  • миграции категорных скидок и MIS-вебхуков (discountrules01 → miswebhook01).
"""
from alembic import op  # noqa: F401


revision = "mergeheads01"
down_revision = ("miswebhook01", "pendingsubs01")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
