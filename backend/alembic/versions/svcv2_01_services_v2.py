"""services v2 — price + visible_for_referrals

Revision ID: svcv2_01
Revises: apptoutcome01
Create Date: 2026-05-09
"""
from alembic import op


revision = 'svcv2_01'
down_revision = 'apptoutcome01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Добавляет:
      - services.price            NUMERIC(10,2) NULL — цена пациенту (отличается от original_price из МИС)
      - services.visible_for_referrals BOOLEAN NOT NULL DEFAULT TRUE — видимость в форме создания направления
    Idempotent: проверяем наличие колонок.
    """
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='services' AND column_name='price') THEN
                ALTER TABLE services ADD COLUMN price NUMERIC(10,2) NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='services' AND column_name='visible_for_referrals') THEN
                ALTER TABLE services
                  ADD COLUMN visible_for_referrals BOOLEAN NOT NULL DEFAULT TRUE;
            END IF;
        END $$;
        """
    )
    # Индекс по (tenant_id, visible_for_referrals) для быстрого фильтра в форме направления
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_services_tenant_referrals
            ON services (tenant_id, visible_for_referrals)
            WHERE is_active = TRUE;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_services_tenant_referrals;")
    op.execute("ALTER TABLE services DROP COLUMN IF EXISTS visible_for_referrals;")
    op.execute("ALTER TABLE services DROP COLUMN IF EXISTS price;")
