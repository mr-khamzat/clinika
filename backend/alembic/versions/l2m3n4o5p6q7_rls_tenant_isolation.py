"""RLS tenant isolation for referrals, bonuses, audit_log

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-04-24

"""
from alembic import op

revision = 'l2m3n4o5p6q7'
down_revision = 'k1l2m3n4o5p6'
branch_labels = None
depends_on = None

# Таблицы с колонкой tenant_id — применяем RLS
RLS_TABLES = ["referrals", "bonuses", "audit_log"]


def upgrade() -> None:
    for table in RLS_TABLES:
        # Включаем Row Level Security
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        # FORCE RLS применяется и к владельцу таблицы
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        # Политика: разрешить если:
        #   - tenant_id IS NULL (строка не привязана к тенанту, видна всем)
        #   - app.tenant_id не установлен (суперадмин — видит всё)
        #   - app.tenant_id совпадает с tenant_id строки (тенантный пользователь)
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (
                tenant_id IS NULL
                OR current_setting('app.tenant_id', true) IS NULL
                OR current_setting('app.tenant_id', true) = ''
                OR tenant_id::text = current_setting('app.tenant_id', true)
            )
        """)


def downgrade() -> None:
    for table in RLS_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
