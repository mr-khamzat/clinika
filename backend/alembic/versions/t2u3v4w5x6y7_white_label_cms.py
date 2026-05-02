"""white_label_cms

Revision ID: t2u3v4w5x6y7
Revises: s1t2u3v4w5x6
Create Date: 2026-05-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

revision = "t2u3v4w5x6y7"
down_revision = "s1t2u3v4w5x6"
branch_labels = None
depends_on = None


def upgrade():
    # Extend tenant_branding with new white-label fields
    op.add_column("tenant_branding", sa.Column("secondary_color", sa.String(20), nullable=True, server_default="#E0F7FA"))
    op.add_column("tenant_branding", sa.Column("favicon_url", sa.String(500), nullable=True))
    op.add_column("tenant_branding", sa.Column("og_image_url", sa.String(500), nullable=True))
    op.add_column("tenant_branding", sa.Column("footer_text", sa.String(500), nullable=True))
    op.add_column("tenant_branding", sa.Column("custom_domain", sa.String(255), nullable=True))
    op.add_column("tenant_branding", sa.Column("domain_verified", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("tenant_branding", sa.Column("meta_title", sa.String(200), nullable=True))
    op.add_column("tenant_branding", sa.Column("meta_description", sa.String(500), nullable=True))
    op.add_column("tenant_branding", sa.Column("support_phone", sa.String(50), nullable=True))
    op.add_column("tenant_branding", sa.Column("support_email", sa.String(200), nullable=True))
    op.add_column("tenant_branding", sa.Column("hide_menu_items", JSONB(), nullable=True, server_default="[]"))
    op.add_column("tenant_branding", sa.Column("rename_menu_items", JSONB(), nullable=True, server_default="{}"))

    # Create tenant_cms_pages table
    op.create_table(
        "tenant_cms_pages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(200), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("content_md", sa.Text(), nullable=True),
        sa.Column("content_blocks", JSONB(), nullable=True, server_default="[]"),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("page_type", sa.String(50), nullable=False, server_default="info"),
        sa.Column("show_in_menu", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("menu_title", sa.String(200), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("seo_title", sa.String(200), nullable=True),
        sa.Column("seo_description", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_tenant_cms_pages_slug"),
    )
    op.create_index("ix_tenant_cms_pages_tenant_id", "tenant_cms_pages", ["tenant_id"])
    op.create_index("ix_tenant_cms_pages_published", "tenant_cms_pages", ["tenant_id", "is_published"])


def downgrade():
    op.drop_table("tenant_cms_pages")
    for col in ["secondary_color","favicon_url","og_image_url","footer_text","custom_domain",
                "domain_verified","meta_title","meta_description","support_phone","support_email",
                "hide_menu_items","rename_menu_items"]:
        op.drop_column("tenant_branding", col)
