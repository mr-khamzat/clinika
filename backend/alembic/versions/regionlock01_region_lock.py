"""region lock — allowed_region + region_strict on franchises

Revision ID: regionlock01
Revises: auditipgeo01
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa


revision = 'regionlock01'
down_revision = 'auditipgeo01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ===== Region Lock: географический контроль франшиз =====
    # allowed_region — код или название региона, в котором франшиза имеет право работать
    # (например "Ingushetia" / "RU-IN" / "Чеченская Республика").
    # NULL — франшиза не привязана к региону, проверки отключены.
    op.add_column(
        'franchises',
        sa.Column('allowed_region', sa.String(length=100), nullable=True),
    )
    # region_strict — режим. False (по умолчанию) — только алерт владельцу платформы.
    # True — после нарушения блокировать действие (Phase 2).
    op.add_column(
        'franchises',
        sa.Column(
            'region_strict',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        'ix_franchises_allowed_region',
        'franchises',
        ['allowed_region'],
    )


def downgrade() -> None:
    op.drop_index('ix_franchises_allowed_region', table_name='franchises')
    op.drop_column('franchises', 'region_strict')
    op.drop_column('franchises', 'allowed_region')
