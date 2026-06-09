"""Тесты на находку #16 — `update_clinic_payment_status` доверял webhook без
сверки суммы и без защиты от понижения статуса.

Стиль — unit, без Docker/Postgres: используем лёгкий фейк AsyncSession
(`db.get`/`db.commit`/`db.refresh`) и фейковый `ClinicPayment`. Авторитетную
сверку через `adapter.get_status` подменяем monkeypatch'ем на `get_gateway`,
а резолв конфига — на `_get_active_config`.

Проверяем (по разделу «Проверка» плана):
  - regress-protection: succeeded + поздний pending → остаётся succeeded;
  - amount-mismatch: 1500 vs 1 → НЕ succeeded, отметка amount_mismatch;
  - happy-path ЮKassa: get_status подтвердил + сумма совпала → succeeded;
  - адаптер-заглушка без get_status (NotImplementedError):
      * сумма совпала → succeeded, но помечен unverified;
      * сумма НЕ совпала → НЕ succeeded;
  - refunded только из succeeded (из pending — заблокирован).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.models.payments_clinic import ClinicPaymentStatus
from app.services import acquiring_service


# ── Фейки ────────────────────────────────────────────────────────────────────


@dataclass
class FakePayment:
    """Мини-двойник ClinicPayment — только используемые в функции поля."""
    id: Any = "11111111-1111-1111-1111-111111111111"
    clinic_id: Any = "22222222-2222-2222-2222-222222222222"
    gateway: str = "yookassa"
    gateway_payment_id: str | None = "yk_pid_1"
    amount: Decimal = Decimal("1500.00")
    status: str = ClinicPaymentStatus.PENDING
    paid_at: datetime | None = None
    refunded_at: datetime | None = None
    payment_metadata: dict = field(default_factory=dict)
    updated_at: datetime | None = None


class FakeDB:
    """AsyncSession-двойник: get возвращает заранее положенный payment."""

    def __init__(self, payment: FakePayment):
        self._payment = payment
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    async def get(self, _model, _pk):
        return self._payment


@dataclass
class FakeStatusResult:
    status: str
    amount: Decimal | None = None
    paid_at: datetime | None = None
    raw: dict = field(default_factory=dict)


class FakeGateway:
    """Адаптер с настраиваемым get_status (или бросающий заданное исключение)."""

    def __init__(self, *, result: FakeStatusResult | None = None, exc: BaseException | None = None):
        self._result = result
        self._exc = exc

    async def get_status(self, _payment_id):
        if self._exc is not None:
            raise self._exc
        return self._result


def _patch_adapter(monkeypatch, gateway):
    """Подменяет get_gateway и _get_active_config в сервисном модуле."""
    monkeypatch.setattr(acquiring_service, "get_gateway", lambda name, cfg: gateway)
    monkeypatch.setattr(
        acquiring_service, "_get_active_config", AsyncMock(return_value=object())
    )


def _yk_success_result(amount: Decimal) -> FakeStatusResult:
    return FakeStatusResult(
        status=ClinicPaymentStatus.SUCCEEDED,
        amount=None,  # эмулируем «amount не заполнен адаптером» → читается из raw
        raw={"amount": {"value": str(amount), "currency": "RUB"}},
    )


# ── 1) Защита от понижения статуса (regress-protection) ──────────────────────


async def test_terminal_succeeded_not_downgraded_to_pending(monkeypatch):
    p = FakePayment(status=ClinicPaymentStatus.SUCCEEDED)
    db = FakeDB(p)
    # get_gateway не должен дёргаться вовсе на нетерминальном переходе —
    # подстрахуемся, чтобы любой вызов упал.
    monkeypatch.setattr(
        acquiring_service, "get_gateway",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("не должно вызываться")),
    )

    out = await acquiring_service.update_clinic_payment_status(
        db, payment_id=p.id, status=ClinicPaymentStatus.PENDING,
        raw={"event": "late.pending"},
    )

    assert out.status == ClinicPaymentStatus.SUCCEEDED  # откат запрещён
    # событие всё равно занесено в аудит с пометкой
    events = out.payment_metadata["webhook_events"]
    assert events[-1]["note"] == "downgrade_blocked"
    assert events[-1]["applied_status"] == ClinicPaymentStatus.SUCCEEDED


async def test_terminal_refunded_not_downgraded(monkeypatch):
    p = FakePayment(status=ClinicPaymentStatus.REFUNDED)
    db = FakeDB(p)
    out = await acquiring_service.update_clinic_payment_status(
        db, payment_id=p.id, status=ClinicPaymentStatus.PENDING,
    )
    assert out.status == ClinicPaymentStatus.REFUNDED


# ── 2) Сверка суммы перед succeeded ──────────────────────────────────────────


async def test_amount_mismatch_blocks_succeeded(monkeypatch):
    p = FakePayment(amount=Decimal("1500.00"), status=ClinicPaymentStatus.PENDING)
    db = FakeDB(p)
    # Шлюз подтверждает succeeded, но на ЗАНИЖЕННУЮ сумму (1 vs 1500).
    gw = FakeGateway(result=_yk_success_result(Decimal("1.00")))
    _patch_adapter(monkeypatch, gw)

    out = await acquiring_service.update_clinic_payment_status(
        db, payment_id=p.id, status=ClinicPaymentStatus.SUCCEEDED,
        webhook_amount=Decimal("1.00"),
        gateway_payment_id="yk_pid_1",
        paid_at=datetime.utcnow(),
    )

    assert out.status != ClinicPaymentStatus.SUCCEEDED
    assert out.status == ClinicPaymentStatus.PENDING
    assert out.paid_at is None
    assert out.payment_metadata["webhook_events"][-1]["note"] == "amount_mismatch"


async def test_webhook_amount_matches_authoritative_mismatch_blocks(monkeypatch):
    """webhook сумма верна, но get_status шлюза вернул другую — тоже блок."""
    p = FakePayment(amount=Decimal("1500.00"))
    db = FakeDB(p)
    gw = FakeGateway(result=_yk_success_result(Decimal("1.00")))  # шлюз: 1 руб
    _patch_adapter(monkeypatch, gw)

    out = await acquiring_service.update_clinic_payment_status(
        db, payment_id=p.id, status=ClinicPaymentStatus.SUCCEEDED,
        webhook_amount=Decimal("1500.00"),  # webhook честен, но шлюз — нет
        gateway_payment_id="yk_pid_1",
    )

    assert out.status != ClinicPaymentStatus.SUCCEEDED
    assert out.payment_metadata["webhook_events"][-1]["note"] == "amount_mismatch"


# ── 3) Happy-path ЮKassa (get_status подтвердил + сумма совпала) ─────────────


async def test_happy_path_yookassa_succeeded(monkeypatch):
    p = FakePayment(amount=Decimal("1500.00"), status=ClinicPaymentStatus.PENDING)
    db = FakeDB(p)
    gw = FakeGateway(result=_yk_success_result(Decimal("1500.00")))
    _patch_adapter(monkeypatch, gw)

    paid = datetime(2026, 6, 8, 12, 0, 0)
    out = await acquiring_service.update_clinic_payment_status(
        db, payment_id=p.id, status=ClinicPaymentStatus.SUCCEEDED,
        webhook_amount=Decimal("1500.00"),
        gateway_payment_id="yk_pid_1",
        paid_at=paid,
    )

    assert out.status == ClinicPaymentStatus.SUCCEEDED
    assert out.paid_at == paid
    # verified=True → без пометки unverified/mismatch
    ev = out.payment_metadata["webhook_events"][-1]
    assert ev["applied_status"] == ClinicPaymentStatus.SUCCEEDED
    assert ev.get("note") != "amount_mismatch"


async def test_quantize_tolerates_cent_formatting(monkeypatch):
    """1500 vs 1500.00 не должно ложно срабатывать как mismatch."""
    p = FakePayment(amount=Decimal("1500"))
    db = FakeDB(p)
    gw = FakeGateway(result=_yk_success_result(Decimal("1500.00")))
    _patch_adapter(monkeypatch, gw)

    out = await acquiring_service.update_clinic_payment_status(
        db, payment_id=p.id, status=ClinicPaymentStatus.SUCCEEDED,
        webhook_amount=Decimal("1500.000"),
        gateway_payment_id="yk_pid_1",
    )
    assert out.status == ClinicPaymentStatus.SUCCEEDED


# ── 4) Адаптер-заглушка без get_status ───────────────────────────────────────


async def test_stub_gateway_amount_ok_marked_unverified(monkeypatch):
    """tinkoff/sber: get_status кидает NotImplementedError. Сумма совпала →
    succeeded ставится, но помечается unverified (осознанный компромисс)."""
    p = FakePayment(gateway="tinkoff", amount=Decimal("1500.00"))
    db = FakeDB(p)
    gw = FakeGateway(exc=NotImplementedError("Tinkoff: реализуйте /v2/GetState"))
    _patch_adapter(monkeypatch, gw)

    out = await acquiring_service.update_clinic_payment_status(
        db, payment_id=p.id, status=ClinicPaymentStatus.SUCCEEDED,
        webhook_amount=Decimal("1500.00"),
        gateway_payment_id="yk_pid_1",
    )

    assert out.status == ClinicPaymentStatus.SUCCEEDED
    assert out.payment_metadata["webhook_events"][-1]["note"] == "unverified_amount_ok"


async def test_stub_gateway_amount_mismatch_blocks(monkeypatch):
    """Заглушка + заниженная сумма → НЕ succeeded."""
    p = FakePayment(gateway="tinkoff", amount=Decimal("1500.00"))
    db = FakeDB(p)
    gw = FakeGateway(exc=NotImplementedError())
    _patch_adapter(monkeypatch, gw)

    out = await acquiring_service.update_clinic_payment_status(
        db, payment_id=p.id, status=ClinicPaymentStatus.SUCCEEDED,
        webhook_amount=Decimal("1.00"),
        gateway_payment_id="yk_pid_1",
    )

    assert out.status != ClinicPaymentStatus.SUCCEEDED
    assert out.payment_metadata["webhook_events"][-1]["note"] == "amount_mismatch"


async def test_adapter_network_error_degrades_to_amount_check(monkeypatch):
    """get_status упал по сети (RuntimeError) → verified=False; при совпавшей
    сумме succeeded ставится (unverified), сервис НЕ падает."""
    p = FakePayment(amount=Decimal("1500.00"))
    db = FakeDB(p)
    gw = FakeGateway(exc=RuntimeError("YOOKASSA get_status: timeout"))
    _patch_adapter(monkeypatch, gw)

    out = await acquiring_service.update_clinic_payment_status(
        db, payment_id=p.id, status=ClinicPaymentStatus.SUCCEEDED,
        webhook_amount=Decimal("1500.00"),
        gateway_payment_id="yk_pid_1",
    )
    assert out.status == ClinicPaymentStatus.SUCCEEDED
    assert out.payment_metadata["webhook_events"][-1]["note"] == "unverified_amount_ok"


# ── 5) REFUNDED только из SUCCEEDED ──────────────────────────────────────────


async def test_refund_from_succeeded_ok(monkeypatch):
    p = FakePayment(status=ClinicPaymentStatus.SUCCEEDED)
    db = FakeDB(p)
    out = await acquiring_service.update_clinic_payment_status(
        db, payment_id=p.id, status=ClinicPaymentStatus.REFUNDED,
    )
    assert out.status == ClinicPaymentStatus.REFUNDED
    assert out.refunded_at is not None


async def test_refund_from_pending_blocked(monkeypatch):
    p = FakePayment(status=ClinicPaymentStatus.PENDING)
    db = FakeDB(p)
    out = await acquiring_service.update_clinic_payment_status(
        db, payment_id=p.id, status=ClinicPaymentStatus.REFUNDED,
    )
    assert out.status == ClinicPaymentStatus.PENDING  # refund без оплаты не проходит
    assert out.refunded_at is None
    assert out.payment_metadata["webhook_events"][-1]["note"] == "refund_without_success_blocked"


# ── 6) Прочее: payment не найден; webhook без суммы (нет регресса легит. оплаты)


async def test_missing_payment_returns_none(monkeypatch):
    class _EmptyDB:
        async def get(self, *a, **k):
            return None
    out = await acquiring_service.update_clinic_payment_status(
        _EmptyDB(), payment_id="nope", status=ClinicPaymentStatus.SUCCEEDED,
    )
    assert out is None


async def test_no_webhook_amount_relies_on_authoritative(monkeypatch):
    """Шлюз без суммы в webhook, но get_status подтвердил верную сумму →
    легитимная оплата НЕ ломается."""
    p = FakePayment(amount=Decimal("1500.00"))
    db = FakeDB(p)
    gw = FakeGateway(result=_yk_success_result(Decimal("1500.00")))
    _patch_adapter(monkeypatch, gw)

    out = await acquiring_service.update_clinic_payment_status(
        db, payment_id=p.id, status=ClinicPaymentStatus.SUCCEEDED,
        webhook_amount=None,
        gateway_payment_id="yk_pid_1",
    )
    assert out.status == ClinicPaymentStatus.SUCCEEDED


@pytest.mark.integration
async def test_concurrent_webhooks_keep_terminal_state():
    """Кросс-проверка на реальном PostgreSQL (with_for_update/гонки) — скип без
    Docker. Здесь — заглушка-маркер: два параллельных webhook'а не должны
    откатить succeeded в pending. Реализуется в integration-наборе."""
    pytest.skip("требует PostgreSQL/Docker — integration-набор")
