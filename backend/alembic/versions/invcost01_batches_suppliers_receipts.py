"""Этап 1 INVENTORY_COST_PLAN: партии (батчи) FIFO, поставщики, документы приходов.

Revision ID: invcost01
Revises: director01
Create Date: 2026-05-15

Создаёт:
  • suppliers — поставщики (tenant-scoped).
  • inventory_receipts — документы приходов (накладные).
  • inventory_batches — партии товара (основа FIFO).
  • inventory_movements.batch_id — FK на партию (для трассировки списаний).
  • inventory_movements.appointment_id — FK на приём (для реверса при отмене).

Backfill:
  • Каждое существующее INCOME-движение → запись в inventory_batches.
  • OUTGOING/WRITE_OFF/EXPIRED-движения привязываются к самой ранней
    партии того же item/clinic (упрощённая первичная привязка).
  • qty_remaining партии = qty_received − Σ |delta| привязанных списаний.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "invcost01"
down_revision = "director01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─────────────────── suppliers ───────────────────
    op.create_table(
        "suppliers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("inn", sa.String(12), nullable=True),
        sa.Column("contact_person", sa.String(200), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("email", sa.String(200), nullable=True),
        sa.Column("payment_terms", sa.String(100), nullable=True),
        sa.Column("external_id", sa.String(100), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True),
                  server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True),
                  server_default=sa.text("NOW()"), nullable=False),
        sa.UniqueConstraint("tenant_id", "name", name="uq_suppliers_tenant_name"),
    )
    op.create_index("ix_suppliers_tenant", "suppliers", ["tenant_id"])

    # ─────────────────── inventory_receipts ───────────────────
    op.create_table(
        "inventory_receipts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id"), nullable=False),
        sa.Column("supplier_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("doc_number", sa.String(100), nullable=True),
        sa.Column("doc_date", sa.Date(), nullable=False),
        sa.Column("total_amount", sa.Numeric(12, 2), server_default=sa.text("0"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("attachments", postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id"), nullable=True),
        sa.Column("posted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("posted_by_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id"), nullable=True),
        sa.Column("external_id", sa.String(100), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True),
                  server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True),
                  server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("ix_receipts_tenant_date", "inventory_receipts",
                    ["tenant_id", sa.text("doc_date DESC")])

    # ─────────────────── inventory_batches ───────────────────
    op.create_table(
        "inventory_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("inventory_items.id"), nullable=False),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id"), nullable=False),
        sa.Column("receipt_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("inventory_receipts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("movement_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("inventory_movements.id", ondelete="SET NULL"), nullable=True),
        sa.Column("batch_number", sa.String(100), nullable=True),
        sa.Column("qty_received", sa.Numeric(12, 3), nullable=False),
        sa.Column("qty_remaining", sa.Numeric(12, 3), nullable=False),
        sa.Column("unit_cost", sa.Numeric(12, 2), nullable=False),
        sa.Column("received_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("expires_at", sa.Date(), nullable=True),
        sa.Column("supplier_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("external_id", sa.String(100), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True),
                  server_default=sa.text("NOW()"), nullable=False),
        sa.CheckConstraint("qty_received >= 0", name="ck_batches_qty_received_nonneg"),
        sa.CheckConstraint("qty_remaining >= 0", name="ck_batches_qty_remaining_nonneg"),
        sa.CheckConstraint("unit_cost >= 0", name="ck_batches_unit_cost_nonneg"),
    )
    # FIFO-индекс: сначала истекающие, потом по дате прихода.
    op.execute(
        "CREATE INDEX ix_batches_fifo ON inventory_batches "
        "(item_id, clinic_id, expires_at NULLS LAST, received_at) "
        "WHERE qty_remaining > 0"
    )
    op.create_index("ix_batches_tenant", "inventory_batches", ["tenant_id"])
    op.create_index("ix_batches_item", "inventory_batches", ["item_id"])

    # ─────────── inventory_movements: новые колонки ───────────
    op.add_column(
        "inventory_movements",
        sa.Column("batch_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("inventory_batches.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column(
        "inventory_movements",
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_movements_batch", "inventory_movements", ["batch_id"])
    op.create_index("ix_movements_appointment", "inventory_movements", ["appointment_id"])

    # ─────────── Backfill: INCOME-движения → партии ───────────
    op.execute("""
        INSERT INTO inventory_batches (
          id, tenant_id, item_id, clinic_id, movement_id, batch_number,
          qty_received, qty_remaining, unit_cost, received_at, expires_at
        )
        SELECT
          gen_random_uuid(),
          m.tenant_id,
          m.item_id,
          m.clinic_id,
          m.id,
          NULLIF(m.batch_number, ''),
          m.quantity,
          m.quantity,
          COALESCE(i.cost_per_unit, 0),
          m.created_at,
          m.expiry_date
        FROM inventory_movements m
        JOIN inventory_items i ON i.id = m.item_id
        WHERE m.type = 'income'
          AND m.quantity > 0
          AND NOT EXISTS (
            SELECT 1 FROM inventory_batches b WHERE b.movement_id = m.id
          );
    """)

    # ─────────── Backfill: привязать списания к самой ранней партии ───────────
    op.execute("""
        WITH ranked_batches AS (
          SELECT
            b.id, b.item_id, b.clinic_id,
            ROW_NUMBER() OVER (
              PARTITION BY b.item_id, b.clinic_id
              ORDER BY b.expires_at NULLS LAST, b.received_at
            ) AS rn
          FROM inventory_batches b
        )
        UPDATE inventory_movements m
        SET batch_id = rb.id
        FROM ranked_batches rb
        WHERE rb.item_id = m.item_id
          AND rb.clinic_id = m.clinic_id
          AND rb.rn = 1
          AND m.type IN ('outgoing', 'write_off', 'expired')
          AND m.batch_id IS NULL;
    """)

    # ─────────── Backfill: пересчитать qty_remaining по фактическим списаниям ───────────
    op.execute("""
        UPDATE inventory_batches b
        SET qty_remaining = GREATEST(
          0,
          b.qty_received - COALESCE((
            SELECT SUM(ABS(m.quantity))
            FROM inventory_movements m
            WHERE m.batch_id = b.id
              AND m.type IN ('outgoing', 'write_off', 'expired')
          ), 0)
        );
    """)


def downgrade() -> None:
    op.drop_index("ix_movements_appointment", table_name="inventory_movements")
    op.drop_index("ix_movements_batch", table_name="inventory_movements")
    op.drop_column("inventory_movements", "appointment_id")
    op.drop_column("inventory_movements", "batch_id")

    op.drop_index("ix_batches_item", table_name="inventory_batches")
    op.drop_index("ix_batches_tenant", table_name="inventory_batches")
    op.execute("DROP INDEX IF EXISTS ix_batches_fifo")
    op.drop_table("inventory_batches")

    op.drop_index("ix_receipts_tenant_date", table_name="inventory_receipts")
    op.drop_table("inventory_receipts")

    op.drop_index("ix_suppliers_tenant", table_name="suppliers")
    op.drop_table("suppliers")
