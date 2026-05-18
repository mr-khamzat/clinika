"""ads02: approval, tags, category, share_origin

Revision ID: ads02_improvements
Revises: sf05_polls
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "ads02_improvements"
down_revision = "external01"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("ads", sa.Column("approval_status", sa.String(20), nullable=False, server_default="approved"))
    op.add_column("ads", sa.Column("approval_note", sa.Text(), nullable=True))
    op.add_column("ads", sa.Column("approved_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    op.add_column("ads", sa.Column("approved_at", sa.DateTime(), nullable=True))
    op.add_column("ads", sa.Column("category", sa.String(50), nullable=True))
    op.add_column("ads", sa.Column("tags", JSONB(), nullable=True))
    op.add_column("ads", sa.Column("share_origin_ad_id", UUID(as_uuid=True), sa.ForeignKey("ads.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_ads_category", "ads", ["category"])
    op.create_index("ix_ads_share_origin", "ads", ["share_origin_ad_id"])
    op.create_index("ix_ads_approval", "ads", ["approval_status"])


def downgrade():
    op.drop_index("ix_ads_approval", table_name="ads")
    op.drop_index("ix_ads_share_origin", table_name="ads")
    op.drop_index("ix_ads_category", table_name="ads")
    op.drop_column("ads", "share_origin_ad_id")
    op.drop_column("ads", "tags")
    op.drop_column("ads", "category")
    op.drop_column("ads", "approved_at")
    op.drop_column("ads", "approved_by_id")
    op.drop_column("ads", "approval_note")
    op.drop_column("ads", "approval_status")
