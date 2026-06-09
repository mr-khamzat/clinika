"""arrltv01 — mrr_history snapshot table (optional)

Зачем нужна:
  Сейчас admin_arr_ltv считает MRR/ARR on-the-fly через агрегации подписок.
  Это OK для нескольких сотен тенантов. Если объём вырастет, можно ежедневно
  записывать снимок в mrr_history и брать тренд из готовой таблицы за миллисекунды.

Безопасно к параллельному tenanthealth01: down_revision указывает на
tenanthealth01 (создаётся параллельным агентом). Если на момент применения
этой миграции tenanthealth01 ещё не существует — нужно вручную поменять
down_revision на 'featflag01'.

Revision ID: arrltv01
Revises: tenanthealth01
Create Date: 2026-05-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "arrltv01"
down_revision = "tenanthealth01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mrr_history",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        # Период — первый день месяца (для уникальности и сортировки).
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("mrr_rub", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("arr_rub", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("active_tenants", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("new_tenants", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("churned_tenants", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "captured_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("period", name="uq_mrr_history_period"),
    )
    op.create_index("ix_mrr_history_period", "mrr_history", ["period"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_mrr_history_period", table_name="mrr_history")
    op.drop_table("mrr_history")
