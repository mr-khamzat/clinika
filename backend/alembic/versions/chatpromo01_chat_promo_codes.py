"""chatpromo01 — chat_promo_codes table

Промокоды, выпускаемые регистраторами/менеджерами клиники
прямо из чата с пациентом.

Revision ID: chatpromo01
Revises: arrltv01
Create Date: 2026-05-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "chatpromo01"
down_revision = "chatmsgtpl01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_promo_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(40), nullable=False, unique=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("issued_to_patient_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("issued_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("discount_type", sa.String(16), nullable=False, server_default="percent"),
        sa.Column("discount_value", sa.Integer, nullable=False),
        sa.Column("max_uses", sa.Integer, nullable=False, server_default="1"),
        sa.Column("used_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("valid_until", sa.DateTime, nullable=False),
        sa.Column("used_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_chat_promo_codes_code", "chat_promo_codes", ["code"])
    op.create_index("ix_chat_promo_codes_thread_id", "chat_promo_codes", ["thread_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_promo_codes_thread_id", table_name="chat_promo_codes")
    op.drop_index("ix_chat_promo_codes_code", table_name="chat_promo_codes")
    op.drop_table("chat_promo_codes")
