"""
External Doctors MVP — добавляет роль acquisition_manager и расширяет users
полями для самозанятых внешних врачей:
  - external_doctor_inn   VARCHAR(20)
  - external_doctor_rate  JSONB  {type: 'percent'|'fixed', value: 30, currency: 'RUB'}
  - external_doctor_active BOOL  DEFAULT true

Контекст: роли visiting_doctor / partner_doctor / recruiter уже существуют
(см. p7q8r9s0t1u2_external_doctors_system).  В этой миграции добавляется
ТОЛЬКО недостающее звено — менеджер привлечения (acquisition_manager) и
поля профиля внешнего врача (ИНН, ставка, активность как самозанятого).

Revision ID: external01
Revises: sf05_polls
Create Date: 2026-05-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'external01'
down_revision = 'sf05_polls'
branch_labels = None
depends_on = None


def upgrade():
    # ── 1. Новая роль (идемпотентно) ────────────────────────────────────────
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'acquisition_manager'")
    # external_doctor — алиас на partner_doctor; partner_doctor уже есть.
    # Не добавляем 'external_doctor' в enum, чтобы не плодить дубли.

    # ── 2. Поля профиля внешнего врача (самозанятый) ────────────────────────
    op.add_column(
        'users',
        sa.Column('external_doctor_inn', sa.String(20), nullable=True)
    )
    op.add_column(
        'users',
        sa.Column('external_doctor_rate', postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )
    op.add_column(
        'users',
        sa.Column(
            'external_doctor_active',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('true'),
        )
    )


def downgrade():
    op.drop_column('users', 'external_doctor_active')
    op.drop_column('users', 'external_doctor_rate')
    op.drop_column('users', 'external_doctor_inn')
    # ALTER TYPE ... DROP VALUE не поддерживается Postgres — оставляем enum как есть.
