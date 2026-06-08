"""
Точечные тесты для находки #17 (тема pii-152fz) — кодовая часть.

Находка #17: медданные специальной категории (диагнозы, аллергии, прививки,
результаты анализов, виталки) хранились в PLAINTEXT. Теперь соответствующие
модели умеют шифровать эти поля по тому же паттерну, что и PHI appointments
(#2): shadow-колонка *_encrypted (ciphertext 'enc:'/'plain:' от
encryption_service), plaintext отдаётся property *_plain (lazy decrypt с
fallback на legacy-plaintext-колонку), на запись шифрует set_*() и listener
pii_sync. По медтексту blind-index не нужен (поиска по нему нет).

Покрытые модели/поля:
  • PatientDiagnosis.name / notes
  • PatientAllergy.allergen / reaction
  • PatientVaccination.vaccine_name
  • LabResult.value / reference_range / raw_json (JSONB → JSON-строка)
  • PatientVital.value_extra (JSONB → JSON-строка) / note

Что проверяем (unit, без Docker/Postgres — модель инстанцируется в памяти):
  • round-trip шифрования: set_* → *_encrypted содержит 'enc:'/'plain:',
    *_plain отдаёт исходный plaintext (и dict для JSON-полей);
  • property падает обратно на legacy-plaintext-колонку до backfill;
  • «дамп» (то, что персистится: только *_encrypted) НЕ содержит plaintext
    диагноза/аллергии/анализа;
  • listener pii_sync._sync_target заполняет shadow-колонки из plaintext;
  • _MAP покрывает все обязательные медполя и не вешает hash на медтекст.

Запуск: pytest backend/tests/test_fix_17.py -v
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.unit


# ── Фикстура: детерминированный SECRET_KEY (сброс кэша Fernet) ───────────────

@pytest.fixture
def stable_secret_key(monkeypatch):
    """Фиксирует SECRET_KEY и сбрасывает кэш Fernet (как в test_fix_2)."""
    import app.services.encryption_service as enc

    monkeypatch.setenv("SECRET_KEY", "unit-test-secret-key-for-fix-17")
    try:
        from app.config import settings
        monkeypatch.setattr(settings, "secret_key", "unit-test-secret-key-for-fix-17", raising=False)
    except Exception:
        pass
    monkeypatch.setattr(enc, "_fernet", None, raising=False)
    yield enc
    monkeypatch.setattr(enc, "_fernet", None, raising=False)


# ── Тестовые медданные (спец.категория ПДн) ─────────────────────────────────

DIAG_NAME = "Сахарный диабет 2 типа"
DIAG_NOTES = "Декомпенсация; назначен метформин 1000мг."
ALLERGEN = "Пенициллин"
REACTION = "Анафилактический шок"
VACCINE = "Спутник V (Гам-КОВИД-Вак)"
LAB_VALUE = "13.7"
LAB_REF = "4.0-6.0"
LAB_RAW = {"analyte": "glucose", "flag": "high", "comment": "натощак"}
VITAL_NOTE = "Измерено после нагрузки, самочувствие плохое"
VITAL_EXTRA = {"sys": 180, "dia": 110, "phase": "deep_sleep"}


# ── 1. PatientDiagnosis: name / notes ───────────────────────────────────────

def test_diagnosis_name_roundtrip(stable_secret_key):
    from app.models.medcard import PatientDiagnosis
    d = PatientDiagnosis()
    d.set_name(DIAG_NAME)

    assert d.name_encrypted
    assert d.name_encrypted.startswith(("enc:", "plain:"))
    assert DIAG_NAME not in d.name_encrypted
    assert "диабет" not in d.name_encrypted
    assert d.name_plain == DIAG_NAME


def test_diagnosis_notes_roundtrip(stable_secret_key):
    from app.models.medcard import PatientDiagnosis
    d = PatientDiagnosis()
    d.set_notes(DIAG_NOTES)

    assert d.notes_encrypted
    assert d.notes_encrypted.startswith(("enc:", "plain:"))
    assert DIAG_NOTES not in d.notes_encrypted
    assert "метформин" not in d.notes_encrypted
    assert d.notes_plain == DIAG_NOTES


def test_diagnosis_none_and_legacy_fallback(stable_secret_key):
    from app.models.medcard import PatientDiagnosis
    # None не падает и не оставляет шифртекст
    d = PatientDiagnosis()
    d.set_name(None)
    d.set_notes(None)
    assert d.name_encrypted is None
    assert d.notes_encrypted is None
    assert d.name_plain is None
    assert d.notes_plain is None

    # legacy-запись (до backfill): шифртекста нет → property отдаёт plaintext-колонку
    legacy = PatientDiagnosis(name=DIAG_NAME, notes=DIAG_NOTES)
    assert legacy.name_encrypted is None
    assert legacy.name_plain == DIAG_NAME
    assert legacy.notes_plain == DIAG_NOTES


# ── 2. PatientAllergy: allergen / reaction ──────────────────────────────────

def test_allergy_roundtrip(stable_secret_key):
    from app.models.medcard import PatientAllergy
    a = PatientAllergy()
    a.set_allergen(ALLERGEN)
    a.set_reaction(REACTION)

    assert a.allergen_encrypted.startswith(("enc:", "plain:"))
    assert ALLERGEN not in a.allergen_encrypted
    assert REACTION not in a.reaction_encrypted
    assert "шок" not in a.reaction_encrypted
    assert a.allergen_plain == ALLERGEN
    assert a.reaction_plain == REACTION


def test_allergy_legacy_fallback(stable_secret_key):
    from app.models.medcard import PatientAllergy
    legacy = PatientAllergy(allergen=ALLERGEN, reaction=REACTION)
    assert legacy.allergen_encrypted is None
    assert legacy.allergen_plain == ALLERGEN
    assert legacy.reaction_plain == REACTION


# ── 3. PatientVaccination: vaccine_name ─────────────────────────────────────

def test_vaccination_roundtrip(stable_secret_key):
    from app.models.medcard import PatientVaccination
    v = PatientVaccination()
    v.set_vaccine_name(VACCINE)

    assert v.vaccine_name_encrypted.startswith(("enc:", "plain:"))
    assert VACCINE not in v.vaccine_name_encrypted
    assert "Спутник" not in v.vaccine_name_encrypted
    assert v.vaccine_name_plain == VACCINE


def test_vaccination_legacy_fallback(stable_secret_key):
    from app.models.medcard import PatientVaccination
    legacy = PatientVaccination(vaccine_name=VACCINE)
    assert legacy.vaccine_name_encrypted is None
    assert legacy.vaccine_name_plain == VACCINE


# ── 4. LabResult: value / reference_range / raw_json (JSONB) ────────────────

def test_lab_value_and_reference_roundtrip(stable_secret_key):
    from app.models.lab import LabResult
    r = LabResult()
    r.set_value(LAB_VALUE)
    r.set_reference_range(LAB_REF)

    assert r.value_encrypted.startswith(("enc:", "plain:"))
    assert LAB_VALUE not in r.value_encrypted
    assert r.reference_range_encrypted.startswith(("enc:", "plain:"))
    assert LAB_REF not in r.reference_range_encrypted
    assert r.value_plain == LAB_VALUE
    assert r.reference_range_plain == LAB_REF


def test_lab_raw_json_roundtrip(stable_secret_key):
    """JSONB-поле: шифруется как JSON-строка, getter возвращает dict."""
    from app.models.lab import LabResult
    r = LabResult()
    r.set_raw_json(LAB_RAW)

    assert r.raw_json_encrypted
    assert r.raw_json_encrypted.startswith(("enc:", "plain:"))
    # plaintext значений не утёк в шифр
    assert "glucose" not in r.raw_json_encrypted
    assert "натощак" not in r.raw_json_encrypted
    # round-trip восстанавливает dict
    assert r.raw_json_plain == LAB_RAW


def test_lab_none_and_legacy(stable_secret_key):
    from app.models.lab import LabResult
    r = LabResult()
    r.set_value(None)
    r.set_reference_range(None)
    r.set_raw_json(None)
    assert r.value_encrypted is None
    assert r.reference_range_encrypted is None
    assert r.raw_json_encrypted is None
    assert r.value_plain is None
    assert r.raw_json_plain is None

    legacy = LabResult(value=LAB_VALUE, reference_range=LAB_REF, raw_json=LAB_RAW)
    assert legacy.value_encrypted is None
    assert legacy.value_plain == LAB_VALUE
    assert legacy.reference_range_plain == LAB_REF
    assert legacy.raw_json_plain == LAB_RAW


# ── 5. PatientVital: value_extra (JSONB) / note (value_num НЕ шифруем) ───────

def test_vital_note_roundtrip(stable_secret_key):
    from app.models.patient_vital import PatientVital
    pv = PatientVital()
    pv.set_note(VITAL_NOTE)

    assert pv.note_encrypted.startswith(("enc:", "plain:"))
    assert VITAL_NOTE not in pv.note_encrypted
    assert pv.note_plain == VITAL_NOTE


def test_vital_extra_json_roundtrip(stable_secret_key):
    from app.models.patient_vital import PatientVital
    pv = PatientVital()
    pv.set_value_extra(VITAL_EXTRA)

    assert pv.value_extra_encrypted
    assert pv.value_extra_encrypted.startswith(("enc:", "plain:"))
    assert "180" not in pv.value_extra_encrypted
    assert "deep_sleep" not in pv.value_extra_encrypted
    assert pv.value_extra_plain == VITAL_EXTRA


def test_vital_value_num_is_not_encrypted(stable_secret_key):
    """value_num (числовой показатель для графиков) намеренно НЕ шифруется."""
    from app.models.patient_vital import PatientVital
    from decimal import Decimal
    pv = PatientVital(value_num=Decimal("72.5"))
    # нет shadow-колонки/сеттера для value_num — значение остаётся числовым
    assert pv.value_num == Decimal("72.5")
    assert not hasattr(pv, "value_num_encrypted")
    assert not hasattr(pv, "set_value_num")


def test_vital_legacy_fallback(stable_secret_key):
    from app.models.patient_vital import PatientVital
    legacy = PatientVital(note=VITAL_NOTE, value_extra=VITAL_EXTRA)
    assert legacy.note_encrypted is None
    assert legacy.note_plain == VITAL_NOTE
    assert legacy.value_extra_plain == VITAL_EXTRA


# ── 6. «Дамп» персистентных шифр-колонок не содержит plaintext медданных ────

def test_persisted_dump_has_no_plaintext_medical_data(stable_secret_key):
    """Симулируем дамп строк БД (только *_encrypted) — без plaintext спец.категории ПДн."""
    from app.models.medcard import PatientDiagnosis, PatientAllergy, PatientVaccination
    from app.models.lab import LabResult
    from app.models.patient_vital import PatientVital

    d = PatientDiagnosis()
    d.set_name(DIAG_NAME)
    d.set_notes(DIAG_NOTES)
    a = PatientAllergy()
    a.set_allergen(ALLERGEN)
    a.set_reaction(REACTION)
    v = PatientVaccination()
    v.set_vaccine_name(VACCINE)
    r = LabResult()
    r.set_value(LAB_VALUE)
    r.set_reference_range(LAB_REF)
    r.set_raw_json(LAB_RAW)
    pv = PatientVital()
    pv.set_note(VITAL_NOTE)
    pv.set_value_extra(VITAL_EXTRA)

    dump = " | ".join(
        str(x) for x in (
            d.name_encrypted, d.notes_encrypted,
            a.allergen_encrypted, a.reaction_encrypted,
            v.vaccine_name_encrypted,
            r.value_encrypted, r.reference_range_encrypted, r.raw_json_encrypted,
            pv.note_encrypted, pv.value_extra_encrypted,
        )
    )
    secrets = [
        DIAG_NAME, "диабет", DIAG_NOTES, "метформин",
        ALLERGEN, REACTION, "шок",
        VACCINE, "Спутник",
        LAB_VALUE, LAB_REF, "glucose", "натощак",
        VITAL_NOTE, "deep_sleep",
    ]
    for secret in secrets:
        assert secret not in dump, f"plaintext медданные утекли в дамп: {secret!r}"


# ── 7. Listener pii_sync синхронизирует shadow-колонки из plaintext ─────────

def test_pii_sync_fills_diagnosis_shadow_columns(stable_secret_key):
    from app.services import pii_sync
    from app.models.medcard import PatientDiagnosis

    d = PatientDiagnosis(name=DIAG_NAME, notes=DIAG_NOTES)
    assert d.name_encrypted is None  # ещё не синхронизировано

    pii_sync._sync_target(d)  # то, что делает before_insert listener

    assert d.name_encrypted and d.name_encrypted.startswith(("enc:", "plain:"))
    assert DIAG_NAME not in d.name_encrypted
    assert d.notes_encrypted and DIAG_NOTES not in d.notes_encrypted


def test_pii_sync_fills_lab_json(stable_secret_key):
    from app.services import pii_sync
    from app.models.lab import LabResult

    r = LabResult(value=LAB_VALUE, reference_range=LAB_REF, raw_json=LAB_RAW)
    pii_sync._sync_target(r)

    assert r.value_encrypted and LAB_VALUE not in r.value_encrypted
    assert r.reference_range_encrypted and LAB_REF not in r.reference_range_encrypted
    # JSON-поле зашифровано как JSON-строка → property восстанавливает dict
    assert r.raw_json_encrypted and "glucose" not in r.raw_json_encrypted
    assert r.raw_json_plain == LAB_RAW


def test_pii_sync_fills_vital_json(stable_secret_key):
    from app.services import pii_sync
    from app.models.patient_vital import PatientVital

    pv = PatientVital(note=VITAL_NOTE, value_extra=VITAL_EXTRA)
    pii_sync._sync_target(pv)

    assert pv.note_encrypted and VITAL_NOTE not in pv.note_encrypted
    assert pv.value_extra_encrypted and "deep_sleep" not in pv.value_extra_encrypted
    assert pv.value_extra_plain == VITAL_EXTRA


# ── 8. _MAP покрывает обязательные медполя и НЕ вешает hash на медтекст ──────

def test_pii_sync_map_covers_all_medical_fields():
    from app.services.pii_sync import _MAP
    from app.models.medcard import PatientDiagnosis, PatientAllergy, PatientVaccination
    from app.models.lab import LabResult
    from app.models.patient_vital import PatientVital

    expected = {
        PatientDiagnosis: {
            "name": "name_encrypted",
            "notes": "notes_encrypted",
        },
        PatientAllergy: {
            "allergen": "allergen_encrypted",
            "reaction": "reaction_encrypted",
        },
        PatientVaccination: {
            "vaccine_name": "vaccine_name_encrypted",
        },
        LabResult: {
            "value": "value_encrypted",
            "reference_range": "reference_range_encrypted",
            "raw_json": "raw_json_encrypted",
        },
        PatientVital: {
            "value_extra": "value_extra_encrypted",
            "note": "note_encrypted",
        },
    }
    for model, fields in expected.items():
        spec = _MAP[model]
        for plain_attr, enc_col in fields.items():
            assert spec[plain_attr]["enc"] == enc_col
            # медтекст не ищут — blind-index не вешаем
            assert "hash" not in spec[plain_attr], f"{model.__name__}.{plain_attr} не должен иметь hash"

    # JSON-поля помечены флагом json для корректной сериализации в listener
    assert _MAP[LabResult]["raw_json"].get("json") is True
    assert _MAP[PatientVital]["value_extra"].get("json") is True
