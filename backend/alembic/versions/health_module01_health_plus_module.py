"""health_module01 — Здоровье+ как платный модуль marketplace + интеграция с appointments.

Revises: subplans01
Create Date: 2026-05-11

Что делает:
1. Регистрирует модуль `health_plus_module` в `commercial_modules` (если ещё нет).
   Управление каталогом тарифов Здоровье+/Семья+/Pro доступно тенанту только
   при активной подписке на этот модуль.
2. Добавляет в `appointments` колонки `applied_subscription_id`, `discount_percent`,
   `discount_amount` для применения и аудита скидок по подписке пациента.
3. Расширяет features всех существующих global планов структурой `services_access`
   (категории: consultations / lab_tests / diagnostics / procedures).
"""
import json
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "health_module01"
down_revision = "subplans01"
branch_labels = None
depends_on = None


# ── Услуги по категориям (дефолтная структура services_access) ──────────────
SERVICES_ACCESS_HEALTH = {
    "consultations": {"count": 4, "discount_pct": 10, "category": "Консультации врачей"},
    "lab_tests":     {"count": 20, "discount_pct": 20, "category": "Лабораторные анализы"},
    "diagnostics":   {"count": 5, "discount_pct": 15, "category": "Диагностика"},
    "procedures":    {"count": 3, "discount_pct": 10, "category": "Процедуры"},
}
SERVICES_ACCESS_FAMILY = {
    "consultations": {"count": 8, "discount_pct": 10, "category": "Консультации врачей"},
    "lab_tests":     {"count": 40, "discount_pct": 20, "category": "Лабораторные анализы"},
    "diagnostics":   {"count": 10, "discount_pct": 15, "category": "Диагностика"},
    "procedures":    {"count": 6, "discount_pct": 10, "category": "Процедуры"},
}
SERVICES_ACCESS_PRO = {
    "consultations": {"count": 999, "discount_pct": 15, "category": "Консультации врачей"},
    "lab_tests":     {"count": 999, "discount_pct": 25, "category": "Лабораторные анализы"},
    "diagnostics":   {"count": 999, "discount_pct": 20, "category": "Диагностика"},
    "procedures":    {"count": 999, "discount_pct": 15, "category": "Процедуры"},
}


def upgrade():
    bind = op.get_bind()

    # ── 1. Регистрируем модуль в commercial_modules ────────────────────────
    bind.exec_driver_sql(
        """
        INSERT INTO commercial_modules (
            id, key, name, description, category,
            price_monthly, price_annual, included_in_plans, is_active, sort_order,
            screenshots, features_list, default_trial_days, popular,
            setup_complexity, monthly_price_demo, created_at, updated_at
        )
        SELECT
            gen_random_uuid(),
            'health_plus_module',
            'Здоровье+ (пациентские подписки)',
            'Платные подписки для пациентов: безлимит чата, скидки на услуги, ежемесячный расходник, приоритет записи. Управление ценой и составом тарифа — за клиникой.',
            'patient_engagement',
            1990.00, 21500.00, NULL, TRUE, 80,
            '[]'::jsonb,
            '["Безлимит чата с врачом","Скидки 10-25 процентов на услуги","Ежемесячный расходник пациенту","Приоритет записи","Наличная и онлайн активация"]'::jsonb,
            14, TRUE, 'easy', NULL,
            NOW(), NOW()
        WHERE NOT EXISTS (
            SELECT 1 FROM commercial_modules WHERE key='health_plus_module'
        )
        """
    )

    # ── 2. Расширяем appointments полями скидки от подписки ────────────────
    op.add_column(
        "appointments",
        sa.Column("applied_subscription_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_appointments_applied_subscription",
        "appointments", "patient_subscriptions",
        ["applied_subscription_id"], ["id"], ondelete="SET NULL",
    )
    op.add_column(
        "appointments",
        sa.Column("discount_percent", sa.Numeric(5, 2),
                  nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "appointments",
        sa.Column("discount_amount", sa.Numeric(10, 2),
                  nullable=False, server_default=sa.text("0")),
    )

    # ── 3. Расширяем features global планов structured services_access ────
    bind.exec_driver_sql(
        "UPDATE subscription_plans "
        "SET features = features || %s::jsonb "
        "WHERE tenant_id IS NULL AND plan_key='health_plus'",
        (json.dumps({"services_access": SERVICES_ACCESS_HEALTH}),),
    )
    bind.exec_driver_sql(
        "UPDATE subscription_plans "
        "SET features = features || %s::jsonb "
        "WHERE tenant_id IS NULL AND plan_key='family_plus'",
        (json.dumps({"services_access": SERVICES_ACCESS_FAMILY}),),
    )
    bind.exec_driver_sql(
        "UPDATE subscription_plans "
        "SET features = features || %s::jsonb "
        "WHERE tenant_id IS NULL AND plan_key='pro'",
        (json.dumps({"services_access": SERVICES_ACCESS_PRO}),),
    )

    # ── 4. billing_ledger расширение типов (если в коде используется новый
    # тип subscription_cash — entry_type хранится как String, миграция БД не
    # нужна, добавляется логически в коде).


def downgrade():
    op.drop_constraint("fk_appointments_applied_subscription",
                       "appointments", type_="foreignkey")
    op.drop_column("appointments", "discount_amount")
    op.drop_column("appointments", "discount_percent")
    op.drop_column("appointments", "applied_subscription_id")
    # Модуль и services_access оставляем — это soft data.
