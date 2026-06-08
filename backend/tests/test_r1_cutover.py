"""
R1 cutover — тесты перевода чтений ПДн на property/blind-index (#2/#17).

Контекст: после backfill-шифрования сырые plaintext-колонки appointments
(patient_phone/name/notes) и медтаблиц (lab_results.value/reference_range,
patient_diagnoses.name/notes, patient_allergies.allergen/reaction,
patient_vaccinations.vaccine_name, patient_vitals.note/value_extra) содержат
ciphertext. Код, который читал их «сырыми» (ORM-колонка / column-tuple select /
text()-SQL), после backfill отдал бы 'enc:...' токены, а join по plaintext-
телефону перестал бы совпадать. Cutover переводит:
  • отображение → property *_plain (lazy-decrypt, fallback на legacy-plaintext);
  • группировку/exact-поиск по телефону → детерминированный blind-index *_hash.

Тесты двух видов:
  1) Поведенческие (unit, без БД): декларативный ORM-объект инстанцируется в
     памяти, проверяем что property *_plain корректно отдаёт значение и до
     backfill (fallback на legacy-plaintext), и после (decrypt).
  2) Инспекция исходников: гарантируем, что конкретные cutover-места читают
     *_plain / *_hash и НЕ остаётся ни одного TODO(#2 PHI)-маркера и сырых
     plaintext-join'ов телефона в перечисленных функциях.

Запуск: pytest backend/tests/test_r1_cutover.py -v
"""
from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

BACKEND = Path(__file__).resolve().parents[1]
APP = BACKEND / "app"


# ── Фикстура: детерминированный SECRET_KEY (Fernet + HMAC-ключ blind-index) ──

@pytest.fixture
def stable_secret_key(monkeypatch):
    import app.services.encryption_service as enc

    monkeypatch.setenv("SECRET_KEY", "unit-test-secret-key-for-r1-cutover")
    try:
        from app.config import settings
        monkeypatch.setattr(settings, "secret_key", "unit-test-secret-key-for-r1-cutover", raising=False)
    except Exception:
        pass
    monkeypatch.setattr(enc, "_fernet", None, raising=False)
    yield enc
    monkeypatch.setattr(enc, "_fernet", None, raising=False)


# ── helpers ──────────────────────────────────────────────────────────────────

def _src(rel: str) -> str:
    return (APP / rel).read_text(encoding="utf-8")


def _func_src(rel: str, func_name: str) -> str:
    """Вернуть исходник конкретной функции/метода из модуля (по AST)."""
    tree = ast.parse(_src(rel))
    lines = _src(rel).splitlines()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == func_name:
            end = getattr(node, "end_lineno", None) or (node.lineno + 1)
            return "\n".join(lines[node.lineno - 1: end])
    raise AssertionError(f"function {func_name} not found in {rel}")


# ════════════════════════════════════════════════════════════════════════════
# 1. Поведенческие: property *_plain корректна в ОБОИХ состояниях
# ════════════════════════════════════════════════════════════════════════════

def test_appointment_phone_plain_after_backfill(stable_secret_key):
    """После backfill: patient_phone_encrypted заполнен → *_plain расшифровывает."""
    from app.models.doctor import Appointment
    a = Appointment()
    a.set_patient_phone("+7 (999) 123-45-67")
    # plaintext-колонка тоже выставлена set_*, эмулируем «после backfill»:
    # очищаем legacy plaintext, чтобы fallback не сработал и читался именно decrypt.
    a.patient_phone = None
    assert a.patient_phone_plain == "+7 (999) 123-45-67"


def test_appointment_phone_plain_before_backfill_fallback():
    """До backfill: *_encrypted пуст, *_plain отдаёт legacy-plaintext (fallback)."""
    from app.models.doctor import Appointment
    a = Appointment()
    a.patient_phone = "79991234567"          # legacy plaintext в БД
    a.patient_phone_encrypted = None         # backfill ещё не прошёл
    assert a.patient_phone_plain == "79991234567"


def test_appointment_name_notes_plain_fallback():
    from app.models.doctor import Appointment
    a = Appointment()
    a.patient_name = "Иванов Иван"
    a.notes = "жалобы"
    a.patient_name_encrypted = None
    a.notes_encrypted = None
    assert a.patient_name_plain == "Иванов Иван"
    assert a.notes_plain == "жалобы"


def test_lab_result_value_plain_both_states(stable_secret_key):
    from app.models.lab import LabResult
    # после backfill
    r = LabResult()
    r.set_value("5.6")
    r.set_reference_range("3.3-5.5")
    r.value = None
    r.reference_range = None
    assert r.value_plain == "5.6"
    assert r.reference_range_plain == "3.3-5.5"
    # до backfill (fallback)
    r2 = LabResult()
    r2.value = "12"
    r2.value_encrypted = None
    assert r2.value_plain == "12"


def test_medcard_diagnosis_name_plain_fallback():
    from app.models.medcard import PatientDiagnosis
    d = PatientDiagnosis()
    d.name = "Гипертония"
    d.notes = "стадия 2"
    d.name_encrypted = None
    d.notes_encrypted = None
    assert d.name_plain == "Гипертония"
    assert d.notes_plain == "стадия 2"


def test_vital_note_value_extra_plain_fallback():
    from app.models.patient_vital import PatientVital
    v = PatientVital()
    v.note = "после нагрузки"
    v.value_extra = {"systolic": 120}
    v.note_encrypted = None
    v.value_extra_encrypted = None
    assert v.note_plain == "после нагрузки"
    assert v.value_extra_plain == {"systolic": 120}


