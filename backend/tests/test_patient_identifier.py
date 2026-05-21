"""
chatslot01: тесты автоматической идентификации пациента в МИС.

Мокаем модуль app.services.mis_client целиком. Сервис patient_identifier
импортирует его как `from app.services import mis_client as mis`, поэтому
патчим `app.services.patient_identifier.mis.find_patient_by_phone`/`add_patient`.

mis_client.find_patient_by_phone возвращает dict | None (см. реальную сигнатуру).
mis_client.add_patient возвращает dict | None.

PatientAccountFactory не существует — строим PatientAccount напрямую через
session.add().
"""
import uuid
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from sqlalchemy import select

from app.models.mis_outbox import MisOutbox
from app.models.patient_account import PatientAccount
from app.services.patient_identifier import identify_patient


pytestmark = pytest.mark.asyncio


async def _make_account(session, *, phone="+79991112233", name="Иван Тестов"):
    acc = PatientAccount(
        phone=phone,
        name=name,
        is_active=True,
    )
    session.add(acc)
    await session.flush()
    return acc


def _http_error(status: int) -> httpx.HTTPStatusError:
    """Создаёт настоящий httpx.HTTPStatusError с нужным status_code."""
    req = httpx.Request("POST", "http://mis.test/")
    resp = httpx.Response(status, request=req)
    return httpx.HTTPStatusError("mis", request=req, response=resp)


@pytest.mark.integration
async def test_identify_found_in_mis_links(db_session):
    """find_patient_by_phone вернул dict с patient_id → mis_sync_state='linked'."""
    acc = await _make_account(db_session)
    with patch("app.services.patient_identifier.mis") as mock_mis:
        mock_mis.find_patient_by_phone = AsyncMock(
            return_value={"patient_id": 12345, "phone": acc.phone}
        )
        mock_mis.add_patient = AsyncMock(return_value=None)
        state = await identify_patient(db_session, patient_account_id=acc.id)

    assert state == "linked"
    refreshed = (
        await db_session.execute(
            select(PatientAccount).where(PatientAccount.id == acc.id)
        )
    ).scalar_one()
    assert refreshed.mis_patient_id == 12345
    assert refreshed.mis_sync_state == "linked"


@pytest.mark.integration
async def test_identify_not_found_creates_in_mis(db_session):
    """find_patient_by_phone вернул None → add_patient → mis_sync_state='created'."""
    acc = await _make_account(db_session, phone="+79992223344")
    with patch("app.services.patient_identifier.mis") as mock_mis:
        mock_mis.find_patient_by_phone = AsyncMock(return_value=None)
        mock_mis.add_patient = AsyncMock(
            return_value={"patient_id": 67890, "phone": acc.phone}
        )
        state = await identify_patient(db_session, patient_account_id=acc.id)

    assert state == "created"
    refreshed = (
        await db_session.execute(
            select(PatientAccount).where(PatientAccount.id == acc.id)
        )
    ).scalar_one()
    assert refreshed.mis_patient_id == 67890
    assert refreshed.mis_sync_state == "created"


@pytest.mark.integration
async def test_identify_5xx_enqueues_outbox(db_session):
    """add_patient бросил 5xx → mis_sync_state='error' + строка в mis_outbox."""
    acc = await _make_account(db_session, phone="+79993334455")
    with patch("app.services.patient_identifier.mis") as mock_mis:
        mock_mis.find_patient_by_phone = AsyncMock(return_value=None)
        mock_mis.add_patient = AsyncMock(side_effect=_http_error(503))
        state = await identify_patient(db_session, patient_account_id=acc.id)

    assert state == "error"
    outbox_rows = (await db_session.execute(select(MisOutbox))).scalars().all()
    assert any(row.event_type == "patient.create" for row in outbox_rows)


@pytest.mark.integration
async def test_identify_4xx_manual_required(db_session):
    """add_patient бросил 4xx → mis_sync_state='manual_required'."""
    acc = await _make_account(db_session, phone="+79994445566")
    with patch("app.services.patient_identifier.mis") as mock_mis:
        mock_mis.find_patient_by_phone = AsyncMock(return_value=None)
        mock_mis.add_patient = AsyncMock(side_effect=_http_error(422))
        state = await identify_patient(db_session, patient_account_id=acc.id)

    assert state == "manual_required"


@pytest.mark.integration
async def test_identify_no_phone_marks_no_phone(db_session):
    """Аккаунт с пустым phone → mis_sync_state='no_phone' (без обращения к МИС)."""
    # phone уникален (UNIQUE INDEX) — генерим пустую строку. Если ограничение
    # сработает (NOT NULL ловится моделью), подставляем placeholder и
    # затираем .phone после flush.
    acc = PatientAccount(
        phone=f"placeholder-{uuid.uuid4().hex[:8]}",
        name="Без телефона",
        is_active=True,
    )
    db_session.add(acc)
    await db_session.flush()
    acc.phone = ""
    await db_session.flush()

    with patch("app.services.patient_identifier.mis") as mock_mis:
        mock_mis.find_patient_by_phone = AsyncMock(return_value={"patient_id": 1})
        state = await identify_patient(db_session, patient_account_id=acc.id)
        # МИС не должен вызываться при пустом phone
        mock_mis.find_patient_by_phone.assert_not_called()

    assert state == "no_phone"


@pytest.mark.integration
async def test_identify_ambiguous_when_duplicate_phone(db_session):
    """
    Дубликат phone → mis_sync_state='ambiguous'.

    В patient_accounts на phone стоит UNIQUE — поэтому создать два аккаунта с
    одним phone нельзя честным путём. Поэтому проверяем «семантику ambiguous»:
    после создания второго мокового аккаунта с тем же phone (через INSERT
    мимо unique-индекса via raw SQL не вариант — он реально уникален).
    Вместо этого имитируем через моковую SELECT: подменяем session.execute
    второго запроса. НО проще — просто проверяем, что код-путь работает
    при наличии дубликатов на уровне БД нет (фактически 0 дубликатов),
    и тогда identify_patient уходит дальше в МИС. Поэтому этот сценарий
    тестируем через mock-fallback: подменяем сам select на side_effect
    возвращающий дубликат на втором вызове.
    """
    acc = await _make_account(db_session, phone="+79995556677")
    # Готовим вторую запись «как будто» дубликат — но UNIQUE не даст создать
    # через обычный flow. Используем тот факт, что identify_patient делает
    # отдельный SELECT с фильтром phone == acc.phone AND id != acc.id.
    # Мокаем session.execute полностью невозможно (он используется в первом
    # запросе тоже). Поэтому используем wrap: подменяем после первого SELECT.

    orig_execute = db_session.execute
    call_count = {"n": 0}

    async def fake_execute(stmt, *args, **kwargs):
        call_count["n"] += 1
        # 1-й вызов: select PatientAccount where id == acc.id → отдаём реальный
        # 2-й вызов: select PatientAccount where phone == ... and id != ... → отдаём фейковый дубликат
        result = await orig_execute(stmt, *args, **kwargs)
        if call_count["n"] == 2:
            class _Wrap:
                def scalars(self_inner):
                    class _S:
                        def all(self_inner2):
                            # имитация дубликата (любой непустой список)
                            return [object()]
                    return _S()
                def scalar_one_or_none(self_inner):
                    return None
            return _Wrap()
        return result

    with patch.object(db_session, "execute", side_effect=fake_execute):
        state = await identify_patient(db_session, patient_account_id=acc.id)

    assert state == "ambiguous"
