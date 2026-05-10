"""onboard01 — Self-service onboarding (Глава 2)

Revises: secmerge01
Create Date: 2026-05-10

Добавляет инфраструктуру для публичного wizard-а регистрации новой франшизы:

  • tenants.trial_ends_at        TIMESTAMPTZ NULL — конец триала
  • tenants.onboarded_at         TIMESTAMPTZ NULL — момент завершения онбординга
  • tenants.onboarding_source    VARCHAR(50)      — self_service | manual | imported

  • Новая таблица signup_requests — драфт регистраций до подтверждения email:
      id UUID PK
      email, phone, full_name, franchise_name, tenant_slug
      payload JSONB                 — полные данные wizard (клиники, модули, тариф)
      verification_code VARCHAR(8)  — email-OTP
      attempts INT default 0        — счётчик попыток ввода OTP
      verified_at TIMESTAMPTZ NULL
      tenant_id UUID NULL           — заполняется после complete
      status VARCHAR(20)            — draft|verified|completed|failed
      ip_address INET, user_agent TEXT
      created_at, updated_at

Индексы: email, tenant_slug, status (для антифрод/админских отчётов).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, INET


revision = "onboard01"
down_revision = "secmerge01"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    """Проверяет наличие колонки (защита от повторного запуска)."""
    bind = op.get_bind()
    row = bind.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).first()
    return bool(row)


def upgrade() -> None:
    # ── 1. tenants: новые поля триала / источника онбординга ───────────────
    if not _has_column("tenants", "trial_ends_at"):
        op.add_column(
            "tenants",
            sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_column("tenants", "onboarded_at"):
        op.add_column(
            "tenants",
            sa.Column("onboarded_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_column("tenants", "onboarding_source"):
        op.add_column(
            "tenants",
            sa.Column("onboarding_source", sa.String(length=50), nullable=True),
        )

    # ── 2. signup_requests ────────────────────────────────────────────────
    op.create_table(
        "signup_requests",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.String(length=200), nullable=False),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("full_name", sa.String(length=200), nullable=False),
        sa.Column("franchise_name", sa.String(length=200), nullable=False),
        sa.Column("tenant_slug", sa.String(length=100), nullable=False),
        sa.Column("payload", JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("verification_code", sa.String(length=8), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False,
                  server_default="draft"),
        sa.Column("ip_address", INET(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
    )
    op.create_index("ix_signup_requests_email",       "signup_requests", ["email"])
    op.create_index("ix_signup_requests_tenant_slug", "signup_requests", ["tenant_slug"])
    op.create_index("ix_signup_requests_status",      "signup_requests", ["status"])
    op.create_index("ix_signup_requests_created_at",  "signup_requests", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_signup_requests_created_at",  table_name="signup_requests")
    op.drop_index("ix_signup_requests_status",      table_name="signup_requests")
    op.drop_index("ix_signup_requests_tenant_slug", table_name="signup_requests")
    op.drop_index("ix_signup_requests_email",       table_name="signup_requests")
    op.drop_table("signup_requests")

    if _has_column("tenants", "onboarding_source"):
        op.drop_column("tenants", "onboarding_source")
    if _has_column("tenants", "onboarded_at"):
        op.drop_column("tenants", "onboarded_at")
    if _has_column("tenants", "trial_ends_at"):
        op.drop_column("tenants", "trial_ends_at")
