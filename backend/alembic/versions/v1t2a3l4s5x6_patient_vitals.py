"""patient_vitals — витальные показатели пациента + Apple Health sync

Revision ID: v1t2a3l4s5x6
Revises: w9x0y1z2a3b4
Create Date: 2026-05-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "v1t2a3l4s5x6"
down_revision = "w9x0y1z2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "patient_vitals",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("patient_phone", sa.String(30), nullable=False),
        sa.Column("metric", sa.String(40), nullable=False),
        sa.Column("value_num", sa.Numeric(10, 2), nullable=True),
        sa.Column("value_extra", JSONB, nullable=True),
        sa.Column("unit", sa.String(20), nullable=True),
        sa.Column("measured_at", sa.DateTime, nullable=False),
        sa.Column("source", sa.String(30), nullable=False, server_default="manual"),
        sa.Column("device_info", sa.String(200), nullable=True),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_patient_vitals_tenant_id",
        "patient_vitals", ["tenant_id"],
    )
    op.create_index(
        "ix_patient_vitals_patient_phone",
        "patient_vitals", ["patient_phone"],
    )
    op.create_index(
        "ix_patient_vitals_measured_at",
        "patient_vitals", ["measured_at"],
    )
    op.create_index(
        "ix_vitals_tenant_phone_metric_time",
        "patient_vitals",
        ["tenant_id", "patient_phone", "metric", "measured_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_vitals_tenant_phone_metric_time", table_name="patient_vitals")
    op.drop_index("ix_patient_vitals_measured_at", table_name="patient_vitals")
    op.drop_index("ix_patient_vitals_patient_phone", table_name="patient_vitals")
    op.drop_index("ix_patient_vitals_tenant_id", table_name="patient_vitals")
    op.drop_table("patient_vitals")
