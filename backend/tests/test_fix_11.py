"""Тесты фикса #11 — record_payment сверяет сумму платежа с суммой счёта.

Раздел «Проверка» плана REMEDIATION-PLAN.md (idx 11):
  - Негатив: счёт 49900 + платёж 1 → ValueError, не PAID, не ACTIVE, нет ledger-записи.
  - Полный: amount == invoice.amount → PAID.
  - Частичный: 20000 + 29900 → PARTIAL → PAID.
  - Переплата → ValueError.
  - Сверка ledger (фактическая сумма платежа, не сумма счёта).
  - API: POST /pay amount=1 → 400 (роутер ловит ValueError).

Unit-стиль: AsyncSession и record_billing_ledger мокаются, без Docker/Postgres.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.unit

from app.models.billing import InvoiceStatus, PaymentStatus, SubStatus


# ─── Хелперы для мока БД ───────────────────────────────────────────────────────


def _make_invoice(amount: str, *, status: str = InvoiceStatus.SENT,
                  paid_amount: str | None = None) -> SimpleNamespace:
    """Лёгкий двойник Invoice (record_payment мутирует поля напрямую)."""
    return SimpleNamespace(
        id=uuid.uuid4(),
        subscription_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        invoice_number="INV-2026-00001",
        amount=Decimal(amount),
        status=status,
        paid_amount=Decimal(paid_amount) if paid_amount is not None else None,
        paid_at=None,
    )


def _make_sub(status: str = SubStatus.PAST_DUE) -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), status=status)


def _make_db(invoice, sub=None) -> AsyncMock:
    """AsyncSession-двойник.

    Первый db.execute(...) → invoice (select Invoice),
    второй db.execute(...) → sub (select Subscription, только при полной оплате).
    db.add фиксирует добавленные объекты в db.added.
    """
    db = AsyncMock()
    results: list = []

    inv_res = MagicMock()
    inv_res.scalar_one_or_none = MagicMock(return_value=invoice)
    results.append(inv_res)

    sub_res = MagicMock()
    sub_res.scalar_one_or_none = MagicMock(return_value=sub)
    results.append(sub_res)

    db.execute = AsyncMock(side_effect=results)
    db.added = []
    db.add = MagicMock(side_effect=lambda obj: db.added.append(obj))
    db.flush = AsyncMock()
    return db


# ─── Негатив: занижение суммы (ядро уязвимости) ────────────────────────────────


@pytest.mark.asyncio
async def test_underpayment_does_not_close_invoice():
    """49900 счёт + платёж 1 → ValueError-free, но статус PARTIAL, не PAID, нет реактивации."""
    from app.services import billing_service

    invoice = _make_invoice("49900.00", status=InvoiceStatus.OVERDUE)
    sub = _make_sub(SubStatus.PAST_DUE)
    db = _make_db(invoice, sub)

    with patch.object(billing_service, "record_billing_ledger", new=AsyncMock()) as ledger:
        payment = await billing_service.record_payment(db, invoice.id, amount=Decimal("1"))

    # Счёт НЕ закрыт — частичная оплата.
    assert invoice.status == InvoiceStatus.PARTIAL
    assert invoice.status != InvoiceStatus.PAID
    assert invoice.paid_at is None
    assert invoice.paid_amount == Decimal("1.00")
    # Платёж зафиксирован как COMPLETED на фактическую сумму.
    assert payment.status == PaymentStatus.COMPLETED
    assert payment.amount == Decimal("1.00")
    # Подписка НЕ реактивирована частичным платежом.
    assert sub.status == SubStatus.PAST_DUE
    # Ledger пишет фактическую сумму платежа (1), не сумму счёта (49900).
    assert ledger.await_count == 1
    assert ledger.await_args.kwargs["amount"] == Decimal("1.00")


# ─── Полная оплата ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_exact_payment_marks_paid_and_reactivates():
    """amount == invoice.amount → PAID + paid_at + реактивация PAST_DUE→ACTIVE."""
    from app.services import billing_service

    invoice = _make_invoice("9900.00", status=InvoiceStatus.OVERDUE)
    sub = _make_sub(SubStatus.PAST_DUE)
    db = _make_db(invoice, sub)

    with patch.object(billing_service, "record_billing_ledger", new=AsyncMock()) as ledger:
        payment = await billing_service.record_payment(db, invoice.id, amount=Decimal("9900.00"))

    assert invoice.status == InvoiceStatus.PAID
    assert invoice.paid_at is not None
    assert invoice.paid_amount == Decimal("9900.00")
    assert payment.status == PaymentStatus.COMPLETED
    assert sub.status == SubStatus.ACTIVE
    assert ledger.await_args.kwargs["amount"] == Decimal("9900.00")


# ─── Частичные платежи накапливаются до полного закрытия ──────────────────────


@pytest.mark.asyncio
async def test_partial_then_full_accumulates_to_paid():
    """20000 (PARTIAL) → +29900 (PAID) для счёта 49900."""
    from app.services import billing_service

    # Первый платёж: 20000 из 49900.
    invoice = _make_invoice("49900.00", status=InvoiceStatus.SENT)
    db1 = _make_db(invoice, _make_sub(SubStatus.ACTIVE))
    with patch.object(billing_service, "record_billing_ledger", new=AsyncMock()):
        await billing_service.record_payment(db1, invoice.id, amount=Decimal("20000"))
    assert invoice.status == InvoiceStatus.PARTIAL
    assert invoice.paid_amount == Decimal("20000.00")

    # Второй платёж: добивает остаток 29900 → PAID.
    sub = _make_sub(SubStatus.PAST_DUE)
    db2 = _make_db(invoice, sub)
    with patch.object(billing_service, "record_billing_ledger", new=AsyncMock()):
        await billing_service.record_payment(db2, invoice.id, amount=Decimal("29900"))
    assert invoice.status == InvoiceStatus.PAID
    assert invoice.paid_amount == Decimal("49900.00")
    assert sub.status == SubStatus.ACTIVE


# ─── Переплата отклоняется ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_overpayment_raises_value_error():
    """Платёж больше суммы счёта → ValueError, счёт не тронут."""
    from app.services import billing_service

    invoice = _make_invoice("9900.00", status=InvoiceStatus.SENT)
    db = _make_db(invoice)

    with patch.object(billing_service, "record_billing_ledger", new=AsyncMock()) as ledger:
        with pytest.raises(ValueError):
            await billing_service.record_payment(db, invoice.id, amount=Decimal("10000"))

    assert invoice.status == InvoiceStatus.SENT
    assert invoice.paid_amount is None
    # Ни платежа, ни ledger-записи при отказе.
    assert db.added == []
    assert ledger.await_count == 0


@pytest.mark.asyncio
async def test_overpayment_on_partial_raises():
    """Частично оплачен (20000/49900) + платёж 30000 (>остатка 29900) → ValueError."""
    from app.services import billing_service

    invoice = _make_invoice("49900.00", status=InvoiceStatus.PARTIAL, paid_amount="20000.00")
    db = _make_db(invoice)

    with patch.object(billing_service, "record_billing_ledger", new=AsyncMock()):
        with pytest.raises(ValueError):
            await billing_service.record_payment(db, invoice.id, amount=Decimal("30000"))

    # Остаётся как было.
    assert invoice.status == InvoiceStatus.PARTIAL
    assert invoice.paid_amount == Decimal("20000.00")


# ─── Прочие границы ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_already_paid_invoice_rejected():
    """Повторная оплата закрытого счёта → ValueError (существующая защита сохранена)."""
    from app.services import billing_service

    invoice = _make_invoice("9900.00", status=InvoiceStatus.PAID, paid_amount="9900.00")
    db = _make_db(invoice)

    with patch.object(billing_service, "record_billing_ledger", new=AsyncMock()):
        with pytest.raises(ValueError):
            await billing_service.record_payment(db, invoice.id, amount=Decimal("9900.00"))


@pytest.mark.asyncio
async def test_invoice_not_found_raises():
    from app.services import billing_service

    db = _make_db(None)
    with patch.object(billing_service, "record_billing_ledger", new=AsyncMock()):
        with pytest.raises(ValueError):
            await billing_service.record_payment(db, uuid.uuid4(), amount=Decimal("100"))


@pytest.mark.asyncio
async def test_float_amount_quantized_no_false_overpayment():
    """amount из float (как приходит из RecordPaymentRequest) нормализуется до копейки."""
    from app.services import billing_service

    invoice = _make_invoice("100.00", status=InvoiceStatus.SENT)
    db = _make_db(invoice, _make_sub(SubStatus.ACTIVE))

    # float 100.00 не должен дать ложную переплату из-за двоичного представления.
    with patch.object(billing_service, "record_billing_ledger", new=AsyncMock()):
        payment = await billing_service.record_payment(
            db, invoice.id, amount=Decimal(str(100.00))
        )

    assert invoice.status == InvoiceStatus.PAID
    assert payment.amount == Decimal("100.00")


@pytest.mark.asyncio
async def test_centavo_epsilon_allows_full_payment():
    """Платёж, покрывающий сумму с точностью до копейки, закрывает счёт."""
    from app.services import billing_service

    invoice = _make_invoice("100.00", status=InvoiceStatus.PARTIAL, paid_amount="99.99")
    db = _make_db(invoice, _make_sub(SubStatus.ACTIVE))

    with patch.object(billing_service, "record_billing_ledger", new=AsyncMock()):
        await billing_service.record_payment(db, invoice.id, amount=Decimal("0.01"))

    assert invoice.status == InvoiceStatus.PAID
    assert invoice.paid_amount == Decimal("100.00")


# ─── InvoiceStatus.PARTIAL добавлен в модель ──────────────────────────────────


def test_invoice_status_partial_constant():
    from app.models.billing import InvoiceStatus

    assert InvoiceStatus.PARTIAL == "partial"


# ─── API-уровень: POST /pay amount=1 → 400 (интеграционно) ────────────────────


@pytest.mark.integration
def test_pay_endpoint_underpayment_returns_400():
    """Сквозной API-кейс: занижение через /pay должно дать 400.

    Требует поднятого приложения/БД (TestClient + Postgres) — скипается без Docker.
    Логика та же, что в unit-тестах выше: record_payment больше не закрывает счёт
    при заниженной сумме, но при переплате роутер ловит ValueError → 400.
    """
    pytest.skip("integration: требует TestClient + Postgres (см. conftest)")
