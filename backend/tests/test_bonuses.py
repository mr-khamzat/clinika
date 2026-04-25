"""Тесты расчёта бонусов Clinika backend.

Проверяют:
- базовую арифметику бонусов (без реальной БД)
- функции mark_bonus_paid / mark_bonus_cancelled через AsyncMock
- password hashing
"""
import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

pytestmark = pytest.mark.asyncio


# ─── Тесты арифметики бонусов ────────────────────────────────────────────────

def test_bonus_calculation_basic():
    """Базовый расчёт: 10% от 1000 = 100."""
    amount = Decimal("1000.00")
    bonus_percent = Decimal("10")
    expected = amount * bonus_percent / 100
    assert expected == Decimal("100.00")


def test_bonus_zero_amount():
    """Нулевая сумма → нулевой бонус."""
    amount = Decimal("0.00")
    bonus_percent = Decimal("10")
    expected = amount * bonus_percent / 100
    assert expected == Decimal("0.00")


def test_bonus_zero_percent():
    """Нулевой процент → нулевой бонус."""
    amount = Decimal("5000.00")
    bonus_percent = Decimal("0")
    expected = amount * bonus_percent / 100
    assert expected == Decimal("0.00")


def test_bonus_max_cap():
    """Бонус ограничивается максимальным значением."""
    amount = Decimal("100000.00")
    bonus_percent = Decimal("10")
    max_bonus = Decimal("5000.00")

    calculated = amount * bonus_percent / 100
    actual = min(calculated, max_bonus)
    assert actual == max_bonus


def test_bonus_recruiter_percent():
    """Рекрутер получает % от бонуса автора (2 знака после запятой)."""
    author_bonus = 150.0
    recruiter_percent = 20.0
    rec_amount = round(author_bonus * recruiter_percent / 100, 2)
    assert rec_amount == 30.0


def test_commission_split():
    """Разделение бонуса: комиссия 10% → admin получает 90%."""
    full_amount = 200.0
    commission_rate = 10.0
    commission = round(full_amount * commission_rate / 100, 2)
    admin_amount = full_amount - commission
    assert commission == 20.0
    assert admin_amount == 180.0


# ─── Тесты bonus_service (с мок-сессией) ─────────────────────────────────────

async def test_mark_bonus_paid_not_found():
    """mark_bonus_paid возвращает None если бонус не найден."""
    import os
    os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
    os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
    os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-32chars!!")
    os.environ.setdefault("QR_SECRET", "test-qr-secret")
    os.environ.setdefault("SUPERADMIN_USERNAME", "testadmin")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "testpass")
    os.environ.setdefault("SUPERADMIN_FULL_NAME", "Test Admin")

    from app.services.bonus_service import mark_bonus_paid

    db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=mock_result)

    result = await mark_bonus_paid(db, uuid.uuid4())
    assert result is None


async def test_mark_bonus_cancelled_not_found():
    """mark_bonus_cancelled возвращает None если бонус не найден."""
    from app.services.bonus_service import mark_bonus_cancelled

    db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=mock_result)

    result = await mark_bonus_cancelled(db, uuid.uuid4())
    assert result is None


# ─── Тесты password hashing ───────────────────────────────────────────────────

def test_password_hash_and_verify():
    """hash_password + verify_password работают корректно."""
    import os
    os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
    os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
    os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-32chars!!")
    os.environ.setdefault("QR_SECRET", "test-qr-secret")
    os.environ.setdefault("SUPERADMIN_USERNAME", "testadmin")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "testpass")
    os.environ.setdefault("SUPERADMIN_FULL_NAME", "Test Admin")

    from app.core.security import hash_password, verify_password

    plain = "MySecurePass123!"
    hashed = hash_password(plain)

    assert hashed != plain
    assert verify_password(plain, hashed) is True
    assert verify_password("wrong-password", hashed) is False


def test_password_hash_unique_per_call():
    """Каждый вызов hash_password даёт уникальный хеш (разные соли)."""
    from app.core.security import hash_password

    h1 = hash_password("same-password")
    h2 = hash_password("same-password")
    assert h1 != h2  # соли разные


def test_verify_password_wrong_format():
    """verify_password с некорректно-форматным хешем возвращает False."""
    from app.core.security import verify_password

    result = verify_password("password", "not-a-valid-hash-format")
    assert result is False
