"""seed extra commercial modules: webhooks, ai_assistant, white_label, mis_sync

Revision ID: c4d5e6f7g8h9
Revises: b3c4d5e6f7g8
Create Date: 2026-05-06

Этап 7 ROADMAP — добавить недостающие платные модули в каталог
commercial_modules. Идемпотентно (ON CONFLICT DO NOTHING).
"""
from alembic import op
import sqlalchemy as sa


revision = "c4d5e6f7g8h9"
down_revision = "b3c4d5e6f7g8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    INSERT INTO commercial_modules
        (id, key, name, description, category, price_monthly, price_annual,
         included_in_plans, is_active, sort_order, created_at, updated_at)
    VALUES
        (gen_random_uuid(), 'webhooks',
         'Webhooks',
         'Уведомления внешним системам по событиям клиники (HTTP-callbacks)',
         'integrations', 1500, 15000, '["enterprise"]'::jsonb, true, 50, now(), now()),
        (gen_random_uuid(), 'ai_assistant',
         'AI-ассистент',
         'База знаний / FAQ с автоматическими ответами через LLM',
         'ai', 990, 9900, NULL, true, 51, now(), now()),
        (gen_random_uuid(), 'white_label',
         'White-Label брендинг',
         'Свой логотип, цветовая схема, домен, CMS-страницы тенанта',
         'branding', 3990, 39900, '["enterprise"]'::jsonb, true, 52, now(), now()),
        (gen_random_uuid(), 'mis_sync',
         'МИС-синхронизация',
         'Импорт пациентов и визитов из МИС-провайдера (Renovatio и др.)',
         'integrations', 2500, 25000, '["professional","enterprise"]'::jsonb, true, 53, now(), now())
    ON CONFLICT (key) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("""
    DELETE FROM commercial_modules
     WHERE key IN ('webhooks', 'ai_assistant', 'white_label', 'mis_sync');
    """)
