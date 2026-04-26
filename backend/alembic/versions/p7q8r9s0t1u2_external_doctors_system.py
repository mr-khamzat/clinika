"""
External doctors system: acquisition_manager, external_doctor, visiting_doctor roles,
doctor_requests table, visiting_doctor_settings table,
extend appointments (price, qr_code), extend referrals (assigned_doctor_id, appointment_id),
extend users (doctor_type, manager_id)

Revision ID: p7q8r9s0t1u2
Revises: o6p7q8r9s0t1
Create Date: 2026-04-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'p7q8r9s0t1u2'
down_revision = 'o6p7q8r9s0t1'
branch_labels = None
depends_on = None


def upgrade():
    # ── 1. New role values (IF NOT EXISTS — idempotent) ──────────────────────
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'acquisition_manager'")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'external_doctor'")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'visiting_doctor'")

    # ── 2. Extend users ──────────────────────────────────────────────────────
    op.add_column('users', sa.Column('doctor_type', sa.String(20), nullable=True))
    op.add_column('users', sa.Column('manager_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('ix_users_manager_id', 'users', ['manager_id'])
    op.create_foreign_key(
        'fk_users_manager_id', 'users', 'users',
        ['manager_id'], ['id'], ondelete='SET NULL'
    )

    # ── 3. doctor_requests table ──────────────────────────────────────────────
    op.create_table(
        'doctor_requests',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('manager_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('doctor_name', sa.String(200), nullable=False),
        sa.Column('phone', sa.String(20), nullable=True),
        sa.Column('clinic_name', sa.String(200), nullable=True),
        sa.Column('specialization', sa.String(100), nullable=True),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.text('now()')),
        sa.Column('approved_at', sa.DateTime, nullable=True),
        sa.Column('approved_by_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )

    # ── 4. visiting_doctor_settings table ────────────────────────────────────
    op.create_table(
        'visiting_doctor_settings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('doctor_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('clinic_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('clinics.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('price_per_visit', sa.Numeric(10, 2), nullable=False),
        sa.Column('doctor_percent', sa.Numeric(5, 2), nullable=False, server_default='70'),
        sa.Column('start_date', sa.Date, nullable=True),
        sa.Column('end_date', sa.Date, nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.text('now()')),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )

    # ── 5. Extend appointments ────────────────────────────────────────────────
    op.add_column('appointments', sa.Column('price', sa.Numeric(10, 2), nullable=True))
    op.add_column('appointments', sa.Column('qr_code', sa.Text, nullable=True))

    # ── 6. Extend referrals ───────────────────────────────────────────────────
    op.add_column('referrals', sa.Column('assigned_doctor_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('referrals', sa.Column('appointment_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_referrals_assigned_doctor_id', 'referrals', 'users',
        ['assigned_doctor_id'], ['id'], ondelete='SET NULL'
    )
    op.create_foreign_key(
        'fk_referrals_appointment_id', 'referrals', 'appointments',
        ['appointment_id'], ['id'], ondelete='SET NULL'
    )


def downgrade():
    op.drop_constraint('fk_referrals_appointment_id', 'referrals', type_='foreignkey')
    op.drop_constraint('fk_referrals_assigned_doctor_id', 'referrals', type_='foreignkey')
    op.drop_column('referrals', 'appointment_id')
    op.drop_column('referrals', 'assigned_doctor_id')
    op.drop_column('appointments', 'qr_code')
    op.drop_column('appointments', 'price')
    op.drop_table('visiting_doctor_settings')
    op.drop_table('doctor_requests')
    op.drop_constraint('fk_users_manager_id', 'users', type_='foreignkey')
    op.drop_index('ix_users_manager_id', 'users')
    op.drop_column('users', 'manager_id')
    op.drop_column('users', 'doctor_type')
