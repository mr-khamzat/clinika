"""subplans01 — CRUD-каталог тарифов подписки «Здоровье+».

Revises: integrations01
Create Date: 2026-05-11

Добавляется таблица subscription_plans для управления планами подписки
пациента (Здоровье+, Семья+, Pro и custom_*). Поддерживает:
  - глобальные шаблоны (tenant_id IS NULL) — управляет super_admin
  - override на тенант (tenant_id NOT NULL) — управляет franchise_owner

Поведение чтения (effective plan): override поверх глобального шаблона.

Seed: вставляем 3 существующих плана (health_plus, family_plus, pro)
как глобальные шаблоны с теми же ценами и benefits, что были в
PLAN_DEFINITIONS словаре сервиса.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "subplans01"
down_revision = "integrations01"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "subscription_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("plan_key", sa.String(40), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price_monthly", sa.Numeric(10, 2), nullable=False),
        sa.Column("price_annual", sa.Numeric(10, 2), nullable=True),
        sa.Column("trial_days", sa.Integer(),
                  nullable=False, server_default=sa.text("7")),
        sa.Column("benefits", postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("features", postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("is_active", sa.Boolean(),
                  nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(),
                  nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_subscription_plans_tenant", "subscription_plans", ["tenant_id"]
    )
    op.create_index(
        "ix_subscription_plans_plan_key", "subscription_plans", ["plan_key"]
    )
    # Глобальный шаблон — один на plan_key (tenant_id IS NULL)
    op.create_index(
        "uq_sub_plans_global_key",
        "subscription_plans",
        ["plan_key"],
        unique=True,
        postgresql_where=sa.text("tenant_id IS NULL"),
    )
    # Override — один на (plan_key, tenant_id) когда tenant_id задан
    op.create_index(
        "uq_sub_plans_tenant_key",
        "subscription_plans",
        ["plan_key", "tenant_id"],
        unique=True,
        postgresql_where=sa.text("tenant_id IS NOT NULL"),
    )

    # ── Seed существующих планов как глобальных шаблонов ────────────────────
    # Используем bulk_insert чтобы избежать проблем с двоеточиями в JSON,
    # которые alembic/SQLAlchemy интерпретирует как bind-параметры.
    import json
    plans_t = sa.table(
        "subscription_plans",
        sa.column("plan_key", sa.String),
        sa.column("tenant_id", postgresql.UUID(as_uuid=True)),
        sa.column("title", sa.String),
        sa.column("description", sa.Text),
        sa.column("price_monthly", sa.Numeric),
        sa.column("price_annual", sa.Numeric),
        sa.column("trial_days", sa.Integer),
        sa.column("benefits", postgresql.JSONB),
        sa.column("features", postgresql.JSONB),
        sa.column("is_active", sa.Boolean),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(plans_t, [
        {
            "plan_key": "health_plus",
            "tenant_id": None,
            "title": "Здоровье+",
            "description": (
                "Базовая подписка: безлимит чата с врачом, скидка 10% на приёмы, "
                "расходник 1 раз в месяц автоматически, приоритет записи."
            ),
            "price_monthly": 290.00,
            "price_annual": 2900.00,
            "trial_days": 7,
            "benefits": [
                "Безлимит чата с врачом",
                "Скидка 10% на приёмы",
                "Расходник 1 раз в месяц автоматически",
                "Приоритет в записи",
            ],
            "features": {
                "unlimited_chat": True,
                "discount_percent": 10,
                "family_members_allowed": 1,
                "telemedicine_unlimited": False,
                "priority_booking": True,
                "monthly_supply": True,
            },
            "is_active": True,
            "sort_order": 10,
        },
        {
            "plan_key": "family_plus",
            "tenant_id": None,
            "title": "Семья+",
            "description": (
                "Подписка для всей семьи: все преимущества Здоровье+, "
                "до 4 членов семьи, общая медкарта."
            ),
            "price_monthly": 590.00,
            "price_annual": 5900.00,
            "trial_days": 7,
            "benefits": [
                "Все преимущества Здоровье+",
                "До 4 членов семьи",
                "Семейная медкарта",
            ],
            "features": {
                "unlimited_chat": True,
                "discount_percent": 10,
                "family_members_allowed": 4,
                "telemedicine_unlimited": False,
                "priority_booking": True,
                "monthly_supply": True,
            },
            "is_active": True,
            "sort_order": 20,
        },
        {
            "plan_key": "pro",
            "tenant_id": None,
            "title": "Pro",
            "description": (
                "Максимальный пакет: все преимущества Семья+, "
                "телемедицина без ограничений, приоритет 24/7."
            ),
            "price_monthly": 990.00,
            "price_annual": 9900.00,
            "trial_days": 7,
            "benefits": [
                "Все преимущества Семья+",
                "Телемедицина без ограничений",
                "Приоритет 24/7",
            ],
            "features": {
                "unlimited_chat": True,
                "discount_percent": 10,
                "family_members_allowed": 4,
                "telemedicine_unlimited": True,
                "priority_booking": True,
                "monthly_supply": True,
            },
            "is_active": True,
            "sort_order": 30,
        },
    ])


def downgrade():
    op.drop_index("uq_sub_plans_tenant_key", table_name="subscription_plans")
    op.drop_index("uq_sub_plans_global_key", table_name="subscription_plans")
    op.drop_index("ix_subscription_plans_plan_key", table_name="subscription_plans")
    op.drop_index("ix_subscription_plans_tenant", table_name="subscription_plans")
    op.drop_table("subscription_plans")
