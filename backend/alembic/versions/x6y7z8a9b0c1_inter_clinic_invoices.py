"""inter_clinic_invoices

Revision ID: x6y7z8a9b0c1
Revises: w5x6y7z8a9b0
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'x6y7z8a9b0c1'
down_revision = 'w5x6y7z8a9b0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'inter_clinic_invoices',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('invoice_number', sa.String(60), unique=True, nullable=False),
        sa.Column('issuer_clinic_id',    postgresql.UUID(as_uuid=True), sa.ForeignKey('clinics.id',   ondelete='SET NULL'), nullable=True),
        sa.Column('issuer_tenant_id',    postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id',   ondelete='SET NULL'), nullable=True),
        sa.Column('recipient_clinic_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('clinics.id',   ondelete='SET NULL'), nullable=True),
        sa.Column('recipient_tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id',   ondelete='SET NULL'), nullable=True),
        sa.Column('amount', sa.Numeric(12, 2), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('invoice_type', sa.String(30), server_default='manual', nullable=False),
        sa.Column('status', sa.String(20), server_default='draft', nullable=False),
        sa.Column('referral_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('referrals.id', ondelete='SET NULL'), nullable=True),
        sa.Column('due_date', sa.Date, nullable=True),
        sa.Column('paid_at', sa.DateTime, nullable=True),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_inter_clinic_invoices_invoice_number', 'inter_clinic_invoices', ['invoice_number'], unique=True)
    op.create_index('ix_ici_issuer_tenant',    'inter_clinic_invoices', ['issuer_tenant_id',    'status'])
    op.create_index('ix_ici_recipient_tenant', 'inter_clinic_invoices', ['recipient_tenant_id', 'status'])
    op.create_index('ix_ici_referral_id',      'inter_clinic_invoices', ['referral_id'])
    op.create_index('ix_ici_status',           'inter_clinic_invoices', ['status'])


def downgrade() -> None:
    op.drop_table('inter_clinic_invoices')
