"""doctor_ai01 — Глава 6: Врач AI (премиум-инструменты доктора)

Revises: mgr_templates01
Create Date: 2026-05-11

Добавляет инфраструктуру премиум-инструментов для роли doctor (а также
partner_doctor и visiting_doctor — direct billing):

  • Таблица treatment_plans — структурированные планы лечения (AI/manual):
      id UUID PK
      tenant_id UUID FK
      appointment_id UUID FK NULL  — план может быть и без записи (общий)
      patient_phone VARCHAR(30)    — нормализованный телефон пациента
      doctor_id UUID FK            — врач-автор плана
      payload JSONB                — цели, этапы, назначения, диагностика…
      status VARCHAR(20)           — draft | approved | archived
      ai_provider VARCHAR(20) NULL — gemini | rule-based
      created_at, approved_at, archived_at, updated_at

  • Таблица ai_doctor_logs — телеметрия AI-вызовов (briefing/treatment):
      id UUID PK
      tenant_id UUID FK NULL
      doctor_id UUID FK NULL
      action VARCHAR(40)           — briefing | treatment_plan | …
      appointment_id UUID FK NULL
      input_tokens INT NULL
      output_tokens INT NULL
      latency_ms INT NULL
      ai_provider VARCHAR(20)      — gemini | rule-based
      success BOOLEAN
      generated_at TIMESTAMP

  • Таблица direct_bills — прямые счета (visiting/partner-doctor → пациент/клиника):
      id UUID PK
      tenant_id UUID FK
      doctor_id UUID FK
      clinic_id UUID FK NULL
      patient_phone VARCHAR(30) NULL
      appointment_id UUID FK NULL
      services JSONB               — [{name, price, qty}, …]
      subtotal NUMERIC(12,2)
      discount_pct NUMERIC(5,2)
      discount_amount NUMERIC(12,2)
      total NUMERIC(12,2)
      status VARCHAR(20)           — draft | sent | paid | cancelled
      payment_method VARCHAR(20)   — cash | card | transfer
      notes TEXT NULL
      created_at, sent_at, paid_at, cancelled_at

Индексы оптимизированы под типичные выборки.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "doctor_ai01"
down_revision = "mgr_templates01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─── treatment_plans ────────────────────────────────────────────────
    op.create_table(
        "treatment_plans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("appointment_id", UUID(as_uuid=True), sa.ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("patient_phone", sa.String(30), nullable=True),
        sa.Column("doctor_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("payload", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("ai_provider", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("approved_at", sa.DateTime, nullable=True),
        sa.Column("archived_at", sa.DateTime, nullable=True),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_treatment_plans_tenant", "treatment_plans", ["tenant_id"])
    op.create_index("ix_treatment_plans_doctor", "treatment_plans", ["doctor_id"])
    op.create_index("ix_treatment_plans_appointment", "treatment_plans", ["appointment_id"])
    op.create_index("ix_treatment_plans_status", "treatment_plans", ["status"])
    op.create_index("ix_treatment_plans_patient_phone", "treatment_plans", ["patient_phone"])

    # ─── ai_doctor_logs ─────────────────────────────────────────────────
    op.create_table(
        "ai_doctor_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("doctor_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("appointment_id", UUID(as_uuid=True), sa.ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("input_tokens", sa.Integer, nullable=True),
        sa.Column("output_tokens", sa.Integer, nullable=True),
        sa.Column("latency_ms", sa.Integer, nullable=True),
        sa.Column("ai_provider", sa.String(20), nullable=False, server_default=sa.text("'rule-based'")),
        sa.Column("success", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("generated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ai_doctor_logs_tenant", "ai_doctor_logs", ["tenant_id"])
    op.create_index("ix_ai_doctor_logs_doctor", "ai_doctor_logs", ["doctor_id"])
    op.create_index("ix_ai_doctor_logs_action", "ai_doctor_logs", ["action"])

    # ─── direct_bills ───────────────────────────────────────────────────
    op.create_table(
        "direct_bills",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("doctor_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("clinic_id", UUID(as_uuid=True), sa.ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True),
        sa.Column("patient_phone", sa.String(30), nullable=True),
        sa.Column("patient_name", sa.String(200), nullable=True),
        sa.Column("appointment_id", UUID(as_uuid=True), sa.ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("inter_clinic_invoice_id", UUID(as_uuid=True), sa.ForeignKey("inter_clinic_invoices.id", ondelete="SET NULL"), nullable=True),
        sa.Column("services", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("discount_pct", sa.Numeric(5, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("total", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("payment_method", sa.String(20), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("bill_number", sa.String(40), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("sent_at", sa.DateTime, nullable=True),
        sa.Column("paid_at", sa.DateTime, nullable=True),
        sa.Column("cancelled_at", sa.DateTime, nullable=True),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_direct_bills_tenant", "direct_bills", ["tenant_id"])
    op.create_index("ix_direct_bills_doctor", "direct_bills", ["doctor_id"])
    op.create_index("ix_direct_bills_clinic", "direct_bills", ["clinic_id"])
    op.create_index("ix_direct_bills_status", "direct_bills", ["status"])
    op.create_index("ix_direct_bills_created", "direct_bills", ["created_at"])
    op.create_index("ix_direct_bills_appointment", "direct_bills", ["appointment_id"])


def downgrade() -> None:
    op.drop_index("ix_direct_bills_appointment", table_name="direct_bills")
    op.drop_index("ix_direct_bills_created", table_name="direct_bills")
    op.drop_index("ix_direct_bills_status", table_name="direct_bills")
    op.drop_index("ix_direct_bills_clinic", table_name="direct_bills")
    op.drop_index("ix_direct_bills_doctor", table_name="direct_bills")
    op.drop_index("ix_direct_bills_tenant", table_name="direct_bills")
    op.drop_table("direct_bills")

    op.drop_index("ix_ai_doctor_logs_action", table_name="ai_doctor_logs")
    op.drop_index("ix_ai_doctor_logs_doctor", table_name="ai_doctor_logs")
    op.drop_index("ix_ai_doctor_logs_tenant", table_name="ai_doctor_logs")
    op.drop_table("ai_doctor_logs")

    op.drop_index("ix_treatment_plans_patient_phone", table_name="treatment_plans")
    op.drop_index("ix_treatment_plans_status", table_name="treatment_plans")
    op.drop_index("ix_treatment_plans_appointment", table_name="treatment_plans")
    op.drop_index("ix_treatment_plans_doctor", table_name="treatment_plans")
    op.drop_index("ix_treatment_plans_tenant", table_name="treatment_plans")
    op.drop_table("treatment_plans")
