"""Точечный тест для находки #13.

_add_months падал ValueError для подписок, начатых 29-31 числа,
потому что date(year, month, start.day) не учитывал длину целевого месяца.
Фикс — кламп дня на последний день месяца через calendar.monthrange.

Проверяем кейсы из раздела «Проверка» плана:
  (2026, 1, 31) + 1 мес  -> 2026-02-28
  (2024, 1, 31) + 1 мес  -> 2024-02-29 (високосный)
  (2026, 1, 31) + 3 мес  -> 2026-04-30
  (2026, 8, 31) + 6 мес  -> 2027-02-28
А также что _period_end больше не падает для всех циклов подписки.
"""
from __future__ import annotations

from datetime import date

import pytest

from app.services.billing_service import _add_months, _period_end

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "start, n, expected",
    [
        (date(2026, 1, 31), 1, date(2026, 2, 28)),   # короткий февраль (невисокосный)
        (date(2024, 1, 31), 1, date(2024, 2, 29)),   # короткий февраль (високосный)
        (date(2026, 1, 31), 3, date(2026, 4, 30)),   # апрель 30 дней
        (date(2026, 8, 31), 6, date(2027, 2, 28)),   # переход через год в февраль
        (date(2026, 1, 15), 1, date(2026, 2, 15)),   # обычный день не дрейфует
    ],
)
def test_add_months_clamps_to_month_end(start, n, expected):
    assert _add_months(start, n) == expected


def test_period_end_no_value_error_for_31st_all_cycles():
    """До фикса любой цикл с подпиской от 31-го числа кидал ValueError."""
    start = date(2026, 1, 31)
    for cycle in ("monthly", "quarterly", "semi_annual", "nine_months", "annual"):
        # не должно бросать ValueError: day is out of range
        end = _period_end(start, cycle)
        assert isinstance(end, date)
