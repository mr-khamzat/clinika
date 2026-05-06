"""tenant mis clinic ids

Revision ID: a2b3c4d5e6f7
Revises: x9y8z7w65432
Create Date: 2026-05-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "a2b3c4d5e6f7"
down_revision = "x9y8z7w65432"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Добавляем колонку для per-tenant списка МИС clinic_id
    op.add_column(
        "tenants",
        sa.Column("mis_clinic_ids", JSONB(), nullable=True),
    )
    # Заполняем для единственного боевого тенанта arc прежними хардкод-значениями {1, 4, 26}
    op.execute(
        "UPDATE tenants SET mis_clinic_ids = '[1, 4, 26]'::jsonb WHERE slug = 'arc'"
    )


def downgrade() -> None:
    op.drop_column("tenants", "mis_clinic_ids")
