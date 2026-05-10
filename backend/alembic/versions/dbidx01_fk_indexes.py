"""dbidx01 — индексы на FK-колонки (Phase 4 stabilization)

Добавляет btree-индексы на 15 внешних ключей, у которых не было индексов.
Используется CREATE INDEX CONCURRENTLY (без блокировок таблиц) + IF NOT EXISTS
(идемпотентно — если индекс уже создан, шаг пропускается).

Внимание: CONCURRENTLY запрещён внутри транзакции, поэтому миграция выполняется
с autocommit (op.get_bind().execution_options(isolation_level="AUTOCOMMIT")).

Revision ID: dbidx01
Revises: bonusv2_01
Create Date: 2026-05-10
"""
from alembic import op


revision = 'dbidx01'
down_revision = 'bonusv2_01'
branch_labels = None
depends_on = None


# (table, column) — имя индекса считается как ix_<table>_<column>.
INDEXES = [
    ("clinic_schedules", "clinic_id"),
    ("discounts", "created_by_id"),
    ("discounts", "clinic_id"),
    ("discounts", "service_id"),
    ("referral_comments", "referral_id"),
    ("referral_comments", "author_id"),
    ("appointments", "referral_id"),
    ("appointments", "created_by_id"),
    ("ledger_entries", "created_by_id"),
    ("wiki_pages", "parent_id"),
    ("wiki_pages", "created_by_id"),
    ("activity_log", "user_id"),
    ("wiki_images", "page_id"),
    ("tenants", "franchise_owner_id"),
    ("invitations", "clinic_id"),
]


def upgrade():
    # CREATE INDEX CONCURRENTLY нельзя внутри transaction block.
    # Alembic уже открыл транзакцию — выходим из неё через autocommit_block().
    with op.get_context().autocommit_block():
        for table, column in INDEXES:
            index_name = f"ix_{table}_{column}"
            op.execute(
                f'CREATE INDEX CONCURRENTLY IF NOT EXISTS "{index_name}" '
                f'ON "{table}" ("{column}")'
            )


def downgrade():
    with op.get_context().autocommit_block():
        for table, column in INDEXES:
            index_name = f"ix_{table}_{column}"
            op.execute(
                f'DROP INDEX CONCURRENTLY IF EXISTS "{index_name}"'
            )
