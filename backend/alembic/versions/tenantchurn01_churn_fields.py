"""tenantchurn01 — churn tracking fields for tenants

Revision ID: tenantchurn01
Revises: chatslot01
Create Date: 2026-05-23

Изменения:
  Добавляет в tenants:
    - churned_at  TIMESTAMPTZ NULL (с индексом)
    - churn_reason VARCHAR(30) NULL
      enum в Python: downgrade | not_renewed | hard_delete |
                     payment_failed | voluntary

Используется фичей Churn Dashboard (/admin/churn) — см. platform-roadmap.md #2.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "tenantchurn01"
down_revision: Union[str, None] = "chatslot01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("churned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "tenants",
        sa.Column("churn_reason", sa.String(length=30), nullable=True),
    )
    op.create_index(
        "ix_tenants_churned_at",
        "tenants",
        ["churned_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_tenants_churned_at", table_name="tenants")
    op.drop_column("tenants", "churn_reason")
    op.drop_column("tenants", "churned_at")
