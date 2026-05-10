"""tenantapi01 — per-tenant rotatable API keys for external integrations (CRM / BI).

Revision ID: tenantapi01
Revises: modhealth01
Create Date: 2026-05-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'tenantapi01'
down_revision = 'modhealth01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'tenant_api_keys'
            ) THEN
                CREATE TABLE tenant_api_keys (
                    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    key_hash VARCHAR(128) NOT NULL UNIQUE,
                    key_prefix VARCHAR(16) NOT NULL,
                    name VARCHAR(200) NOT NULL,
                    scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
                    created_at TIMESTAMP NOT NULL DEFAULT now(),
                    created_by_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
                    last_used_at TIMESTAMP NULL,
                    last_used_ip VARCHAR(45) NULL,
                    expires_at TIMESTAMP NULL,
                    revoked_at TIMESTAMP NULL,
                    allowed_ips JSONB NULL,
                    request_count INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX ix_tenant_api_keys_tenant ON tenant_api_keys(tenant_id);
                CREATE INDEX ix_tenant_api_keys_prefix ON tenant_api_keys(key_prefix);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS tenant_api_keys;")
