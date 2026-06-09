"""quota01 — API Quotas и Rate Limits по тенантам

Revision ID: quota01
Revises: tenantchurn01
Create Date: 2026-05-23

Создаёт:
  tenant_quotas — настройки лимитов на tenant (RPM, RPD, storage, users, calls)
  quota_usage   — daily aggregate использования (заполняется flush_to_db)

Дефолты: 6000 RPM / 100k RPD / 5000mb / 50 users / 1000 calls min/month.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = "quota01"
down_revision: Union[str, None] = "tenantchurn01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_quotas",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("requests_per_minute", sa.Integer(), nullable=False, server_default="6000"),
        sa.Column("requests_per_day", sa.Integer(), nullable=False, server_default="100000"),
        sa.Column("storage_mb_limit", sa.Integer(), nullable=False, server_default="5000"),
        sa.Column("users_limit", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("calls_minutes_per_month", sa.Integer(), nullable=False, server_default="1000"),
        sa.Column("plan_default", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", name="uq_tenant_quotas_tenant_id"),
    )
    op.create_index("ix_tenant_quotas_tenant_id", "tenant_quotas", ["tenant_id"], unique=False)

    op.create_table(
        "quota_usage",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("requests_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("storage_mb_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("calls_minutes_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_updated", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "period", name="uq_quota_usage_tenant_period"),
    )
    op.create_index("ix_quota_usage_tenant_id", "quota_usage", ["tenant_id"], unique=False)
    op.create_index("ix_quota_usage_period", "quota_usage", ["period"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_quota_usage_period", table_name="quota_usage")
    op.drop_index("ix_quota_usage_tenant_id", table_name="quota_usage")
    op.drop_table("quota_usage")

    op.drop_index("ix_tenant_quotas_tenant_id", table_name="tenant_quotas")
    op.drop_table("tenant_quotas")
