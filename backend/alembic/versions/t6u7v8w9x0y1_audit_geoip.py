"""audit geoip — добавляет поля geo_country/region/city/lat/lon в audit_log

Revision ID: a9b0c1d2e3f4
Revises: a7b8c9d0e1f2
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa


revision = 't6u7v8w9x0y1'
down_revision = 'a7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('audit_log', sa.Column('geo_country', sa.String(2), nullable=True))
    op.add_column('audit_log', sa.Column('geo_country_name', sa.String(80), nullable=True))
    op.add_column('audit_log', sa.Column('geo_region', sa.String(120), nullable=True))
    op.add_column('audit_log', sa.Column('geo_city', sa.String(120), nullable=True))
    op.add_column('audit_log', sa.Column('geo_lat', sa.Numeric(9, 6), nullable=True))
    op.add_column('audit_log', sa.Column('geo_lon', sa.Numeric(9, 6), nullable=True))
    op.create_index('ix_audit_log_geo_country', 'audit_log', ['geo_country'])


def downgrade() -> None:
    op.drop_index('ix_audit_log_geo_country', table_name='audit_log')
    op.drop_column('audit_log', 'geo_lon')
    op.drop_column('audit_log', 'geo_lat')
    op.drop_column('audit_log', 'geo_city')
    op.drop_column('audit_log', 'geo_region')
    op.drop_column('audit_log', 'geo_country_name')
    op.drop_column('audit_log', 'geo_country')
