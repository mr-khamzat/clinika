"""extend push_subscriptions: patient_id, user_agent, last_used_at, user_id→UUID FK

Revision ID: pushsub02
Revises: announce01
Create Date: 2026-05-16

Изменения:
 - rename last_used → last_used_at (соответствие naming-конвенции остальных таблиц)
 - alter user_id: String(36) → UUID + FK на users.id ON DELETE CASCADE
 - add patient_id UUID FK patient_accounts.id ON DELETE CASCADE (nullable)
 - add user_agent VARCHAR(500) (nullable)
 - alter p256dh/auth: Text → VARCHAR(200) (соответствие модели; ключи короче 200)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "pushsub02"
down_revision = "announce01"
branch_labels = None
depends_on = None


def upgrade():
    # ── last_used → last_used_at
    op.alter_column("push_subscriptions", "last_used", new_column_name="last_used_at")

    # ── user_id: String(36) → UUID + FK
    # Текущий тип character varying(36) — конвертируем через USING (валидные UUID-строки).
    op.execute(
        "ALTER TABLE push_subscriptions "
        "ALTER COLUMN user_id TYPE uuid USING NULLIF(user_id, '')::uuid"
    )
    op.create_foreign_key(
        "push_subscriptions_user_id_fkey",
        "push_subscriptions",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # ── patient_id
    op.add_column(
        "push_subscriptions",
        sa.Column("patient_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_push_subscriptions_patient_id", "push_subscriptions", ["patient_id"]
    )
    op.create_foreign_key(
        "push_subscriptions_patient_id_fkey",
        "push_subscriptions",
        "patient_accounts",
        ["patient_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # ── user_agent
    op.add_column(
        "push_subscriptions",
        sa.Column("user_agent", sa.String(length=500), nullable=True),
    )

    # ── p256dh / auth: Text → VARCHAR(200)
    # Используем USING для безопасной конверсии (значения короче 200).
    op.execute(
        "ALTER TABLE push_subscriptions "
        "ALTER COLUMN p256dh TYPE varchar(200) USING SUBSTRING(p256dh FROM 1 FOR 200)"
    )
    op.execute(
        "ALTER TABLE push_subscriptions "
        "ALTER COLUMN auth TYPE varchar(200) USING SUBSTRING(auth FROM 1 FOR 200)"
    )


def downgrade():
    op.execute("ALTER TABLE push_subscriptions ALTER COLUMN auth TYPE text")
    op.execute("ALTER TABLE push_subscriptions ALTER COLUMN p256dh TYPE text")
    op.drop_column("push_subscriptions", "user_agent")
    op.drop_constraint(
        "push_subscriptions_patient_id_fkey", "push_subscriptions", type_="foreignkey"
    )
    op.drop_index("ix_push_subscriptions_patient_id", "push_subscriptions")
    op.drop_column("push_subscriptions", "patient_id")
    op.drop_constraint(
        "push_subscriptions_user_id_fkey", "push_subscriptions", type_="foreignkey"
    )
    op.execute(
        "ALTER TABLE push_subscriptions ALTER COLUMN user_id TYPE varchar(36) USING user_id::text"
    )
    op.alter_column("push_subscriptions", "last_used_at", new_column_name="last_used")
