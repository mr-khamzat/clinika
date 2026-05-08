"""sms_marketing module — templates + campaigns + message log

Revision ID: smsmkt01
Revises: loyalty01
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'smsmkt01'
# Параллельный агент Loyalty UI создал loyalty01 одновременно с telemed01-веткой:
# обе исходно указывали down_revision=telemed01 → multiple heads.
# Сериализуем: smsmkt01 теперь идёт после loyalty01.
down_revision = 'loyalty01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ===== ENUM-типы =====
    campaign_status = postgresql.ENUM(
        'draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled',
        name='sms_campaign_status',
        create_type=True,
    )
    audience_type = postgresql.ENUM(
        'sleeping_30d', 'sleeping_90d', 'specific_segment',
        'custom_phones', 'all_patients',
        name='sms_audience_type',
        create_type=True,
    )
    message_status = postgresql.ENUM(
        'queued', 'sent', 'delivered', 'failed', 'opted_out',
        name='sms_message_status',
        create_type=True,
    )
    sms_provider = postgresql.ENUM(
        'smsc', 'sms_aero', 'plivo', 'internal',
        name='sms_provider',
        create_type=True,
    )
    bind = op.get_bind()
    campaign_status.create(bind, checkfirst=True)
    audience_type.create(bind, checkfirst=True)
    message_status.create(bind, checkfirst=True)
    sms_provider.create(bind, checkfirst=True)

    # ===== sms_templates =====
    op.create_table(
        'sms_templates',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('variables', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            'is_active',
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        'ix_sms_templates_tenant_id', 'sms_templates', ['tenant_id']
    )
    op.create_index(
        'ix_sms_templates_is_active', 'sms_templates', ['is_active']
    )

    # ===== sms_campaigns =====
    op.create_table(
        'sms_campaigns',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'template_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('sms_templates.id', ondelete='RESTRICT'),
            nullable=False,
        ),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column(
            'status',
            postgresql.ENUM(
                'draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled',
                name='sms_campaign_status',
                create_type=False,
            ),
            nullable=False,
            server_default='draft',
        ),
        sa.Column('scheduled_at', sa.DateTime(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.Column(
            'audience_type',
            postgresql.ENUM(
                'sleeping_30d', 'sleeping_90d', 'specific_segment',
                'custom_phones', 'all_patients',
                name='sms_audience_type',
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column('audience_filter', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('total_recipients', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('sent_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('failed_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column(
            'created_by',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        'ix_sms_campaigns_tenant_id', 'sms_campaigns', ['tenant_id']
    )
    op.create_index(
        'ix_sms_campaigns_template_id', 'sms_campaigns', ['template_id']
    )
    op.create_index(
        'ix_sms_campaigns_status', 'sms_campaigns', ['status']
    )
    op.create_index(
        'ix_sms_campaigns_scheduled_at', 'sms_campaigns', ['scheduled_at']
    )

    # ===== sms_messages_log =====
    op.create_table(
        'sms_messages_log',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'campaign_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('sms_campaigns.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('patient_phone', sa.String(length=30), nullable=False),
        sa.Column('message_text', sa.Text(), nullable=False),
        sa.Column(
            'status',
            postgresql.ENUM(
                'queued', 'sent', 'delivered', 'failed', 'opted_out',
                name='sms_message_status',
                create_type=False,
            ),
            nullable=False,
            server_default='queued',
        ),
        sa.Column(
            'provider',
            postgresql.ENUM(
                'smsc', 'sms_aero', 'plivo', 'internal',
                name='sms_provider',
                create_type=False,
            ),
            nullable=True,
        ),
        sa.Column('provider_message_id', sa.String(length=200), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('sent_at', sa.DateTime(), nullable=True),
        sa.Column('delivered_at', sa.DateTime(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        'ix_sms_messages_log_campaign_id', 'sms_messages_log', ['campaign_id']
    )
    op.create_index(
        'ix_sms_messages_log_patient_phone', 'sms_messages_log', ['patient_phone']
    )
    op.create_index(
        'ix_sms_messages_log_status', 'sms_messages_log', ['status']
    )
    op.create_index(
        'ix_sms_messages_log_sent_at', 'sms_messages_log', ['sent_at']
    )


def downgrade() -> None:
    op.drop_index('ix_sms_messages_log_sent_at', table_name='sms_messages_log')
    op.drop_index('ix_sms_messages_log_status', table_name='sms_messages_log')
    op.drop_index('ix_sms_messages_log_patient_phone', table_name='sms_messages_log')
    op.drop_index('ix_sms_messages_log_campaign_id', table_name='sms_messages_log')
    op.drop_table('sms_messages_log')

    op.drop_index('ix_sms_campaigns_scheduled_at', table_name='sms_campaigns')
    op.drop_index('ix_sms_campaigns_status', table_name='sms_campaigns')
    op.drop_index('ix_sms_campaigns_template_id', table_name='sms_campaigns')
    op.drop_index('ix_sms_campaigns_tenant_id', table_name='sms_campaigns')
    op.drop_table('sms_campaigns')

    op.drop_index('ix_sms_templates_is_active', table_name='sms_templates')
    op.drop_index('ix_sms_templates_tenant_id', table_name='sms_templates')
    op.drop_table('sms_templates')

    bind = op.get_bind()
    sa.Enum(name='sms_provider').drop(bind, checkfirst=True)
    sa.Enum(name='sms_message_status').drop(bind, checkfirst=True)
    sa.Enum(name='sms_audience_type').drop(bind, checkfirst=True)
    sa.Enum(name='sms_campaign_status').drop(bind, checkfirst=True)
