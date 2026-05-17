"""Кабинет директора: роль director + users.franchise_id.

Revision ID: director01
Revises: onec01
Create Date: 2026-05-15

Добавляет:
  • Новое значение 'director' в enum userrole (роль для read-only
    финансово-операционного кабинета владельца сети).
  • users.franchise_id — UUID FK на franchises.id (ondelete SET NULL),
    nullable, с индексом. Через эту колонку директор привязан к одной
    франшизе и видит сводку по всем её тенантам.
  • Бекфилл: для каждого пользователя с ролью franchise_owner проставляем
    franchise_id = (SELECT id FROM franchises WHERE owner_user_id = users.id LIMIT 1).
    Это удобно, чтобы кабинет франчайзи сразу подцепил свою сеть и чтобы
    помощник-директор мог быть назначен через UI без дополнительной правки.

PostgreSQL: ALTER TYPE ... ADD VALUE нельзя выполнять в той же транзакции,
где значение потом используется. В нашей миграции мы только добавляем
enum-значение и колонку — оба DDL допустимы вместе. Но если alembic запустит
DDL в одной транзакции, то ADD VALUE может потребовать COMMIT.
Чтобы не зависеть от настроек alembic, делаем COMMIT после ADD VALUE.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "director01"
down_revision = "onec01"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    """Защита от повторного запуска — проверяет существование колонки."""
    bind = op.get_bind()
    row = bind.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name=:t AND column_name=:c"
        ),
        {"t": table, "c": column},
    ).first()
    return bool(row)


def upgrade() -> None:
    # ── 1. enum value 'director' ─────────────────────────────────────────
    # ADD VALUE требует COMMIT, потому что в той же транзакции значение нельзя
    # будет использовать в DML/служебных запросах ниже.
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'director'")
    op.execute("COMMIT")

    # ── 2. users.franchise_id ────────────────────────────────────────────
    if not _has_column("users", "franchise_id"):
        op.add_column(
            "users",
            sa.Column(
                "franchise_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("franchises.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index(
            "ix_users_franchise_id", "users", ["franchise_id"], if_not_exists=True
        )

    # ── 3. Бекфилл franchise_id для существующих franchise_owner ─────────
    # Если у пользователя role=franchise_owner и есть Franchise.owner_user_id=user.id —
    # подставляем франшизу.
    op.execute(
        """
        UPDATE users u
        SET franchise_id = f.id
        FROM franchises f
        WHERE f.owner_user_id = u.id
          AND u.role::text = 'franchise_owner'
          AND u.franchise_id IS NULL;
        """
    )


def downgrade() -> None:
    # enum value не удаляем — в PG это болезненно (нужен пересоздать тип).
    # Просто откатываем колонку.
    if _has_column("users", "franchise_id"):
        op.drop_constraint(
            "users_franchise_id_fkey", "users", type_="foreignkey"
        )
        op.drop_index("ix_users_franchise_id", table_name="users")
        op.drop_column("users", "franchise_id")
