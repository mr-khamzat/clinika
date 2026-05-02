"""billing_acts

Revision ID: u3v4w5x6y7z8
Revises: t2u3v4w5x6y7
Create Date: 2026-05-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "u3v4w5x6y7z8"
down_revision = "t2u3v4w5x6y7"
branch_labels = None
depends_on = None


def upgrade():
    # Extend invoices table for B2B acts
    op.add_column("invoices", sa.Column("act_number", sa.String(50), nullable=True))
    op.add_column("invoices", sa.Column("act_status", sa.String(30), nullable=False, server_default="draft"))
    op.add_column("invoices", sa.Column("act_type", sa.String(30), nullable=False, server_default="subscription"))
    op.add_column("invoices", sa.Column("signed_at", sa.DateTime(), nullable=True))
    op.add_column("invoices", sa.Column("signer_name", sa.String(200), nullable=True))
    op.add_column("invoices", sa.Column("signer_ip", sa.String(45), nullable=True))
    op.add_column("invoices", sa.Column("act_pdf_path", sa.String(500), nullable=True))
    op.add_column("invoices", sa.Column("act_line_items", JSONB(), nullable=True, server_default="[]"))
    op.add_column("invoices", sa.Column("subtotal", sa.Numeric(14, 2), nullable=True))
    op.add_column("invoices", sa.Column("tax_rate", sa.Numeric(5, 2), nullable=True, server_default="0"))
    op.add_column("invoices", sa.Column("tax_amount", sa.Numeric(14, 2), nullable=True, server_default="0"))
    op.add_column("invoices", sa.Column("total", sa.Numeric(14, 2), nullable=True))
    op.add_column("invoices", sa.Column("legal_entity_name", sa.String(300), nullable=True))
    op.add_column("invoices", sa.Column("legal_entity_inn", sa.String(20), nullable=True))
    op.add_column("invoices", sa.Column("legal_address", sa.String(500), nullable=True))
    op.add_column("invoices", sa.Column("overdue_notified_at", sa.DateTime(), nullable=True))
    op.add_column("invoices", sa.Column("soft_lock_applied_at", sa.DateTime(), nullable=True))
    op.create_index("ix_invoices_act_number", "invoices", ["act_number"])
    op.create_index("ix_invoices_act_status", "invoices", ["act_status"])


def downgrade():
    op.drop_index("ix_invoices_act_status", table_name="invoices")
    op.drop_index("ix_invoices_act_number", table_name="invoices")
    for col in ["act_number","act_status","act_type","signed_at","signer_name","signer_ip",
                "act_pdf_path","act_line_items","subtotal","tax_rate","tax_amount","total",
                "legal_entity_name","legal_entity_inn","legal_address","overdue_notified_at",
                "soft_lock_applied_at"]:
        op.drop_column("invoices", col)
