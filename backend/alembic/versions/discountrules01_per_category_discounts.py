"""Категорные скидки тарифов «Здоровье+» / «Семья+» / «Pro».

Revision ID: discountrules01
Revises: invcost0203
Create Date: 2026-05-15

Создаёт таблицу subscription_plan_discounts: тенант (или глобал) задаёт
дифференцированные скидки для подписки — на все услуги плана,
по категории (services.category — текстовое поле), или по конкретной услуге.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "discountrules01"
down_revision = "invcost0203"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subscription_plan_discounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=True),
        sa.Column("plan_key", sa.String(40), nullable=False),
        sa.Column("scope", sa.String(20), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("category_name", sa.String(200), nullable=True),
        sa.Column("service_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("services.id", ondelete="CASCADE"),
                  nullable=True),
        sa.Column("discount_percent", sa.Numeric(5, 2), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False,
                  server_default=sa.text("TRUE")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.CheckConstraint(
            "discount_percent >= 0 AND discount_percent <= 100",
            name="ck_spd_pct_range",
        ),
        sa.CheckConstraint(
            "(scope='all' AND category_id IS NULL AND service_id IS NULL) "
            "OR (scope='category' AND (category_id IS NOT NULL OR category_name IS NOT NULL)) "
            "OR (scope='service' AND service_id IS NOT NULL)",
            name="ck_spd_scope_consistency",
        ),
    )
    op.create_index(
        "ix_plan_disc_tenant_plan",
        "subscription_plan_discounts",
        ["tenant_id", "plan_key", "is_active"],
    )
    op.create_index(
        "ix_plan_disc_service",
        "subscription_plan_discounts",
        ["service_id"],
        postgresql_where=sa.text("service_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_plan_disc_service", table_name="subscription_plan_discounts")
    op.drop_index("ix_plan_disc_tenant_plan", table_name="subscription_plan_discounts")
    op.drop_table("subscription_plan_discounts")
