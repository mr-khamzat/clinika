"""health_sub01 — Глава 9: Подписка Здоровье+, асинхронный чат, iCal-feed, document storage.

Revises: family01
Create Date: 2026-05-11

Что добавляется:
  patient_subscriptions          — подписка пациента (health_plus / family_plus / pro)
  patient_subscription_history   — журнал событий подписки

  chat_threads                   — асинхронные треды чата пациент↔клиника
  chat_messages                  — сообщения в тредах

  patient_calendar_tokens        — токены iCal-feed для подписки в Google/Apple Calendar

  patient_documents (ALTER)      — добавляются колонки patient_id / category / title /
                                    visibility / deleted_at (для патиент-центричной модели
                                    Главы 9; существующие staff-загрузки остаются совместимы).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "health_sub01"
down_revision = "family01"
branch_labels = None
depends_on = None


def upgrade():
    # ── patient_subscriptions ────────────────────────────────────────
    op.create_table(
        "patient_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("plan", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="trial"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True,
                  server_default=sa.text("NOW()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("auto_renew", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("price_monthly", sa.Numeric(10, 2), nullable=True),
        sa.Column("payment_method", sa.String(40), nullable=True),
        sa.Column("external_subscription_id", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
    )
    op.create_index("ix_patient_subs_tenant", "patient_subscriptions", ["tenant_id"])
    op.create_index("ix_patient_subs_patient", "patient_subscriptions", ["patient_id"])
    op.create_index("ix_patient_subs_status", "patient_subscriptions", ["status"])
    # Уникальность: одна активная/триал подписка на план у пациента
    op.execute(
        "CREATE UNIQUE INDEX uq_patient_sub_active "
        "ON patient_subscriptions (patient_id, plan) "
        "WHERE status IN ('active','trial')"
    )

    # ── patient_subscription_history ─────────────────────────────────
    op.create_table(
        "patient_subscription_history",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("subscription_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patient_subscriptions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("event", sa.String(40), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
    )
    op.create_index("ix_patient_sub_hist_sub", "patient_subscription_history",
                    ["subscription_id"])

    # ── chat_threads ─────────────────────────────────────────────────
    op.create_table(
        "chat_threads",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("subject", sa.String(200), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("assigned_doctor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unread_for_patient", sa.Integer, nullable=False, server_default="0"),
        sa.Column("unread_for_clinic", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
    )
    op.create_index("ix_chat_threads_tenant", "chat_threads", ["tenant_id"])
    op.create_index("ix_chat_threads_clinic", "chat_threads", ["clinic_id"])
    op.create_index("ix_chat_threads_patient", "chat_threads", ["patient_id"])
    op.create_index("ix_chat_threads_status", "chat_threads", ["status"])

    # ── chat_messages ────────────────────────────────────────────────
    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("chat_threads.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("sender_type", sa.String(20), nullable=False),
        sa.Column("sender_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("attachments", postgresql.JSONB, nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
    )
    op.create_index("ix_chat_messages_thread", "chat_messages", ["thread_id"])
    op.create_index("ix_chat_messages_created", "chat_messages", ["created_at"])

    # ── patient_calendar_tokens ──────────────────────────────────────
    op.create_table(
        "patient_calendar_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_patient_cal_tok_patient", "patient_calendar_tokens", ["patient_id"])
    op.create_index("ix_patient_cal_tok_token", "patient_calendar_tokens", ["token"])

    # ── patient_documents — добавочные колонки для патиент-центричной модели ──
    # Существующая таблица staff-центрична (patient_phone + filename). Добавляем
    # nullable-колонки для Главы 9 (patient_id, category, title, visibility, deleted_at).
    # Старые staff-загрузки остаются совместимы.
    op.add_column("patient_documents",
                  sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                            sa.ForeignKey("patient_accounts.id", ondelete="SET NULL"),
                            nullable=True))
    op.add_column("patient_documents",
                  sa.Column("category", sa.String(40), nullable=True))
    op.add_column("patient_documents",
                  sa.Column("title", sa.String(200), nullable=True))
    op.add_column("patient_documents",
                  sa.Column("visibility", sa.String(20),
                            nullable=False, server_default="patient_and_doctors"))
    op.add_column("patient_documents",
                  sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_patient_documents_patient_id", "patient_documents", ["patient_id"])


def downgrade():
    op.drop_index("ix_patient_documents_patient_id", table_name="patient_documents")
    op.drop_column("patient_documents", "deleted_at")
    op.drop_column("patient_documents", "visibility")
    op.drop_column("patient_documents", "title")
    op.drop_column("patient_documents", "category")
    op.drop_column("patient_documents", "patient_id")

    op.drop_index("ix_patient_cal_tok_token", table_name="patient_calendar_tokens")
    op.drop_index("ix_patient_cal_tok_patient", table_name="patient_calendar_tokens")
    op.drop_table("patient_calendar_tokens")

    op.drop_index("ix_chat_messages_created", table_name="chat_messages")
    op.drop_index("ix_chat_messages_thread", table_name="chat_messages")
    op.drop_table("chat_messages")

    op.drop_index("ix_chat_threads_status", table_name="chat_threads")
    op.drop_index("ix_chat_threads_patient", table_name="chat_threads")
    op.drop_index("ix_chat_threads_clinic", table_name="chat_threads")
    op.drop_index("ix_chat_threads_tenant", table_name="chat_threads")
    op.drop_table("chat_threads")

    op.drop_index("ix_patient_sub_hist_sub", table_name="patient_subscription_history")
    op.drop_table("patient_subscription_history")

    op.execute("DROP INDEX IF EXISTS uq_patient_sub_active")
    op.drop_index("ix_patient_subs_status", table_name="patient_subscriptions")
    op.drop_index("ix_patient_subs_patient", table_name="patient_subscriptions")
    op.drop_index("ix_patient_subs_tenant", table_name="patient_subscriptions")
    op.drop_table("patient_subscriptions")
