"""inventory module — items + stocks + movements (W7)

Revision ID: inventory01
Revises: mrgcr01
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'inventory01'
down_revision = 'mrgcr01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ===== ENUM-типы =====
    inventory_category = postgresql.ENUM(
        'consumable', 'equipment', 'medication', 'reagent', 'other',
        name='inventory_category',
        create_type=True,
    )
    inventory_movement_type = postgresql.ENUM(
        'income', 'outgoing', 'transfer', 'adjustment', 'write_off', 'expired',
        name='inventory_movement_type',
        create_type=True,
    )
    bind = op.get_bind()
    inventory_category.create(bind, checkfirst=True)
    inventory_movement_type.create(bind, checkfirst=True)

    # ===== inventory_items =====
    op.create_table(
        'inventory_items',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('sku', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column(
            'category',
            postgresql.ENUM(
                'consumable', 'equipment', 'medication', 'reagent', 'other',
                name='inventory_category',
                create_type=False,
            ),
            nullable=False,
            server_default='consumable',
        ),
        sa.Column('unit', sa.String(length=20), nullable=False, server_default='шт'),
        sa.Column('barcode', sa.String(length=100), nullable=True),
        sa.Column('vendor', sa.String(length=200), nullable=True),
        sa.Column('cost_per_unit', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('min_stock_threshold', sa.Numeric(12, 3), nullable=False, server_default='0'),
        sa.Column('expiry_tracked', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('photo_url', sa.String(length=500), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('tenant_id', 'sku', name='uq_inventory_item_tenant_sku'),
    )
    op.create_index('ix_inventory_items_tenant_id', 'inventory_items', ['tenant_id'])
    op.create_index('ix_inventory_items_sku', 'inventory_items', ['sku'])
    op.create_index('ix_inventory_items_barcode', 'inventory_items', ['barcode'])

    # ===== inventory_stocks =====
    op.create_table(
        'inventory_stocks',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'item_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('inventory_items.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'clinic_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('clinics.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('quantity', sa.Numeric(12, 3), nullable=False, server_default='0'),
        sa.Column('expiry_date', sa.Date(), nullable=True),
        sa.Column('batch_number', sa.String(length=50), nullable=False, server_default=''),
        sa.Column('last_counted_at', sa.DateTime(), nullable=True),
        sa.UniqueConstraint(
            'item_id', 'clinic_id', 'batch_number',
            name='uq_inventory_stock_item_clinic_batch',
        ),
    )
    op.create_index('ix_inventory_stocks_tenant_id', 'inventory_stocks', ['tenant_id'])
    op.create_index('ix_inventory_stocks_item_clinic', 'inventory_stocks', ['item_id', 'clinic_id'])
    op.create_index('ix_inventory_stocks_expiry', 'inventory_stocks', ['expiry_date'])

    # ===== inventory_movements =====
    op.create_table(
        'inventory_movements',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'item_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('inventory_items.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'clinic_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('clinics.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'type',
            postgresql.ENUM(
                'income', 'outgoing', 'transfer', 'adjustment', 'write_off', 'expired',
                name='inventory_movement_type',
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column('quantity', sa.Numeric(12, 3), nullable=False),
        sa.Column('balance_after', sa.Numeric(12, 3), nullable=False),
        sa.Column('batch_number', sa.String(length=50), nullable=False, server_default=''),
        sa.Column('expiry_date', sa.Date(), nullable=True),
        sa.Column('ref_entity_type', sa.String(length=50), nullable=True),
        sa.Column('ref_entity_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column(
            'performed_by_user_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_inventory_movements_tenant_id', 'inventory_movements', ['tenant_id'])
    op.create_index(
        'ix_inventory_movements_item_clinic', 'inventory_movements',
        ['item_id', 'clinic_id'],
    )
    op.create_index('ix_inventory_movements_type', 'inventory_movements', ['type'])
    op.create_index(
        'ix_inventory_movements_created_at', 'inventory_movements', ['created_at'],
    )


def downgrade() -> None:
    op.drop_index('ix_inventory_movements_created_at', table_name='inventory_movements')
    op.drop_index('ix_inventory_movements_type', table_name='inventory_movements')
    op.drop_index('ix_inventory_movements_item_clinic', table_name='inventory_movements')
    op.drop_index('ix_inventory_movements_tenant_id', table_name='inventory_movements')
    op.drop_table('inventory_movements')

    op.drop_index('ix_inventory_stocks_expiry', table_name='inventory_stocks')
    op.drop_index('ix_inventory_stocks_item_clinic', table_name='inventory_stocks')
    op.drop_index('ix_inventory_stocks_tenant_id', table_name='inventory_stocks')
    op.drop_table('inventory_stocks')

    op.drop_index('ix_inventory_items_barcode', table_name='inventory_items')
    op.drop_index('ix_inventory_items_sku', table_name='inventory_items')
    op.drop_index('ix_inventory_items_tenant_id', table_name='inventory_items')
    op.drop_table('inventory_items')

    bind = op.get_bind()
    sa.Enum(name='inventory_movement_type').drop(bind, checkfirst=True)
    sa.Enum(name='inventory_category').drop(bind, checkfirst=True)
