"""wf02: tenant settings JSONB (idempotent — если столбец уже есть, ничего не делаем)"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'wf02_tenant_settings'
down_revision = 'wf01_sla'
branch_labels = None
depends_on = None


def upgrade():
    # Проверяем наличие столбца settings — он может уже существовать
    conn = op.get_bind()
    res = conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name='tenants' AND column_name='settings'"
    )).first()
    if not res:
        op.add_column('tenants',
            sa.Column('settings', JSONB, server_default='{}', nullable=False))


def downgrade():
    # Не дропаем — могут быть данные от других модулей.
    pass
