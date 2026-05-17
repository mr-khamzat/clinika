"""МИС-вебхуки на события подписки (subscription.activated / cancelled / renewed).

Revision ID: miswebhook01
Revises: discountrules01
Create Date: 2026-05-15

Регистрирует таблицу tenant_mis_subscription_webhooks — каждый тенант может
настроить один или несколько endpoints внешнего МИС (renovatio / stoclinic /
custom), куда отправляются события подписки пациента.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "miswebhook01"
down_revision = "discountrules01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_mis_subscription_webhooks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("mis_type", sa.String(30), nullable=False),
        sa.Column("webhook_url", sa.String(500), nullable=False),
        sa.Column("auth_header", sa.String(200), nullable=True),
        sa.Column("events", postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False,
                  server_default=sa.text(
                      "'[\"subscription.activated\",\"subscription.cancelled\"]'::jsonb"
                  )),
        sa.Column("is_active", sa.Boolean, nullable=False,
                  server_default=sa.text("TRUE")),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("retry_count", sa.Integer, nullable=False,
                  server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
    )
    op.create_index(
        "ix_mis_webhook_tenant",
        "tenant_mis_subscription_webhooks",
        ["tenant_id", "is_active"],
    )


def downgrade() -> None:
    op.drop_index("ix_mis_webhook_tenant",
                  table_name="tenant_mis_subscription_webhooks")
    op.drop_table("tenant_mis_subscription_webhooks")
