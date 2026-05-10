"""ads pro: A/B + targeting + budget + capping + ROI

Revision ID: adspro01
Revises: reftypes01
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa


revision = 'adspro01'
down_revision = 'reftypes01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            -- Бюджет и автостоп
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='budget_total') THEN
                ALTER TABLE ads ADD COLUMN budget_total NUMERIC(12,2) NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='spent_total') THEN
                ALTER TABLE ads ADD COLUMN spent_total NUMERIC(12,2) NOT NULL DEFAULT 0;
            END IF;

            -- Frequency capping
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='freq_per_day') THEN
                ALTER TABLE ads ADD COLUMN freq_per_day INT NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='freq_per_hour') THEN
                ALTER TABLE ads ADD COLUMN freq_per_hour INT NULL;
            END IF;

            -- Health checker
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='last_impression_at') THEN
                ALTER TABLE ads ADD COLUMN last_impression_at TIMESTAMP NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='auto_pause_idle_days') THEN
                ALTER TABLE ads ADD COLUMN auto_pause_idle_days INT NOT NULL DEFAULT 7;
            END IF;

            -- A/B-тесты
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='parent_ad_id') THEN
                ALTER TABLE ads ADD COLUMN parent_ad_id uuid NULL REFERENCES ads(id) ON DELETE SET NULL;
                CREATE INDEX ix_ads_parent_ad_id ON ads(parent_ad_id);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='ab_variant') THEN
                ALTER TABLE ads ADD COLUMN ab_variant VARCHAR(8) NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='ab_winner') THEN
                ALTER TABLE ads ADD COLUMN ab_winner BOOLEAN NOT NULL DEFAULT FALSE;
            END IF;

            -- Targeting (audience filters)
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='audience') THEN
                ALTER TABLE ads ADD COLUMN audience JSONB NULL;
            END IF;

            -- Conversion attribution
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='revenue_attributed') THEN
                ALTER TABLE ads ADD COLUMN revenue_attributed NUMERIC(12,2) NOT NULL DEFAULT 0;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='attribution_window_days') THEN
                ALTER TABLE ads ADD COLUMN attribution_window_days INT NOT NULL DEFAULT 7;
            END IF;

            -- AdEvent: revenue для conversion
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ad_events' AND column_name='revenue') THEN
                ALTER TABLE ad_events ADD COLUMN revenue NUMERIC(12,2) NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ad_events' AND column_name='referral_id') THEN
                ALTER TABLE ad_events ADD COLUMN referral_id uuid NULL REFERENCES referrals(id) ON DELETE SET NULL;
                CREATE INDEX ix_ad_events_referral_id ON ad_events(referral_id);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    for col in ['budget_total','spent_total','freq_per_day','freq_per_hour',
                'last_impression_at','auto_pause_idle_days','parent_ad_id',
                'ab_variant','ab_winner','audience','revenue_attributed',
                'attribution_window_days']:
        op.execute(f"ALTER TABLE ads DROP COLUMN IF EXISTS {col}")
    for col in ['revenue','referral_id']:
        op.execute(f"ALTER TABLE ad_events DROP COLUMN IF EXISTS {col}")
