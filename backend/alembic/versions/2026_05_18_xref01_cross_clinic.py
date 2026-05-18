"""xref01: cross-clinic referrals — направление пациента из клиники А в клинику Б одной франшизы

Revision ID: xref01_cross_clinic
Revises: fhc01_head_clinic
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "xref01_cross_clinic"
down_revision = "fhc01_head_clinic"
branch_labels = None
depends_on = None


def upgrade():
    # ── Поля для cross-clinic направлений ───────────────────────────────────
    # target_tenant_id          — клиника-получатель (куда направили)
    # referred_by_tenant_id     — клиника-отправитель (журналинг, копия)
    # cross_clinic_status       — pending_target_accept / accepted / rejected
    #                             / completed / canceled
    # cross_clinic_note         — комментарий (причина, инструкции, отказ)
    # inter_clinic_invoice_id   — авто-счёт, когда услуга оказана и расчёт
    #                             между клиниками сгенерирован
    op.add_column(
        "referrals",
        sa.Column("target_tenant_id", UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "referrals",
        sa.Column("referred_by_tenant_id", UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "referrals",
        sa.Column("cross_clinic_status", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "referrals",
        sa.Column("cross_clinic_note", sa.Text(), nullable=True),
    )
    op.add_column(
        "referrals",
        sa.Column("inter_clinic_invoice_id", UUID(as_uuid=True), nullable=True),
    )

    op.create_foreign_key(
        "fk_referrals_target_tenant",
        "referrals", "tenants",
        ["target_tenant_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_referrals_referred_by_tenant",
        "referrals", "tenants",
        ["referred_by_tenant_id"], ["id"],
        ondelete="SET NULL",
    )

    # Композитный индекс для входящих cross-clinic направлений
    op.create_index(
        "ix_referrals_target_xstatus",
        "referrals",
        ["target_tenant_id", "cross_clinic_status"],
    )


def downgrade():
    op.drop_index("ix_referrals_target_xstatus", table_name="referrals")
    op.drop_constraint("fk_referrals_referred_by_tenant", "referrals", type_="foreignkey")
    op.drop_constraint("fk_referrals_target_tenant", "referrals", type_="foreignkey")
    op.drop_column("referrals", "inter_clinic_invoice_id")
    op.drop_column("referrals", "cross_clinic_note")
    op.drop_column("referrals", "cross_clinic_status")
    op.drop_column("referrals", "referred_by_tenant_id")
    op.drop_column("referrals", "target_tenant_id")
