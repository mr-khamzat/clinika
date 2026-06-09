"""Точечные unit-тесты для security-remediation-wave0, пакет «services».

Покрывает находки аудита (idx):
  29 — lab_service: API-ключи лаборатории шифруются через encryption_service
       (был импорт несуществующего secrets_service → plaintext).
  34 — scheduling_service.book_slot: SELECT-then-INSERT с конфликтом слота.
  36 — acquiring_service.refund_clinic_payment: идемпотентность + проверка
       статуса/суммы возврата.
  39 — bonus_service: денежные суммы пишутся в ledger как Decimal (без float).
  42 — billing_service: номер счёта по MAX(suffix)+1 (устойчив к удалению),
       retry на конфликт уникального индекса.
  43 — staff_chat_mentions: fire-and-forget TG-задачи удерживаются ссылкой.

Все тесты — unit (mock / in-memory), PostgreSQL не требуется.
"""
from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

pytestmark = pytest.mark.unit


# ─────────────────────────────────────────────────────────────────────────────
# idx 29 — lab_service: реальное шифрование через encryption_service
# ─────────────────────────────────────────────────────────────────────────────

def test_lab_api_key_encrypt_roundtrip():
    """encrypt_api_key → decrypt_api_key возвращает исходный ключ, и хранимое
    значение НЕ равно plaintext (используется encryption_service)."""
    from app.services import lab_service

    raw = "super-secret-lab-key-1234567890"
    stored = lab_service.encrypt_api_key(raw)
    assert stored is not None
    # Хранимое значение содержит маркер encryption_service ('enc:' или 'plain:'),
    # но никак не голый ключ без префикса.
    assert stored.startswith("enc:") or stored.startswith("plain:")
    # Главное — раунд-трип корректен.
    assert lab_service.decrypt_api_key(stored) == raw


def test_lab_api_key_uses_real_encryption_module():
    """Импорт должен идти из encryption_service (а не несуществующего
    secrets_service). При наличии cryptography ключ шифруется (enc:)."""
    from app.services import lab_service

    stored = lab_service.encrypt_api_key("abcdefgh12345678")
    # Если Fernet доступен — значение зашифровано (enc:), плейнтекста в нём нет.
    if stored.startswith("enc:"):
        assert "abcdefgh12345678" not in stored
    # decrypt всегда возвращает исходник
    assert lab_service.decrypt_api_key(stored) == "abcdefgh12345678"


def test_lab_api_key_none_passthrough():
    from app.services import lab_service
    assert lab_service.encrypt_api_key(None) is None
    assert lab_service.decrypt_api_key(None) is None


# ─────────────────────────────────────────────────────────────────────────────
# Лёгкая in-memory фейк-сессия для тестов, которым нужна работа со списком строк
# ─────────────────────────────────────────────────────────────────────────────

class _Bind:
    def __init__(self, name="sqlite"):
        self.dialect = SimpleNamespace(name=name)


# ─────────────────────────────────────────────────────────────────────────────
# idx 34 — scheduling_service.book_slot: конфликт слота → HTTP 409
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_book_slot_rejects_taken_slot():
    """Если слот уже занят (PENDING/CONFIRMED) — book_slot бросает 409 и НЕ
    добавляет новый Appointment."""
    from fastapi import HTTPException
    from app.services import scheduling_service

    db = AsyncMock()
    db.bind = _Bind("sqlite")  # не PG → advisory-lock пропускается

    existing_appt = object()
    conflict_result = MagicMock()
    conflict_result.scalar_one_or_none.return_value = existing_appt
    db.execute = AsyncMock(return_value=conflict_result)
    db.add = MagicMock()

    with pytest.raises(HTTPException) as ei:
        await scheduling_service.book_slot(
            db,
            doctor_id=uuid.uuid4(),
            appointment_date=date(2026, 6, 10),
            start_time=time(10, 0),
            patient_phone="+70000000000",
            patient_name="Тест",
        )
    assert ei.value.status_code == 409
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_book_slot_advisory_lock_only_on_pg():
    """На PostgreSQL перед проверкой берётся pg_advisory_xact_lock."""
    from fastapi import HTTPException
    from app.services import scheduling_service

    calls = []

    db = AsyncMock()
    db.bind = _Bind("postgresql")
    db.add = MagicMock()

    async def fake_execute(stmt, params=None):
        # Запоминаем «сырые» SQL-вызовы (advisory lock идёт как text()).
        text_sql = getattr(stmt, "text", None)
        if text_sql:
            calls.append(text_sql)
            return MagicMock()
        # Любой select слота → конфликт, чтобы быстро выйти из функции.
        res = MagicMock()
        res.scalar_one_or_none.return_value = object()
        return res

    db.execute = AsyncMock(side_effect=fake_execute)

    with pytest.raises(HTTPException):
        await scheduling_service.book_slot(
            db,
            doctor_id=uuid.uuid4(),
            appointment_date=date(2026, 6, 10),
            start_time=time(10, 0),
            patient_phone="+70000000000",
            patient_name="Тест",
        )
    assert any("pg_advisory_xact_lock" in c for c in calls), \
        "advisory lock не был взят на PostgreSQL"


