"""accountant cabinet — spendings (clinic expenses)

Revision ID: acct02_spendings
Revises: acct01_cashshift
Create Date: 2026-05-18

Создаёт таблицу spendings — расходы клиники для модуля бухгалтерии
(аренда, лаборатория, материалы, маркетинг, коммуналка, прочее).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'acct02_spendings'
down_revision = 'acct01_cashshift'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "spendings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("clinic_id", UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("paid_at", sa.Date, nullable=True),
        sa.Column("due_date", sa.Date, nullable=True),
        sa.Column("is_recurring", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_by_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_spendings_tenant", "spendings", ["tenant_id"])
    op.create_index("ix_spendings_clinic", "spendings", ["clinic_id"])
    op.create_index("ix_spendings_category", "spendings", ["category"])


def downgrade():
    op.drop_index("ix_spendings_category", table_name="spendings")
    op.drop_index("ix_spendings_clinic", table_name="spendings")
    op.drop_index("ix_spendings_tenant", table_name="spendings")
    op.drop_table("spendings")
