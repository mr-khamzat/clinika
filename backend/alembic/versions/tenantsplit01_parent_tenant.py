"""tenant split — parent_tenant_id для head→sub связей

Revision ID: tenantsplit01
Revises: svcv2_01
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'tenantsplit01'
down_revision = 'svcv2_01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='tenants' AND column_name='parent_tenant_id') THEN
                ALTER TABLE tenants
                  ADD COLUMN parent_tenant_id uuid NULL
                  REFERENCES tenants(id) ON DELETE SET NULL;
                CREATE INDEX ix_tenants_parent ON tenants(parent_tenant_id);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.drop_column('tenants', 'parent_tenant_id')
