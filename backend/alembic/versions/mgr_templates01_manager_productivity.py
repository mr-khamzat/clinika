"""mgr_templates01 — Manager productivity (Глава 4)

Revises: onboard01
Create Date: 2026-05-10

Добавляет инфраструктуру повышения продуктивности менеджера клиники:

  • Таблица referral_templates — шаблоны направлений (CRUD + use):
      id UUID PK
      tenant_id UUID FK
      clinic_id UUID FK NULL   — NULL = шаблон на всю tenant
      name VARCHAR(200)
      description TEXT NULL
      payload JSONB            — target_doctor_id?, services[], notes, priority, ...
      usage_count INT DEFAULT 0
      created_by_user_id UUID
      created_at, updated_at

  • Таблица manager_clinic_access — многоклиничный доступ менеджера:
      id UUID PK
      user_id UUID FK
      clinic_id UUID FK
      granted_at TIMESTAMPTZ
      granted_by_user_id UUID NULL
      UNIQUE (user_id, clinic_id)

  • Расширение AppointmentStatus новым значением IN_PROGRESS — для Kanban-доски
    (хранится как varchar так как enum в БД native_enum=False).

Индексы оптимизированы под типичные выборки:
  • referral_templates по tenant_id + clinic_id (фильтр в UI)
  • manager_clinic_access по user_id (быстрый join при login)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "mgr_templates01"
down_revision = "onboard01"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    """Защита от повторного запуска миграции (idempotent)."""
    bind = op.get_bind()
    row = bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name=:t"
    ), {"t": table}).first()
    return bool(row)


def upgrade() -> None:
    # ── 1. referral_templates ─────────────────────────────────────────────
    if not _table_exists("referral_templates"):
        op.create_table(
            "referral_templates",
            sa.Column("id", UUID(as_uuid=True), primary_key=True,
                      server_default=sa.text("gen_random_uuid()")),
            sa.Column("tenant_id", UUID(as_uuid=True),
                      sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                      nullable=False),
            sa.Column("clinic_id", UUID(as_uuid=True),
                      sa.ForeignKey("clinics.id", ondelete="CASCADE"),
                      nullable=True),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("payload", JSONB(), nullable=False,
                      server_default=sa.text("'{}'::jsonb")),
            sa.Column("usage_count", sa.Integer(), nullable=False,
                      server_default="0"),
            sa.Column("created_by_user_id", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="SET NULL"),
                      nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.text("NOW()")),
        )
        op.create_index("ix_referral_templates_tenant_id",
                        "referral_templates", ["tenant_id"])
        op.create_index("ix_referral_templates_clinic_id",
                        "referral_templates", ["clinic_id"])
        op.create_index("ix_referral_templates_tenant_clinic",
                        "referral_templates", ["tenant_id", "clinic_id"])

    # ── 2. manager_clinic_access ──────────────────────────────────────────
    if not _table_exists("manager_clinic_access"):
        op.create_table(
            "manager_clinic_access",
            sa.Column("id", UUID(as_uuid=True), primary_key=True,
                      server_default=sa.text("gen_random_uuid()")),
            sa.Column("user_id", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="CASCADE"),
                      nullable=False),
            sa.Column("clinic_id", UUID(as_uuid=True),
                      sa.ForeignKey("clinics.id", ondelete="CASCADE"),
                      nullable=False),
            sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.text("NOW()")),
            sa.Column("granted_by_user_id", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="SET NULL"),
                      nullable=True),
            sa.UniqueConstraint("user_id", "clinic_id",
                                name="uq_manager_clinic_access_user_clinic"),
        )
        op.create_index("ix_manager_clinic_access_user_id",
                        "manager_clinic_access", ["user_id"])
        op.create_index("ix_manager_clinic_access_clinic_id",
                        "manager_clinic_access", ["clinic_id"])

    # ── 3. appointments.status — расширяем varchar(9) → varchar(20),
    # чтобы новое значение 'in_progress' помещалось (используется Kanban).
    bind = op.get_bind()
    cur_len = bind.execute(sa.text(
        "SELECT character_maximum_length FROM information_schema.columns "
        "WHERE table_name='appointments' AND column_name='status'"
    )).scalar()
    if cur_len is not None and cur_len < 20:
        op.alter_column(
            "appointments", "status",
            type_=sa.String(length=20),
            existing_nullable=False,
        )


def downgrade() -> None:
    # Возвращать varchar(9) опасно (потенциально обрежет данные), пропускаем.
    if _table_exists("manager_clinic_access"):
        op.drop_index("ix_manager_clinic_access_clinic_id",
                      table_name="manager_clinic_access")
        op.drop_index("ix_manager_clinic_access_user_id",
                      table_name="manager_clinic_access")
        op.drop_table("manager_clinic_access")

    if _table_exists("referral_templates"):
        op.drop_index("ix_referral_templates_tenant_clinic",
                      table_name="referral_templates")
        op.drop_index("ix_referral_templates_clinic_id",
                      table_name="referral_templates")
        op.drop_index("ix_referral_templates_tenant_id",
                      table_name="referral_templates")
        op.drop_table("referral_templates")
