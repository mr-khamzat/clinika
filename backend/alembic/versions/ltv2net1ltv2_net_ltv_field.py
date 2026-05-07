"""ltv: добавить колонку net_ltv для NetLTV (по фактическим оплатам)

Revision ID: ltv2net1ltv2
Revises: ltv1pro1ltv1
Create Date: 2026-05-07

NetLTV = avg_paid × visits_per_year × 3
где avg_paid — средняя фактическая оплата визита (из getPayments).

Если getPayments недоступен (Renovatio ещё не открыл права) — поле останется
со значением по умолчанию (0). Логика расчёта сама определит, есть ли данные.
"""
from alembic import op
import sqlalchemy as sa


revision = "ltv2net1ltv2"
down_revision = "ltv1pro1ltv1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "patient_ltv_snapshots",
        sa.Column(
            "net_ltv",
            sa.Numeric(12, 2),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("patient_ltv_snapshots", "net_ltv")
