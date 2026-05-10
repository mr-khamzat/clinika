"""referral types — service / doctor / lab

Revision ID: reftypes01
Revises: svcfin01
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa


revision = 'reftypes01'
down_revision = 'svcfin01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            -- referral_type: service (default) | doctor | lab
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='referrals' AND column_name='referral_type') THEN
                ALTER TABLE referrals
                  ADD COLUMN referral_type VARCHAR(16) NOT NULL DEFAULT 'service';
            END IF;

            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='referrals' AND column_name='target_doctor_id') THEN
                ALTER TABLE referrals
                  ADD COLUMN target_doctor_id uuid NULL
                  REFERENCES doctors(id) ON DELETE SET NULL;
                CREATE INDEX ix_referrals_target_doctor ON referrals(target_doctor_id);
            END IF;

            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='referrals' AND column_name='lab_tests') THEN
                ALTER TABLE referrals
                  ADD COLUMN lab_tests TEXT NULL;
            END IF;

            -- service_id больше не обязателен (для doctor/lab может быть NULL)
            ALTER TABLE referrals ALTER COLUMN service_id DROP NOT NULL;
        END $$;
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE referrals ALTER COLUMN service_id SET NOT NULL")
    op.drop_column('referrals', 'lab_tests')
    op.drop_column('referrals', 'target_doctor_id')
    op.drop_column('referrals', 'referral_type')
