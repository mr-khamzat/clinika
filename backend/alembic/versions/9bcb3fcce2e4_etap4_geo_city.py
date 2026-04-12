"""etap4_geo_city

Revision ID: 9bcb3fcce2e4
Revises: 3bb50c97a428
Create Date: 2026-04-12 05:43:39.035366

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '9bcb3fcce2e4'
down_revision: Union[str, None] = '3bb50c97a428'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Этап 4: таблица городов ───────────────────────────────────────────────
    op.create_table(
        'cities',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('region', sa.String(100), nullable=True),
        sa.Column('country', sa.String(10), nullable=False, server_default=sa.text("'RU'")),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_cities_name', 'cities', ['name'])

    # ── Этап 4: geo колонки в clinics ─────────────────────────────────────────
    op.add_column('clinics', sa.Column('city_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('clinics', sa.Column('city', sa.String(100), nullable=True))
    op.add_column('clinics', sa.Column('region', sa.String(100), nullable=True))
    op.add_column('clinics', sa.Column('latitude', sa.Float(), nullable=True))
    op.add_column('clinics', sa.Column('longitude', sa.Float(), nullable=True))
    op.create_index('ix_clinics_city', 'clinics', ['city'])
    op.create_index('ix_clinics_city_id', 'clinics', ['city_id'])
    op.create_foreign_key('fk_clinics_city_id', 'clinics', 'cities', ['city_id'], ['id'], ondelete='SET NULL')




def downgrade() -> None:
    op.drop_constraint('fk_clinics_city_id', 'clinics', type_='foreignkey')
    op.drop_index('ix_clinics_city_id', table_name='clinics')
    op.drop_index('ix_clinics_city', table_name='clinics')
    op.drop_column('clinics', 'longitude')
    op.drop_column('clinics', 'latitude')
    op.drop_column('clinics', 'region')
    op.drop_column('clinics', 'city')
    op.drop_column('clinics', 'city_id')
    op.drop_index('ix_cities_name', table_name='cities')
    op.drop_table('cities')


