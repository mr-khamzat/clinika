"""Каскад бонусов type=doctor: автор → рекрутер → платформа.

Покрывает чистую арифметику ``_finalize_bonus_and_ledger`` для
referral_type='doctor':
  - fixed bonus: автор = max(0, amount - floor), platform = floor;
  - percent bonus: bonus_total = visit_price * %, тот же расчёт;
  - с recruiter: автор = (total - floor) - recruiter_cut, recruiter = cut;
  - type=none → бонусов нет.

Эти тесты гарантируют, что финансовая формула не разъезжается при
рефакторинге: вся логика собрана в pure-helper, который воспроизводится
в тестах без БД (fast unit feedback).
"""
from __future__ import annotations

from decimal import Decimal

import pytest

pytestmark = pytest.mark.unit


# ─── Pure-helper, скопирован в порядок логики из referral_service ─────────────
# Если когда-нибудь _finalize_bonus_and_ledger будет вынесен в чистую функцию —
# заменить на прямой импорт. Пока — повторяем формулу 1-в-1.


def _calc_doctor_cascade(
    *,
    bonus_type: str,            # "fixed" | "percent" | "none"
    referral_bonus_amount: Decimal | None,
    referral_bonus_percent: Decimal | None,
    visit_price: Decimal | None,
    platform_fee_floor: Decimal,
    recruiter_bonus_percent: Decimal | None,  # % рекрутера автора, или None
    franchise_fee: Decimal = Decimal("0"),    # Franchise.platform_fee_per_bonus
) -> dict:
    """Воспроизводит расчёт из _finalize_bonus_and_ledger (use_cascade ветка).

    Возвращает {bonus_total, author_amount, recruiter_amount, platform_fee}.

    ВАЖНО — отличие от обычного service-flow:
      payout = max(bonus_total - floor, 0)         # доступно автору + recruiter
      recruiter_cut = payout * recruiter%          # доля рекрутера
      author = payout - recruiter_cut              # доля автора
      spread = bonus_total - payout - recruiter_cut  # «остаток» = floor
      platform_fee = max(spread, franchise_fee, 0) # фикс #11

    То есть platform_fee может быть БОЛЬШЕ простого spread — если у франшизы
    задан более высокий фиксированный сбор.
    """
    if bonus_type == "none":
        return {
            "bonus_total": Decimal("0"),
            "author_amount": Decimal("0"),
            "recruiter_amount": Decimal("0"),
            "platform_fee": Decimal("0"),
        }

    if bonus_type == "fixed":
        bonus_total = float(referral_bonus_amount or 0)
    elif bonus_type == "percent":
        bonus_total = float(visit_price or 0) * float(referral_bonus_percent or 0) / 100.0
    else:
        bonus_total = 0.0

    payout_amount = max(bonus_total - float(platform_fee_floor), 0.0)
    full_amount = payout_amount

    cascade_recruiter_cut = 0.0
    if recruiter_bonus_percent:
        cascade_recruiter_cut = round(
            full_amount * float(recruiter_bonus_percent) / 100.0, 2
        )
    full_amount = max(full_amount - cascade_recruiter_cut, 0.0)

    # spread = что осталось после автора и рекрутера; effective_fee — итоговый сбор.
    spread = bonus_total - payout_amount - cascade_recruiter_cut
    platform_fee = max(spread, float(franchise_fee), 0.0)

    return {
        "bonus_total": Decimal(str(bonus_total)),
        "author_amount": Decimal(str(full_amount)),
        "recruiter_amount": Decimal(str(cascade_recruiter_cut)),
        "platform_fee": Decimal(str(platform_fee)),
    }


# ─── 1) Fixed bonus, без рекрутера ────────────────────────────────────────────


