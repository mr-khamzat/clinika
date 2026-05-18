"""stcc01: cross-tenant rooms — общие комнаты для всех клиник одной франшизы

Добавляет в staff_chat_rooms поля:
  - franchise_id (UUID, NULL, FK → franchises.id ON DELETE SET NULL)
  - is_cross_tenant (BOOL NOT NULL DEFAULT false)

tenant_id остаётся обязательным — для cross-tenant комнат это будет
тенант инициатора (создателя).

Revision ID: stcc01_cross_tenant_rooms
Revises: fhc01_head_clinic
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "stcc01_cross_tenant_rooms"
down_revision = "fhc01_head_clinic"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) franchise_id (NULL) — FK на franchises.id с ON DELETE SET NULL
    op.add_column(
        "staff_chat_rooms",
        sa.Column("franchise_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_staff_chat_rooms_franchise_id",
        "staff_chat_rooms",
        "franchises",
        ["franchise_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 2) is_cross_tenant (BOOL NOT NULL DEFAULT false)
    op.add_column(
        "staff_chat_rooms",
        sa.Column(
            "is_cross_tenant",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # 3) Композитный индекс для быстрого поиска cross-tenant rooms франшизы
    op.create_index(
        "ix_staff_chat_rooms_franchise_cross",
        "staff_chat_rooms",
        ["franchise_id", "is_cross_tenant"],
    )


def downgrade() -> None:
    op.drop_index("ix_staff_chat_rooms_franchise_cross", table_name="staff_chat_rooms")
    op.drop_column("staff_chat_rooms", "is_cross_tenant")
    op.drop_constraint(
        "fk_staff_chat_rooms_franchise_id", "staff_chat_rooms", type_="foreignkey"
    )
    op.drop_column("staff_chat_rooms", "franchise_id")