def test_hash_phone_deterministic_and_normalizing(stable_secret_key):
    """Группировка/exact-поиск по hash детерминирована и нормализует формат."""
    from app.models.doctor import hash_phone
    h1 = hash_phone("+7 (999) 123-45-67")
    h2 = hash_phone("89991234567")
    h3 = hash_phone("79991234567")
    assert h1 and h1 == h2 == h3            # один и тот же абонент → один хэш
    assert hash_phone("+79990000000") != h1  # другой номер → другой хэш
    assert hash_phone(None) is None


# ════════════════════════════════════════════════════════════════════════════
# 2. Инспекция исходников: места переведены на *_plain / *_hash
# ════════════════════════════════════════════════════════════════════════════

def test_no_todo_markers_remain():
    """Ни одного маркера TODO(#2 PHI) не осталось в backend/app."""
    leftover = [
        str(p) for p in APP.rglob("*.py")
        if "TODO(#2 PHI)" in p.read_text(encoding="utf-8")
    ]
    assert leftover == [], f"остались TODO(#2 PHI): {leftover}"


def test_distinct_counts_use_phone_hash():
    """Аналитика уникальных пациентов считает по patient_phone_hash, не plaintext."""
    for rel in [
        "services/cohort_service.py",
        "services/kpi_service.py",
        "routers/director.py",
        "routers/sms_marketing.py",
    ]:
        src = _src(rel)
        assert "distinct(Appointment.patient_phone_hash" in src.replace("func.", ""), rel
        assert "distinct(Appointment.patient_phone)" not in src.replace("func.", ""), rel


def test_exact_phone_lookups_use_hash():
    """Exact-match по телефону переведён на patient_phone_hash == hash_phone(...)."""
    cases = [
        ("services/spending_service.py", "compute_spending_summary"),
        ("services/calendar_service.py", "upcoming_appointments"),
        ("routers/patient_family.py", None),
        ("routers/medcard.py", "patient_medcard_timeline"),
    ]
    for rel, fn in cases:
        src = _func_src(rel, fn) if fn else _src(rel)
        assert "patient_phone_hash == hash_phone" in src, f"{rel}:{fn}"
        # сырого exact-сравнения plaintext-колонки телефона больше нет
        assert "Appointment.patient_phone ==" not in src, f"{rel}:{fn}"


def test_public_api_uses_hash_and_plain():
    src = _src("routers/public_api_v1.py")
    # поиск по телефону — exact-hash, ilike по Appointment.patient_phone убран
    assert "patient_phone_hash == hash_phone(phone)" in src
    assert "Appointment.patient_phone.ilike" not in src
    # отображение в _appointment_out — через property *_plain
    out = _func_src("routers/public_api_v1.py", "_appointment_out")
    assert "patient_phone_plain" in out and "patient_name_plain" in out
    assert "a.patient_phone," not in out and "a.patient_name," not in out


def test_reports_selects_orm_and_uses_plain():
    """Отчёт менеджера выбирает ORM Appointment и отдаёт *_plain (не enc:-токены)."""
    src = _src("routers/manager/reports.py")
    # больше не выбираем сырые Appointment.patient_phone/name/notes столбцами
    assert "Appointment.patient_phone," not in src
    assert "Appointment.patient_name," not in src
    assert "Appointment.notes," not in src
    # отдаём расшифрованные значения
    assert "patient_phone_plain" in src
    assert "patient_name_plain" in src
    assert "notes_plain" in src


def test_retention_uses_phone_hash_and_plain():
    src = _src("routers/manager/analytics_retention.py")
    # группировка/джойны — по blind-index
    assert "patient_phone_hash" in src
    # сырой plaintext телефон в аналитике ретеншена больше не фигурирует
    assert "Appointment.patient_phone," not in src
    assert "tuple_(Appointment.doctor_id, Appointment.patient_phone)" not in src
    # drill-down отображает ФИО/телефон через property
    drill = _func_src("routers/manager/analytics_retention.py", "doctor_retention_patients")
    assert "patient_phone_plain" in drill
    assert "patient_name_plain" in drill


def test_engagement_analytics_no_plaintext_phone_join():
    """Сырые SQL-джойны appointments.patient_phone = pa.phone убраны."""
    src = _src("services/engagement_analytics.py")
    assert "a.patient_phone = pa.phone" not in src
    assert "a.patient_phone=pa.phone" not in src
    # churn/funnel считают через blind-index hash_phone
    assert "patient_phone_hash" in src
    assert "hash_phone(" in src


def test_medical_display_serializers_use_plain():
    """Серилайзеры медданных отдают расшифрованные значения (#17)."""
    lab_doc = _func_src("routers/doctor_lab.py", "_serialize_result")
    assert "value_plain" in lab_doc and "reference_range_plain" in lab_doc
    assert "r.value," not in lab_doc and "r.reference_range," not in lab_doc

    diag = _func_src("routers/medcard.py", "_diag_dict")
    assert "name_plain" in diag and "notes_plain" in diag

    allergy = _func_src("routers/medcard.py", "_allergy_dict")
    assert "allergen_plain" in allergy and "reaction_plain" in allergy

    vacc = _func_src("routers/medcard.py", "_vacc_dict")
    assert "vaccine_name_plain" in vacc

    vital = _func_src("routers/vitals.py", "_serialize")
    assert "note_plain" in vital and "value_extra_plain" in vital


def test_sms_dispatch_audience_uses_hash_and_decrypt():
    """Аудитория рассылки дедуплицируется по hash и отдаёт расшифрованный номер."""
    src = _src("jobs/sms_campaign_dispatch.py")
    assert "patient_phone_hash" in src
    assert "patient_phone_plain" in src
    # больше не тянем distinct сырого plaintext-телефона
    assert "distinct(Appointment.patient_phone))" not in src.replace("func.", "")
