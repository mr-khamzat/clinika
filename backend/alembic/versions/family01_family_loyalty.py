"""family01 — Глава 8: Семейный профиль + расширенная программа лояльности.

Revises: regulations01
Create Date: 2026-05-11

Что добавляется:
  family_groups       — семейная группа (1:1 с владельцем-пациентом)
  family_members      — члены группы (patient_id + права доступа)
  family_invites      — pending-приглашения по телефону (если пациент уже есть)

  loyalty_accounts_ext — расширенный loyalty-аккаунт (по patient_id)
                          с тиром (bronze/silver/gold/platinum) и total_spent
  loyalty_events       — приходы/уходы баллов (привязка к appointment/referral)
  loyalty_claims       — заявки на получение наград

Также в существующую loyalty_rewards добавляются:
  min_tier  VARCHAR(20)  DEFAULT 'bronze'
  stock     INTEGER      NULL  (NULL = безлимит)

Старые таблицы (loyalty_accounts, loyalty_transactions, patient_family_members,
loyalty_rules, loyalty_tiers, loyalty_rewards) НЕ удаляются —
legacy /loyalty/* router продолжает работать.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "family01"
down_revision = "regulations01"
branch_labels = None
depends_on = None


def upgrade():
    # ── family_groups ────────────────────────────────────────────────
    op.create_table(
        "family_groups",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("owner_patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False,
                  server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime, nullable=False,
                  server_default=sa.text("NOW()")),
    )
    op.create_index("ix_family_groups_tenant", "family_groups", ["tenant_id"])

    # ── family_members ───────────────────────────────────────────────
    op.create_table(
        "family_members",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("group_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("family_groups.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("relation", sa.String(40), nullable=False, server_default="other"),
        sa.Column("can_view_records", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("can_book_appointments", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("can_manage_payments", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("added_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("group_id", "patient_id", name="uq_family_group_patient"),
    )
    op.create_index("ix_family_members_group", "family_members", ["group_id"])
    op.create_index("ix_family_members_patient", "family_members", ["patient_id"])

    # ── family_invites ───────────────────────────────────────────────
    op.create_table(
        "family_invites",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("group_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("family_groups.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("inviter_patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("invitee_phone", sa.String(30), nullable=False),
        sa.Column("invitee_name", sa.String(200), nullable=True),
        sa.Column("relation", sa.String(40), nullable=False, server_default="other"),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime, nullable=False),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
        sa.Column("accepted_at", sa.DateTime, nullable=True),
    )
    op.create_index("ix_family_invites_phone", "family_invites", ["invitee_phone"])
    op.create_index("ix_family_invites_status", "family_invites", ["status"])

    # ── loyalty_accounts_ext ─────────────────────────────────────────
    op.create_table(
        "loyalty_accounts_ext",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("patient_phone", sa.String(32), nullable=False),
        sa.Column("points", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tier", sa.String(20), nullable=False, server_default="bronze"),
        sa.Column("total_spent", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("joined_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
        sa.Column("last_activity_at", sa.DateTime, nullable=True),
        sa.UniqueConstraint("tenant_id", "patient_id", name="uq_loyalty_ext_tenant_patient"),
    )
    op.create_index("ix_loyalty_ext_tenant", "loyalty_accounts_ext", ["tenant_id"])
    op.create_index("ix_loyalty_ext_phone", "loyalty_accounts_ext", ["patient_phone"])

    # ── loyalty_events ───────────────────────────────────────────────
    op.create_table(
        "loyalty_events",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("loyalty_accounts_ext.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("delta", sa.Integer, nullable=False),
        sa.Column("reason", sa.String(80), nullable=False),
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("referral_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("referrals.id", ondelete="SET NULL"), nullable=True),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_loyalty_events_account", "loyalty_events", ["account_id"])
    op.create_index("ix_loyalty_events_reason", "loyalty_events", ["reason"])
    op.create_index("ix_loyalty_events_created", "loyalty_events", ["created_at"])

    # ── loyalty_claims ───────────────────────────────────────────────
    op.create_table(
        "loyalty_claims",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("loyalty_accounts_ext.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("reward_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("loyalty_rewards.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("points_spent", sa.Integer, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="requested"),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
        sa.Column("delivered_at", sa.DateTime, nullable=True),
    )
    op.create_index("ix_loyalty_claims_account", "loyalty_claims", ["account_id"])
    op.create_index("ix_loyalty_claims_status", "loyalty_claims", ["status"])

    # ── loyalty_rewards: добавляем min_tier и stock ──────────────────
    with op.batch_alter_table("loyalty_rewards") as batch:
        batch.add_column(sa.Column("min_tier", sa.String(20),
                                   nullable=False, server_default="bronze"))
        batch.add_column(sa.Column("stock", sa.Integer, nullable=True))


def downgrade():
    with op.batch_alter_table("loyalty_rewards") as batch:
        batch.drop_column("stock")
        batch.drop_column("min_tier")

    op.drop_index("ix_loyalty_claims_status", table_name="loyalty_claims")
    op.drop_index("ix_loyalty_claims_account", table_name="loyalty_claims")
    op.drop_table("loyalty_claims")

    op.drop_index("ix_loyalty_events_created", table_name="loyalty_events")
    op.drop_index("ix_loyalty_events_reason", table_name="loyalty_events")
    op.drop_index("ix_loyalty_events_account", table_name="loyalty_events")
    op.drop_table("loyalty_events")

    op.drop_index("ix_loyalty_ext_phone", table_name="loyalty_accounts_ext")
    op.drop_index("ix_loyalty_ext_tenant", table_name="loyalty_accounts_ext")
    op.drop_table("loyalty_accounts_ext")

    op.drop_index("ix_family_invites_status", table_name="family_invites")
    op.drop_index("ix_family_invites_phone", table_name="family_invites")
    op.drop_table("family_invites")

    op.drop_index("ix_family_members_patient", table_name="family_members")
    op.drop_index("ix_family_members_group", table_name="family_members")
    op.drop_table("family_members")

    op.drop_index("ix_family_groups_tenant", table_name="family_groups")
    op.drop_table("family_groups")
