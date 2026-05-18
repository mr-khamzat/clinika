"""mis_payment_imports — дедупликация платежей из МИС

Revision ID: acct05_mis_pay_imports
Revises: acct04_lab_roles
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'acct05_mis_pay_imports'
down_revision = 'acct04_lab_roles'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "mis_payment_imports",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("clinic_id", UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("mis_clinic_id", sa.Integer, nullable=False),
        sa.Column("mis_payment_id", sa.String(64), nullable=False),
        sa.Column("mis_invoice_id", sa.String(64), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("method", sa.String(20), nullable=False),
        sa.Column("paid_at", sa.DateTime, nullable=False),
        sa.Column("shift_entry_id", UUID(as_uuid=True),
                  sa.ForeignKey("cash_shift_entries.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("ledger_entry_id", UUID(as_uuid=True),
                  sa.ForeignKey("ledger_entries.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("imported_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_mis_payment_imports_tenant", "mis_payment_imports", ["tenant_id"])
    op.create_index("ix_mis_payment_imports_clinic", "mis_payment_imports", ["clinic_id"])
    op.create_unique_constraint(
        "uq_mis_payment_unique", "mis_payment_imports", ["mis_clinic_id", "mis_payment_id"]
    )


def downgrade():
    op.drop_constraint("uq_mis_payment_unique", "mis_payment_imports", type_="unique")
    op.drop_index("ix_mis_payment_imports_clinic", table_name="mis_payment_imports")
    op.drop_index("ix_mis_payment_imports_tenant", table_name="mis_payment_imports")
    op.drop_table("mis_payment_imports")
