"""delete_legacy_plugins: удаление старой plugin_*-системы

Revision ID: cleanup1plugin1
Revises: pay1ment1foundation
Create Date: 2026-05-07

Удаляет таблицы старой plugin_*-системы (deprecated, заменена commercial_modules):
  - clinic_visibility       — матрица видимости клиник внутри тенанта
  - billing_events          — аудит-лог биллинговых событий (пустой)
  - tenant_plugin_features  — статусы фич для тенантов (заменены TenantModuleSubscription)
  - plugin_features         — каталог фич (заменены commercial_modules)
  - plugins                 — каталог плагинов (CommercialModule заменяет)

ВАЖНО: данные мигрировать в commercial_modules не требуется —
включения для текущих тенантов уже есть в новой системе (16 модулей,
11 подписок). Старые plugin_features содержали 17 фич, из которых
только бесплатные (4 шт.) были включены — их функциональность давно
перенесена в commercial_modules. Перед миграцией сделан pg_dump в
/opt/clinika/backups/pre_legacy_cleanup_*.sql.

Downgrade пересоздаёт пустые таблицы (без данных).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "cleanup1plugin1"
down_revision = "pay1ment1foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Порядок drop важен — сначала зависимые (FK на plugin_features → plugins)
    op.drop_table("clinic_visibility")
    op.drop_table("billing_events")
    op.drop_table("tenant_plugin_features")
    op.drop_table("plugin_features")
    op.drop_table("plugins")


def downgrade() -> None:
    # Пересоздание пустых таблиц (для совместимости с откатом миграции)
    op.create_table(
        "plugins",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(100), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("icon", sa.String(50), nullable=False, server_default="extension"),
        sa.Column("category", sa.String(50), nullable=False, server_default="general"),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_plugins_key", "plugins", ["key"])

    op.create_table(
        "plugin_features",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("plugin_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(150), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_paid", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("price_monthly", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("feature_type", sa.String(20), nullable=False, server_default="boolean"),
        sa.Column("default_value", sa.String(100), nullable=True),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_plugin_features_plugin_id", "plugin_features", ["plugin_id"])
    op.create_index("ix_plugin_features_key", "plugin_features", ["key"])

    op.create_table(
        "tenant_plugin_features",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("feature_key", sa.String(150),
                  sa.ForeignKey("plugin_features.key", ondelete="CASCADE"), nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("value", sa.String(200), nullable=True),
        sa.Column("trial_ends_at", sa.DateTime, nullable=True),
        sa.Column("enabled_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("disabled_at", sa.DateTime, nullable=True),
    )
    op.create_index("ix_tenant_plugin_features_tenant_id", "tenant_plugin_features", ["tenant_id"])
    op.create_index("ix_tenant_plugin_features_feature_key", "tenant_plugin_features", ["feature_key"])

    op.create_table(
        "billing_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("feature_key", sa.String(150), nullable=False),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("meta", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_billing_events_tenant_id", "billing_events", ["tenant_id"])

    op.create_table(
        "clinic_visibility",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("to_clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("allow_admin", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("allow_doctor", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("allow_manager", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_clinic_visibility_tenant_id", "clinic_visibility", ["tenant_id"])
