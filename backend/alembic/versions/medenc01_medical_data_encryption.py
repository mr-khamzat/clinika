"""medenc01 — медданные: shadow-колонки *_encrypted для шифрования PHI (находка #17)

Revision ID: medenc01
Revises: rlsall01
Create Date: 2026-06-08

Контекст (Волна 2, security-remediation-wave0):
Находка #17 (high, pii-152fz) — медицинские сведения (спец.категория ПДн по
152-ФЗ) лежат в plaintext в таблицах медкарты/лаборатории/виталок, хотя соседние
PHI-сущности (Appointment, AppointmentOutcome, PatientDocument, LabOrder.notes,
Referral) уже шифруются по проектному паттерну lazy-property над
encryption_service + listener pii_sync. Несогласованность очевидна: LabOrder.notes
шифруется, а LabResult.value рядом — нет.

Эта миграция, по образцу apptphi01 (находка #2), лишь СОЗДАЁТ nullable shadow-
колонки `<field>_encrypted` (Text) для каждого PHI-поля. Реального шифрования
существующих строк здесь НЕТ — см. блок ниже. Колонки nullable именно для того,
чтобы прикладной код (модель с property/setter) и отдельный data-скрипт могли
дозаполнять их постепенно без падения INSERT на исторических строках.

Поля, для которых добавляются shadow-колонки (1:1 с тем, что объявит код-агент в
моделях + _MAP listener pii_sync):

  patient_diagnoses  (PatientDiagnosis):
    name              → name_encrypted
    notes             → notes_encrypted
    (icd10_code НЕ шифруется — структурированный код МКБ-10 для фильтров/выборок)

  patient_allergies  (PatientAllergy):
    allergen          → allergen_encrypted
    reaction          → reaction_encrypted

  patient_vaccinations (PatientVaccination):
    vaccine_name      → vaccine_name_encrypted

  lab_results        (LabResult):
    value             → value_encrypted
    reference_range   → reference_range_encrypted
    raw_json (JSONB)  → raw_json_encrypted (Text; getter делает json.loads,
                        setter json.dumps+encrypt — потому shadow тип Text, не JSONB)
    (flagged Boolean НЕ шифруется — не ПДн, используется для фильтров)

  patient_vitals     (PatientVital):
    note              → note_encrypted
    value_extra (JSONB) → value_extra_encrypted (Text; json round-trip как raw_json)
    (value_num Numeric НЕ шифруется — числовой показатель для графиков/агрегации,
     вне ФИО малочувствителен; сужение исходной рекомендации, см. PR/residualRisk)

────────────────────────────────────────────────────────────────────────────
ВАЖНО про ШИФРОВАНИЕ медданных (осознанно отложено из миграции) — как в #2:

Реальное row-by-row шифрование существующих значений через encryption_service в
этой DDL-миграции НЕ выполняется. Причины (консервативно, чтобы не испортить прод):

  1. encryption_service.encrypt() при ОТСУТСТВИИ/РАССОГЛАСОВАНИИ SECRET_KEY в
     окружении alembic-процесса молча падает в fallback `plain:<value>` — это НЕ
     шифрование, а маркировка: данные останутся читаемыми, а откатить
     «plain:»-замусоривание на медтаблицах сложно. План #17 прямо предупреждает:
     «Backfill только ставит plain: — реального шифрования истории нет».

  2. Построчный Python-UPDATE внутри миграции на больших медтаблицах =
     долгий эксклюзивный замок + риск таймаута деплоя.

  3. Пока модели не объявляют shadow-колонки и listener pii_sync (_MAP) не
     расширен на эти модели и не выкачен, заполнять шифр-колонки из миграции
     преждевременно — они разъедутся с тем, что пишет код.

Поэтому миграция лишь СОЗДАЁТ nullable shadow-колонки. Фактическое шифрование
существующих строк выполняет ОТДЕЛЬНЫЙ data-скрипт / прикладной backfill (в
maintenance-окне, при ЗАВЕДОМО заданном и стабильном SECRET_KEY, ПОСЛЕ выката
моделей с property/setter и listener), затем — cutover чтений на property/ORM
(особое внимание patient_lab_dynamics.py — читает lr.value сырым SQL мимо
property). См. residualRisk.

ПОРЯДОК (находка #17 зависит от #7 backfill и #1 RLS): down_revision = rlsall01
(текущий head — RLS на всех tenant-таблицах). Только ADD COLUMN — RLS на
lab_results/lab_orders нет (они дочерние, без tenant_id), а на остальных
медтаблицах FORCE RLS не мешает ALTER TABLE ... ADD COLUMN (DDL владельцем).

downgrade(): полностью обратимо — удалить все добавленные shadow-колонки.
Данные не трогаем (их и не писали).
"""
from alembic import op
import sqlalchemy as sa

revision = "medenc01"
down_revision = "rlsall01"
branch_labels = None
depends_on = None


# Карта: таблица -> список shadow-колонок (*_encrypted), которые добавляем.
# Имена 1:1 с тем, что объявляют модели + _MAP listener pii_sync (находка #17).
_SHADOW_COLUMNS: dict[str, list[str]] = {
    "patient_diagnoses": ["name_encrypted", "notes_encrypted"],
    "patient_allergies": ["allergen_encrypted", "reaction_encrypted"],
    "patient_vaccinations": ["vaccine_name_encrypted"],
    "lab_results": ["value_encrypted", "reference_range_encrypted", "raw_json_encrypted"],
    "patient_vitals": ["note_encrypted", "value_extra_encrypted"],
}


def upgrade() -> None:
    # Только ADD COLUMN: каждая колонка Text + nullable. ADD COLUMN не упадёт на
    # существующих строках, код/data-скрипт сможет дозаполнять постепенно.
    # Идемпотентно: проверяем наличие через information_schema (повторный прогон
    # без падения).
    for table, columns in _SHADOW_COLUMNS.items():
        for column in columns:
            _add_column_if_absent(table, column, sa.Text())


def downgrade() -> None:
    # Удалить все добавленные shadow-колонки (в обратном порядке таблиц для
    # симметрии; data не трогаем — её в эти колонки миграция не писала).
    for table in reversed(list(_SHADOW_COLUMNS)):
        for column in reversed(_SHADOW_COLUMNS[table]):
            _drop_column_if_exists(table, column)


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
