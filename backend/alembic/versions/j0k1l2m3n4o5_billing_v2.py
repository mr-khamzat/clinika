"""billing_v2: tenant_plans, tenant_pricing_rules, billing_ledger, ads, ad_events, tenant_plugin_subscriptions

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-04-16 21:00:00.000000

ТОЛЬКО новые таблицы. Существующие таблицы не затрагиваются.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'j0k1l2m3n4o5'
down_revision: Union[str, None] = 'i9j0k1l2m3n4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. TenantPlan — каталог тарифов в БД ─────────────────────────────────
    op.create_table(
        'tenant_plans',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(50), nullable=False),
        sa.Column('display_name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('base_price_month', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('base_price_year', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('max_clinics', sa.Integer(), nullable=False, server_default='3'),
        sa.Column('max_users', sa.Integer(), nullable=False, server_default='20'),
        sa.Column('features', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('is_public', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_tenant_plans_name', 'tenant_plans', ['name'], unique=True)

    # ── 2. TenantPricingRules — индивидуальные условия тенанта ────────────────
    op.create_table(
        'tenant_pricing_rules',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('min_price', sa.Numeric(12, 2), nullable=True),
        sa.Column('max_price', sa.Numeric(12, 2), nullable=True),
        sa.Column('plugin_split_percent', sa.Numeric(5, 2), nullable=False, server_default='30.00'),
        sa.Column('ad_split_percent', sa.Numeric(5, 2), nullable=False, server_default='20.00'),
        sa.Column('franchise_fee_percent', sa.Numeric(5, 2), nullable=False, server_default='0.00'),
        sa.Column('subscription_discount_percent', sa.Numeric(5, 2), nullable=False, server_default='0.00'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_tenant_pricing_rules_tenant_id', 'tenant_pricing_rules', ['tenant_id'], unique=True)

    # ── 3. BillingLedger — платформенный реестр (append-only) ────────────────
    op.create_table(
        'billing_ledger',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('clinic_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('entry_type', sa.String(60), nullable=False),
        sa.Column('direction', sa.String(10), nullable=False),
        sa.Column('amount', sa.Numeric(14, 2), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False, server_default='RUB'),
        sa.Column('reference_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('reference_type', sa.String(60), nullable=True),
        sa.Column('description', sa.String(500), nullable=True),
        sa.Column('meta', postgresql.JSONB(), nullable=True),
        sa.Column('is_split', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('split_parent_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('split_actor', sa.String(30), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['split_parent_id'], ['billing_ledger.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_billing_ledger_tenant_id', 'billing_ledger', ['tenant_id'])
    op.create_index('ix_billing_ledger_entry_type', 'billing_ledger', ['entry_type'])
    op.create_index('ix_billing_ledger_reference_id', 'billing_ledger', ['reference_id'])
    op.create_index('ix_billing_ledger_split_parent_id', 'billing_ledger', ['split_parent_id'])
    op.create_index('ix_billing_ledger_created_at', 'billing_ledger', ['created_at'])
    op.create_index('ix_billing_ledger_tenant_type', 'billing_ledger', ['tenant_id', 'entry_type'])
    op.create_index('ix_billing_ledger_created_tenant', 'billing_ledger', ['created_at', 'tenant_id'])

    # ── 4. Ads — рекламные объявления ────────────────────────────────────────
    op.create_table(
        'ads',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('title', sa.String(300), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('image_url', sa.String(1000), nullable=True),
        sa.Column('link', sa.String(1000), nullable=True),
        sa.Column('ad_type', sa.String(30), nullable=False, server_default='banner'),
        sa.Column('status', sa.String(20), nullable=False, server_default='draft'),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=False),
        sa.Column('price', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('pricing_model', sa.String(20), nullable=False, server_default='flat'),
        sa.Column('impressions_limit', sa.Integer(), nullable=True),
        sa.Column('clicks_limit', sa.Integer(), nullable=True),
        sa.Column('impressions_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('clicks_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('conversions_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('meta', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_ads_tenant_id', 'ads', ['tenant_id'])
    op.create_index('ix_ads_status', 'ads', ['status'])
    op.create_index('ix_ads_tenant_status', 'ads', ['tenant_id', 'status'])
    op.create_index('ix_ads_dates', 'ads', ['start_date', 'end_date'])

    # ── 5. AdEvents — события взаимодействия с рекламой ─────────────────────
    op.create_table(
        'ad_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('ad_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('event_type', sa.String(30), nullable=False),
        sa.Column('ip_hash', sa.String(64), nullable=True),
        sa.Column('meta', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['ad_id'], ['ads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_ad_events_ad_id', 'ad_events', ['ad_id'])
    op.create_index('ix_ad_events_tenant_id', 'ad_events', ['tenant_id'])
    op.create_index('ix_ad_events_event_type', 'ad_events', ['event_type'])
    op.create_index('ix_ad_events_created_at', 'ad_events', ['created_at'])

    # ── 6. TenantPluginSubscriptions — lifecycle платных плагинов ────────────
    op.create_table(
        'tenant_plugin_subscriptions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('feature_key', sa.String(150), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='trial'),
        sa.Column('billing_cycle', sa.String(20), nullable=False, server_default='monthly'),
        sa.Column('price', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('started_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('trial_ends_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(), nullable=True),
        sa.Column('last_charged_at', sa.DateTime(), nullable=True),
        sa.Column('auto_renew', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('meta', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('tenant_id', 'feature_key', name='uq_plugin_sub_tenant_feature'),
    )
    op.create_index('ix_tenant_plugin_subscriptions_tenant_id', 'tenant_plugin_subscriptions', ['tenant_id'])
    op.create_index('ix_tenant_plugin_subscriptions_feature_key', 'tenant_plugin_subscriptions', ['feature_key'])
    op.create_index('ix_tenant_plugin_subscriptions_status', 'tenant_plugin_subscriptions', ['status'])


def downgrade() -> None:
    op.drop_table('tenant_plugin_subscriptions')
    op.drop_table('ad_events')
    op.drop_table('ads')
    op.drop_table('billing_ledger')
    op.drop_table('tenant_pricing_rules')
    op.drop_table('tenant_plans')
