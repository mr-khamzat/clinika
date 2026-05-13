"""franchisebonusfee01 — Поле fee_per_bonus_from_clinic + ledger-entries."""
from alembic import op
import sqlalchemy as sa


revision = "franchisebonusfee01"
down_revision = "franchisemodules01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "franchises",
        sa.Column("fee_per_bonus_from_clinic", sa.Numeric(12, 2),
                  nullable=False, server_default="100"),
    )


def downgrade() -> None:
    op.drop_column("franchises", "fee_per_bonus_from_clinic")
