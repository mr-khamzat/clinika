"""franchisemodules01 — Распределение модулей внутри франшизы + внутренние акты."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "franchisemodules01"
down_revision = "chatsettings01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "franchise_module_grants",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("franchise_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("module_key", sa.String(length=80), nullable=False),
        sa.Column("internal_price_rub", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("granted_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["franchise_id"], ["franchises.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["granted_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("franchise_id", "tenant_id", "module_key", name="uq_franchise_module_tenant"),
    )
    op.create_index("ix_franchise_module_grants_franchise", "franchise_module_grants", ["franchise_id"])
    op.create_index("ix_franchise_module_grants_tenant", "franchise_module_grants", ["tenant_id"])
    op.create_index("ix_franchise_module_grants_module", "franchise_module_grants", ["module_key"])

    op.create_table(
        "franchise_internal_acts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("franchise_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("total_rub", sa.Numeric(12, 2), nullable=False),
        sa.Column("breakdown_json", sa.String(length=2000), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["franchise_id"], ["franchises.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("franchise_id", "tenant_id", "period", name="uq_franchise_act_period"),
    )
    op.create_index("ix_franchise_internal_acts_franchise", "franchise_internal_acts", ["franchise_id"])
    op.create_index("ix_franchise_internal_acts_tenant", "franchise_internal_acts", ["tenant_id"])
    op.create_index("ix_franchise_internal_acts_status", "franchise_internal_acts", ["status"])


def downgrade() -> None:
    op.drop_index("ix_franchise_internal_acts_status", table_name="franchise_internal_acts")
    op.drop_index("ix_franchise_internal_acts_tenant", table_name="franchise_internal_acts")
    op.drop_index("ix_franchise_internal_acts_franchise", table_name="franchise_internal_acts")
    op.drop_table("franchise_internal_acts")

    op.drop_index("ix_franchise_module_grants_module", table_name="franchise_module_grants")
    op.drop_index("ix_franchise_module_grants_tenant", table_name="franchise_module_grants")
    op.drop_index("ix_franchise_module_grants_franchise", table_name="franchise_module_grants")
    op.drop_table("franchise_module_grants")
