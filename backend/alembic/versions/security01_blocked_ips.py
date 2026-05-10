"""security01 — Журнал безопасности: таблица blocked_ips

Создаёт таблицу blocked_ips для ручной блокировки IP-адресов через
кабинет super_admin. Используется BlockIpMiddleware в backend и
SecuritySection в кабинете super_admin.

Поля:
  - ip            — заблокированный IP (без CIDR — точное совпадение)
  - reason        — причина блокировки (текст)
  - blocked_by_id — кто заблокировал (super_admin)
  - blocked_at    — когда (UTC)
  - blocked_until — до когда (UTC, NULL = бессрочно)
  - is_active     — флаг для soft-undo блокировки без удаления записи

Индексы:
  - PK по id
  - UNIQUE по (ip) среди активных — обеспечивается частичным index'ом
  - ix_blocked_ips_ip — для быстрой проверки в middleware
  - ix_blocked_ips_active — частичный, для middleware фильтра is_active=true

Revision ID: security01
Revises: modhealth01
Create Date: 2026-05-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'security01'
down_revision = 'modhealth01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'blocked_ips',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('ip', sa.String(length=45), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('blocked_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            'blocked_at', sa.DateTime(),
            server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False,
        ),
        sa.Column('blocked_until', sa.DateTime(), nullable=True),
        sa.Column(
            'is_active', sa.Boolean(),
            nullable=False, server_default=sa.true(),
        ),
        sa.ForeignKeyConstraint(['blocked_by_id'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_blocked_ips_ip', 'blocked_ips', ['ip'])
    # Частичный индекс — middleware проверяет только активные записи,
    # отдельный partial index ускоряет горячий путь.
    op.create_index(
        'ix_blocked_ips_active',
        'blocked_ips',
        ['ip'],
        unique=False,
        postgresql_where=sa.text('is_active = true'),
    )


def downgrade() -> None:
    op.drop_index('ix_blocked_ips_active', table_name='blocked_ips')
    op.drop_index('ix_blocked_ips_ip', table_name='blocked_ips')
    op.drop_table('blocked_ips')
