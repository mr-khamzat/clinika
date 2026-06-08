"""
Точечные тесты для находки #2 (тема pii-152fz) — кодовая часть.

Находка #2: центральная PHI-таблица appointments хранила patient_phone,
patient_name и медзаметки (notes) в PLAINTEXT. Теперь модель умеет шифровать
эти поля (shadow-колонки *_encrypted) и строить детерминированный blind-index
(*_hash) для поиска/группировки без расшифровки, по существующему в проекте
паттерну lazy-property над encryption_service (как PaymentGatewayConfig).

Что проверяем (unit, без Docker/Postgres — модель инстанцируется в памяти,
декларативный __init__ просто проставляет атрибуты):
  • round-trip шифрования: set_* → *_encrypted содержит 'enc:'/'plain:',
    *_plain отдаёт исходный plaintext;
  • детерминизм хэша: один и тот же телефон/имя → один и тот же hash,
    разные → разные; телефон нормализуется (+7…/8…/7… → один хэш);
  • «дамп» (то, что персистится в БД: *_encrypted + *_hash) НЕ содержит
    plaintext ФИО/телефона;
  • listener pii_sync._sync_target заполняет shadow-колонки из plaintext.

Запуск: pytest backend/tests/test_fix_2.py -v
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.unit


# ── Фикстура: детерминированный SECRET_KEY (Fernet + HMAC-ключ blind-index) ──

@pytest.fixture
def stable_secret_key(monkeypatch):
    """Фиксирует SECRET_KEY и сбрасывает кэш Fernet.

    encryption_service кэширует _fernet на процесс — без сброса тесты влияют
    друг на друга. hash_phone/hash_name деривируют HMAC-ключ из того же
    secret_key, поэтому одной фиксации достаточно для шифра и для хэша.
    """
    import app.services.encryption_service as enc

    monkeypatch.setenv("SECRET_KEY", "unit-test-secret-key-for-fix-2")
    try:
        from app.config import settings
        monkeypatch.setattr(settings, "secret_key", "unit-test-secret-key-for-fix-2", raising=False)
    except Exception:
        pass
    monkeypatch.setattr(enc, "_fernet", None, raising=False)
    yield enc
    monkeypatch.setattr(enc, "_fernet", None, raising=False)


PHONE = "+7 (999) 123-45-67"
PHONE_NORM = "79991234567"
NAME = "Иванов Иван Иванович"
NOTES = "Жалобы на головную боль; назначен МРТ. Аллергия на пенициллин."


def _make_appt(**kw):
    from app.models.doctor import Appointment
    return Appointment(**kw)


# ── 1. Round-trip шифрования через accessors ────────────────────────────────

def test_phone_roundtrip(stable_secret_key):
    appt = _make_appt()
    appt.set_patient_phone(PHONE)

    # В БД персистится шифртекст, не plaintext.
    assert appt.patient_phone_encrypted
    assert appt.patient_phone_encrypted.startswith(("enc:", "plain:"))
    assert PHONE not in appt.patient_phone_encrypted
    assert PHONE_NORM not in appt.patient_phone_encrypted
    # property отдаёт исходный plaintext.
    assert appt.patient_phone_plain == PHONE


def test_name_roundtrip(stable_secret_key):
    appt = _make_appt()
    appt.set_patient_name(NAME)

    assert appt.patient_name_encrypted
    assert appt.patient_name_encrypted.startswith(("enc:", "plain:"))
    assert NAME not in appt.patient_name_encrypted
    assert appt.patient_name_plain == NAME


def test_notes_roundtrip(stable_secret_key):
    appt = _make_appt()
    appt.set_notes(NOTES)

    assert appt.notes_encrypted
    assert appt.notes_encrypted.startswith(("enc:", "plain:"))
    assert NOTES not in appt.notes_encrypted
    assert "пенициллин" not in appt.notes_encrypted
    assert appt.notes_plain == NOTES


def test_none_values_dont_crash(stable_secret_key):
    appt = _make_appt()
    appt.set_patient_phone(None)
    appt.set_patient_name(None)
    appt.set_notes(None)
    assert appt.patient_phone_encrypted is None
    assert appt.patient_phone_hash is None
    assert appt.patient_name_encrypted is None
    assert appt.notes_encrypted is None
    assert appt.patient_phone_plain is None
    assert appt.notes_plain is None


def test_property_falls_back_to_legacy_plaintext(stable_secret_key):
    """Старая запись без шифртекста (до backfill) → property отдаёт plaintext-колонку."""
    appt = _make_appt(patient_phone=PHONE_NORM, patient_name=NAME, notes=NOTES)
    # *_encrypted не заполнены (legacy)
    assert appt.patient_phone_plain == PHONE_NORM
    assert appt.patient_name_plain == NAME
    assert appt.notes_plain == NOTES


# ── 2. Детерминизм и нормализация blind-index ───────────────────────────────

def test_phone_hash_is_deterministic(stable_secret_key):
    from app.models.doctor import hash_phone
    assert hash_phone(PHONE_NORM) == hash_phone(PHONE_NORM)
    # 64 hex-символа SHA256
    h = hash_phone(PHONE_NORM)
    assert len(h) == 64
    int(h, 16)  # валидный hex


def test_phone_hash_normalizes_formats(stable_secret_key):
    """+7…, 8…, 7…, с разделителями — все дают ОДИН хэш (можно искать единообразно)."""
    from app.models.doctor import hash_phone
    variants = ["79991234567", "+79991234567", "89991234567", "+7 (999) 123-45-67"]
    hashes = {hash_phone(v) for v in variants}
    assert len(hashes) == 1


def test_different_phones_differ(stable_secret_key):
    from app.models.doctor import hash_phone
    assert hash_phone("79991234567") != hash_phone("79991234568")


def test_phone_hash_is_not_plaintext(stable_secret_key):
    from app.models.doctor import hash_phone
    h = hash_phone(PHONE)
    assert PHONE not in h
    assert PHONE_NORM not in h


def test_name_hash_deterministic_and_normalized(stable_secret_key):
    from app.models.doctor import hash_name
    assert hash_name(NAME) == hash_name("  иванов   иван  иванович ")  # trim+lower+схлоп
    assert hash_name("Петров") != hash_name("Иванов")
    assert NAME not in hash_name(NAME)


def test_hash_none(stable_secret_key):
    from app.models.doctor import hash_phone, hash_name
    assert hash_phone(None) is None
    assert hash_phone("") is None
    assert hash_name(None) is None
    assert hash_name("") is None


def test_setter_sets_matching_hash(stable_secret_key):
    """set_patient_phone проставляет тот же хэш, что и прямой hash_phone (для поиска)."""
    from app.models.doctor import hash_phone
    appt = _make_appt()
    appt.set_patient_phone(PHONE)
    assert appt.patient_phone_hash == hash_phone(PHONE)
    assert appt.patient_phone_hash == hash_phone(PHONE_NORM)  # нормализация


# ── 3. «Дамп» персистентных полей не содержит plaintext PII ─────────────────

def test_persisted_dump_has_no_plaintext_pii(stable_secret_key):
    """Симулируем дамп строки БД (только шифр-/hash-колонки) — без plaintext ФИО/телефона."""
    appt = _make_appt()
    appt.set_patient_phone(PHONE)
    appt.set_patient_name(NAME)
    appt.set_notes(NOTES)

    # То, что реально уходит в зашифрованные/индексные колонки:
    dump = " | ".join(
        str(x) for x in (
            appt.patient_phone_encrypted,
            appt.patient_phone_hash,
            appt.patient_name_encrypted,
            appt.patient_name_hash,
            appt.notes_encrypted,
        )
    )
    for secret in (PHONE, PHONE_NORM, NAME, "Иванов", "пенициллин"):
        assert secret not in dump, f"plaintext PII утёк в дамп: {secret!r}"


# ── 4. Listener pii_sync синхронизирует shadow-колонки из plaintext ─────────

def test_pii_sync_fills_shadow_columns(stable_secret_key):
    from app.services import pii_sync
    from app.models.doctor import hash_phone, hash_name

    # Эмулируем «писали как раньше»: plaintext-поля выставлены напрямую.
    appt = _make_appt(patient_phone=PHONE_NORM, patient_name=NAME, notes=NOTES)
    assert appt.patient_phone_encrypted is None  # ещё не синхронизировано

    pii_sync._sync_target(appt)  # то, что делает before_insert listener

    assert appt.patient_phone_encrypted and appt.patient_phone_encrypted.startswith(("enc:", "plain:"))
    assert appt.patient_phone_hash == hash_phone(PHONE_NORM)
    assert appt.patient_name_encrypted and PHONE_NORM not in appt.patient_name_encrypted
    assert appt.patient_name_hash == hash_name(NAME)
    assert appt.notes_encrypted and NOTES not in appt.notes_encrypted
    # plaintext не утёк в шифр-колонки
    assert PHONE_NORM not in appt.patient_phone_encrypted
    assert NAME not in appt.patient_name_encrypted


def test_pii_sync_map_covers_required_fields():
    """_MAP должен покрывать phone (+hash), name (+hash) и notes для Appointment."""
    from app.services.pii_sync import _MAP
    from app.models.doctor import Appointment

    spec = _MAP[Appointment]
    assert spec["patient_phone"]["enc"] == "patient_phone_encrypted"
    assert spec["patient_phone"]["hash"][0] == "patient_phone_hash"
    assert spec["patient_name"]["enc"] == "patient_name_encrypted"
    assert spec["patient_name"]["hash"][0] == "patient_name_hash"
    assert spec["notes"]["enc"] == "notes_encrypted"
    # notes без blind-index (поиска по тексту заметок нет)
    assert "hash" not in spec["notes"]
