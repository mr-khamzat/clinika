"""patient_portal — аккаунты пациентов + OTP

Revision ID: z8a9b0c1d2e3
Revises: y7z8a9b0c1d2
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'z8a9b0c1d2e3'
down_revision = 'y7z8a9b0c1d2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'patient_accounts',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('phone', sa.String(30), nullable=False, unique=True, index=True),
        sa.Column('name', sa.String(200), nullable=True),
        sa.Column('email', sa.String(200), nullable=True),
        sa.Column('birth_date', sa.Date, nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('last_login_at', sa.DateTime, nullable=True),
    )
    op.create_table(
        'patient_otps',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('phone', sa.String(30), nullable=False, index=True),
        sa.Column('code', sa.String(6), nullable=False),
        sa.Column('expires_at', sa.DateTime, nullable=False),
        sa.Column('is_used', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('patient_otps')
    op.drop_table('patient_accounts')
