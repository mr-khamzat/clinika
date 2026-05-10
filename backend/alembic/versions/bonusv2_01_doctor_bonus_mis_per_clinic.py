"""bonusv2 + mis-per-clinic — каскад бонусов + МИС на уровне клиники

Revision ID: bonusv2_01
Revises: adspro01
Create Date: 2026-05-10
"""
from alembic import op
import sqlalchemy as sa


revision = 'bonusv2_01'
down_revision = 'adspro01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            -- Doctor: бонус за направление к этому врачу (на выбор управляющего)
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='doctors' AND column_name='referral_bonus_type') THEN
                ALTER TABLE doctors
                  ADD COLUMN referral_bonus_type VARCHAR(16) NOT NULL DEFAULT 'none';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='doctors' AND column_name='referral_bonus_amount') THEN
                ALTER TABLE doctors
                  ADD COLUMN referral_bonus_amount NUMERIC(12,2) NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='doctors' AND column_name='referral_bonus_percent') THEN
                ALTER TABLE doctors
                  ADD COLUMN referral_bonus_percent NUMERIC(5,2) NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='doctors' AND column_name='visit_price') THEN
                ALTER TABLE doctors
                  ADD COLUMN visit_price NUMERIC(12,2) NULL;
            END IF;

            -- Clinic: МИС per clinic (fallback на tenant settings если NULL)
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='clinics' AND column_name='mis_api_url') THEN
                ALTER TABLE clinics ADD COLUMN mis_api_url VARCHAR(500) NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='clinics' AND column_name='mis_api_key') THEN
                ALTER TABLE clinics ADD COLUMN mis_api_key VARCHAR(500) NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='clinics' AND column_name='mis_type') THEN
                ALTER TABLE clinics ADD COLUMN mis_type VARCHAR(32) NULL;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    for col in ['referral_bonus_type','referral_bonus_amount','referral_bonus_percent','visit_price']:
        op.execute(f"ALTER TABLE doctors DROP COLUMN IF EXISTS {col}")
    for col in ['mis_api_url','mis_api_key','mis_type']:
        op.execute(f"ALTER TABLE clinics DROP COLUMN IF EXISTS {col}")
