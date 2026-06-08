"""Тесты идемпотентности reverse_writeoff (находка [12]).

Корень бага: reverse_writeoff выбирал ВСЕ движения с quantity < 0 и создавал
обратные +qty, но исходные WRITE_OFF не помечались — повторный вызов (цикл
complete↔uncomplete) каждый раз снова восстанавливал остаток и раздувал склад.

Фикс: колонка InventoryMovement.reversed (Boolean, default False); reverse_writeoff
фильтрует reversed.is_(False) и помечает исходные движения reversed=True;
on_appointment_completed считает «уже списано» только по НЕ-реверснутым WRITE_OFF.

Тест не требует Postgres/Docker: используется лёгкий in-memory fake-session,
повторяющий ровно те операции AsyncSession, которые трогает reverse_writeoff
(execute(select) → movements / stock, get(InventoryBatch), add). Фильтр
quantity<0 + reversed=False fake применяет в Python — это и проверяет, что
повторный реверс ничего не подхватывает.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.models.inventory import (
    InventoryBatch,
    InventoryMovement,
    InventoryMovementType,
    InventoryStock,
)
from app.services.inventory_fifo import reverse_writeoff


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _FakeSession:
    """Минимальный async-fake под reverse_writeoff.

    Хранит movements и stock в Python-списках. execute() различает запрос по
    модели в первом column-описании и применяет фильтрацию по фактическим
    атрибутам объектов (в т.ч. reversed) — так тест честно проверяет, что
    помеченные reversed=True движения второй вызов не видит.
    """

    def __init__(self, movements, stock_rows, batches):
        self.movements = movements
        self.stock_rows = stock_rows
        self.batches = {b.id: b for b in batches}
        self.added: list = []

    async def execute(self, stmt):
        target = stmt.column_descriptions[0]["entity"]
        if target is InventoryMovement:
            rows = [
                m
                for m in self.movements
                if (m.quantity is not None and m.quantity < 0)
                and m.reversed is False
            ]
            return _Result(rows)
        if target is InventoryStock:
            return _Result(self.stock_rows)
        return _Result([])

    async def get(self, model, pk):
        if model is InventoryBatch:
            return self.batches.get(pk)
        return None

    def add(self, obj):
        self.added.append(obj)
        if isinstance(obj, InventoryMovement):
            self.movements.append(obj)


def _make_writeoff(*, tenant_id, item_id, clinic_id, batch_id, qty):
    return InventoryMovement(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        item_id=item_id,
        clinic_id=clinic_id,
        type=InventoryMovementType.WRITE_OFF,
        quantity=Decimal(qty),  # отрицательное
        balance_after=Decimal("0"),
        batch_number="",
        batch_id=batch_id,
        reversed=False,
    )


def _setup(appointment_id, tenant_id):
    item_id = uuid.uuid4()
    clinic_id = uuid.uuid4()
    batch = InventoryBatch(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        item_id=item_id,
        clinic_id=clinic_id,
        qty_remaining=Decimal("0"),
    )
    wo = _make_writeoff(
        tenant_id=tenant_id,
        item_id=item_id,
        clinic_id=clinic_id,
        batch_id=batch.id,
        qty="-2",
    )
    wo.appointment_id = appointment_id
    stock = InventoryStock(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        item_id=item_id,
        clinic_id=clinic_id,
        quantity=Decimal("8"),
    )
    db = _FakeSession([wo], [stock], [batch])
    return db, batch, stock


@pytest.mark.asyncio
async def test_movement_has_reversed_attribute():
    """У InventoryMovement есть атрибут reversed и он принимает False."""
    m = _make_writeoff(
        tenant_id=uuid.uuid4(),
        item_id=uuid.uuid4(),
        clinic_id=uuid.uuid4(),
        batch_id=uuid.uuid4(),
        qty="-1",
    )
    assert m.reversed is False


@pytest.mark.asyncio
async def test_reverse_writeoff_is_idempotent():
    """Второй reverse_writeoff подряд возвращает 0 и не меняет склад."""
    appt = uuid.uuid4()
    tid = uuid.uuid4()
    db, batch, stock = _setup(appt, tid)

    # Первый реверс: восстанавливает 2 ед. (batch и stock), помечает исходник.
    n1 = await reverse_writeoff(db, appointment_id=appt, tenant_id=tid)
    assert n1 == 1
    assert batch.qty_remaining == Decimal("2")
    assert stock.quantity == Decimal("10")  # было 8 + 2

    batch_after = batch.qty_remaining
    stock_after = stock.quantity

    # Второй реверс: исходное движение уже reversed=True → ничего не подхватит.
    n2 = await reverse_writeoff(db, appointment_id=appt, tenant_id=tid)
    assert n2 == 0
    assert batch.qty_remaining == batch_after
    assert stock.quantity == stock_after


@pytest.mark.asyncio
async def test_reverse_writeoff_marks_source_reversed():
    """Исходное WRITE_OFF помечается reversed=True (а реверс-INCOME — нет)."""
    appt = uuid.uuid4()
    tid = uuid.uuid4()
    db, _batch, _stock = _setup(appt, tid)

    await reverse_writeoff(db, appointment_id=appt, tenant_id=tid)

    write_offs = [
        m for m in db.movements if m.type == InventoryMovementType.WRITE_OFF
    ]
    incomes = [
        m for m in db.movements if m.type == InventoryMovementType.INCOME
    ]
    assert len(write_offs) == 1
    assert write_offs[0].reversed is True
    # Созданное обратное движение — обычный INCOME, его reversed НЕ выставлен в
    # True (на transient-объекте Python-side default ещё не применён, поэтому
    # сверяем именно «не True», а не «is False»).
    assert len(incomes) == 1
    assert incomes[0].reversed is not True
