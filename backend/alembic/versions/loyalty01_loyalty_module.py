"""loyalty UI extensions — rules + rewards + commercial_module seed (W5 Loyalty UI)

Этот ревизион добавляет «оболочку» вокруг уже существующей программы
лояльности (см. loy1ty1ty1ty_loyalty_program), необходимую для UI:

  - loyalty_rules            — правила автоматического начисления (visit/referral/birthday/specialist)
  - loyalty_rewards          — каталог наград/обмена (бесплатная услуга, скидка, подарок)
  - commercial_modules row   — seed «loyalty_pro» (2990₽/мес), идемпотентно

Все CRUD/exchange-эндпоинты UI используют эти таблицы.
Существующие loyalty_accounts / loyalty_transactions / loyalty_tiers НЕ трогаем.

Revision ID: loyalty01
Revises: telemed01
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = 'loyalty01'
down_revision = 'telemed01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── loyalty_rules ────────────────────────────────────────────────────
    # Описывает правило автоматического начисления баллов.
    # rule_type:
    #   'visit'      — за каждую запись/визит
    #   'referral'   — за приведённого пациента (партнёр-источник)
    #   'birthday'   — фикс. бонус в день рождения
    #   'specialist' — за визит к узкому специалисту (filter в conditions)
    op.create_table(
        'loyalty_rules',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('rule_type', sa.String(30), nullable=False, index=True),
        sa.Column('bonus_amount', sa.Integer, nullable=False, server_default='0'),       # фикс. кол-во баллов
        sa.Column('bonus_pct', sa.Numeric(5, 2), nullable=False, server_default='0'),    # % от суммы (если применимо)
        sa.Column('is_active', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column('valid_from', sa.DateTime, nullable=True),
        sa.Column('valid_until', sa.DateTime, nullable=True),
        # conditions — произвольный JSON: {"service_ids":[...], "doctor_ids":[...], "min_amount":...}
        sa.Column('conditions', JSONB, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # ── loyalty_rewards (каталог обмена) ────────────────────────────────
    # Награды, которые пациент может «купить» за баллы.
    # reward_type:
    #   'free_service'   — бесплатная услуга
    #   'service_discount' — скидка на услугу
    #   'gift'           — физический подарок
    op.create_table(
        'loyalty_rewards',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('name', sa.String(160), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('reward_type', sa.String(30), nullable=False),
        sa.Column('cost_points', sa.Integer, nullable=False),                           # сколько баллов стоит
        sa.Column('discount_percent', sa.Numeric(5, 2), nullable=True),                 # для service_discount
        sa.Column('service_ref', sa.String(120), nullable=True),                        # ссылка на услугу (id/название)
        sa.Column('is_active', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column('icon', sa.String(40), nullable=True),                                # material-icon ключ
        sa.Column('sort_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # ── seed commercial_modules: loyalty_pro ────────────────────────────
    op.execute("""
    INSERT INTO commercial_modules
        (id, key, name, description, category, price_monthly, price_annual,
         included_in_plans, is_active, sort_order, created_at, updated_at)
    VALUES
        (gen_random_uuid(), 'loyalty_pro',
         'Программа лояльности',
         'Тиры пациентов, автоначисления баллов, каталог обмена и история транзакций',
         'crm', 2990, 29900, '["professional","enterprise"]'::jsonb, true, 60, now(), now())
    ON CONFLICT (key) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("DELETE FROM commercial_modules WHERE key = 'loyalty_pro';")
    op.drop_table('loyalty_rewards')
    op.drop_table('loyalty_rules')
