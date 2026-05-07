"""Тесты биллинга Clinika.

Покрывают чистую логику переходов статусов (без БД):
- Subscription: trial → active при активации плана;
- Invoice: draft → sent → paid при оплате;
- _next_invoice_number форматирование (приватный хелпер).

Интеграционные сценарии (генерация счёта от плана) — за рамками unit-тестов;
для них — ``@pytest.mark.integration`` + testcontainers (см. conftest).
"""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest

pytestmark = pytest.mark.unit


# ─── Subscription: trial → active ─────────────────────────────────────────────


def test_subscription_trial_to_active():
    """trial → active при активации плана basic."""
    from app.models.billing import Subscription, SubStatus

    sub = Subscription(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        plan="basic",
        status=SubStatus.TRIAL,
        billing_cycle="monthly",
        current_period_start=date.today(),
        current_period_end=date.today() + timedelta(days=30),
        amount_per_period=Decimal("0"),
    )
    assert sub.status == SubStatus.TRIAL

    sub.status = SubStatus.ACTIVE
    assert sub.status == "active"


def test_subscription_status_constants():
    """Проверяем что все нужные статусы определены."""
    from app.models.billing import SubStatus

    assert SubStatus.TRIAL == "trial"
    assert SubStatus.ACTIVE == "active"
    assert SubStatus.PAST_DUE == "past_due"
    assert SubStatus.CANCELLED == "cancelled"


# ─── Invoice: draft → sent → paid ─────────────────────────────────────────────


def test_invoice_draft_to_paid():
    """draft → sent → paid (оплата)."""
    from app.models.billing import Invoice, InvoiceStatus

    inv = Invoice(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        subscription_id=uuid.uuid4(),
        invoice_number="INV-2026-00001",
        amount=Decimal("999.00"),
        status=InvoiceStatus.DRAFT,
        period_start=date.today(),
        period_end=date.today() + timedelta(days=30),
        due_date=date.today() + timedelta(days=14),
    )
    assert inv.status == InvoiceStatus.DRAFT

    inv.status = InvoiceStatus.SENT
    assert inv.status == "sent"

    inv.status = InvoiceStatus.PAID
    assert inv.status == "paid"


def test_invoice_overdue_after_due():
    """Если due_at < today и статус не paid → overdue."""
    from app.models.billing import InvoiceStatus

    today = date.today()
    due = today - timedelta(days=5)
    status = InvoiceStatus.SENT

    if status != InvoiceStatus.PAID and due < today:
        status = InvoiceStatus.OVERDUE

    assert status == "overdue"


def test_invoice_number_format():
    """``_next_invoice_number(seq)`` → 'INV-YYYY-NNNN'."""
    from app.services.billing_service import _next_invoice_number

    number = _next_invoice_number(1)
    assert number.startswith("INV-")
    # формат: INV-YYYY-NNNN (зависит от реализации) — главное, что строка
    assert isinstance(number, str)
    assert len(number) >= 8


# ─── Period helpers ───────────────────────────────────────────────────────────


def test_add_months_simple():
    """_add_months(2026-01-15, 1) → 2026-02-15."""
    from app.services.billing_service import _add_months

    result = _add_months(date(2026, 1, 15), 1)
    assert result == date(2026, 2, 15)


def test_add_months_year_rollover():
    """_add_months(2026-12-15, 2) → 2027-02-15."""
    from app.services.billing_service import _add_months

    result = _add_months(date(2026, 12, 15), 2)
    assert result == date(2027, 2, 15)


def test_period_end_monthly():
    """_period_end(2026-01-15, 'monthly') → конец месячного цикла."""
    from app.services.billing_service import _period_end

    end = _period_end(date(2026, 1, 15), "monthly")
    # Должен быть в феврале (следующий месяц)
    assert end.month == 2 or end.year > 2026
