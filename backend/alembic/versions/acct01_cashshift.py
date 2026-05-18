"""accountant cabinet — cash shifts + entries

Revision ID: acct01_cashshift
Revises: ce01_patient_engagement
Create Date: 2026-05-18

Создаёт таблицы для кассовых смен бухгалтерии (cash_shifts и cash_shift_entries).
Гарантирует, что enum userrole содержит 'accountant' (на случай если ранняя
миграция v4w5x6y7z8a9 не была применена в этой среде).

Инвариант «одна открытая смена на клинику» реализован partial unique index'ом:
    UNIQUE (clinic_id) WHERE status = 'open'.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'acct01_cashshift'
down_revision = 'ce01_patient_engagement'
branch_labels = None
depends_on = None


def upgrade():
    # 1) Гарантия enum-значения. ADD VALUE IF NOT EXISTS не падает, если уже есть.
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'accountant'")

    # 2) cash_shifts
    op.create_table(
        "cash_shifts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("clinic_id", UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("opened_by_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("opened_at", sa.DateTime, nullable=False),
        sa.Column("cash_start", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("closed_by_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("closed_at", sa.DateTime, nullable=True),
        sa.Column("cash_end_actual", sa.Numeric(12, 2), nullable=True),
        sa.Column("cash_end_expected", sa.Numeric(12, 2), nullable=True),
        sa.Column("discrepancy", sa.Numeric(12, 2), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_cash_shifts_tenant", "cash_shifts", ["tenant_id"])
    op.create_index("ix_cash_shifts_clinic", "cash_shifts", ["clinic_id"])
    op.create_index("ix_cash_shifts_status", "cash_shifts", ["status"])
    op.create_index("ix_cash_shifts_opened_at", "cash_shifts", ["opened_at"])
    # Инвариант: одна открытая смена на клинику.
    op.execute(
        "CREATE UNIQUE INDEX uq_cash_shifts_one_open_per_clinic "
        "ON cash_shifts (clinic_id) WHERE status = 'open'"
    )

    # 3) cash_shift_entries
    op.create_table(
        "cash_shift_entries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("shift_id", UUID(as_uuid=True),
                  sa.ForeignKey("cash_shifts.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("direction", sa.String(10), nullable=False),   # in | out
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("reference_type", sa.String(40), nullable=True),
        sa.Column("reference_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_cash_shift_entries_shift", "cash_shift_entries", ["shift_id"])
    op.create_index("ix_cash_shift_entries_category", "cash_shift_entries", ["category"])


def downgrade():
    op.drop_index("ix_cash_shift_entries_category", table_name="cash_shift_entries")
    op.drop_index("ix_cash_shift_entries_shift", table_name="cash_shift_entries")
    op.drop_table("cash_shift_entries")

    op.execute("DROP INDEX IF EXISTS uq_cash_shifts_one_open_per_clinic")
    op.drop_index("ix_cash_shifts_opened_at", table_name="cash_shifts")
    op.drop_index("ix_cash_shifts_status", table_name="cash_shifts")
    op.drop_index("ix_cash_shifts_clinic", table_name="cash_shifts")
    op.drop_index("ix_cash_shifts_tenant", table_name="cash_shifts")
    op.drop_table("cash_shifts")
    # enum value не откатываем (Postgres не поддерживает DROP VALUE без пересоздания типа).
