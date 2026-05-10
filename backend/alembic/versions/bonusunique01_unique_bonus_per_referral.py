"""bonusunique01 — UNIQUE на (referral_id, admin_id, bonus_type) и UNIQUE(referral_id) на ICI

Фаза 1, фикс #2 и #3 финансового аудита:
- Защита от двойных начислений Bonus при race-condition (см. _apply_confirmation FOR UPDATE).
- Защита от дублирующихся межклиничных счетов на одно направление.

Перед созданием уникальных индексов чистим уже существующие дубли (оставляя
самую раннюю запись), чтобы миграция не упала на проде.

Revision ID: bonusunique01
Revises: bonusv2_01
Create Date: 2026-05-10
"""
from alembic import op


revision = 'bonusunique01'
# Стэкнуто поверх dbidx01 (FK-индексы, Phase 4 stabilization), который сам
# идёт после bonusv2_01. Ветвление делать нет смысла — обе миграции
# независимы, но порядок не критичен.
down_revision = 'dbidx01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Чистим дубли в bonuses по (referral_id, admin_id, bonus_type) — оставляем
    #    запись с минимальным id (т.е. самую раннюю по времени).
    op.execute("""
        DELETE FROM bonuses b1
        USING bonuses b2
        WHERE b1.referral_id = b2.referral_id
          AND b1.admin_id    = b2.admin_id
          AND b1.bonus_type  = b2.bonus_type
          AND b1.id         > b2.id;
    """)

    # 2) UNIQUE INDEX на (referral_id, admin_id, bonus_type).
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_bonuses_referral_admin_type
            ON bonuses (referral_id, admin_id, bonus_type);
    """)

    # 3) Чистим дубли в inter_clinic_invoices по referral_id (только записи с
    #    непустым referral_id — manual/royalty счета не трогаем).
    op.execute("""
        DELETE FROM inter_clinic_invoices i1
        USING inter_clinic_invoices i2
        WHERE i1.referral_id IS NOT NULL
          AND i1.referral_id = i2.referral_id
          AND i1.id         > i2.id;
    """)

    # 4) UNIQUE INDEX(referral_id) WHERE referral_id IS NOT NULL —
    #    позволяет иметь несколько ICI без referral_id (manual/royalty).
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_ici_referral_id
            ON inter_clinic_invoices (referral_id)
            WHERE referral_id IS NOT NULL;
    """)

    # 5) Расширяем postgres-enum bonusstatus новым значением CANCELLED
    #    (используется bonus_service.mark_bonus_cancelled при отмене
    #    направления, раньше код падал AttributeError).
    #    ALTER TYPE ... ADD VALUE IF NOT EXISTS требует commit вне транзакции
    #    — выполняем через COMMIT/BEGIN внутри миграции.
    op.execute("COMMIT;")
    op.execute("ALTER TYPE bonusstatus ADD VALUE IF NOT EXISTS 'CANCELLED';")
    op.execute("ALTER TYPE recruiterbonusstatus ADD VALUE IF NOT EXISTS 'cancelled';")
    op.execute("BEGIN;")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_ici_referral_id;")
    op.execute("DROP INDEX IF EXISTS uq_bonuses_referral_admin_type;")
    # ALTER TYPE ... DROP VALUE не поддерживается в Postgres — оставляем enum
    # с лишним значением, это безопасно.
