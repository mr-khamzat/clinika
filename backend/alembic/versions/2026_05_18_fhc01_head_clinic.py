"""fhc01: is_head_clinic флаг на tenants — для пометки головной клиники сети

Revision ID: fhc01_head_clinic
Revises: acct05_mis_pay_imports
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa


revision = "fhc01_head_clinic"
down_revision = "acct05_mis_pay_imports"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "tenants",
        sa.Column("is_head_clinic", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("ix_tenants_is_head_clinic", "tenants", ["is_head_clinic"])

    # Назначим автоматически head для каждой франшизы — самый первый по created_at,
    # ИЛИ тенант чей slug содержит 'head' (для существующей АРЦ-сети с slug=arc-head).
    op.execute("""
        UPDATE tenants t SET is_head_clinic = true
        WHERE t.id IN (
            SELECT DISTINCT ON (franchise_id) id
            FROM tenants
            WHERE franchise_id IS NOT NULL
            ORDER BY franchise_id, (slug LIKE '%head%') DESC, created_at ASC
        )
    """)


def downgrade():
    op.drop_index("ix_tenants_is_head_clinic", table_name="tenants")
    op.drop_column("tenants", "is_head_clinic")
