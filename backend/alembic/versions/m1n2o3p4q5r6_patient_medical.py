"""patient medical: medcard (diagnoses/allergies/vaccinations), documents, prescription cache

Revision ID: m1n2o3p4q5r6
Revises: w9x0y1z2a3b4
Create Date: 2026-05-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "m1n2o3p4q5r6"
down_revision = "w9x0y1z2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Диагнозы ──────────────────────────────────────────────────────────
    op.create_table(
        "patient_diagnoses",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("patient_phone", sa.String(30), nullable=False),
        sa.Column("icd10_code", sa.String(20), nullable=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("diagnosed_at", sa.DateTime, nullable=True),
        sa.Column("is_chronic", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("doctor_name", sa.String(200), nullable=True),
        sa.Column("source", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_patient_diagnoses_tenant_id", "patient_diagnoses", ["tenant_id"])
    op.create_index("ix_patient_diagnoses_patient_phone", "patient_diagnoses", ["patient_phone"])

    # ── Аллергии ──────────────────────────────────────────────────────────
    op.create_table(
        "patient_allergies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("patient_phone", sa.String(30), nullable=False),
        sa.Column("allergen", sa.String(200), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False, server_default="mild"),
        sa.Column("reaction", sa.Text, nullable=True),
        sa.Column("noted_at", sa.DateTime, nullable=True),
        sa.Column("source", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_patient_allergies_tenant_id", "patient_allergies", ["tenant_id"])
    op.create_index("ix_patient_allergies_patient_phone", "patient_allergies", ["patient_phone"])

    # ── Прививки ──────────────────────────────────────────────────────────
    op.create_table(
        "patient_vaccinations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("patient_phone", sa.String(30), nullable=False),
        sa.Column("vaccine_name", sa.String(200), nullable=False),
        sa.Column("given_at", sa.DateTime, nullable=True),
        sa.Column("dose_number", sa.Integer, nullable=True),
        sa.Column("expires_at", sa.DateTime, nullable=True),
        sa.Column("batch_number", sa.String(100), nullable=True),
        sa.Column("doctor_name", sa.String(200), nullable=True),
        sa.Column("source", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_patient_vaccinations_tenant_id", "patient_vaccinations", ["tenant_id"])
    op.create_index("ix_patient_vaccinations_patient_phone", "patient_vaccinations", ["patient_phone"])

    # ── Документы пациента ────────────────────────────────────────────────
    op.create_table(
        "patient_documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("patient_phone", sa.String(30), nullable=False),
        sa.Column("filename", sa.String(300), nullable=False),
        sa.Column("mime", sa.String(100), nullable=True),
        sa.Column("size_bytes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("doc_type", sa.String(30), nullable=False, server_default="other"),
        sa.Column("uploaded_by_user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("issued_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_patient_documents_tenant_id", "patient_documents", ["tenant_id"])
    op.create_index("ix_patient_documents_patient_phone", "patient_documents", ["patient_phone"])

    # ── Кэш назначений из МИС ─────────────────────────────────────────────
    op.create_table(
        "patient_prescription_cache",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("patient_phone", sa.String(30), nullable=False),
        sa.Column("mis_id", sa.String(100), nullable=True),
        sa.Column("drug_name", sa.String(300), nullable=False),
        sa.Column("dosage", sa.String(200), nullable=True),
        sa.Column("frequency", sa.String(200), nullable=True),
        sa.Column("duration", sa.String(100), nullable=True),
        sa.Column("prescribed_at", sa.DateTime, nullable=True),
        sa.Column("doctor_name", sa.String(200), nullable=True),
        sa.Column("raw_json", JSONB, nullable=True),
        sa.Column("cached_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_patient_prescription_cache_tenant_id", "patient_prescription_cache", ["tenant_id"])
    op.create_index("ix_patient_prescription_cache_patient_phone", "patient_prescription_cache", ["patient_phone"])
    op.create_index("ix_patient_prescription_cache_mis_id", "patient_prescription_cache", ["mis_id"])


def downgrade() -> None:
    op.drop_index("ix_patient_prescription_cache_mis_id", table_name="patient_prescription_cache")
    op.drop_index("ix_patient_prescription_cache_patient_phone", table_name="patient_prescription_cache")
    op.drop_index("ix_patient_prescription_cache_tenant_id", table_name="patient_prescription_cache")
    op.drop_table("patient_prescription_cache")

    op.drop_index("ix_patient_documents_patient_phone", table_name="patient_documents")
    op.drop_index("ix_patient_documents_tenant_id", table_name="patient_documents")
    op.drop_table("patient_documents")

    op.drop_index("ix_patient_vaccinations_patient_phone", table_name="patient_vaccinations")
    op.drop_index("ix_patient_vaccinations_tenant_id", table_name="patient_vaccinations")
    op.drop_table("patient_vaccinations")

    op.drop_index("ix_patient_allergies_patient_phone", table_name="patient_allergies")
    op.drop_index("ix_patient_allergies_tenant_id", table_name="patient_allergies")
    op.drop_table("patient_allergies")

    op.drop_index("ix_patient_diagnoses_patient_phone", table_name="patient_diagnoses")
    op.drop_index("ix_patient_diagnoses_tenant_id", table_name="patient_diagnoses")
    op.drop_table("patient_diagnoses")
