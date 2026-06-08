"""tpat01 — M2M tenant↔patient (tenant_patients) + name shadow-колонки (находка #18)

Revision ID: tpat01
Revises: medenc01
Create Date: 2026-06-08

Контекст (Волна 3, security-remediation-wave0):
Находка #18 (high, tenant-isolation) — `PatientAccount` (patient_account.py:12-46)
объявляет `phone unique=True` ГЛОБАЛЬНО и НЕ имеет колонки `tenant_id` вовсе.
Один телефон = одна запись на всю платформу, справочник пациентов де-факто общий
между тенантами; ФИО (`name`) лежит в plaintext. DSAR / «право на забвение»
работают по всей платформе, игнорируя границы тенанта.

Решение из плана (НЕ добавлять tenant_id прямо в patient_accounts — это сломало бы
unique по phone и не отражает реальность «пациент лечится в N клиниках»): ввести
M2M-связь `TenantPatient` (паттерн `LoyaltyAccountExt`,
`UniqueConstraint(tenant_id, patient_id)`). Прикладной код будет на её основе
фильтровать `get_account_by_phone(tenant_id=...)`, DSAR и анонимизацию — в рамках
тенанта сессии.

Эта миграция выполняет схему + безопасный backfill связей, по образцу
apptphi01 (#2) / tenantbf01 (#7) / medenc01 (#17):

  (а) CREATE TABLE tenant_patients (id, tenant_id, patient_id, created_at) с
      UniqueConstraint(tenant_id, patient_id) и индексами. Имена столбцов/
      констрейнтов/индексов — 1:1 с моделью `app/models/tenant_patient.py`,
      которую заводит код-агент (тот же стиль, что loyalty_accounts_ext).
      Идемпотентно: создаём только если таблицы ещё нет (information_schema).

  (б) name_encrypted (Text) / name_hash (String(64)) — shadow-колонки на
      patient_accounts через _add_column_if_absent (nullable; заполнит код/
      data-скрипт). По образцу apptphi01/medenc01.

  (в) Backfill связей tenant_patients из ДОСТОВЕРНЫХ источников (только таблицы,
      у которых РЕАЛЬНО есть и patient_id→patient_accounts, и tenant_id):
        • loyalty_accounts_ext (tenant_id NOT NULL, patient_id)
        • lab_orders            (tenant_id NOT NULL, patient_id)
        • family_groups         (tenant_id nullable, owner_patient_id)
        • family_members        (patient_id; tenant_id берём JOIN'ом family_groups)
        • patient_documents     (tenant_id nullable, patient_id nullable)
        • chat_threads          (tenant_id nullable, patient_id NOT NULL)
      INSERT ... SELECT DISTINCT ... ON CONFLICT DO NOTHING — полностью идемпотентно
      и не плодит дублей (защищено UniqueConstraint). Берём только строки, где и
      tenant_id, и patient_id NOT NULL. ПОСЛЕ backfill tenant_id дочерних таблиц (#7).

      ПОЧЕМУ НЕ ВСЕ patient_*-таблицы: legacy `patient_chats` и phone-keyed таблицы
      (patient_documents до главы 9, patient_vitals и т.п.) не имеют patient_id →
      связать пациента с тенантом достоверно нельзя (только по телефону, что
      межтенантно неоднозначно — см. tenantbf01.B). Их связи довяжет прикладной
      код при первом обращении пациента (get_or_create TenantPatient).

────────────────────────────────────────────────────────────────────────────
ВАЖНО про ШИФРОВАНИЕ name (осознанно отложено из миграции — как в #2/#17):

Реальное row-by-row шифрование исторических `patient_accounts.name` через
encryption_service здесь НЕ выполняется. Причины те же, что в apptphi01/medenc01:
  1. encryption_service при ОТСУТСТВИИ/РАССОГЛАСОВАНИИ SECRET_KEY в окружении
     alembic молча падает в fallback `plain:<value>` — это маркировка, не
     шифрование; откатить «plain:»-замусоривание сложно.
  2. Модель PatientAccount пока НЕ объявляет name_encrypted/name_hash и НЕ имеет
     property/listener (это прикладной под-фикс #18: добавить name в pii_sync._MAP
     + property). Пока код не выкачен — заполнять shadow-колонки из миграции
     преждевременно (разъедутся с тем, что пишет код).
Поэтому миграция лишь СОЗДАЁТ nullable shadow-колонки. Фактическое шифрование
существующих ФИО выполняет ОТДЕЛЬНЫЙ data-скрипт / прикладной backfill в
maintenance-окне при ЗАВЕДОМО стабильном SECRET_KEY, после выката модели с
property/listener. Колонки nullable именно ради постепенного дозаполнения без
падения INSERT.

────────────────────────────────────────────────────────────────────────────
RLS на tenant_patients:

`tenant_patients` — НОВАЯ таблица С колонкой tenant_id, но создаётся ПОСЛЕ
rlsall01 (#1, Часть A), который навесил политику `tenant_isolation` на все
существовавшие на тот момент tenant-таблицы. Поэтому изоляцию навешиваем ЗДЕСЬ ЖЕ
тем же предикатом (ENABLE + FORCE ROW LEVEL SECURITY + CREATE POLICY
tenant_isolation), иначе новая tenant-таблица осталась бы без RLS-изоляции на
уровне БД. Предикат — буквальная копия rlsall01._POLICY_PREDICATE (единый текст).

patient_accounts остаётся в WHITELIST_GLOBAL_TABLES rlsall01 (глобальный
справочник пациентов по телефону, без tenant_id) — RLS на него НЕ вешаем; name
шифруется прикладным кодом, но изоляция этого справочника обеспечивается через
tenant_patients, а не RLS на самой таблице.

────────────────────────────────────────────────────────────────────────────
downgrade(): полностью обратимо —
  • DROP POLICY + NO FORCE/DISABLE RLS на tenant_patients;
  • DROP TABLE tenant_patients (с индексами/констрейнтами);
  • удалить name_hash / name_encrypted с patient_accounts.
Данные backfill уходят вместе с таблицей (downgrade удаляет всю M2M-связь).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "tpat01"
down_revision = "medenc01"
branch_labels = None
depends_on = None


# Предикат RLS-политики — БУКВАЛЬНАЯ копия rlsall01._POLICY_PREDICATE (единый
# источник истины для tenant_isolation; USING == WITH CHECK).
_POLICY_PREDICATE = (
    "current_setting('app.tenant_id', true) IS NULL "
    "OR current_setting('app.tenant_id', true) = '' "
    "OR tenant_id::text = current_setting('app.tenant_id', true)"
)


def upgrade() -> None:
    bind = op.get_bind()

    # ── (а) CREATE TABLE tenant_patients (идемпотентно) ──────────────────────
    # Создаём только если таблицы ещё нет: повторный прогон миграции (или ручное
    # предсоздание) не упадёт. Имена 1:1 с моделью app/models/tenant_patient.py
    # (стиль loyalty_accounts_ext): констрейнт uq_tenant_patient_tenant_patient,
    # индексы ix_tenant_patients_tenant_id / ix_tenant_patients_patient_id.
    if not _table_exists(bind, "tenant_patients"):
        op.create_table(
            "tenant_patients",
            sa.Column(
                "id",
                postgresql.UUID(as_uuid=True),
                primary_key=True,
                server_default=sa.text("gen_random_uuid()"),
                nullable=False,
            ),
            sa.Column(
                "tenant_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "patient_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("patient_accounts.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.UniqueConstraint(
                "tenant_id", "patient_id", name="uq_tenant_patient_tenant_patient"
            ),
        )
        op.create_index(
            "ix_tenant_patients_tenant_id", "tenant_patients", ["tenant_id"]
        )
        op.create_index(
            "ix_tenant_patients_patient_id", "tenant_patients", ["patient_id"]
        )

    # ── (б) Shadow-колонки name_encrypted / name_hash на patient_accounts ────
    # Nullable, заполняются прикладным кодом/data-скриптом (см. докстринг про
    # шифрование). name_hash — blind-index (sha256 hexdigest), как в проекте.
    _add_column_if_absent("patient_accounts", "name_encrypted", sa.Text())
    _add_column_if_absent("patient_accounts", "name_hash", sa.String(64))

    # ── (в) Backfill связей tenant_patients из достоверных источников ────────
    # Все INSERT ... SELECT DISTINCT ... ON CONFLICT DO NOTHING — идемпотентно,
    # дубли отсекает UniqueConstraint(tenant_id, patient_id). Каждый источник
    # выбирает только строки с NOT NULL по обоим ключам. gen_random_uuid() —
    # тот же дефолт, что у самой таблицы (pgcrypto обычно доступен; если нет —
    # дефолт колонки id всё равно подставится, т.к. id в SELECT не указываем).

    # loyalty_accounts_ext: tenant_id NOT NULL, patient_id → patient_accounts.
    op.execute(
        sa.text(
            """
            INSERT INTO tenant_patients (tenant_id, patient_id)
            SELECT DISTINCT le.tenant_id, le.patient_id
              FROM loyalty_accounts_ext AS le
             WHERE le.tenant_id IS NOT NULL
               AND le.patient_id IS NOT NULL
            ON CONFLICT (tenant_id, patient_id) DO NOTHING
            """
        )
    )

    # lab_orders: tenant_id NOT NULL, patient_id → patient_accounts.
    op.execute(
        sa.text(
            """
            INSERT INTO tenant_patients (tenant_id, patient_id)
            SELECT DISTINCT lo.tenant_id, lo.patient_id
              FROM lab_orders AS lo
             WHERE lo.tenant_id IS NOT NULL
               AND lo.patient_id IS NOT NULL
            ON CONFLICT (tenant_id, patient_id) DO NOTHING
            """
        )
    )

    # family_groups: tenant_id nullable, owner_patient_id → patient_accounts.
    op.execute(
        sa.text(
            """
            INSERT INTO tenant_patients (tenant_id, patient_id)
            SELECT DISTINCT fg.tenant_id, fg.owner_patient_id
              FROM family_groups AS fg
             WHERE fg.tenant_id IS NOT NULL
               AND fg.owner_patient_id IS NOT NULL
            ON CONFLICT (tenant_id, patient_id) DO NOTHING
            """
        )
    )

    # family_members: patient_id → patient_accounts; tenant_id наследуем от
    # family_groups через group_id (у family_members своей колонки tenant_id нет).
    op.execute(
        sa.text(
            """
            INSERT INTO tenant_patients (tenant_id, patient_id)
            SELECT DISTINCT fg.tenant_id, fm.patient_id
              FROM family_members AS fm
              JOIN family_groups AS fg ON fg.id = fm.group_id
             WHERE fg.tenant_id IS NOT NULL
               AND fm.patient_id IS NOT NULL
            ON CONFLICT (tenant_id, patient_id) DO NOTHING
            """
        )
    )

    # patient_documents: tenant_id nullable, patient_id nullable (глава 9) —
    # берём только строки, где заполнены ОБА (legacy phone-only пропускаем).
    op.execute(
        sa.text(
            """
            INSERT INTO tenant_patients (tenant_id, patient_id)
            SELECT DISTINCT pd.tenant_id, pd.patient_id
              FROM patient_documents AS pd
             WHERE pd.tenant_id IS NOT NULL
               AND pd.patient_id IS NOT NULL
            ON CONFLICT (tenant_id, patient_id) DO NOTHING
            """
        )
    )

    # chat_threads (главы 9; план называет его patient_chat_threads):
    # tenant_id nullable, patient_id NOT NULL → patient_accounts.
    op.execute(
        sa.text(
            """
            INSERT INTO tenant_patients (tenant_id, patient_id)
            SELECT DISTINCT ct.tenant_id, ct.patient_id
              FROM chat_threads AS ct
             WHERE ct.tenant_id IS NOT NULL
               AND ct.patient_id IS NOT NULL
            ON CONFLICT (tenant_id, patient_id) DO NOTHING
            """
        )
    )

    # ── (г) RLS на tenant_patients (создаётся ПОСЛЕ rlsall01 — навешиваем тут) ─
    # Тем же предикатом tenant_isolation, что rlsall01. ENABLE/FORCE повторно не
    # падает; политику DROP IF EXISTS перед CREATE — идемпотентно.
    op.execute(sa.text('ALTER TABLE "tenant_patients" ENABLE ROW LEVEL SECURITY'))
    op.execute(sa.text('ALTER TABLE "tenant_patients" FORCE ROW LEVEL SECURITY'))
    op.execute(sa.text('DROP POLICY IF EXISTS tenant_isolation ON "tenant_patients"'))
    op.execute(
        sa.text(
            'CREATE POLICY tenant_isolation ON "tenant_patients" '
            f"USING ({_POLICY_PREDICATE}) "
            f"WITH CHECK ({_POLICY_PREDICATE})"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()

    # name shadow-колонки patient_accounts.
    _drop_column_if_exists("patient_accounts", "name_hash")
    _drop_column_if_exists("patient_accounts", "name_encrypted")

    # RLS на tenant_patients + сама таблица (индексы/констрейнты уйдут с ней).
    if _table_exists(bind, "tenant_patients"):
        op.execute(
            sa.text('DROP POLICY IF EXISTS tenant_isolation ON "tenant_patients"')
        )
        op.execute(
            sa.text('ALTER TABLE "tenant_patients" NO FORCE ROW LEVEL SECURITY')
        )
        op.execute(
            sa.text('ALTER TABLE "tenant_patients" DISABLE ROW LEVEL SECURITY')
        )
        op.drop_index("ix_tenant_patients_patient_id", table_name="tenant_patients")
        op.drop_index("ix_tenant_patients_tenant_id", table_name="tenant_patients")
        op.drop_table("tenant_patients")


# ─────────────────────────── helpers (идемпотентность) ──────────────────────
def _table_exists(bind, table: str) -> bool:
    return bool(
        bind.execute(
            sa.text(
                """
                SELECT 1 FROM information_schema.tables
                 WHERE table_name = :t
                """
            ),
            {"t": table},
        ).scalar()
    )


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
