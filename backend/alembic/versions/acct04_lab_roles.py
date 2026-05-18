"""lab_ct + lab_xray roles

Revision ID: acct04_lab_roles
Revises: acct03_ici_approval
Create Date: 2026-05-18

Добавляет в enum userrole две новые роли:
  - lab_ct      — Лаборант КТ
  - lab_xray    — Лаборант рентгенолог

Поведение/права те же, что у doctor — отдельные роли нужны для
человекочитаемого справочника, фильтрации и UI-меток.
"""
from alembic import op


revision = 'acct04_lab_roles'
down_revision = 'acct03_ici_approval'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'lab_ct'")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'lab_xray'")


def downgrade():
    # enum value не откатываем (Postgres не поддерживает DROP VALUE без пересоздания типа).
    pass
