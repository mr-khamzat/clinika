"""tenant_visibility — матрица видимости между клиниками франшизы

Revision ID: tvis01_tenant_visibility
Revises: xref01_cross_clinic, stcc01_cross_tenant_rooms
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa


revision = "tvis01_tenant_visibility"
down_revision = ("xref01_cross_clinic", "stcc01_cross_tenant_rooms")
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "tenant_visibility",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("viewer_tenant_id", sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_tenant_id", sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("allow_chat", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("allow_calls", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("viewer_tenant_id", "target_tenant_id", name="uq_tenant_visibility_pair"),
    )
    op.create_index("ix_tenant_visibility_viewer", "tenant_visibility", ["viewer_tenant_id"])


def downgrade():
    op.drop_index("ix_tenant_visibility_viewer", table_name="tenant_visibility")
    op.drop_table("tenant_visibility")
