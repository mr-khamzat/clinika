"""secmerge01 — merge security01 + marketplace01 + tenantapi01

Объединяет три параллельные ветки, отколовшиеся от modhealth01:
  - marketplace01 (marketplace fields)
  - tenantapi01 (api keys)
  - security01 (blocked_ips для Журнала безопасности)

Никаких DDL — только склейка истории.

Revision ID: secmerge01
Revises: marketplace01, tenantapi01, security01
Create Date: 2026-05-10
"""

revision = 'secmerge01'
down_revision = ('marketplace01', 'tenantapi01', 'security01')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
