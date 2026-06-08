"""Точечный тест для находки #14: напоминания о приёме сравнивали
МСК-слот (appointment_date + start_time — настенное московское время,
которое видит пациент) с UTC-окном, считанным от datetime.utcnow().

Результат — сдвиг на 3 часа: напоминание уходило не в то время, а на
краях окна (+/-15 мин) могло вообще не попасть в окно и пропуститься.

Фикс: «сейчас» в джобе берётся в МСК (timezone(timedelta(hours=3)) →
naive), то есть в одной TZ со слотом приёма. Тесты проверяют, что слот,
заданный по МСК-стенным часам, корректно попадает в 24h / 2h окно, и что
старый UTC-сдвиг исчез.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.jobs.appointment_reminders as job

MSK = timezone(timedelta(hours=3))


def _make_apt(apt_dt_msk: datetime):
    """Фейковый приём: слот хранится как настенное МСК-время (date + time)."""
    return SimpleNamespace(
        id="11111111-1111-1111-1111-111111111111",
        appointment_date=apt_dt_msk.date(),
        start_time=apt_dt_msk.time(),
        patient_phone="+79990000000",
        reminders_sent={},
    )


class _FakeSession:
    def __init__(self, rows):
        self._rows = rows
        self.commit = AsyncMock()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def execute(self, *a, **k):
        result = MagicMock()
        result.scalars.return_value.all.return_value = self._rows
        return result


async def _run_with(rows):
    """Запускает джоб с подменёнными сессией и push-сервисом.

    Возвращает (sent_total, captured_apts) — какие приёмы получили пуш.
    """
    captured = []

    async def _fake_push(phone, title, body, data, db):
        captured.append(data.get("hours"))
        return 1

    # run_appointment_reminders делает локальный `from app.database import
    # AsyncSessionLocal`, поэтому патчим источник в app.database.
    # flag_modified — реальный SQLAlchemy-вызов, требующий ORM-инстанс с
    # _sa_instance_state; фейковый SimpleNamespace его не имеет. Логику окон/TZ
    # это не затрагивает, поэтому в тесте патчим no-op'ом.
    with patch("app.database.AsyncSessionLocal", lambda: _FakeSession(rows)), \
         patch("app.jobs.appointment_reminders.flag_modified", MagicMock()), \
         patch(
             "app.services.push_service.send_push_to_phone",
             new=AsyncMock(side_effect=_fake_push),
         ):
        total = await job.run_appointment_reminders()
    return total, captured


@pytest.mark.asyncio
async def test_msk_slot_24h_window_matches():
    """Слот ровно через 24ч по МСК-стенным часам попадает в 24h-окно."""
    now_msk = datetime.now(MSK).replace(tzinfo=None)
    apt = _make_apt(now_msk + timedelta(hours=24))
    total, hours = await _run_with([apt])
    assert total == 1
    assert hours == [24]


@pytest.mark.asyncio
async def test_msk_slot_2h_window_matches():
    """Слот ровно через 2ч по МСК-стенным часам попадает в 2h-окно."""
    now_msk = datetime.now(MSK).replace(tzinfo=None)
    apt = _make_apt(now_msk + timedelta(hours=2))
    total, hours = await _run_with([apt])
    assert total == 1
    assert hours == [2]


@pytest.mark.asyncio
async def test_no_three_hour_offset_false_positive():
    """Старый баг: слот, сдвинутый на +3ч от истинного 24h-момента,
    раньше ложно попадал в окно из-за UTC-vs-МСК рассинхрона.
    После фикса (обе стороны в МСК) такой слот в окно НЕ попадает.

    24h-окно — это [+23:45, +24:15]. Слот на +27ч заведомо вне его, и
    при корректной (одинаковой) TZ не должен слать напоминание.
    """
    now_msk = datetime.now(MSK).replace(tzinfo=None)
    apt = _make_apt(now_msk + timedelta(hours=27))
    total, hours = await _run_with([apt])
    assert total == 0
    assert hours == []