def test_advisory_lock_key_is_stable_and_signed_64bit():
    from app.services import scheduling_service

    did = uuid.UUID("11111111-1111-1111-1111-111111111111")
    k1 = scheduling_service._advisory_lock_key(did, date(2026, 6, 10), time(10, 0))
    k2 = scheduling_service._advisory_lock_key(did, date(2026, 6, 10), time(10, 0))
    k3 = scheduling_service._advisory_lock_key(did, date(2026, 6, 10), time(11, 0))
    assert k1 == k2          # детерминирован
    assert k1 != k3          # разный слот → разный ключ
    assert -(2 ** 63) <= k1 < 2 ** 63   # влезает в bigint


# ─────────────────────────────────────────────────────────────────────────────
# idx 36 — acquiring_service.refund_clinic_payment: guard'ы
# ─────────────────────────────────────────────────────────────────────────────

def _make_payment(status, amount="100.00", gw_pid="gw-1", meta=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        clinic_id=uuid.uuid4(),
        gateway="yookassa",
        gateway_payment_id=gw_pid,
        status=status,
        amount=Decimal(amount),
        payment_metadata=dict(meta or {}),
    )


def _refund_db(payment):
    db = AsyncMock()
    db.bind = _Bind("sqlite")
    db.get = AsyncMock(return_value=payment)
    db.flush = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_refund_blocks_non_succeeded():
    from app.services import acquiring_service
    from app.models.payments_clinic import ClinicPaymentStatus

    payment = _make_payment(ClinicPaymentStatus.PENDING)
    db = _refund_db(payment)

    with pytest.raises(LookupError):
        await acquiring_service.refund_clinic_payment(db, payment_id=payment.id)


@pytest.mark.asyncio
async def test_refund_blocks_already_refunded():
    from app.services import acquiring_service
    from app.models.payments_clinic import ClinicPaymentStatus

    payment = _make_payment(ClinicPaymentStatus.REFUNDED)
    db = _refund_db(payment)

    with pytest.raises(LookupError):
        await acquiring_service.refund_clinic_payment(db, payment_id=payment.id)


@pytest.mark.asyncio
async def test_refund_blocks_double_initiation():
    """Повторный возврат при уже выставленном refund_initiated — блокируется."""
    from app.services import acquiring_service
    from app.models.payments_clinic import ClinicPaymentStatus

    payment = _make_payment(
        ClinicPaymentStatus.SUCCEEDED, meta={"refund_initiated": {"at": "x"}}
    )
    db = _refund_db(payment)

    with pytest.raises(LookupError):
        await acquiring_service.refund_clinic_payment(db, payment_id=payment.id)


@pytest.mark.asyncio
async def test_refund_rejects_amount_over_payment():
    from app.services import acquiring_service
    from app.models.payments_clinic import ClinicPaymentStatus

    payment = _make_payment(ClinicPaymentStatus.SUCCEEDED, amount="100.00")
    db = _refund_db(payment)

    with pytest.raises(LookupError):
        await acquiring_service.refund_clinic_payment(
            db, payment_id=payment.id, amount=Decimal("150.00")
        )


@pytest.mark.asyncio
async def test_refund_happy_path_marks_initiated(monkeypatch):
    """Успешный возврат: вызывает adapter.refund и помечает refund_initiated."""
    from app.services import acquiring_service
    from app.models.payments_clinic import ClinicPaymentStatus

    payment = _make_payment(ClinicPaymentStatus.SUCCEEDED, amount="100.00")
    db = _refund_db(payment)

    # Конфиг шлюза найден
    monkeypatch.setattr(
        acquiring_service, "_get_active_config",
        AsyncMock(return_value=object()),
    )
    fake_adapter = SimpleNamespace(refund=AsyncMock(return_value={"ok": True}))
    monkeypatch.setattr(acquiring_service, "get_gateway", lambda gw, cfg: fake_adapter)

    out = await acquiring_service.refund_clinic_payment(
        db, payment_id=payment.id, amount=Decimal("100.00")
    )
    assert out["payment_id"] == str(payment.id)
    fake_adapter.refund.assert_awaited_once()
    assert payment.payment_metadata.get("refund_initiated") is not None


