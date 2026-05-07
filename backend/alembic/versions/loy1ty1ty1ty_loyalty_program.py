"""loyalty_program — программа лояльности пациента (Этап 11 ROADMAP)

Создаёт 4 таблицы:
  - loyalty_accounts        — аккаунт пациента (1 на телефон+тенант)
  - loyalty_transactions    — append-only история (earn/redeem/expire/...)
  - loyalty_tiers           — конфиг уровней (bronze/silver/gold/platinum)
  - patient_ai_conversations — лог диалогов пациента с медицинским AI

Модели описаны в backend/app/models/loyalty.py.

Revision ID: loy1ty1ty1ty
Revises: c4d5e6f7g8h9
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = 'loy1ty1ty1ty'
down_revision = 'c4d5e6f7g8h9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── loyalty_accounts ────────────────────────────────────────────────
    op.create_table(
        'loyalty_accounts',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('patient_phone', sa.String(20), nullable=False, index=True),
        sa.Column('points_total', sa.Integer, nullable=False, server_default='0'),
        sa.Column('points_balance', sa.Integer, nullable=False, server_default='0'),
        sa.Column('tier', sa.String(20), nullable=False, server_default='bronze'),
        sa.Column('tier_progress', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('joined_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('tenant_id', 'patient_phone', name='uq_loyalty_account_tenant_phone'),
    )

    # ── loyalty_transactions (append-only) ──────────────────────────────
    op.create_table(
        'loyalty_transactions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('account_id', UUID(as_uuid=True),
                  sa.ForeignKey('loyalty_accounts.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('patient_phone', sa.String(20), nullable=False, index=True),
        sa.Column('delta', sa.Integer, nullable=False),
        # 'earn' | 'redeem' | 'expire' | 'tier_bonus' | 'manual_credit' | 'manual_debit'
        sa.Column('op_type', sa.String(30), nullable=False, index=True),
        sa.Column('reference_id', sa.String(64), nullable=True),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now(), index=True),
        sa.Column('created_by_user_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )

    # ── loyalty_tiers ───────────────────────────────────────────────────
    op.create_table(
        'loyalty_tiers',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('name', sa.String(20), nullable=False),
        sa.Column('threshold_rub', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('discount_percent', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('perks', JSONB, nullable=True),
        sa.UniqueConstraint('tenant_id', 'name', name='uq_loyalty_tier_tenant_name'),
    )

    # ── patient_ai_conversations ────────────────────────────────────────
    op.create_table(
        'patient_ai_conversations',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('patient_phone', sa.String(20), nullable=False, index=True),
        sa.Column('question', sa.Text, nullable=False),
        sa.Column('answer', sa.Text, nullable=True),
        sa.Column('source', sa.String(20), nullable=True),  # llm/cache/fallback
        sa.Column('tokens_in', sa.Integer, nullable=True),
        sa.Column('tokens_out', sa.Integer, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now(), index=True),
    )


def downgrade() -> None:
    op.drop_table('patient_ai_conversations')
    op.drop_table('loyalty_tiers')
    op.drop_table('loyalty_transactions')
    op.drop_table('loyalty_accounts')
