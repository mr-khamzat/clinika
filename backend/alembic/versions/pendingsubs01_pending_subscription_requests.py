"""pendingsubs01: pending_subscription_requests — очередь подписок на одобрение.

Revision ID: pendingsubs01
Revises: invcost0203
Create Date: 2026-05-15

Создаёт таблицу pending_subscription_requests для очереди заявок пациентов
на подписку «Здоровье+» с ручным одобрением менеджером (вместо
прямой self-activation через /patient/subscription/start).

Status workflow:
  pending → approved (создаёт PatientSubscription)
  pending → rejected (с reject_reason)
  pending → expired  (для автоматической очистки старых заявок)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "pendingsubs01"
down_revision = "invcost0203"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pending_subscription_requests",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "clinic_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("clinics.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "patient_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("plan_key", sa.String(40), nullable=False),
        sa.Column(
            "months", sa.Integer(),
            nullable=False, server_default=sa.text("1"),
        ),
        # 'cash' | 'online' | 'unknown'
        sa.Column("payment_method", sa.String(40), nullable=True),
        sa.Column("patient_note", sa.Text(), nullable=True),
        # pending | approved | rejected | expired
        sa.Column(
            "status", sa.String(20),
            nullable=False, server_default=sa.text("'pending'"),
        ),
        sa.Column(
            "reviewed_by_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "reviewed_at", sa.TIMESTAMP(timezone=True), nullable=True,
        ),
        sa.Column("reject_reason", sa.Text(), nullable=True),
        sa.Column(
            "resulting_subscription_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("patient_subscriptions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True),
            server_default=sa.text("NOW()"), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True),
            server_default=sa.text("NOW()"), nullable=False,
        ),
    )
    op.create_index(
        "ix_pending_subs_tenant_status",
        "pending_subscription_requests", ["tenant_id", "status"],
    )
    op.create_index(
        "ix_pending_subs_patient",
        "pending_subscription_requests", ["patient_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_pending_subs_patient",
        table_name="pending_subscription_requests",
    )
    op.drop_index(
        "ix_pending_subs_tenant_status",
        table_name="pending_subscription_requests",
    )
    op.drop_table("pending_subscription_requests")
