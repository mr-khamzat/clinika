"""call_rules per-clinic

Revision ID: w9x0y1z2a3b4
Revises: v8w9x0y1z2a3
Create Date: 2026-05-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "w9x0y1z2a3b4"
down_revision = "v8w9x0y1z2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("call_rules", sa.Column("from_clinic_id", UUID(as_uuid=True),
        sa.ForeignKey("clinics.id", ondelete="CASCADE"), nullable=True, index=True))
    op.add_column("call_rules", sa.Column("to_clinic_id", UUID(as_uuid=True),
        sa.ForeignKey("clinics.id", ondelete="CASCADE"), nullable=True, index=True))
    # Новый unique с клиниками — чтобы можно было иметь правило без клиник + правила с клиниками
    op.drop_constraint("uq_call_rule", "call_rules", type_="unique")
    op.create_unique_constraint(
        "uq_call_rule",
        "call_rules",
        ["tenant_id", "from_role", "to_role", "scope", "from_clinic_id", "to_clinic_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_call_rule", "call_rules", type_="unique")
    op.create_unique_constraint(
        "uq_call_rule",
        "call_rules",
        ["tenant_id", "from_role", "to_role", "scope"],
    )
    op.drop_column("call_rules", "to_clinic_id")
    op.drop_column("call_rules", "from_clinic_id")
