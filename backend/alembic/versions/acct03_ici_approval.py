"""inter_clinic_invoices — approval workflow (pending_approval, approve, reject)

Revision ID: acct03_ici_approval
Revises: acct02_spendings
Create Date: 2026-05-18

Расширение flow межклиничных счетов:
- При отправке (mark_sent) статус теперь = 'pending_approval' (вместо 'sent')
- Manager клиники-получателя видит счёт и согласует/отклоняет
- approve  → status='approved' + snapshot ФИО руководителя для подписи
- reject   → status='rejected' + причина
- pay (accountant)    → status='paid' (только из 'approved')

Поля:
- approved_by_id   FK users          — кто согласовал (manager/owner/director)
- approved_at      timestamp          — когда согласовал
- approved_by_name varchar(200)       — snapshot ФИО для подписи (на случай ухода)
- approved_by_role varchar(40)        — snapshot роли ('manager' и т.п.)
- rejected_at      timestamp          — когда отклонил
- rejection_reason text                — причина отклонения

Старые статусы остаются совместимыми ('draft','sent','paid','cancelled' —
никак не ломаются), 'pending_approval','approved','rejected' добавляются как
свободные значения varchar (нет CHECK-ограничения).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'acct03_ici_approval'
down_revision = 'acct02_spendings'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('inter_clinic_invoices', sa.Column(
        'approved_by_id', UUID(as_uuid=True),
        sa.ForeignKey('users.id', ondelete='SET NULL'),
        nullable=True,
    ))
    op.add_column('inter_clinic_invoices', sa.Column(
        'approved_at', sa.DateTime, nullable=True,
    ))
    op.add_column('inter_clinic_invoices', sa.Column(
        'approved_by_name', sa.String(200), nullable=True,
    ))
    op.add_column('inter_clinic_invoices', sa.Column(
        'approved_by_role', sa.String(40), nullable=True,
    ))
    op.add_column('inter_clinic_invoices', sa.Column(
        'rejected_at', sa.DateTime, nullable=True,
    ))
    op.add_column('inter_clinic_invoices', sa.Column(
        'rejection_reason', sa.Text, nullable=True,
    ))


def downgrade():
    op.drop_column('inter_clinic_invoices', 'rejection_reason')
    op.drop_column('inter_clinic_invoices', 'rejected_at')
    op.drop_column('inter_clinic_invoices', 'approved_by_role')
    op.drop_column('inter_clinic_invoices', 'approved_by_name')
    op.drop_column('inter_clinic_invoices', 'approved_at')
    op.drop_column('inter_clinic_invoices', 'approved_by_id')
