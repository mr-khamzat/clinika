"""franchise onboarding wizard

Revision ID: wizard1onboard1
Revises: w3notifread01
Create Date: 2026-05-07

Добавляет состояние пошагового мастера онбординга для франчайзи:
  - franchises.onboarding_done       (bool, default false)
  - franchises.onboarding_step       (int,  default 1)   — текущий шаг (1..6)
  - franchises.onboarding_data       (jsonb, default {}) — накопленные данные шагов
  - franchises.onboarding_completed_at (datetime, nullable)

Wizard состоит из 6 шагов. После завершения onboarding_done=true и
кабинет franchise_owner открывается в обычном режиме.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "wizard1onboard1"
down_revision = "w3notifread01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Флаг завершённости мастера и сопутствующее состояние
    op.add_column(
        "franchises",
        sa.Column("onboarding_done", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "franchises",
        sa.Column("onboarding_step", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "franchises",
        sa.Column("onboarding_data", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "franchises",
        sa.Column("onboarding_completed_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("franchises", "onboarding_completed_at")
    op.drop_column("franchises", "onboarding_data")
    op.drop_column("franchises", "onboarding_step")
    op.drop_column("franchises", "onboarding_done")
