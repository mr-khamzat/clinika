"""commercial modules, tenant integrations, module subscriptions

Revision ID: n5o6p7q8r9s0
Revises: m3n4o5p6q7r8
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'n5o6p7q8r9s0'
down_revision = 'm3n4o5p6q7r8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'commercial_modules',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('key', sa.String(100), unique=True, nullable=False, index=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('category', sa.String(50), nullable=False),
        sa.Column('price_monthly', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('price_annual', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('included_in_plans', postgresql.JSONB, nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('sort_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('config_schema', postgresql.JSONB, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        'tenant_module_subscriptions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('module_key', sa.String(100), sa.ForeignKey('commercial_modules.key', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='trial'),
        sa.Column('billing_cycle', sa.String(20), nullable=False, server_default='monthly'),
        sa.Column('custom_price', sa.Numeric(12, 2), nullable=True),
        sa.Column('trial_days', sa.Integer, nullable=False, server_default='0'),
        sa.Column('started_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('trial_ends_at', sa.DateTime, nullable=True),
        sa.Column('expires_at', sa.DateTime, nullable=True),
        sa.Column('cancelled_at', sa.DateTime, nullable=True),
        sa.Column('config', postgresql.JSONB, nullable=True),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('tenant_id', 'module_key', name='uq_tenant_module_sub'),
    )

    op.create_table(
        'tenant_integrations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('type', sa.String(20), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('base_url', sa.String(500), nullable=False),
        sa.Column('api_key', sa.String(500), nullable=False),
        sa.Column('extra_config', postgresql.JSONB, nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('last_tested_at', sa.DateTime, nullable=True),
        sa.Column('test_status', sa.String(20), nullable=True),
        sa.Column('test_error', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # Сид каталога модулей
    op.execute("""
    INSERT INTO commercial_modules (id, key, name, description, category, price_monthly, price_annual, included_in_plans, sort_order, config_schema) VALUES
    (gen_random_uuid(), 'telephony_basic',    'Аудио внутри клиники',          'Аудио звонки между сотрудниками одной клиники', 'telephony',   0,    0,    '["professional","enterprise"]', 10,
     '{"role_matrix": {"type": "object", "description": "Матрица ролей: кто кому может звонить внутри клиники"}}'),
    (gen_random_uuid(), 'cross_clinic_audio', 'Аудио между клиниками',         'Звонки в другие клиники франшизы',              'telephony',   1990, 19900, null, 11, null),
    (gen_random_uuid(), 'video_calls',        'Видеозвонки 1:1',               'P2P видеозвонки (WebRTC)',                       'telephony',   2490, 24900, null, 12, null),
    (gen_random_uuid(), 'video_conference',   'Видеоконференции',              'До 10 участников',                               'telephony',   4490, 44900, null, 13, null),
    (gen_random_uuid(), 'call_recording',     'Хранение записей 7 дней',       'Запись и хранение звонков 7 дней',               'telephony',    990,  9900, null, 14, null),
    (gen_random_uuid(), 'ai_analytics_basic', 'AI-аналитика Базовая',          '6 типов анализа, 50 запросов/мес',               'ai',          2990, 29900, null, 20,
     '{"quota_monthly": {"type": "number", "default": 50, "description": "Запросов в месяц"}}'),
    (gen_random_uuid(), 'ai_analytics_pro',   'AI-аналитика Расширенная',      'Безлимит, авто-отчёты, PDF экспорт',             'ai',          4490, 44900, null, 21,
     '{"quota_monthly": {"type": "number", "default": -1, "description": "-1 = безлимит"}}'),
    (gen_random_uuid(), 'ads_basic',          'Реклама Базовая',               'До 3 кампаний, баннер, 1 000 сетевых показов',   'advertising',  990,  9900, null, 30,
     '{"network_impressions": {"type": "number", "default": 1000}}'),
    (gen_random_uuid(), 'ads_agency',         'Реклама Агентская',             'Безлимит кампаний, все форматы, 5 000 показов',  'advertising', 2490, 24900, null, 31,
     '{"network_impressions": {"type": "number", "default": 5000}}'),
    (gen_random_uuid(), 'ads_network_5k',     'Сетевые показы 5 000',          'Пакет 5 000 показов в сети платформы',           'advertising',  350,    0,  null, 32,
     '{"network_impressions": {"type": "number", "default": 5000}}'),
    (gen_random_uuid(), 'ads_network_25k',    'Сетевые показы 25 000',         'Пакет 25 000 показов в сети платформы',          'advertising', 1500,    0,  null, 33,
     '{"network_impressions": {"type": "number", "default": 25000}}'),
    (gen_random_uuid(), 'ads_network_100k',   'Сетевые показы 100 000',        'Пакет 100 000 показов в сети платформы',         'advertising', 5000,    0,  null, 34,
     '{"network_impressions": {"type": "number", "default": 100000}}')
    """)


def downgrade() -> None:
    op.drop_table('tenant_integrations')
    op.drop_table('tenant_module_subscriptions')
    op.drop_table('commercial_modules')
