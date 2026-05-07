"""ltv_pro: patient_ltv_snapshots + сид модуля ltv_pro

Revision ID: ltv1pro1ltv1
Revises: partner1ship1
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "ltv1pro1ltv1"
down_revision = "partner1ship1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Таблица снапшотов LTV ────────────────────────────────────────────
    op.create_table(
        "patient_ltv_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "clinic_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("clinics.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("patient_phone", sa.String(32), nullable=False),
        sa.Column("patient_name", sa.String(300), nullable=True),
        sa.Column("visits_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_spent", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("avg_check", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("first_visit_at", sa.DateTime, nullable=True),
        sa.Column("last_visit_at", sa.DateTime, nullable=True),
        sa.Column("visits_per_year", sa.Numeric(6, 2), nullable=False, server_default="0"),
        sa.Column("ltv_estimate", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("cohort_quarter", sa.String(10), nullable=True),
        sa.Column("churn_risk", sa.String(10), nullable=False, server_default="low"),
        sa.Column("computed_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "tenant_id", "clinic_id", "patient_phone",
            name="uq_ltv_snapshot_tenant_clinic_phone",
        ),
    )
    op.create_index("ix_patient_ltv_snapshots_tenant_id", "patient_ltv_snapshots", ["tenant_id"])
    op.create_index("ix_patient_ltv_snapshots_clinic_id", "patient_ltv_snapshots", ["clinic_id"])
    op.create_index("ix_patient_ltv_snapshots_patient_phone", "patient_ltv_snapshots", ["patient_phone"])
    op.create_index("ix_patient_ltv_snapshots_cohort_quarter", "patient_ltv_snapshots", ["cohort_quarter"])
    op.create_index("ix_patient_ltv_snapshots_churn_risk", "patient_ltv_snapshots", ["churn_risk"])

    # ── Сид нового коммерческого модуля ltv_pro ──────────────────────────
    op.execute("""
    INSERT INTO commercial_modules
        (id, key, name, description, category, price_monthly, price_annual,
         included_in_plans, is_active, sort_order, created_at, updated_at)
    VALUES
        (gen_random_uuid(), 'ltv_pro',
         'LTV-аналитика',
         'Расчёт пожизненной ценности пациентов из МИС: топ по LTV, когорты, churn risk, средний чек.',
         'analytics', 2990, 29900, NULL, true, 60, now(), now())
    ON CONFLICT (key) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("DELETE FROM commercial_modules WHERE key = 'ltv_pro';")
    op.drop_index("ix_patient_ltv_snapshots_churn_risk", table_name="patient_ltv_snapshots")
    op.drop_index("ix_patient_ltv_snapshots_cohort_quarter", table_name="patient_ltv_snapshots")
    op.drop_index("ix_patient_ltv_snapshots_patient_phone", table_name="patient_ltv_snapshots")
    op.drop_index("ix_patient_ltv_snapshots_clinic_id", table_name="patient_ltv_snapshots")
    op.drop_index("ix_patient_ltv_snapshots_tenant_id", table_name="patient_ltv_snapshots")
    op.drop_table("patient_ltv_snapshots")
