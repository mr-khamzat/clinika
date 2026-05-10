"""marketplace01 — поля для витрины модулей (screenshots / features / popular / complexity / trial)

Revision ID: marketplace01
Revises: modhealth01
Create Date: 2026-05-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "marketplace01"
down_revision = "modhealth01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Расширяем каталог commercial_modules полями для витрины (marketplace).
    op.add_column(
        "commercial_modules",
        sa.Column("screenshots", JSONB(), nullable=True, server_default="[]"),
    )
    op.add_column(
        "commercial_modules",
        sa.Column("features_list", JSONB(), nullable=True, server_default="[]"),
    )
    op.add_column(
        "commercial_modules",
        sa.Column(
            "default_trial_days",
            sa.Integer(),
            nullable=False,
            server_default="14",
        ),
    )
    op.add_column(
        "commercial_modules",
        sa.Column(
            "popular",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "commercial_modules",
        sa.Column(
            "setup_complexity",
            sa.String(16),
            nullable=False,
            server_default="easy",
        ),
    )
    op.add_column(
        "commercial_modules",
        sa.Column(
            "monthly_price_demo",
            sa.Numeric(12, 2),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("commercial_modules", "monthly_price_demo")
    op.drop_column("commercial_modules", "setup_complexity")
    op.drop_column("commercial_modules", "popular")
    op.drop_column("commercial_modules", "default_trial_days")
    op.drop_column("commercial_modules", "features_list")
    op.drop_column("commercial_modules", "screenshots")
