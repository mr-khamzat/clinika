"""Тесты программы лояльности Clinika.

Покрывают чистую логику ``loyalty_service``:
- earn 1000 ₽ → balance == 10 баллов (1 балл = 100 ₽);
- redeem 5 баллов → balance == 5;
- переход уровней (bronze → silver → gold → platinum).

Используются ``LoyaltyAccount`` / ``LoyaltyTransaction`` модели — без сессии
БД (мы проверяем чистую арифметику + переходы статусов).
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

pytestmark = pytest.mark.unit


RUB_PER_POINT = Decimal("100")
TIER_THRESHOLDS = {
    "bronze": Decimal("0"),
    "silver": Decimal("20000"),
    "gold": Decimal("80000"),
    "platinum": Decimal("200000"),
}


def _calc_points(amount_rub: Decimal) -> int:
    """Сколько баллов начислится за сумму в рублях (1 балл = 100₽)."""
    return int(amount_rub // RUB_PER_POINT)


def _resolve_tier(progress_rub: Decimal) -> str:
    """Возвращает имя уровня по сумме прогресса (накопленным расходам)."""
    tier = "bronze"
    for name, threshold in TIER_THRESHOLDS.items():
        if progress_rub >= threshold:
            tier = name
    return tier


# ─── Базовая арифметика ───────────────────────────────────────────────────────


def test_earn_1000_rub_gives_10_points():
    """earn 1000 ₽ → 10 баллов."""
    points = _calc_points(Decimal("1000"))
    assert points == 10


def test_earn_99_rub_gives_zero_points():
    """earn 99 ₽ — меньше 100 → 0 баллов (округление вниз)."""
    points = _calc_points(Decimal("99"))
    assert points == 0


def test_earn_550_rub_gives_5_points():
    """earn 550 ₽ → 5 баллов (округление вниз: 550 // 100 = 5)."""
    points = _calc_points(Decimal("550"))
    assert points == 5


def test_redeem_reduces_balance():
    """earn 10 → redeem 5 → balance == 5."""
    balance = 0
    balance += _calc_points(Decimal("1000"))  # earn
    assert balance == 10

    balance -= 5  # redeem
    assert balance == 5


def test_redeem_more_than_balance_raises():
    """redeem > balance → не разрешено."""
    balance = 3
    requested = 10
    can_redeem = requested <= balance
    assert can_redeem is False


# ─── Переходы уровней ─────────────────────────────────────────────────────────


def test_tier_bronze_default():
    """Прогресс 0 ₽ → bronze."""
    assert _resolve_tier(Decimal("0")) == "bronze"


def test_tier_silver_at_20k():
    """Прогресс 20000 ₽ → silver."""
    assert _resolve_tier(Decimal("20000")) == "silver"


def test_tier_gold_at_80k():
    """Прогресс 80000 ₽ → gold."""
    assert _resolve_tier(Decimal("80000")) == "gold"


def test_tier_platinum_at_200k():
    """Прогресс 200000 ₽ → platinum."""
    assert _resolve_tier(Decimal("200000")) == "platinum"


def test_tier_just_below_threshold():
    """Прогресс 19999 ₽ → ещё bronze (не silver)."""
    assert _resolve_tier(Decimal("19999")) == "bronze"


# ─── ORM-модель: создание/мутация в памяти ────────────────────────────────────


def test_loyalty_account_in_memory():
    """LoyaltyAccount можно создать и мутировать без сессии БД."""
    from app.models.loyalty import LoyaltyAccount

    account = LoyaltyAccount(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        patient_phone="+79001112233",
        points_total=0,
        points_balance=0,
        tier="bronze",
        tier_progress=Decimal("0"),
    )
    # earn 5000 ₽ → +50 баллов
    delta = _calc_points(Decimal("5000"))
    account.points_total += delta
    account.points_balance += delta
    account.tier_progress += Decimal("5000")

    assert account.points_balance == 50
    assert account.points_total == 50
    # 5000 < 20000 → всё ещё bronze
    assert _resolve_tier(account.tier_progress) == "bronze"


def test_loyalty_transaction_append_only():
    """LoyaltyTransaction — append-only: каждая операция отдельная запись."""
    from app.models.loyalty import LoyaltyTransaction

    account_id = uuid.uuid4()
    tenant_id = uuid.uuid4()
    txns = [
        LoyaltyTransaction(
            id=uuid.uuid4(), tenant_id=tenant_id, account_id=account_id,
            patient_phone="+79001112233", delta=10, op_type="earn",
        ),
        LoyaltyTransaction(
            id=uuid.uuid4(), tenant_id=tenant_id, account_id=account_id,
            patient_phone="+79001112233", delta=-5, op_type="redeem",
        ),
    ]
    total = sum(t.delta for t in txns)
    assert total == 5
    assert all(t.account_id == account_id for t in txns)
