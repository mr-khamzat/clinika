"""Quick Wins для чата клиника↔пациент.

Покрывает 4 фичи:
  1. Typing indicator — endpoints + поля в serialize_thread()
  2. Reactions — модель + toggle endpoint + serialize_message()
  3. Pin thread — поле pinned_at + endpoint toggle + сортировка
  4. Color label — поле color_label + PATCH endpoint

Unit-стиль (без реальной БД): сериализаторы тестируются на ORM-объектах в
памяти, эндпоинты — через AsyncMock сессии. PostgreSQL не нужен.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest


pytestmark = pytest.mark.unit


def _make_thread_obj():
    """ChatThread в памяти, без обращения к БД."""
    from app.models.chat import ChatThread
    th = ChatThread(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        clinic_id=uuid.uuid4(),
        patient_id=uuid.uuid4(),
        subject="qw",
        status="open",
        unread_for_patient=0,
        unread_for_clinic=0,
        last_message_at=datetime.utcnow(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    return th


def _make_msg_obj(thread):
    from app.models.chat import ChatMessage
    return ChatMessage(
        id=uuid.uuid4(),
        thread_id=thread.id,
        sender_type="patient",
        sender_id=thread.patient_id,
        body="hello",
        attachments=None,
        created_at=datetime.utcnow(),
    )


def _staff_user(th):
    from app.models.user import User, UserRole
    return User(
        id=uuid.uuid4(),
        tenant_id=th.tenant_id,
        clinic_id=th.clinic_id,
        role=UserRole.MANAGER,
        username=f"u-{uuid.uuid4().hex[:6]}",
        full_name="t",
        password_hash="x",
    )


def _mock_db_with_thread(th):
    """AsyncSession-мок: первый execute() возвращает наш thread."""
    db = AsyncMock()

    def _make_result(scalar=None, scalars=None):
        r = MagicMock()
        r.scalar_one_or_none.return_value = scalar
        sc = MagicMock()
        sc.all.return_value = scalars or []
        r.scalars.return_value = sc
        return r

    # cs.get_thread() делает execute(select(ChatThread).where(id==...))
    db.execute = AsyncMock(return_value=_make_result(scalar=th))
    db.commit = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


# ─── 1. Typing indicator ─────────────────────────────────────────────────────


def test_typing_serializer_outputs_fields():
    """serialize_thread() возвращает оба typing-поля (ISO или None)."""
    from app.services.chat_service import serialize_thread
    th = _make_thread_obj()
    th.last_typing_at_clinic = datetime(2026, 5, 16, 12, 0, 0)
    th.last_typing_at_patient = None
    out = serialize_thread(th)
    assert "last_typing_at_clinic" in out
    assert "last_typing_at_patient" in out
    assert out["last_typing_at_clinic"] == "2026-05-16T12:00:00"
    assert out["last_typing_at_patient"] is None


def test_typing_model_has_columns():
    """ChatThread.__table__ содержит last_typing_at_clinic и last_typing_at_patient."""
    from app.models.chat import ChatThread
    cols = {c.name for c in ChatThread.__table__.columns}
    assert "last_typing_at_clinic" in cols
    assert "last_typing_at_patient" in cols


@pytest.mark.asyncio
async def test_clinic_typing_endpoint_updates_timestamp():
    """POST /clinic/chat/threads/{id}/typing → ставит last_typing_at_clinic≈now."""
    from app.routers import clinic_chat as cc
    th = _make_thread_obj()
    fake = _staff_user(th)
    # Доступ: добавим клинику в _user_clinic_ids → мок execute последовательно
    db = AsyncMock()
    # _user_clinic_ids: для role=manager → SELECT clinic.id WHERE tenant_id=...
    # Возвращаем строку с clinic_id треда
    r_clinic_ids = MagicMock()
    r_clinic_ids.all.return_value = [(th.clinic_id,)]
    # get_thread: scalar_one_or_none → th
    r_thread = MagicMock()
    r_thread.scalar_one_or_none.return_value = th
    db.execute = AsyncMock(side_effect=[r_clinic_ids, r_thread])
    db.commit = AsyncMock()

    before = datetime.utcnow()
    res = await cc.typing_indicator(thread_id=th.id, user=fake, db=db)
    assert res["ok"] is True
    assert th.last_typing_at_clinic is not None
    assert th.last_typing_at_clinic.replace(tzinfo=None) >= before - timedelta(seconds=2)
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_clinic_typing_404_when_thread_missing():
    """typing endpoint → 404 если тред не найден."""
    from app.routers import clinic_chat as cc
    from fastapi import HTTPException
    th = _make_thread_obj()
    fake = _staff_user(th)
    db = AsyncMock()
    r_clinic_ids = MagicMock()
    r_clinic_ids.all.return_value = [(th.clinic_id,)]
    r_thread = MagicMock()
    r_thread.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(side_effect=[r_clinic_ids, r_thread])

    with pytest.raises(HTTPException) as exc:
        await cc.typing_indicator(thread_id=uuid.uuid4(), user=fake, db=db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_patient_typing_endpoint_updates_timestamp():
    """POST /patient/chat/threads/{id}/typing → ставит last_typing_at_patient."""
    from app.routers import patient_chat_threads as pct
    th = _make_thread_obj()

    # Подменяем _get_session / _account чтобы вернуть фейк-сессию и аккаунт
    from app.models.patient_account import PatientAccount
    fake_acc = PatientAccount(id=th.patient_id, phone="+79990000000")

    async def fake_get_session(*a, **kw):
        return MagicMock(phone="+79990000000")

    async def fake_account(*a, **kw):
        return fake_acc

    pct._get_session = fake_get_session
    pct._account = fake_account

    db = AsyncMock()
    r_thread = MagicMock()
    r_thread.scalar_one_or_none.return_value = th
    db.execute = AsyncMock(return_value=r_thread)
    db.commit = AsyncMock()

    from fastapi import Request
    req = MagicMock(spec=Request)
    req.cookies = {}

    before = datetime.utcnow()
    res = await pct.patient_typing(
        thread_id=th.id, request=req,
        authorization=None, x_patient_session="t", session_token="t", t="t",
        db=db,
    )
    assert res["ok"] is True
    assert th.last_typing_at_patient is not None
    assert th.last_typing_at_patient.replace(tzinfo=None) >= before - timedelta(seconds=2)
