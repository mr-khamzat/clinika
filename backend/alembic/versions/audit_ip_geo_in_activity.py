"""add ip and geo columns to activity_log

Revision ID: auditipgeo01
Revises: wizard1onboard1
Create Date: 2026-05-07

Добавляет в activity_log поля ip_address + geo_* — чтобы /admin -> Аудит
показывал откуда пользователь выполнил действие (особенно важно для логинов).
Audit log уже имел эти поля; activity_log не имел.
"""
from alembic import op
import sqlalchemy as sa


revision = 'auditipgeo01'
down_revision = 'wizard1onboard1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('activity_log', sa.Column('ip_address', sa.String(45), nullable=True))
    op.add_column('activity_log', sa.Column('user_agent', sa.String(500), nullable=True))
    op.add_column('activity_log', sa.Column('geo_country', sa.String(2), nullable=True))
    op.add_column('activity_log', sa.Column('geo_country_name', sa.String(100), nullable=True))
    op.add_column('activity_log', sa.Column('geo_region', sa.String(100), nullable=True))
    op.add_column('activity_log', sa.Column('geo_city', sa.String(100), nullable=True))
    op.add_column('activity_log', sa.Column('geo_lat', sa.Numeric(9, 6), nullable=True))
    op.add_column('activity_log', sa.Column('geo_lon', sa.Numeric(9, 6), nullable=True))


def downgrade() -> None:
    op.drop_column('activity_log', 'geo_lon')
    op.drop_column('activity_log', 'geo_lat')
    op.drop_column('activity_log', 'geo_city')
    op.drop_column('activity_log', 'geo_region')
    op.drop_column('activity_log', 'geo_country_name')
    op.drop_column('activity_log', 'geo_country')
    op.drop_column('activity_log', 'user_agent')
    op.drop_column('activity_log', 'ip_address')
