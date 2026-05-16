"""StaffChat global search — ILIKE по body в room'ах с user-membership."""
import uuid
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_search_returns_empty_for_short_query():
    """Запрос короче 2 символов → []."""
    from app.services.staff_chat_service import search_messages_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4())
    res = await search_messages_logic(db, user, "a", limit=50)
    assert res == []


@pytest.mark.asyncio
async def test_search_returns_empty_when_user_has_no_rooms():
    """User не состоит ни в одной комнате → []."""
    from app.services import staff_chat_service as svc
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4())
    with patch.object(svc, "user_room_ids", AsyncMock(return_value=[])):
        res = await svc.search_messages_logic(db, user, "test", limit=50)
    assert res == []


@pytest.mark.asyncio
async def test_search_serializes_results_with_snippet_and_room_name():
    """Поиск возвращает message_id/room_id/room_name/snippet/created_at/sender_id."""
    from app.services import staff_chat_service as svc
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4())
    room_id = uuid.uuid4()
    msg = MagicMock()
    msg.id = uuid.uuid4()
    msg.room_id = room_id
    msg.body = "Привет, это тестовое сообщение для поиска"
    msg.sender_id = uuid.uuid4()
    msg.created_at = datetime(2026, 5, 17, 12, 0, 0)
    room = MagicMock()
    room.id = room_id
    room.name = "general"

    result_mock = MagicMock()
    result_mock.all.return_value = [(msg, room)]
    db.execute = AsyncMock(return_value=result_mock)

    with patch.object(svc, "user_room_ids", AsyncMock(return_value=[room_id])):
        res = await svc.search_messages_logic(db, user, "тестовое", limit=50)

    assert len(res) == 1
    item = res[0]
    assert item["message_id"] == str(msg.id)
    assert item["room_id"] == str(room_id)
    assert item["room_name"] == "general"
    assert "тестовое" in item["body_snippet"]
    assert item["sender_id"] == str(msg.sender_id)
    assert item["created_at"] == msg.created_at.isoformat()
