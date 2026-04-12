"""etap5_scheduling

Revision ID: f8fec11962e4
Revises: 9bcb3fcce2e4
Create Date: 2026-04-12 10:06:14.340167

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f8fec11962e4'
down_revision: Union[str, None] = '9bcb3fcce2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Этап 5: врачи ─────────────────────────────────────────────────────────
    op.create_table(
        'doctors',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('clinic_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('full_name', sa.String(200), nullable=False),
        sa.Column('specialty', sa.String(100), nullable=True),
        sa.Column('photo_url', sa.String(500), nullable=True),
        sa.Column('bio', sa.Text(), nullable=True),
        sa.Column('slot_duration', sa.Integer(), nullable=False, server_default=sa.text('30')),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_doctors_clinic_id', 'doctors', ['clinic_id'])
    op.create_index('ix_doctors_tenant_id', 'doctors', ['tenant_id'])

    # ── Этап 5: расписание врачей (шаблон) ───────────────────────────────────
    op.create_table(
        'doctor_schedules',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('doctor_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('day_of_week', sa.Integer(), nullable=False),
        sa.Column('start_time', sa.Time(), nullable=False),
        sa.Column('end_time', sa.Time(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_doctor_schedules_doctor_id', 'doctor_schedules', ['doctor_id'])

    # ── Этап 5: записи на приём ───────────────────────────────────────────────
    op.create_table(
        'appointments',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('doctor_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('clinic_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('referral_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('patient_phone', sa.String(20), nullable=False),
        sa.Column('patient_name', sa.String(200), nullable=True),
        sa.Column('appointment_date', sa.Date(), nullable=False),
        sa.Column('start_time', sa.Time(), nullable=False),
        sa.Column('end_time', sa.Time(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['doctor_id'],   ['doctors.id'],   ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['clinic_id'],   ['clinics.id']),
        sa.ForeignKeyConstraint(['referral_id'], ['referrals.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'],   ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['tenant_id'],   ['tenants.id'],   ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_appointments_doctor_id',   'appointments', ['doctor_id'])
    op.create_index('ix_appointments_clinic_id',   'appointments', ['clinic_id'])
    op.create_index('ix_appointments_date',        'appointments', ['appointment_date'])
    op.create_index('ix_appointments_status',      'appointments', ['status'])
    op.create_index('ix_appointments_patient',     'appointments', ['patient_phone'])
    op.create_index('ix_appointments_tenant_id',   'appointments', ['tenant_id'])




def downgrade() -> None:
    op.drop_table('appointments')
    op.drop_table('doctor_schedules')
    op.drop_table('doctors')