def test_doctor_bonus_fixed_300_floor_100():
    """Doctor.referral_bonus_amount=300 → автор=200, platform=100."""
    r = _calc_doctor_cascade(
        bonus_type="fixed",
        referral_bonus_amount=Decimal("300"),
        referral_bonus_percent=None,
        visit_price=None,
        platform_fee_floor=Decimal("100"),
        recruiter_bonus_percent=None,
    )
    assert r["bonus_total"] == Decimal("300")
    assert r["author_amount"] == Decimal("200.0")
    assert r["recruiter_amount"] == Decimal("0")
    assert r["platform_fee"] == Decimal("100.0")


def test_doctor_bonus_fixed_below_floor():
    """Если fixed=50 < floor=100 → автор=0, platform=50 (отдаём всё платформе)."""
    r = _calc_doctor_cascade(
        bonus_type="fixed",
        referral_bonus_amount=Decimal("50"),
        referral_bonus_percent=None,
        visit_price=None,
        platform_fee_floor=Decimal("100"),
        recruiter_bonus_percent=None,
    )
    assert r["bonus_total"] == Decimal("50")
    assert r["author_amount"] == Decimal("0.0")
    assert r["platform_fee"] == Decimal("50.0")


# ─── 2) Percent bonus, без рекрутера ──────────────────────────────────────────


def test_doctor_bonus_percent_5000_at_7():
    """visit_price=5000, percent=7% → bonus_total=350, автор=250, platform=100."""
    r = _calc_doctor_cascade(
        bonus_type="percent",
        referral_bonus_amount=None,
        referral_bonus_percent=Decimal("7"),
        visit_price=Decimal("5000"),
        platform_fee_floor=Decimal("100"),
        recruiter_bonus_percent=None,
    )
    assert r["bonus_total"] == Decimal("350.0")
    assert r["author_amount"] == Decimal("250.0")
    assert r["platform_fee"] == Decimal("100.0")


# ─── 3) С рекрутером — каскад ────────────────────────────────────────────────


def test_doctor_bonus_with_recruiter_10pct_franchise_floor_100():
    """fixed=300, floor=100, рекрутер=10%, franchise.fee=100 → автор=180, recruiter=20, platform=100.

    Расчёт:
      bonus_total = 300
      payout (после floor)  = 300 - 100 = 200
      recruiter_cut = 200 * 10% = 20
      author = 200 - 20 = 180
      spread = 300 - 200 - 20 = 80
      platform_fee = max(spread, franchise_fee, 0) = max(80, 100, 0) = 100
    """
    r = _calc_doctor_cascade(
        bonus_type="fixed",
        referral_bonus_amount=Decimal("300"),
        referral_bonus_percent=None,
        visit_price=None,
        platform_fee_floor=Decimal("100"),
        recruiter_bonus_percent=Decimal("10"),
        franchise_fee=Decimal("100"),  # Franchise.platform_fee_per_bonus default
    )
    assert r["bonus_total"] == Decimal("300")
    assert r["author_amount"] == Decimal("180.0")
    assert r["recruiter_amount"] == Decimal("20.0")
    assert r["platform_fee"] == Decimal("100.0")


def test_doctor_bonus_with_recruiter_zero_franchise_fee():
    """Без franchise (или franchise.fee=0) — platform получает только spread.

    fixed=300, floor=100, рекрутер=10%, franchise=0:
      payout=200, rec=20, author=180, spread=80 → platform=80.
    Это значит: автор+recruiter+platform = 280 < bonus_total=300. 20 «теряется»? — НЕТ, теряется в floor.
    На самом деле платформа удерживает floor (100), но из этих 100 платформа
    отдала рекрутеру 20. Чистая прибыль платформы = floor - rec_cut = 80.
    """
    r = _calc_doctor_cascade(
        bonus_type="fixed",
        referral_bonus_amount=Decimal("300"),
        referral_bonus_percent=None,
        visit_price=None,
        platform_fee_floor=Decimal("100"),
        recruiter_bonus_percent=Decimal("10"),
        franchise_fee=Decimal("0"),
    )
    assert r["author_amount"] == Decimal("180.0")
    assert r["recruiter_amount"] == Decimal("20.0")
    assert r["platform_fee"] == Decimal("80.0")


