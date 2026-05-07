"""rbac1per1mis1 — tenant_permission_overrides (Этап 8 ROADMAP)

RBAC как данные: позволяем тенанту переопределить базовую матрицу прав
(ROLE_PERMISSIONS из app.core.permissions). Уникальность: (tenant_id, role).

Revision ID: rbac1per1mis1
Revises: sla1day1day1
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = 'rbac1per1mis1'
down_revision = 'sla1day1day1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'tenant_permission_overrides',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'tenant_id',
            UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'),
            nullable=False,
            index=True,
        ),
        sa.Column('role', sa.String(length=30), nullable=False),
        sa.Column(
            'permissions',
            JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            'updated_by_user_id',
            UUID(as_uuid=True),
            sa.ForeignKey('users.id'),
            nullable=True,
        ),
        sa.UniqueConstraint('tenant_id', 'role', name='uq_tenant_role'),
    )
    # Индекс tenant_id создаётся автоматически из index=True в Column выше.


def downgrade() -> None:
    op.drop_table('tenant_permission_overrides')
