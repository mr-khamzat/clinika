"""franchise — иерархия Платформа → Франшиза → Тенант

Revision ID: a1b2c3d4e5f6
Revises: f5a6b7c8d9e0
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 's5t6u7v8w9x0'
down_revision = 't6u7v8w9x0y1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Таблица franchises ───────────────────────────────────────────────────
    op.create_table(
        'franchises',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('slug', sa.String(50), nullable=False, unique=True),
        sa.Column('owner_user_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('contact_email', sa.String(200), nullable=True),
        sa.Column('contact_phone', sa.String(50), nullable=True),
        sa.Column('brand_color', sa.String(20), nullable=True),
        sa.Column('logo_url', sa.String(500), nullable=True),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_franchises_slug', 'franchises', ['slug'], unique=True)
    op.create_index('ix_franchises_owner_user_id', 'franchises', ['owner_user_id'])

    # ── Расширяем tenants: добавляем franchise_id ────────────────────────────
    op.add_column(
        'tenants',
        sa.Column('franchise_id', UUID(as_uuid=True),
                  sa.ForeignKey('franchises.id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index('ix_tenants_franchise_id', 'tenants', ['franchise_id'])

    # ── Data-migration: для каждого тенанта с franchise_owner_id создаём
    # соответствующую запись Franchise и связываем tenant.franchise_id.
    # Логика: один тенант → одна франшиза (с тем же владельцем). Позднее
    # franchise_owner может добавить новые тенанты в эту же франшизу.
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, name, slug, franchise_owner_id FROM tenants "
        "WHERE franchise_owner_id IS NOT NULL AND franchise_id IS NULL"
    )).fetchall()

    import uuid as _uuid

    used_slugs: set[str] = set()
    existing_slugs = bind.execute(sa.text("SELECT slug FROM franchises")).fetchall()
    for r in existing_slugs:
        used_slugs.add(r[0])

    for r in rows:
        tenant_id, tenant_name, tenant_slug, owner_id = r[0], r[1], r[2], r[3]
        base_slug = (tenant_slug or "fr")[:40]
        uniq_slug = base_slug
        counter = 1
        while uniq_slug in used_slugs:
            counter += 1
            uniq_slug = f"{base_slug}-{counter}"
        used_slugs.add(uniq_slug)

        new_franchise_id = _uuid.uuid4()
        bind.execute(sa.text(
            "INSERT INTO franchises (id, name, slug, owner_user_id, is_active, created_at, updated_at) "
            "VALUES (:id, :name, :slug, :owner, TRUE, NOW(), NOW())"
        ), {
            "id": new_franchise_id,
            "name": f"Франшиза {tenant_name}",
            "slug": uniq_slug,
            "owner": owner_id,
        })
        bind.execute(sa.text(
            "UPDATE tenants SET franchise_id = :fid WHERE id = :tid"
        ), {"fid": new_franchise_id, "tid": tenant_id})


def downgrade() -> None:
    op.drop_index('ix_tenants_franchise_id', table_name='tenants')
    op.drop_column('tenants', 'franchise_id')
    op.drop_index('ix_franchises_owner_user_id', table_name='franchises')
    op.drop_index('ix_franchises_slug', table_name='franchises')
    op.drop_table('franchises')
