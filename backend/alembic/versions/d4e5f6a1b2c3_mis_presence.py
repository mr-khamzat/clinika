"""МИС + Presence + Notifications — Этап 15"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'd4e5f6a1b2c3'
down_revision = 'c3d4e5f6a1b2'
branch_labels = None
depends_on = None


def upgrade():
    # ── Расширить таблицу doctors ────────────────────────────────────────
    op.add_column('doctors', sa.Column('mis_id', sa.Integer(), nullable=True))

    # ── Расширить таблицу services ───────────────────────────────────────
    op.add_column('services', sa.Column('description', sa.Text(), nullable=True))
    op.add_column('services', sa.Column('preparation', sa.Text(), nullable=True))
    op.add_column('services', sa.Column('lab', sa.String(200), nullable=True))
    op.add_column('services', sa.Column('duration', sa.Integer(), nullable=True))

    # ── user_presence ────────────────────────────────────────────────────
    op.create_table(
        'user_presence',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='offline'),
        sa.Column('status_text', sa.String(100), nullable=True),
        sa.Column('last_seen_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_user_presence_user_id', 'user_presence', ['user_id'])

    # ── call_permissions ─────────────────────────────────────────────────
    op.create_table(
        'call_permissions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True),
        sa.Column('from_role', sa.String(50), nullable=False),
        sa.Column('to_role', sa.String(50), nullable=False),
        sa.Column('can_call', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('can_video', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('same_clinic_only', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.create_index('ix_call_permissions_tenant', 'call_permissions', ['tenant_id'])

    # ── notification_settings ────────────────────────────────────────────
    op.create_table(
        'notification_settings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True),
        sa.Column('role', sa.String(50), nullable=False),
        sa.Column('events', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('channels', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_notification_settings_tenant', 'notification_settings', ['tenant_id'])

    # ── call_logs ────────────────────────────────────────────────────────
    op.create_table(
        'call_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True),
        sa.Column('caller_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('callee_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('outcome', sa.String(20), nullable=False, server_default='missed'),
        sa.Column('duration_sec', sa.Integer(), nullable=True),
        sa.Column('call_type', sa.String(10), nullable=False, server_default='audio'),
        sa.Column('started_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('ended_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_call_logs_tenant', 'call_logs', ['tenant_id'])
    op.create_index('ix_call_logs_caller', 'call_logs', ['caller_id'])

    # ── Дефолтные разрешения на звонки (для существующих тенантов) ─────
    op.execute("""
        INSERT INTO call_permissions (id, tenant_id, from_role, to_role, can_call, can_video, same_clinic_only)
        SELECT gen_random_uuid(), t.id, fr.r, to_r.r,
               CASE WHEN (fr.r, to_r.r) IN (
                   ('admin','admin'), ('admin','manager'), ('manager','admin'),
                   ('manager','manager'), ('manager','partner')
               ) THEN true ELSE false END,
               false, false
        FROM tenants t
        CROSS JOIN (VALUES ('admin'),('manager'),('partner')) AS fr(r)
        CROSS JOIN (VALUES ('admin'),('manager'),('partner')) AS to_r(r)
        ON CONFLICT DO NOTHING
    """)


def downgrade():
    op.drop_table('call_logs')
    op.drop_table('notification_settings')
    op.drop_table('call_permissions')
    op.drop_table('user_presence')
    op.drop_column('services', 'duration')
    op.drop_column('services', 'lab')
    op.drop_column('services', 'preparation')
    op.drop_column('services', 'description')
    op.drop_column('doctors', 'mis_id')
