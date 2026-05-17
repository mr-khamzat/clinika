"""Этапы 2-3 INVENTORY_COST_PLAN: нормативы услуг + кеш себестоимости приёма.

Revision ID: invcost0203
Revises: marketingads01
Create Date: 2026-05-15

Создаёт:
  • service_consumables — нормативы расходников на услугу
    (service_id × item_id → quantity).
  • appointment_costs — кешированная себестоимость приёма
    (materials_cost + labor_cost + overhead_cost; revenue + margin
    как generated-колонки).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "invcost0203"
down_revision = "marketingads01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─────────────────── service_consumables ───────────────────
    op.create_table(
        "service_consumables",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "service_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("services.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "item_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("inventory_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Numeric(12, 3), nullable=False),
        sa.Column(
            "is_optional", sa.Boolean(),
            nullable=False, server_default=sa.text("false"),
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True),
            server_default=sa.text("NOW()"), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True),
            server_default=sa.text("NOW()"), nullable=False,
        ),
        sa.CheckConstraint("quantity > 0", name="ck_service_consumables_qty_positive"),
        sa.UniqueConstraint(
            "service_id", "item_id",
            name="uq_service_consumables_service_item",
        ),
    )
    op.create_index(
        "ix_service_consumables_service",
        "service_consumables", ["service_id"],
    )
    op.create_index(
        "ix_service_consumables_tenant",
        "service_consumables", ["tenant_id"],
    )

    # ─────────────────── appointment_costs ───────────────────
    op.create_table(
        "appointment_costs",
        sa.Column(
            "appointment_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("appointments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tenant_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "materials_cost", sa.Numeric(12, 2),
            nullable=False, server_default=sa.text("0"),
        ),
        sa.Column(
            "labor_cost", sa.Numeric(12, 2),
            nullable=False, server_default=sa.text("0"),
        ),
        sa.Column(
            "overhead_cost", sa.Numeric(12, 2),
            nullable=False, server_default=sa.text("0"),
        ),
        sa.Column(
            "total_cost", sa.Numeric(12, 2),
            sa.Computed(
                "materials_cost + labor_cost + overhead_cost",
                persisted=True,
            ),
            nullable=True,
        ),
        sa.Column(
            "revenue", sa.Numeric(12, 2),
            nullable=False, server_default=sa.text("0"),
        ),
        sa.Column(
            "margin", sa.Numeric(12, 2),
            sa.Computed(
                "revenue - materials_cost - labor_cost - overhead_cost",
                persisted=True,
            ),
            nullable=True,
        ),
        sa.Column("margin_pct", sa.Numeric(8, 2), nullable=True),
        sa.Column(
            "calculated_at", sa.TIMESTAMP(timezone=True),
            server_default=sa.text("NOW()"), nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_appointment_costs_tenant",
        "appointment_costs", ["tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_appointment_costs_tenant", table_name="appointment_costs")
    op.drop_table("appointment_costs")
    op.drop_index("ix_service_consumables_tenant", table_name="service_consumables")
    op.drop_index("ix_service_consumables_service", table_name="service_consumables")
    op.drop_table("service_consumables")
