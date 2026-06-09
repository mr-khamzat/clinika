"""nps_surveys — NPS-опрос пациента по итогам чат-треда

Revision ID: npssurvey01
Revises: ddbe13b8a531
Create Date: 2026-05-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'npssurvey01'
down_revision = 'ddbe13b8a531'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'nps_surveys',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True),
        sa.Column('clinic_id', UUID(as_uuid=True), sa.ForeignKey('clinics.id', ondelete='SET NULL'), nullable=True),
        sa.Column('patient_id', UUID(as_uuid=True), nullable=True),
        sa.Column('thread_id', UUID(as_uuid=True), nullable=True),
        sa.Column('score', sa.Integer, nullable=True),
        sa.Column('comment', sa.Text, nullable=True),
        sa.Column('sent_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('answered_at', sa.DateTime, nullable=True),
    )
    op.create_index('ix_nps_surveys_patient_id', 'nps_surveys', ['patient_id'])
    op.create_index('ix_nps_surveys_thread_id', 'nps_surveys', ['thread_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_nps_surveys_thread_id', table_name='nps_surveys')
    op.drop_index('ix_nps_surveys_patient_id', table_name='nps_surveys')
    op.drop_table('nps_surveys')