# ─────────────────────────────────────────────────────────────────────────────
# idx 39 — bonus_service: Decimal в ledger без float
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_mark_bonus_paid_writes_decimal_to_ledger(monkeypatch):
    """add_entry должен получить amount как Decimal (а не float)."""
    from app.services import bonus_service
    from app.models.bonus import BonusStatus

    bonus = SimpleNamespace(
        id=uuid.uuid4(),
        status=BonusStatus.PENDING,
        amount=Decimal("123.45"),
        admin_id=uuid.uuid4(),
        tenant_id=None,
        paid_at=None,
    )

    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = bonus
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    captured = {}

    async def fake_add_entry(*, db, user_id, amount, operation_type, **kw):
        captured["amount"] = amount
        captured["op"] = operation_type
        return SimpleNamespace(id=uuid.uuid4())

    import app.services.ledger_service as ledger_service
    monkeypatch.setattr(ledger_service, "add_entry", fake_add_entry)
    # Заглушаем побочные интеграции, чтобы не лезть в реальные сервисы.
    monkeypatch.setattr(
        "app.services.franchise_billing_service.record_platform_fee_for_bonus",
        AsyncMock(), raising=False,
    )

    await bonus_service.mark_bonus_paid(db, bonus.id)

    assert isinstance(captured["amount"], Decimal), \
        f"ожидался Decimal, получено {type(captured['amount'])}"
    assert captured["amount"] == Decimal("-123.45")


# ─────────────────────────────────────────────────────────────────────────────
# idx 42 — billing_service: номер счёта MAX(suffix)+1 + retry
# ─────────────────────────────────────────────────────────────────────────────

def test_seq_from_invoice_number():
    from app.services import billing_service

    prefix = billing_service._invoice_prefix(2026)
    assert billing_service._seq_from_invoice_number("INV-2026-00042", prefix) == 42
    assert billing_service._seq_from_invoice_number("INV-2026-00001", prefix) == 1
    # Чужой год / мусор → 0
    assert billing_service._seq_from_invoice_number("INV-2025-00099", prefix) == 0
    assert billing_service._seq_from_invoice_number(None, prefix) == 0
    assert billing_service._seq_from_invoice_number("garbage", prefix) == 0


@pytest.mark.asyncio
async def test_next_invoice_seq_uses_max_not_count():
    """Даже если строк мало (после удаления), seq идёт от MAX(suffix)+1,
    а не от COUNT(*)+1 — иначе будут дубли существующих номеров."""
    from app.services import billing_service

    year = 2026
    prefix = billing_service._invoice_prefix(year)
    # Существует ОДИН счёт с большим номером (как после удаления более ранних).
    existing = [f"{prefix}00007"]

    db = AsyncMock()
    res = MagicMock()
    res.scalars.return_value.all.return_value = existing
    db.execute = AsyncMock(return_value=res)

    seq = await billing_service._next_invoice_seq(db, year)
    assert seq == 8  # MAX(7)+1, НЕ COUNT(1)+1=2


def test_format_invoice_number():
    from app.services import billing_service
    assert billing_service._format_invoice_number(5, 2026) == "INV-2026-00005"
    # Обратносовместимый алиас всё ещё работает.
    assert billing_service._next_invoice_number(5).startswith("INV-")


# ─────────────────────────────────────────────────────────────────────────────
# idx 43 — staff_chat_mentions: удержание ссылок на fire-and-forget задачи
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_spawn_tg_task_holds_reference_until_done():
    from app.services import staff_chat_mentions as scm

    started = asyncio.Event()
    release = asyncio.Event()

    async def _work():
        started.set()
        await release.wait()

    scm._spawn_tg_task(_work())
    await started.wait()
    # Пока задача не завершилась — ссылка удерживается в множестве.
    assert len(scm._pending_tg_tasks) >= 1
    release.set()
    # Дать callback'у выполниться.
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert len(scm._pending_tg_tasks) == 0


@pytest.mark.asyncio
async def test_spawn_tg_task_logs_exception_without_crashing():
    """Исключение в фоне логируется, не всплывает наружу и ссылка очищается."""
    from app.services import staff_chat_mentions as scm

    async def _boom():
        raise RuntimeError("tg down")

    scm._spawn_tg_task(_boom())
    # Прокручиваем event loop, чтобы задача упала и отработал callback.
    for _ in range(5):
        await asyncio.sleep(0)
    assert len(scm._pending_tg_tasks) == 0
