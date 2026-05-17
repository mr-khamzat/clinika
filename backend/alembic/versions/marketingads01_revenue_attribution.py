"""marketing channels + ad spend + patient attribution

Revision ID: marketingads01
Revises: invcost01
Create Date: 2026-05-15

Цель: реальные данные доходов с рекламы для DirectorMarketing.
  - marketing_channels  — справочник каналов (yandex_direct, google_ads, instagram_ads ...)
  - ad_spend_entries    — расходы на рекламу (помесячно или по кампаниям)
  - patient_attribution — атрибуция пациента к каналу (utm + first/last touch)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# Идентификаторы миграции
revision = "marketingads01"
down_revision = "invcost01"
branch_labels = None
depends_on = None


def upgrade():
    # ────────────────────────────────────────────────────────────────────
    # 1. marketing_channels — справочник каналов
    # ────────────────────────────────────────────────────────────────────
    op.create_table(
        "marketing_channels",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=True),  # NULL = глобальный системный канал
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("icon", sa.String(50), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("TRUE")),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_mc_tenant", "marketing_channels", ["tenant_id"])
    op.create_index("ix_mc_code", "marketing_channels", ["code"])

    # ────────────────────────────────────────────────────────────────────
    # 2. ad_spend_entries — рекламные расходы
    # ────────────────────────────────────────────────────────────────────
    op.create_table(
        "ad_spend_entries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("clinic_id", UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("channel_id", UUID(as_uuid=True),
                  sa.ForeignKey("marketing_channels.id", ondelete="RESTRICT"),
                  nullable=False),
        sa.Column("campaign_name", sa.String(200), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("period_from", sa.Date, nullable=False),
        sa.Column("period_to", sa.Date, nullable=False),
        sa.Column("leads_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("clicks_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("impressions_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("external_id", sa.String(100), nullable=True),
        sa.Column("created_by_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.CheckConstraint("amount >= 0", name="ck_ad_spend_amount_nonneg"),
        sa.CheckConstraint("period_to >= period_from", name="ck_ad_spend_period"),
    )
    op.create_index("ix_ad_spend_tenant_period", "ad_spend_entries",
                    ["tenant_id", "period_from", "period_to"])
    op.create_index("ix_ad_spend_channel", "ad_spend_entries", ["channel_id"])
    op.create_index("ix_ad_spend_clinic", "ad_spend_entries", ["clinic_id"])

    # ────────────────────────────────────────────────────────────────────
    # 3. patient_attribution — связь пациента с каналом (UTM + touchpoints)
    # ────────────────────────────────────────────────────────────────────
    op.create_table(
        "patient_attribution",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        # Идентификация пациента — phone (т.к. appointments хранят patient_phone)
        # ИЛИ user_id если пациент зарегистрирован в портале
        sa.Column("patient_phone", sa.String(32), nullable=True),
        sa.Column("patient_user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("contact_request_id", UUID(as_uuid=True), nullable=True),
        sa.Column("channel_id", UUID(as_uuid=True),
                  sa.ForeignKey("marketing_channels.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("source_detail", sa.String(200), nullable=True),
        # UTM tags
        sa.Column("utm_source", sa.String(100), nullable=True),
        sa.Column("utm_medium", sa.String(100), nullable=True),
        sa.Column("utm_campaign", sa.String(100), nullable=True),
        sa.Column("utm_term", sa.String(100), nullable=True),
        sa.Column("utm_content", sa.String(100), nullable=True),
        sa.Column("referrer", sa.String(500), nullable=True),
        sa.Column("first_touch_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_touch_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        # Атрибуция уникальна на тенант + телефон/user_id
    )
    op.create_index("ix_attr_tenant_phone", "patient_attribution",
                    ["tenant_id", "patient_phone"])
    op.create_index("ix_attr_tenant_user", "patient_attribution",
                    ["tenant_id", "patient_user_id"])
    op.create_index("ix_attr_channel", "patient_attribution", ["channel_id"])

    # ────────────────────────────────────────────────────────────────────
    # 4. SEED системных каналов (tenant_id IS NULL = глобальные)
    # ────────────────────────────────────────────────────────────────────
    op.execute("""
    INSERT INTO marketing_channels (id, tenant_id, code, name, icon, sort_order) VALUES
      (gen_random_uuid(), NULL, 'yandex_direct',  'Яндекс Директ',          'campaign',     10),
      (gen_random_uuid(), NULL, 'google_ads',     'Google Ads',             'campaign',     20),
      (gen_random_uuid(), NULL, 'instagram_ads',  'Instagram Ads',          'photo_camera', 30),
      (gen_random_uuid(), NULL, 'vk_ads',         'ВКонтакте Реклама',      'group',        40),
      (gen_random_uuid(), NULL, 'telegram_ads',   'Telegram Ads',           'send',         50),
      (gen_random_uuid(), NULL, 'seo',            'Поисковый трафик (SEO)', 'search',       60),
      (gen_random_uuid(), NULL, 'referral',       'Рекомендации пациентов', 'thumb_up',     70),
      (gen_random_uuid(), NULL, 'direct',         'Прямые заходы',          'public',       80),
      (gen_random_uuid(), NULL, 'offline',        'Оффлайн / вывеска',      'storefront',   90),
      (gen_random_uuid(), NULL, 'other',          'Прочее',                 'help',        100);
    """)


def downgrade():
    op.drop_index("ix_attr_channel", table_name="patient_attribution")
    op.drop_index("ix_attr_tenant_user", table_name="patient_attribution")
    op.drop_index("ix_attr_tenant_phone", table_name="patient_attribution")
    op.drop_table("patient_attribution")

    op.drop_index("ix_ad_spend_clinic", table_name="ad_spend_entries")
    op.drop_index("ix_ad_spend_channel", table_name="ad_spend_entries")
    op.drop_index("ix_ad_spend_tenant_period", table_name="ad_spend_entries")
    op.drop_table("ad_spend_entries")

    op.drop_index("ix_mc_code", table_name="marketing_channels")
    op.drop_index("ix_mc_tenant", table_name="marketing_channels")
    op.drop_table("marketing_channels")
