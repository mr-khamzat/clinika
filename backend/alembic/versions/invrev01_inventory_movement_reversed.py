"""invrev01 — inventory_movements.reversed (идемпотентность reverse_writeoff, находка #12)

Revision ID: invrev01
Revises: chatslot01
Create Date: 2026-06-08

Контекст (Волна 0, security-remediation-wave0):
В модель InventoryMovement уже добавлена колонка `reversed` (Boolean,
server_default false), а `reverse_writeoff` фильтрует `reversed.is_(False)` и
помечает исходное движение `m.reversed = True`. Эта миграция добавляет колонку
ФИЗИЧЕСКИ в БД + делает консервативный backfill, чтобы уже-реверснутые
WRITE_OFF не были подхвачены повторно после выката кода.

upgrade():
  1. ADD COLUMN reversed boolean NOT NULL DEFAULT false на inventory_movements.
     server_default="false" гарантирует, что ADD COLUMN не упадёт на
     существующих строках (все получат false).
  2. Backfill: пометить reversed=true те ИСХОДНЫЕ списания (quantity < 0),
     для которых УЖЕ существует парный реверс-INCOME.

Логика backfill (имена/значения взяты из кода, не выдуманы):
  • Исходное списание = строка inventory_movements с quantity < 0.
    (reverse_writeoff отбирал движения именно по `quantity < 0`, не по type,
     и создавал по одному реверс-INCOME на каждое такое движение.)
  • Реверс-маркер = строка той же таблицы с:
        type = 'income'                       (InventoryMovementType.INCOME,
                                                values_callable → lowercase)
        ref_entity_type = 'appointment_reversal'   (буквально из reverse_writeoff)
        appointment_id = <appointment_id исходного движения>
    Это очень специфичный маркер: 'appointment_reversal' выставляется ТОЛЬКО
    в reverse_writeoff, поэтому ложноположительное совпадение исключено.
  • Сопоставление КОНСЕРВАТИВНОЕ — по appointment_id (а не по item/batch/qty):
    если для приёма существует хотя бы один реверс-INCOME, значит откат
    completed→in_progress по этому приёму уже выполнялся и его списания
    восстановлены. Помечаем только движения с НЕ-NULL appointment_id
    (reverse_writeoff работает строго в разрезе appointment_id), reversed=false
    и quantity<0. Сами реверс-INCOME (quantity>0) под условие не попадают.

downgrade():
  DROP COLUMN reversed.
"""
from alembic import op
import sqlalchemy as sa

revision = "invrev01"
down_revision = "chatslot01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Физически добавить колонку. server_default="false" → существующие
    #    строки получат false, NOT NULL не упадёт.
    op.add_column(
        "inventory_movements",
        sa.Column(
            "reversed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # 2. Консервативный backfill: пометить уже-реверснутые исходные списания.
    #    Помечаем движение M (quantity < 0, привязано к appointment_id), если
    #    существует реверс-INCOME по тому же appointment_id
    #    (type='income' AND ref_entity_type='appointment_reversal').
    op.execute(
        sa.text(
            """
            UPDATE inventory_movements AS m
               SET reversed = true
             WHERE m.quantity < 0
               AND m.appointment_id IS NOT NULL
               AND EXISTS (
                       SELECT 1
                         FROM inventory_movements AS r
                        WHERE r.appointment_id = m.appointment_id
                          AND r.tenant_id = m.tenant_id
                          AND r.type::text = 'income'
                          AND r.ref_entity_type = 'appointment_reversal'
                   )
            """
        )
    )


def downgrade() -> None:
    op.drop_column("inventory_movements", "reversed")
