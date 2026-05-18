"""ce01: patient engagement hub (login tracking, tags, notes, prefs, segments, templates, campaigns, suggestions, NPS)

Revision ID: ce01_patient_engagement
Revises: ads02_improvements
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "ce01_patient_engagement"
down_revision = "ads02_improvements"
branch_labels = None
depends_on = None


def upgrade():
    # === patient_accounts расширение ===
    op.add_column("patient_accounts", sa.Column("login_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("patient_accounts", sa.Column("last_seen_at", sa.DateTime(), nullable=True))
    op.add_column("patient_accounts", sa.Column("marketing_opt_in", sa.Boolean(), nullable=False, server_default="true"))
    op.create_index("ix_patient_accounts_last_seen", "patient_accounts", ["last_seen_at"])

    # === patient_tags ===
    op.create_table(
        "patient_tags",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("patient_id", UUID(as_uuid=True), sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tag", sa.String(50), nullable=False),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("created_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_patient_tags_tenant", "patient_tags", ["tenant_id"])
    op.create_index("ix_patient_tags_patient", "patient_tags", ["patient_id"])
    op.create_unique_constraint("uq_patient_tag", "patient_tags", ["patient_id", "tag"])

    # === patient_notes ===
    op.create_table(
        "patient_notes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("patient_id", UUID(as_uuid=True), sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_patient_notes_patient", "patient_notes", ["patient_id"])

    # === patient_comm_prefs ===
    op.create_table(
        "patient_comm_prefs",
        sa.Column("patient_id", UUID(as_uuid=True), sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("promo", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("reminders", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("loyalty", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("news", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("quiet_hours_from", sa.Integer(), nullable=True),
        sa.Column("quiet_hours_to", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    # === patient_segments ===
    op.create_table(
        "patient_segments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("filter_json", JSONB(), nullable=True),
        sa.Column("is_dynamic", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("snapshot_patient_ids", JSONB(), nullable=True),
        sa.Column("last_resolved_count", sa.Integer(), nullable=True),
        sa.Column("last_resolved_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_patient_segments_tenant", "patient_segments", ["tenant_id"])

    # === push_templates ===
    op.create_table(
        "push_templates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),  # welcome/birthday/abandonment/nps/anniversary/churn/custom
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("icon_url", sa.String(500), nullable=True),
        sa.Column("link", sa.String(500), nullable=True),
        sa.Column("variables_used", JSONB(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_push_templates_tenant", "push_templates", ["tenant_id"])
    op.create_index("ix_push_templates_category", "push_templates", ["category"])

    # === push_campaigns ===
    op.create_table(
        "push_campaigns",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("template_id", UUID(as_uuid=True), sa.ForeignKey("push_templates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("template_b_id", UUID(as_uuid=True), sa.ForeignKey("push_templates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("segment_id", UUID(as_uuid=True), sa.ForeignKey("patient_segments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("ab_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),  # draft/scheduled/sending/sent/failed
        sa.Column("sent_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delivered_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("click_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("conversion_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("a_sent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("b_sent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("a_click", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("b_click", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("scheduled_at", sa.DateTime(), nullable=True),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_push_campaigns_tenant", "push_campaigns", ["tenant_id"])
    op.create_index("ix_push_campaigns_status", "push_campaigns", ["status"])

    # === engagement_suggestions ===
    op.create_table(
        "engagement_suggestions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("patient_id", UUID(as_uuid=True), sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(50), nullable=False),  # welcome/birthday/abandonment/nps/anniversary/churn_30d/60d/90d
        sa.Column("template_id", UUID(as_uuid=True), sa.ForeignKey("push_templates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),  # pending/sent/dismissed/postponed/auto_blocked
        sa.Column("postponed_until", sa.DateTime(), nullable=True),
        sa.Column("reviewed_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("sent_campaign_id", UUID(as_uuid=True), sa.ForeignKey("push_campaigns.id", ondelete="SET NULL"), nullable=True),
        sa.Column("meta", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_engagement_suggestions_tenant", "engagement_suggestions", ["tenant_id"])
    op.create_index("ix_engagement_suggestions_patient", "engagement_suggestions", ["patient_id"])
    op.create_index("ix_engagement_suggestions_status", "engagement_suggestions", ["status"])
    op.create_index("ix_engagement_suggestions_kind", "engagement_suggestions", ["kind"])

    # === nps_responses ===
    op.create_table(
        "nps_responses",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("patient_id", UUID(as_uuid=True), sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("appointment_id", UUID(as_uuid=True), nullable=True),
        sa.Column("score", sa.Integer(), nullable=False),  # 0..10
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("source", sa.String(30), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_nps_responses_tenant", "nps_responses", ["tenant_id"])
    op.create_index("ix_nps_responses_patient", "nps_responses", ["patient_id"])


def downgrade():
    op.drop_index("ix_nps_responses_patient", table_name="nps_responses")
    op.drop_index("ix_nps_responses_tenant", table_name="nps_responses")
    op.drop_table("nps_responses")
    for idx in ("ix_engagement_suggestions_kind", "ix_engagement_suggestions_status", "ix_engagement_suggestions_patient", "ix_engagement_suggestions_tenant"):
        op.drop_index(idx, table_name="engagement_suggestions")
    op.drop_table("engagement_suggestions")
    for idx in ("ix_push_campaigns_status", "ix_push_campaigns_tenant"):
        op.drop_index(idx, table_name="push_campaigns")
    op.drop_table("push_campaigns")
    for idx in ("ix_push_templates_category", "ix_push_templates_tenant"):
        op.drop_index(idx, table_name="push_templates")
    op.drop_table("push_templates")
    op.drop_index("ix_patient_segments_tenant", table_name="patient_segments")
    op.drop_table("patient_segments")
    op.drop_table("patient_comm_prefs")
    op.drop_index("ix_patient_notes_patient", table_name="patient_notes")
    op.drop_table("patient_notes")
    op.drop_constraint("uq_patient_tag", "patient_tags", type_="unique")
    op.drop_index("ix_patient_tags_patient", table_name="patient_tags")
    op.drop_index("ix_patient_tags_tenant", table_name="patient_tags")
    op.drop_table("patient_tags")
    op.drop_index("ix_patient_accounts_last_seen", table_name="patient_accounts")
    op.drop_column("patient_accounts", "marketing_opt_in")
    op.drop_column("patient_accounts", "last_seen_at")
    op.drop_column("patient_accounts", "login_count")
