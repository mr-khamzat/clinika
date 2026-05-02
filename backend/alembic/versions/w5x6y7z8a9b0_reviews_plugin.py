"""w5x6y7z8a9b0_reviews_plugin

Revision ID: w5x6y7z8a9b0
Revises: v4w5x6y7z8a9
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'w5x6y7z8a9b0'
down_revision = 'v4w5x6y7z8a9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'reviews',
        sa.Column('id',             UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id',      UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True, index=True),
        sa.Column('appointment_id', UUID(as_uuid=True), sa.ForeignKey('appointments.id', ondelete='SET NULL'), nullable=True, unique=True),
        sa.Column('doctor_id',      UUID(as_uuid=True), sa.ForeignKey('doctors.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('clinic_id',      UUID(as_uuid=True), sa.ForeignKey('clinics.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('patient_name',   sa.String(200), nullable=True),
        sa.Column('patient_phone',  sa.String(20),  nullable=True, index=True),
        sa.Column('rating',         sa.SmallInteger, nullable=False),
        sa.Column('comment',        sa.Text,         nullable=True),
        sa.Column('status',         sa.String(20),   nullable=False, server_default='pending', index=True),
        sa.Column('moderator_id',   UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('moderated_at',   sa.DateTime,     nullable=True),
        sa.Column('is_anonymous',   sa.Boolean,      nullable=False, server_default='false'),
        sa.Column('created_at',     sa.DateTime,     nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at',     sa.DateTime,     nullable=False, server_default=sa.text('now()')),
    )


def downgrade():
    op.drop_table('reviews')