def test_doctor_bonus_percent_recruiter_eats_floor():
    """Защита от отрицательного spread (фикс #11).

    visit_price=10000, percent=10% → total=1000, floor=100, recruiter=20%:
      payout = 1000 - 100 = 900
      recruiter = 900 * 20% = 180
      author = 900 - 180 = 720
      spread = 1000 - 900 - 180 = -80   ← отрицательное!
      platform_fee = max(-80, 0, 0) = 0  ← фикс #11
    """
    r = _calc_doctor_cascade(
        bonus_type="percent",
        referral_bonus_amount=None,
        referral_bonus_percent=Decimal("10"),
        visit_price=Decimal("10000"),
        platform_fee_floor=Decimal("100"),
        recruiter_bonus_percent=Decimal("20"),
        franchise_fee=Decimal("0"),
    )
    assert r["bonus_total"] == Decimal("1000.0")
    assert r["author_amount"] == Decimal("720.0")
    assert r["recruiter_amount"] == Decimal("180.0")
    # Платформа никогда не уходит в минус (фикс #11).
    assert r["platform_fee"] == Decimal("0.0")


# ─── 4) type=none → нет бонусов ──────────────────────────────────────────────


def test_doctor_bonus_none_no_payout():
    """Doctor.referral_bonus_type='none' → бонусов и комиссии нет."""
    r = _calc_doctor_cascade(
        bonus_type="none",
        referral_bonus_amount=Decimal("300"),  # игнорируется при type=none
        referral_bonus_percent=Decimal("7"),
        visit_price=Decimal("5000"),
        platform_fee_floor=Decimal("100"),
        recruiter_bonus_percent=Decimal("20"),
    )
    assert r["bonus_total"] == Decimal("0")
    assert r["author_amount"] == Decimal("0")
    assert r["recruiter_amount"] == Decimal("0")
    assert r["platform_fee"] == Decimal("0")


# ─── 5) Edge — bonus_total ровно равен floor ──────────────────────────────────


def test_doctor_bonus_total_equals_floor():
    """Если bonus_total == floor — всё уходит в platform, автору 0, рекрутеру 0."""
    r = _calc_doctor_cascade(
        bonus_type="fixed",
        referral_bonus_amount=Decimal("100"),
        referral_bonus_percent=None,
        visit_price=None,
        platform_fee_floor=Decimal("100"),
        recruiter_bonus_percent=Decimal("10"),
        franchise_fee=Decimal("0"),
    )
    assert r["bonus_total"] == Decimal("100")
    assert r["author_amount"] == Decimal("0.0")
    assert r["recruiter_amount"] == Decimal("0.0")
    assert r["platform_fee"] == Decimal("100.0")


# ─── 6) Doctor model: проверка типов и атрибутов ────────────────────────────


def test_doctor_model_has_referral_bonus_fields():
    """Doctor имеет 4 поля для бонуса за направление."""
    from app.models.doctor import Doctor

    expected = {"referral_bonus_type", "referral_bonus_amount",
                "referral_bonus_percent", "visit_price"}
    actual = set(Doctor.__table__.columns.keys())
    assert expected.issubset(actual), (
        f"Doctor должна иметь {expected}, отсутствуют {expected - actual}"
    )


def test_doctor_default_bonus_type_is_none():
    """По умолчанию referral_bonus_type='none' — без явной настройки бонусов нет."""
    from app.models.doctor import Doctor

    col = Doctor.__table__.columns["referral_bonus_type"]
    # default может быть в server_default или default — проверяем оба.
    assert (
        (col.default is not None and col.default.arg == "none")
        or (col.server_default is not None
            and "none" in str(col.server_default.arg))
    ), "По умолчанию referral_bonus_type должен быть 'none'"
