"""modulehealth01 — мониторинг состояния модулей per tenant

Revision ID: modhealth01
Revises: forgotpwd01
Create Date: 2026-05-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'modhealth01'
down_revision = 'forgotpwd01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                           WHERE table_name='module_health_checks') THEN
                CREATE TABLE module_health_checks (
                    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    module_key VARCHAR(100) NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'unknown',
                    last_check_at TIMESTAMP NOT NULL DEFAULT now(),
                    last_used_at TIMESTAMP NULL,
                    last_success_at TIMESTAMP NULL,
                    error_count_24h INT NOT NULL DEFAULT 0,
                    last_error_message TEXT NULL,
                    last_error_at TIMESTAMP NULL,
                    last_alert_at TIMESTAMP NULL,
                    metrics JSONB NULL,
                    UNIQUE (tenant_id, module_key)
                );
                CREATE INDEX ix_mhc_tenant ON module_health_checks(tenant_id);
                CREATE INDEX ix_mhc_status ON module_health_checks(status);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS module_health_checks")
