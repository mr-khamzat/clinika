"""roles cleanup — удалить supervisor/acquisition_manager/partner/accountant, переименовать admin→reg, external_doctor→partner_doctor

Revision ID: b3c4d5e6f7g8
Revises: a2b3c4d5e6f7
Create Date: 2026-05-06

Этап 3 ROADMAP. PG enum нельзя ALTER DROP VALUE — двухшаговая стратегия:
1) создать новый enum userrole_new с целевым набором,
2) перевести данные (admin→reg, external_doctor→partner_doctor, удаляемые → reg+is_active=false),
3) переключить колонку, удалить старый enum, переименовать новый.
"""
from alembic import op


revision = "b3c4d5e6f7g8"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Новый enum со списком разрешённых ролей
    op.execute(
        "CREATE TYPE userrole_new AS ENUM ("
        "'super_admin', 'franchise_owner', 'manager', 'doctor', 'reg', "
        "'nurse', 'recruiter', 'partner_doctor', 'visiting_doctor', 'patient'"
        ")"
    )

    # 2) Перевод данных. Сначала переименования (admin→reg, external_doctor→partner_doctor)
    op.execute("UPDATE users SET role = 'admin'::userrole WHERE role::text = 'admin'")  # no-op safeguard
    # Переводим удаляемые роли → reg + is_active=false (история сохраняется)
    op.execute(
        "UPDATE users SET role = 'admin'::userrole, is_active = false "
        "WHERE role::text IN ('supervisor', 'acquisition_manager', 'partner', 'accountant')"
    )
    # external_doctor пока остаётся, переключим во время каста на новый enum

    # 3) Переключаем колонку на новый enum через CASE — мапим старые имена в новые
    op.execute(
        "ALTER TABLE users ALTER COLUMN role DROP DEFAULT"
    )
    op.execute(
        "ALTER TABLE users ALTER COLUMN role TYPE userrole_new USING ("
        "  CASE role::text "
        "    WHEN 'admin' THEN 'reg' "
        "    WHEN 'external_doctor' THEN 'partner_doctor' "
        "    ELSE role::text "
        "  END"
        ")::userrole_new"
    )
    op.execute(
        "ALTER TABLE users ALTER COLUMN role SET DEFAULT 'reg'::userrole_new"
    )

    # 4) Старый enum drop, новый — переименовать в userrole
    op.execute("DROP TYPE userrole")
    op.execute("ALTER TYPE userrole_new RENAME TO userrole")


def downgrade() -> None:
    # Восстанавливаем старый enum (без удалённых пользователей — их роль теперь reg)
    op.execute(
        "CREATE TYPE userrole_old AS ENUM ("
        "'admin', 'manager', 'partner', 'super_admin', 'doctor', 'nurse', "
        "'recruiter', 'supervisor', 'acquisition_manager', 'external_doctor', "
        "'visiting_doctor', 'franchise_owner', 'accountant'"
        ")"
    )
    op.execute(
        "ALTER TABLE users ALTER COLUMN role DROP DEFAULT"
    )
    op.execute(
        "ALTER TABLE users ALTER COLUMN role TYPE userrole_old USING ("
        "  CASE role::text "
        "    WHEN 'reg' THEN 'admin' "
        "    WHEN 'partner_doctor' THEN 'external_doctor' "
        "    ELSE role::text "
        "  END"
        ")::userrole_old"
    )
    op.execute(
        "ALTER TABLE users ALTER COLUMN role SET DEFAULT 'admin'::userrole_old"
    )
    op.execute("DROP TYPE userrole")
    op.execute("ALTER TYPE userrole_old RENAME TO userrole")
