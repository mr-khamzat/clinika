"""payment_foundation: каркас интернет-эквайринга и 54-ФЗ ОФД

Revision ID: pay1ment1foundation
Revises: ltv2net1ltv2
Create Date: 2026-05-07

Создаёт таблицы для модулей online_payments_pro и fiscal_54fz_pro:
  - clinic_payments         — платежи пациентов клиник (через шлюзы)
  - payment_gateway_configs — конфиг шлюзов (Юкасса/Т-Банк/...) на клинику
  - fiscal_receipts         — фискальные чеки 54-ФЗ из ОФД
  - ofd_configs             — конфиги ОФД-провайдеров (Платформа/Первый/...)

Реальные адаптеры подключаются позже (по одному файлу на провайдера).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "pay1ment1foundation"
down_revision = "ltv2net1ltv2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── clinic_payments ──────────────────────────────────────────────────────
    op.create_table(
        "clinic_payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("appointments.id", ondelete="SET NULL"),
                  nullable=True, index=True),
        sa.Column("patient_phone", sa.String(32), nullable=False),
        sa.Column("patient_name", sa.String(255), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("gateway", sa.String(40), nullable=False),
        sa.Column("gateway_payment_id", sa.String(255), nullable=True, index=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending", index=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("return_url", sa.String(500), nullable=True),
        sa.Column("payment_metadata", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("paid_at", sa.DateTime, nullable=True),
        sa.Column("refunded_at", sa.DateTime, nullable=True),
    )

    # ── payment_gateway_configs ──────────────────────────────────────────────
    op.create_table(
        "payment_gateway_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("gateway", sa.String(40), nullable=False),
        sa.Column("shop_id", sa.String(255), nullable=False),
        sa.Column("secret_key", sa.Text, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("is_test_mode", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("config", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("clinic_id", "gateway", name="uq_clinic_gateway"),
    )

    # ── fiscal_receipts ──────────────────────────────────────────────────────
    op.create_table(
        "fiscal_receipts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("appointments.id", ondelete="SET NULL"),
                  nullable=True, index=True),
        sa.Column("payment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinic_payments.id", ondelete="SET NULL"),
                  nullable=True, index=True),
        sa.Column("inn", sa.String(20), nullable=False, index=True),
        sa.Column("operation_type", sa.String(40), nullable=False),
        sa.Column("total_sum", sa.Numeric(12, 2), nullable=False),
        sa.Column("qr_code", sa.Text, nullable=True),
        sa.Column("fiscal_doc_number", sa.String(40), nullable=True, index=True),
        sa.Column("fiscal_storage_number", sa.String(40), nullable=True, index=True),
        sa.Column("fiscal_sign", sa.String(40), nullable=True),
        sa.Column("receipt_at", sa.DateTime, nullable=True),
        sa.Column("raw_payload", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("ofd_provider", sa.String(40), nullable=False),
        sa.Column("received_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # ── ofd_configs ──────────────────────────────────────────────────────────
    op.create_table(
        "ofd_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("inn", sa.String(20), nullable=False),
        sa.Column("api_key", sa.Text, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("last_pulled_at", sa.DateTime, nullable=True),
        sa.Column("config", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("clinic_id", name="uq_ofd_config_clinic"),
    )


def downgrade() -> None:
    op.drop_table("ofd_configs")
    op.drop_table("fiscal_receipts")
    op.drop_table("payment_gateway_configs")
    op.drop_table("clinic_payments")
