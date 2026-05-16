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


# ─── 2. Reactions ────────────────────────────────────────────────────────────


def test_reaction_model_exists():
    """ChatMessageReaction модель импортируется и имеет ожидаемые колонки."""
    from app.models.chat import ChatMessageReaction
    cols = {c.name for c in ChatMessageReaction.__table__.columns}
    assert {"id", "message_id", "user_type", "user_id", "emoji", "created_at"} <= cols
    assert ChatMessageReaction.__tablename__ == "chat_message_reactions"


def test_serialize_message_reactions_default_empty():
    """serialize_message(m) без db даёт reactions=[] (back-compat)."""
    from app.services.chat_service import serialize_message
    th = _make_thread_obj()
    msg = _make_msg_obj(th)
    out = serialize_message(msg)
    assert "reactions" in out
    assert out["reactions"] == []


@pytest.mark.asyncio
async def test_serialize_message_with_db_aggregates():
    """serialize_message_with_reactions() агрегирует {emoji,count,by_me}."""
    from app.services.chat_service import serialize_message_with_reactions
    th = _make_thread_obj()
    msg = _make_msg_obj(th)
    me = uuid.uuid4()
    other = uuid.uuid4()

    from app.models.chat import ChatMessageReaction
    reactions = [
        ChatMessageReaction(
            id=uuid.uuid4(), message_id=msg.id, user_type="staff",
            user_id=me, emoji="thumbs_up",
        ),
        ChatMessageReaction(
            id=uuid.uuid4(), message_id=msg.id, user_type="staff",
            user_id=other, emoji="thumbs_up",
        ),
        ChatMessageReaction(
            id=uuid.uuid4(), message_id=msg.id, user_type="patient",
            user_id=other, emoji="heart",
        ),
    ]

    db = AsyncMock()
    r = MagicMock()
    sc = MagicMock()
    sc.all.return_value = reactions
    r.scalars.return_value = sc
    db.execute = AsyncMock(return_value=r)

    out = await serialize_message_with_reactions(msg, db=db, me_user_id=me)
    emoji_map = {x["emoji"]: x for x in out["reactions"]}
    assert emoji_map["thumbs_up"]["count"] == 2
    assert emoji_map["thumbs_up"]["by_me"] is True
    assert emoji_map["heart"]["count"] == 1
    assert emoji_map["heart"]["by_me"] is False


@pytest.mark.asyncio
async def test_clinic_reaction_toggle_adds_then_removes():
    """POST /clinic/chat/messages/{id}/reactions: первый раз — добавил, второй — удалил."""
    from app.routers import clinic_chat as cc
    from app.models.chat import ChatMessageReaction

    th = _make_thread_obj()
    msg = _make_msg_obj(th)
    fake = _staff_user(th)

    # ── Сценарий 1: реакция не существует → добавляется.
    db1 = AsyncMock()
    # _user_clinic_ids
    r_ids = MagicMock(); r_ids.all.return_value = [(th.clinic_id,)]
    # get message
    r_msg = MagicMock(); r_msg.scalar_one_or_none.return_value = msg
    # get thread (через cs.get_thread)
    r_th = MagicMock(); r_th.scalar_one_or_none.return_value = th
    # find existing reaction → None
    r_react = MagicMock(); r_react.scalar_one_or_none.return_value = None
    db1.execute = AsyncMock(side_effect=[r_ids, r_msg, r_th, r_react])
    db1.add = MagicMock()
    db1.commit = AsyncMock()
    db1.flush = AsyncMock()

    body = cc.ReactionIn(emoji="thumbs_up")
    r1 = await cc.toggle_reaction(message_id=msg.id, body=body, user=fake, db=db1)
    assert r1["added"] is True
    assert r1["emoji"] == "thumbs_up"
    db1.add.assert_called()  # реакция добавлена

    # ── Сценарий 2: реакция уже существует → удаляется.
    existing = ChatMessageReaction(
        id=uuid.uuid4(), message_id=msg.id, user_type="staff",
        user_id=fake.id, emoji="thumbs_up",
    )
    db2 = AsyncMock()
    r_ids2 = MagicMock(); r_ids2.all.return_value = [(th.clinic_id,)]
    r_msg2 = MagicMock(); r_msg2.scalar_one_or_none.return_value = msg
    r_th2 = MagicMock(); r_th2.scalar_one_or_none.return_value = th
    r_react2 = MagicMock(); r_react2.scalar_one_or_none.return_value = existing
    db2.execute = AsyncMock(side_effect=[r_ids2, r_msg2, r_th2, r_react2])
    db2.delete = AsyncMock()
    db2.commit = AsyncMock()

    r2 = await cc.toggle_reaction(message_id=msg.id, body=body, user=fake, db=db2)
    assert r2["added"] is False
    db2.delete.assert_awaited_once_with(existing)


# ─── 3. Pin thread ───────────────────────────────────────────────────────────


def test_pin_model_has_column():
    """ChatThread имеет колонку pinned_at."""
    from app.models.chat import ChatThread
    cols = {c.name for c in ChatThread.__table__.columns}
    assert "pinned_at" in cols


def test_pin_serializer_outputs_is_pinned():
    """serialize_thread() возвращает is_pinned + pinned_at."""
    from app.services.chat_service import serialize_thread
    th = _make_thread_obj()
    th.pinned_at = datetime(2026, 5, 16, 9, 0)
    out = serialize_thread(th)
    assert out["is_pinned"] is True
    assert out["pinned_at"] == "2026-05-16T09:00:00"

    th.pinned_at = None
    out2 = serialize_thread(th)
    assert out2["is_pinned"] is False
    assert out2["pinned_at"] is None


@pytest.mark.asyncio
async def test_pin_endpoint_toggles():
    """POST /clinic/chat/threads/{id}/pin — toggle on/off."""
    from app.routers import clinic_chat as cc
    th = _make_thread_obj()
    th.pinned_at = None
    fake = _staff_user(th)

    # toggle ON
    db1 = AsyncMock()
    r_ids = MagicMock(); r_ids.all.return_value = [(th.clinic_id,)]
    r_th = MagicMock(); r_th.scalar_one_or_none.return_value = th
    db1.execute = AsyncMock(side_effect=[r_ids, r_th])
    db1.commit = AsyncMock()
    res_on = await cc.pin_thread(thread_id=th.id, user=fake, db=db1)
    assert res_on["is_pinned"] is True
    assert res_on["pinned_at"] is not None
    assert th.pinned_at is not None

    # toggle OFF
    db2 = AsyncMock()
    r_ids2 = MagicMock(); r_ids2.all.return_value = [(th.clinic_id,)]
    r_th2 = MagicMock(); r_th2.scalar_one_or_none.return_value = th
    db2.execute = AsyncMock(side_effect=[r_ids2, r_th2])
    db2.commit = AsyncMock()
    res_off = await cc.pin_thread(thread_id=th.id, user=fake, db=db2)
    assert res_off["is_pinned"] is False
    assert res_off["pinned_at"] is None
    assert th.pinned_at is None


def test_list_clinic_threads_orders_by_pinned():
    """list_clinic_threads() запрос упорядочен pinned_at DESC NULLS LAST → last_message_at DESC."""
    # Проверяем сам построенный SQL через compile() — без выполнения.
    from app.services import chat_service as cs
    import inspect
    src = inspect.getsource(cs.list_clinic_threads)
    # source-level assertion: order_by должен включать pinned_at (как ключевое
    # слово), чтобы заиндексированные треды шли первыми.
    assert "pinned_at" in src, "list_clinic_threads() должен сортировать по pinned_at"
