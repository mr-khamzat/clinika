"""partner service offers and outbound-only bonus snapshot

Revision ID: partneroffers01
Revises: pwdmust01_password_must_change
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'partneroffers01'
down_revision = 'pwdmust01_password_must_change'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # partner_categories
    op.execute("""
        CREATE TABLE IF NOT EXISTS partner_categories (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
            name VARCHAR(120) NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ix_partner_categories_tenant_id ON partner_categories(tenant_id);
        CREATE INDEX IF NOT EXISTS ix_partner_categories_clinic_id ON partner_categories(clinic_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_category_clinic_name ON partner_categories(clinic_id, name);
    """)

    # partner_service_offers
    op.execute("""
        CREATE TABLE IF NOT EXISTS partner_service_offers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
            service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
            category_id UUID NULL REFERENCES partner_categories(id) ON DELETE SET NULL,
            payout_amount NUMERIC(10,2) NOT NULL,
            price_override NUMERIC(10,2) NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_by_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ix_partner_offers_tenant_id ON partner_service_offers(tenant_id);
        CREATE INDEX IF NOT EXISTS ix_partner_offers_clinic_id ON partner_service_offers(clinic_id);
        CREATE INDEX IF NOT EXISTS ix_partner_offers_service_id ON partner_service_offers(service_id);
        CREATE INDEX IF NOT EXISTS ix_partner_offers_category_id ON partner_service_offers(category_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_offer_clinic_service ON partner_service_offers(clinic_id, service_id);
        CREATE INDEX IF NOT EXISTS ix_partner_offer_tenant_active ON partner_service_offers(tenant_id, is_active);
    """)

    # Колонки в referrals
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='referrals' AND column_name='partner_offer_id') THEN
                ALTER TABLE referrals ADD COLUMN partner_offer_id UUID NULL
                    REFERENCES partner_service_offers(id) ON DELETE SET NULL;
                CREATE INDEX ix_referrals_partner_offer_id ON referrals(partner_offer_id);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='referrals' AND column_name='bonus_snapshot_amount') THEN
                ALTER TABLE referrals ADD COLUMN bonus_snapshot_amount NUMERIC(10,2) NULL;
            END IF;
        END $$;
    """)

    # Data migration: переносим существующие services.visible_for_referrals -> partner_service_offers
    op.execute("""
        INSERT INTO partner_service_offers (id, tenant_id, clinic_id, service_id, payout_amount, is_active, created_at, updated_at)
        SELECT gen_random_uuid(), s.tenant_id, s.clinic_id, s.id,
               COALESCE(s.referral_payout, s.bonus_amount, 0)::numeric(10,2),
               true, NOW(), NOW()
        FROM services s
        WHERE s.visible_for_referrals = true
          AND COALESCE(s.referral_payout, s.bonus_amount, 0) > 0
          AND s.clinic_id IS NOT NULL
          AND s.tenant_id IS NOT NULL
        ON CONFLICT (clinic_id, service_id) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_referrals_partner_offer_id;")
    op.execute("ALTER TABLE referrals DROP COLUMN IF EXISTS bonus_snapshot_amount;")
    op.execute("ALTER TABLE referrals DROP COLUMN IF EXISTS partner_offer_id;")
    op.execute("DROP TABLE IF EXISTS partner_service_offers;")
    op.execute("DROP TABLE IF EXISTS partner_categories;")
