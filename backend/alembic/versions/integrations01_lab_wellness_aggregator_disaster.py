"""integrations01 — Глава 10: Лаборатория / Wellness / Партнёры-агрегаторы.

Revises: health_sub01
Create Date: 2026-05-11

Добавляются таблицы:
  lab_providers
  lab_orders
  lab_results

  wellness_partners
  wellness_partner_clicks

  aggregator_partnerships
  aggregator_leads
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "integrations01"
down_revision = "health_sub01"
branch_labels = None
depends_on = None


def upgrade():
    # ── lab_providers ───────────────────────────────────────────────────────
    op.create_table(
        "lab_providers",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("provider_type", sa.String(40), nullable=False),
        sa.Column("api_url", sa.String(300), nullable=True),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("default_clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_lab_providers_tenant", "lab_providers", ["tenant_id"])

    # ── lab_orders ──────────────────────────────────────────────────────────
    op.create_table(
        "lab_orders",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("doctor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("doctors.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("lab_providers.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("external_order_id", sa.String(120), nullable=True),
        sa.Column("test_codes", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="created"),
        sa.Column("requested_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("results_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
    )
    op.create_index("ix_lab_orders_tenant", "lab_orders", ["tenant_id"])
    op.create_index("ix_lab_orders_patient", "lab_orders", ["patient_id"])
    op.create_index("ix_lab_orders_status", "lab_orders", ["status"])
    op.create_index("ix_lab_orders_provider", "lab_orders", ["provider_id"])

    # ── lab_results ─────────────────────────────────────────────────────────
    op.create_table(
        "lab_results",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("order_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("lab_orders.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("test_code", sa.String(40), nullable=False),
        sa.Column("test_name", sa.String(200), nullable=False),
        sa.Column("value", sa.String(120), nullable=True),
        sa.Column("unit", sa.String(40), nullable=True),
        sa.Column("reference_range", sa.String(120), nullable=True),
        sa.Column("flagged", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("result_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw_json", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_lab_results_order", "lab_results", ["order_id"])
    op.create_index("ix_lab_results_test_code", "lab_results", ["test_code"])

    # ── wellness_partners ───────────────────────────────────────────────────
    op.create_table(
        "wellness_partners",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("logo_url", sa.String(300), nullable=True),
        sa.Column("discount_text", sa.String(80), nullable=False, server_default=""),
        sa.Column("promo_code", sa.String(40), nullable=False, server_default=""),
        sa.Column("link_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("min_subscription_plan", sa.String(40), nullable=False, server_default="health_plus"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_wellness_partners_category", "wellness_partners", ["category"])

    # ── wellness_partner_clicks ─────────────────────────────────────────────
    op.create_table(
        "wellness_partner_clicks",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("partner_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("wellness_partners.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("clicked_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_wellness_clicks_partner", "wellness_partner_clicks", ["partner_id"])
    op.create_index("ix_wellness_clicks_patient", "wellness_partner_clicks", ["patient_id"])
    op.create_index("ix_wellness_clicks_at", "wellness_partner_clicks", ["clicked_at"])

    # ── aggregator_partnerships ─────────────────────────────────────────────
    op.create_table(
        "aggregator_partnerships",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("partner_name", sa.String(80), nullable=False),
        sa.Column("api_key_hash", sa.String(80), nullable=False, unique=True),
        sa.Column("key_prefix", sa.String(16), nullable=True),
        sa.Column("commission_pct", sa.Numeric(5, 2),
                  nullable=False, server_default="0.00"),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_aggregator_partnerships_tenant", "aggregator_partnerships", ["tenant_id"])
    op.create_index("ix_aggregator_partnerships_partner", "aggregator_partnerships", ["partner_name"])

    # ── aggregator_leads ────────────────────────────────────────────────────
    op.create_table(
        "aggregator_leads",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("partnership_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("aggregator_partnerships.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("patient_phone", sa.String(20), nullable=False),
        sa.Column("patient_full_name", sa.String(120), nullable=True),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("clinics.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("service_requested", sa.String(200), nullable=True),
        sa.Column("desired_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="received"),
        sa.Column("commission_amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("appointments.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_aggregator_leads_partnership", "aggregator_leads", ["partnership_id"])
    op.create_index("ix_aggregator_leads_phone", "aggregator_leads", ["patient_phone"])
    op.create_index("ix_aggregator_leads_status", "aggregator_leads", ["status"])
    op.create_index("ix_aggregator_leads_created", "aggregator_leads", ["created_at"])

    # ── seed wellness partners ──────────────────────────────────────────────
    op.execute("""
        INSERT INTO wellness_partners
            (name, category, description, discount_text, promo_code, link_url,
             min_subscription_plan, active, sort_order)
        VALUES
            ('X-Fit', 'fitness',
             'Сеть фитнес-клубов «X-Fit» — тренажёрный зал, бассейн, групповые занятия.',
             '10% по промокоду CLINIKA10', 'CLINIKA10',
             'https://www.x-fit.ru/?utm_source=clinika', 'health_plus', true, 10),
            ('Aroma Spa', 'spa',
             'SPA-салон «Aroma Spa» — массаж, ароматерапия, релаксационные программы.',
             '15% по промокоду CLINIKA15', 'CLINIKA15',
             'https://aroma-spa.example.com/?utm_source=clinika', 'health_plus', true, 20),
            ('BioFood', 'nutrition',
             'Консультация диетолога-нутрициолога BioFood: индивидуальный план питания.',
             '20% скидка на первую консультацию', 'CLINIKA20',
             'https://biofood.example.com/?utm_source=clinika', 'health_plus', true, 30),
            ('MentalCare', 'psychology',
             'Онлайн-психолог MentalCare: 50+ специалистов, видео-сессии.',
             'Скидка 500₽ на первую сессию', 'CLINIKA500',
             'https://mentalcare.example.com/?utm_source=clinika', 'health_plus', true, 40),
            ('PranaYoga', 'yoga',
             'Студия йоги PranaYoga: хатха, виньяса, медитация, дыхательные практики.',
             '1 пробное занятие бесплатно', 'CLINIKAFREE',
             'https://pranayoga.example.com/?utm_source=clinika', 'health_plus', true, 50),
            ('Велнес-центр «Аура»', 'spa',
             'Велнес-центр «Аура»: хаммам, сауна, тайский массаж.',
             '12% на любые SPA-процедуры', 'CLINIKAURA',
             'https://aura-wellness.example.com/?utm_source=clinika', 'family_plus', true, 60),
            ('NutriPro coach', 'nutrition',
             'Персональный нутрициолог NutriPro: подбор БАД, разбор анализов.',
             'Бесплатная вводная сессия 30 мин', 'CLINIKAPRO',
             'https://nutripro.example.com/?utm_source=clinika', 'pro', true, 70)
    """)


def downgrade():
    op.drop_table("aggregator_leads")
    op.drop_table("aggregator_partnerships")
    op.drop_table("wellness_partner_clicks")
    op.drop_table("wellness_partners")
    op.drop_table("lab_results")
    op.drop_table("lab_orders")
    op.drop_table("lab_providers")
