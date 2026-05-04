"""premium_patient_features: reminders_sent, cancel_reason, family_members, prep_instructions

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'e4f5a6b7c8d9'
down_revision = 'd3e4f5a6b7c8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Appointment.reminders_sent + cancel_reason ──
    op.add_column(
        'appointments',
        sa.Column(
            'reminders_sent',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        'appointments',
        sa.Column('cancel_reason', sa.Text(), nullable=True),
    )

    # ── 2. patient_family_members (Семейный аккаунт) ──
    op.create_table(
        'patient_family_members',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('owner_phone', sa.String(30), nullable=False),
        sa.Column('member_phone', sa.String(30), nullable=False),
        sa.Column('member_name', sa.String(200), nullable=True),
        sa.Column('relation', sa.String(50), nullable=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(
        'ix_patient_family_members_owner_phone',
        'patient_family_members',
        ['owner_phone'],
    )
    op.create_index(
        'ix_patient_family_members_member_phone',
        'patient_family_members',
        ['member_phone'],
    )
    op.create_unique_constraint(
        'uq_family_owner_member',
        'patient_family_members',
        ['owner_phone', 'member_phone'],
    )

    # ── 3. services.prep_instructions ──
    # Отдельное поле от существующего 'preparation' (которое МИС перезаписывает),
    # чтобы клиника могла редактировать инструкции пациенту независимо
    op.add_column(
        'services',
        sa.Column('prep_instructions', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('services', 'prep_instructions')
    op.drop_constraint('uq_family_owner_member', 'patient_family_members', type_='unique')
    op.drop_index('ix_patient_family_members_member_phone', table_name='patient_family_members')
    op.drop_index('ix_patient_family_members_owner_phone', table_name='patient_family_members')
    op.drop_table('patient_family_members')
    op.drop_column('appointments', 'cancel_reason')
    op.drop_column('appointments', 'reminders_sent')
