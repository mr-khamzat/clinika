"""apptphi01 — appointments: PHI shadow-колонки + tenant_id NOT NULL (условно) + FK ondelete RESTRICT (находка #2)

Revision ID: apptphi01
Revises: tenantbf01
Create Date: 2026-06-08

Контекст (Волна 1, security-remediation-wave0):
Находка #2 (critical, pii-152fz) — центральная PHI-таблица `appointments`:
  • `tenant_id` nullable + ondelete SET NULL → приёмы осиротевают, а fail-open
    проверки/RLS пропускают NULL-строки всем тенантам (кросс-тенантная утечка ПДн).
  • FK `clinic_id` без ondelete (рассогласовано с Doctor.clinic_id CASCADE).
  • `patient_phone` / `patient_name` / `notes` лежат plaintext, хотя это
    спец.категория ПДн по 152-ФЗ.

Предыдущая миграция ветки `tenantbf01` УЖЕ backfill'ит appointments.tenant_id
из clinics (A. appointments ← clinics по clinic_id). Эта миграция:
  (1) добавляет шифр-shadow-колонки (nullable, заполняются прикладным кодом/
      отдельным data-скриптом — здесь НЕ шифруем вслепую, см. ниже);
  (2) добивает остаточный NULL tenant_id той же достоверной связью и УСЛОВНО
      ставит NOT NULL — ТОЛЬКО если 0 строк с NULL (иначе оставляет nullable +
      жирный NOTICE; не роняет прод);
  (3) пересоздаёт FK clinic_id / tenant_id с ondelete RESTRICT.

────────────────────────────────────────────────────────────────────────────
ВАЖНО про ШИФРОВАНИЕ PHI (осознанно отложено из миграции):

Реальное row-by-row шифрование существующих значений patient_phone / patient_name
/ notes через encryption_service в этой DDL-миграции НЕ выполняется. Причины
(консервативно, чтобы не испортить прод):

  1. encryption_service.encrypt() при ОТСУТСТВИИ или РАССОГЛАСОВАНИИ SECRET_KEY
     в окружении alembic-процесса молча падает в fallback `plain:<value>`
     (см. encryption_service.py:60-68). Это НЕ шифрование, а маркировка —
     данные останутся читаемыми, а откатить «plain:»-замусоривание на большой
     центральной таблице сложно. План находки #2 прямо предупреждает:
     «Без SECRET_KEY backfill зашифрует как plain:».

  2. На центральной PHI-таблице (сотни тысяч строк) построчный Python-UPDATE
     внутри миграции = долгий эксклюзивный замок + риск таймаута деплоя.

  3. Модель `Appointment` в коде пока НЕ объявляет эти shadow-колонки и НЕ имеет
     property/setter (это часть прикладного под-фикса #2 «C. Шифрование»).
     Пока listener/property не выкачены, заполнять шифр-колонки из миграции
     преждевременно — они разъедутся с тем, что пишет код.

Поэтому миграция лишь СОЗДАЁТ nullable shadow-колонки. Фактическое шифрование
существующих строк выполняет ОТДЕЛЬНЫЙ data-скрипт / прикладной backfill
(в maintenance-окне, при ЗАВЕДОМО заданном и стабильном SECRET_KEY, после
выката модели с property/listener) — см. residualRisk. Колонки nullable именно
для того, чтобы их можно было дозаполнить постепенно без падения INSERT.

────────────────────────────────────────────────────────────────────────────
ИМЕНА FK (взяты из исходного create_table в f8fec11962e4_etap5_scheduling.py:
73-78, где оба FK созданы БЕЗ явного имени → PostgreSQL присвоил имена по
конвенции `<table>_<column>_fkey`):
  • appointments_clinic_id_fkey  — clinic_id → clinics.id        (был без ondelete)
  • appointments_tenant_id_fkey  — tenant_id → tenants.id        (был ondelete SET NULL)
Пересоздаём оба с ondelete='RESTRICT'. DROP делаем через IF EXISTS —
идемпотентно и устойчиво к ручным переименованиям на проде.

downgrade(): полностью обратимо —
  • вернуть FK clinic_id (без ondelete) и tenant_id (ondelete SET NULL) как было;
  • снять NOT NULL с tenant_id (если ставили);
  • удалить shadow-колонки.
Сами данные backfill tenant_id НЕ откатываем (корректный tenant_id, его откат
вернул бы дыру изоляции; ту же логику использует tenantbf01.downgrade).
"""
from alembic import op
import sqlalchemy as sa

