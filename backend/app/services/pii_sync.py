"""
pii_sync — SQLAlchemy event-listeners, синхронизирующие plaintext PII-поля
с их зашифрованными shadow-колонками (*_encrypted) и blind-index (*_hash).

[Находка #2 — 152-ФЗ] Цель: на КАЖДУЮ запись/изменение Appointment автоматически
заполнять patient_phone_encrypted/_hash, patient_name_encrypted/_hash,
notes_encrypted из соответствующих plaintext-полей — чтобы прикладной код мог
писать как раньше (appt.patient_phone = "..."), а шифрование происходило прозрачно.

[Находка #17 — 152-ФЗ] То же для медданных спец.категории:
  • PatientDiagnosis.name/notes
  • PatientAllergy.allergen/reaction
  • PatientVaccination.vaccine_name
  • LabResult.value/reference_range/raw_json (JSONB)
  • PatientVital.value_extra (JSONB)/note
По медтексту blind-index не нужен (поиска нет) — только шифрование.

[Находка #18 — 152-ФЗ] PatientAccount.name (ФИО глобального аккаунта пациента) —
шифрование + blind-index (имя участвует в поиске/идентификации).

Паттерн (по образцу app/services/user_audit_listeners.py):
  • before_insert / before_update на ORM-модели
  • синхронные listeners (другого пути у ORM-events нет)
  • НИКОГДА не блокируем запись из-за ошибки шифрования (log + продолжаем)

_MAP описывает, какие plaintext-поля каких моделей синхронизировать и куда:
    Model: {
        plaintext_attr: {
            "enc": encrypted_attr,          # обязательно
            "hash": (hash_attr, hash_func), # опционально (для полей с поиском)
            "json": True,                   # опционально (JSONB-поле: dump в JSON-строку)
        }
    }

ПРИМЕЧАНИЕ по объединению веток (merge security-remediation-wave0 ← recon-prod):
  Прод-сторона (Wave A/B) шифрует свои PII-поля НЕ через этот listener, а через
  собственные механизмы соответствующих моделей и НЕ дублируется здесь:
    • User.address           — encrypt в User.__init__ + property setter (user.py)
    • SignupRequest.full_name — encrypt в __init__ + property setter (signup_request.py)
    • Appointment.* / PatientAccount.name — есть set_*-методы в моделях ПЛЮС этот
      listener (модели явно полагаются на pii_sync, см. комментарии #2/#18 в моделях).
  Поэтому в _MAP ниже оставлен ЕДИНЫЙ набор полей, фактически имеющих shadow-колонки
  в текущих моделях. Старые записи прод-_MAP (User.phone_number/email/full_name,
  Doctor.full_name, PatientAccount.phone/email, PatientOTP/ContactRequest) НЕ
  переносятся: таких *_encrypted/_hash колонок в этих моделях нет — их регистрация
  привела бы к INSERT в несуществующую колонку. Дубли по Appointment и
  PatientAccount схлопнуты в одну корректную запись (с blind-index hash).

ВАЖНО (deploy-gate): shadow-колонки создаёт ОТДЕЛЬНАЯ миграция. install_pii_sync()
НЕ вызывается автоматически из main.py — подключать строго ПОСЛЕ применения
миграции (иначе INSERT в несуществующую колонку упадёт). См. opsNote PR #2.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import event
from sqlalchemy.orm.attributes import get_history

from app.models.doctor import Appointment, hash_phone, hash_name
from app.models.medcard import PatientDiagnosis, PatientAllergy, PatientVaccination
from app.models.lab import LabResult
from app.models.patient_vital import PatientVital
from app.models.patient_account import PatientAccount
from app.services import encryption_service

log = logging.getLogger("pii_sync")


def _enc(value, *, as_json: bool = False):
    """plaintext -> ciphertext ('enc:'/'plain:') либо None для пустого.

    as_json=True: значение — JSONB (dict/list). None → None; иначе сериализуем
    в JSON-строку и шифруем её (getter делает json.loads(decrypt(...))).
    """
    if as_json:
        if value is None:
            return None
        return encryption_service.encrypt(json.dumps(value))
    if value is None or value == "":
        return None
    return encryption_service.encrypt(value)


# Карта синхронизации plaintext -> shadow-колонки.
# phone и name участвуют в поиске/группировке → имеют blind-index hash.
# Медтекст (#17) — только шифрование (поиска по нему нет).
_MAP: dict = {
    Appointment: {
        "patient_phone": {"enc": "patient_phone_encrypted", "hash": ("patient_phone_hash", hash_phone)},
        "patient_name":  {"enc": "patient_name_encrypted",  "hash": ("patient_name_hash",  hash_name)},
        "notes":         {"enc": "notes_encrypted"},
    },
    # ── Находка #17: медданные спец.категории ────────────────────────────────
    PatientDiagnosis: {
        "name":  {"enc": "name_encrypted"},
        "notes": {"enc": "notes_encrypted"},
    },
    PatientAllergy: {
        "allergen": {"enc": "allergen_encrypted"},
        "reaction": {"enc": "reaction_encrypted"},
    },
    PatientVaccination: {
        "vaccine_name": {"enc": "vaccine_name_encrypted"},
    },
    LabResult: {
        "value":           {"enc": "value_encrypted"},
        "reference_range": {"enc": "reference_range_encrypted"},
        "raw_json":        {"enc": "raw_json_encrypted", "json": True},
    },
    PatientVital: {
        "value_extra": {"enc": "value_extra_encrypted", "json": True},
        "note":        {"enc": "note_encrypted"},
    },
    # ── Находка #18: ФИО глобального аккаунта пациента ────────────────────────
    # name участвует в поиске/идентификации → есть blind-index hash.
    PatientAccount: {
        "name": {"enc": "name_encrypted", "hash": ("name_hash", hash_name)},
    },
}


def _sync_target(target) -> None:
    """Заполнить shadow-колонки target из его plaintext-полей по _MAP."""
    spec = _MAP.get(type(target))
    if not spec:
        return
    for plain_attr, dst in spec.items():
        try:
            value = getattr(target, plain_attr, None)
            setattr(target, dst["enc"], _enc(value, as_json=dst.get("json", False)))
            hash_cfg = dst.get("hash")
            if hash_cfg:
                hash_attr, hash_fn = hash_cfg
                setattr(target, hash_attr, hash_fn(value))
        except Exception as e:  # pragma: no cover - никогда не блокируем запись
            log.warning("pii_sync: не удалось зашифровать %s.%s: %s",
                        type(target).__name__, plain_attr, e)


def _on_insert(mapper, connection, target) -> None:
    _sync_target(target)


def _on_update(mapper, connection, target) -> None:
    """На UPDATE пересинхронизируем только если plaintext реально изменился."""
    spec = _MAP.get(type(target))
    if not spec:
        return
    changed = False
    for plain_attr in spec:
        try:
            if get_history(target, plain_attr).has_changes():
                changed = True
                break
        except Exception:  # pragma: no cover
            changed = True
            break
    if changed:
        _sync_target(target)


def install_pii_sync() -> None:
    """Зарегистрировать listeners на все модели из _MAP (идемпотентно).

    Вызывать ПОСЛЕ применения миграции, добавляющей shadow-колонки.
    """
    for model in _MAP:
        if not event.contains(model, "before_insert", _on_insert):
            event.listen(model, "before_insert", _on_insert)
        if not event.contains(model, "before_update", _on_update):
            event.listen(model, "before_update", _on_update)
    log.info("pii_sync listeners registered for: %s",
             ", ".join(m.__name__ for m in _MAP))
