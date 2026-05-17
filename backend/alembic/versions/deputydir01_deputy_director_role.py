"""deputy_director — зам руководителя сети (доступ к кабинету руководителя read-only)

Revision ID: deputydir01
Revises: notifprefs01
Create Date: 2026-05-15

Зам главврача = зам руководителя сети. Имеет тот же read-only кабинет
DirectorCabinet, что и руководитель (роль `director`), но без прав менять
данные системы. Назначается super_admin или franchise_owner.
"""
from alembic import op


revision = "deputydir01"
down_revision = "notifprefs01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ADD VALUE — нельзя внутри транзакции; ставим COMMIT через autocommit_block.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'deputy_director'")


def downgrade() -> None:
    # PostgreSQL не поддерживает удаление значений из ENUM штатно —
    # downgrade no-op. При необходимости делается пересозданием типа.
    pass