revision = "apptphi01"
down_revision = "tenantbf01"
branch_labels = None
depends_on = None


# Имена FK по конвенции PostgreSQL (см. докстринг).
_FK_CLINIC = "appointments_clinic_id_fkey"
_FK_TENANT = "appointments_tenant_id_fkey"


def upgrade() -> None:
    # ── (1) Shadow-колонки для шифрования PHI (nullable, заполняются кодом) ───
    # Все Text + nullable: ADD COLUMN не упадёт на существующих строках, и код/
    # data-скрипт сможет дозаполнять постепенно. Hash-колонки — blind-index
    # (sha256 hexdigest, как в проекте: aggregator_service/telemed_token).
    # Идемпотентность: проверяем наличие через information_schema (повторный
    # прогон без падения; PostgreSQL ADD COLUMN IF NOT EXISTS тоже сработал бы,
    # но information_schema нагляднее и единообразно с проверкой NULL ниже).
    _add_column_if_absent("appointments", "patient_phone_encrypted", sa.Text())
    _add_column_if_absent("appointments", "patient_phone_hash", sa.String(64))
    _add_column_if_absent("appointments", "patient_name_encrypted", sa.Text())
    _add_column_if_absent("appointments", "patient_name_hash", sa.String(64))
    _add_column_if_absent("appointments", "notes_encrypted", sa.Text())

    # Индекс на blind-index телефона (exact-match замена plaintext-поиска по
    # patient_phone в KPI/cohort/calendar/SMS). Создаём IF NOT EXISTS.
    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS ix_appointments_patient_phone_hash "
            "ON appointments (patient_phone_hash)"
        )
    )

    # ── (2) Добить остаточный NULL tenant_id той же достоверной связью ───────
    # Дублирует A. из tenantbf01 (appointments ← clinics по clinic_id). Здесь —
    # ради самодостаточности этой миграции (если tenantbf01 что-то не покрыл/
    # появились новые строки между миграциями). Полностью идемпотентно:
    # WHERE tenant_id IS NULL.
    op.execute(
        sa.text(
            """
            UPDATE appointments AS a
               SET tenant_id = c.tenant_id
              FROM clinics AS c
             WHERE a.tenant_id IS NULL
               AND a.clinic_id = c.id
               AND c.tenant_id IS NOT NULL
            """
        )
    )

    # ── (3) FK clinic_id / tenant_id → ondelete RESTRICT ─────────────────────
    # DROP IF EXISTS + ADD: идемпотентно и устойчиво к ручным правкам имён.
    op.execute(sa.text(f"ALTER TABLE appointments DROP CONSTRAINT IF EXISTS {_FK_CLINIC}"))
    op.create_foreign_key(
        _FK_CLINIC,
        "appointments",
        "clinics",
        ["clinic_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute(sa.text(f"ALTER TABLE appointments DROP CONSTRAINT IF EXISTS {_FK_TENANT}"))
    op.create_foreign_key(
        _FK_TENANT,
        "appointments",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    # ── (2b) УСЛОВНЫЙ SET NOT NULL на tenant_id ──────────────────────────────
    # КОНСЕРВАТИВНО: ставим NOT NULL ТОЛЬКО если после backfill не осталось
    # ни одной строки с tenant_id IS NULL. Иначе — НЕ роняем миграцию,
    # оставляем колонку nullable и печатаем громкий NOTICE. Финальный NOT NULL
    # тогда выполняется отдельным шагом ПОСЛЕ ручной зачистки сирот
    # (data-скрипт в maintenance-окне). См. residualRisk.
    op.execute(
        sa.text(
            """
            DO $$
            DECLARE
                n_null bigint;
            BEGIN
                SELECT count(*) INTO n_null
                  FROM appointments
                 WHERE tenant_id IS NULL;

                IF n_null = 0 THEN
                    -- Безопасно: 0 NULL → закрываем дыру жёстко.
                    ALTER TABLE appointments
                        ALTER COLUMN tenant_id SET NOT NULL;
                    RAISE NOTICE 'apptphi01: appointments.tenant_id SET NOT NULL (0 NULL rows).';
                ELSE
                    -- Небезопасно: останутся осиротевшие приёмы. НЕ ставим
                    -- NOT NULL вслепую — это уронило бы миграцию/прод.
                    RAISE WARNING
                        'apptphi01: appointments.tenant_id ОСТАЁТСЯ NULLABLE — %% строк с NULL tenant_id. '
                        'Backfill из clinics не покрыл все строки (clinic с NULL tenant_id или приёмы-сироты). '
                        'Зачистите сироты data-скриптом в maintenance-окне, затем отдельной миграцией '
                        'ALTER COLUMN tenant_id SET NOT NULL.', n_null;
                END IF;
            END
            $$;
            """
        )
    )


def downgrade() -> None:
    # Снять NOT NULL с tenant_id (если был установлен в upgrade). DROP NOT NULL
    # идемпотентен — не падает, если колонка уже nullable.
    op.execute(
        sa.text("ALTER TABLE appointments ALTER COLUMN tenant_id DROP NOT NULL")
    )

    # Вернуть FK как было: clinic_id — без ondelete; tenant_id — ondelete SET NULL.
    op.execute(sa.text(f"ALTER TABLE appointments DROP CONSTRAINT IF EXISTS {_FK_CLINIC}"))
    op.create_foreign_key(
        _FK_CLINIC,
        "appointments",
        "clinics",
        ["clinic_id"],
        ["id"],
        # без ondelete — как в исходном create_table (f8fec11962e4:74)
    )
    op.execute(sa.text(f"ALTER TABLE appointments DROP CONSTRAINT IF EXISTS {_FK_TENANT}"))
    op.create_foreign_key(
        _FK_TENANT,
        "appointments",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="SET NULL",  # как в исходном create_table (f8fec11962e4:77)
    )

    # Удалить blind-index и shadow-колонки.
    op.execute(sa.text("DROP INDEX IF EXISTS ix_appointments_patient_phone_hash"))
    _drop_column_if_exists("appointments", "notes_encrypted")
    _drop_column_if_exists("appointments", "patient_name_hash")
    _drop_column_if_exists("appointments", "patient_name_encrypted")
    _drop_column_if_exists("appointments", "patient_phone_hash")
    _drop_column_if_exists("appointments", "patient_phone_encrypted")


# ─────────────────────────── helpers (идемпотентность) ──────────────────────
def _add_column_if_absent(table: str, column: str, type_) -> None:
    """ADD COLUMN, только если её ещё нет (повторный прогон не падает)."""
    bind = op.get_bind()
    exists = bind.execute(
        sa.text(
            """
            SELECT 1 FROM information_schema.columns
             WHERE table_name = :t AND column_name = :c
            """
        ),
        {"t": table, "c": column},
    ).scalar()
    if not exists:
        op.add_column(table, sa.Column(column, type_, nullable=True))


def _drop_column_if_exists(table: str, column: str) -> None:
    bind = op.get_bind()
    exists = bind.execute(
        sa.text(
            """
            SELECT 1 FROM information_schema.columns
             WHERE table_name = :t AND column_name = :c
            """
        ),
        {"t": table, "c": column},
    ).scalar()
    if exists:
        op.drop_column(table, column)
