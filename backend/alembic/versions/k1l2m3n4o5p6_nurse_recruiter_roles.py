"""Add nurse and recruiter roles, recruiter fields, doctor_clinic_access, recruiter_bonuses

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-04-17

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'k1l2m3n4o5p6'
down_revision = 'j0k1l2m3n4o5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Добавляем новые значения в enum userrole
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'nurse'")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'recruiter'")

    # 2. Добавляем поля в таблицу users
    op.add_column('users', sa.Column('email', sa.String(200), nullable=True))
    op.add_column('users', sa.Column('recruiter_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('users', sa.Column('bonus_percent', sa.Numeric(5, 2), nullable=True))

    # Индекс для email и recruiter_id
    op.create_index('ix_users_email', 'users', ['email'])
    op.create_index('ix_users_recruiter_id', 'users', ['recruiter_id'])

    # FK для recruiter_id
    op.create_foreign_key('fk_users_recruiter_id', 'users', 'users', ['recruiter_id'], ['id'], ondelete='SET NULL')

    # 3. Добавляем поля в таблицу invitations (если их нет)
    op.add_column('invitations', sa.Column('email', sa.String(200), nullable=True))
    op.add_column('invitations', sa.Column('recruiter_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('invitations', sa.Column('clinic_access', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.add_column('invitations', sa.Column('is_used', sa.Boolean(), nullable=False, server_default='false'))
    op.create_index('ix_invitations_email', 'invitations', ['email'])
    op.create_foreign_key('fk_invitations_recruiter_id', 'invitations', 'users', ['recruiter_id'], ['id'])
    # clinic_id теперь nullable
    op.alter_column('invitations', 'clinic_id', nullable=True)

    # 4. Таблица doctor_clinic_access
    op.create_table(
        'doctor_clinic_access',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('doctor_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('clinic_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('clinics.id', ondelete='CASCADE'), nullable=False),
        sa.Column('granted_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_doctor_clinic_access_doctor_id', 'doctor_clinic_access', ['doctor_id'])

    # 5. Таблица recruiter_bonuses
    op.create_table(
        'recruiter_bonuses',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='SET NULL'), nullable=True),
        sa.Column('recruiter_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('doctor_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('referral_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('referrals.id', ondelete='CASCADE'), nullable=False),
        sa.Column('source_bonus_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('bonuses.id', ondelete='SET NULL'), nullable=True),
        sa.Column('percent_applied', sa.Numeric(5, 2), nullable=False),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('status', sa.Enum('pending', 'paid', name='recruiterbonusstatus'), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('paid_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_recruiter_bonuses_recruiter_id', 'recruiter_bonuses', ['recruiter_id'])
    op.create_index('ix_recruiter_bonuses_doctor_id', 'recruiter_bonuses', ['doctor_id'])
    op.create_index('ix_recruiter_bonuses_tenant_id', 'recruiter_bonuses', ['tenant_id'])


def downgrade() -> None:
    op.drop_table('recruiter_bonuses')
    op.drop_table('doctor_clinic_access')
    op.drop_column('invitations', 'is_used')
    op.drop_column('invitations', 'clinic_access')
    op.drop_column('invitations', 'recruiter_id')
    op.drop_column('invitations', 'email')
    op.drop_column('users', 'bonus_percent')
    op.drop_column('users', 'recruiter_id')
    op.drop_column('users', 'email')
