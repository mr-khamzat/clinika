"""StaffChat polls — create / vote (single+multi) / serialize."""
import uuid
import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_create_poll_rejects_less_than_two_options():
    """Меньше 2 вариантов → ValueError."""
    from app.services.staff_chat_service import create_poll_logic
    db = AsyncMock()
    db.flush = AsyncMock()
    user = MagicMock(id=uuid.uuid4())
    room = MagicMock(id=uuid.uuid4(), last_message_at=None)
    with pytest.raises(ValueError):
        await create_poll_logic(
            db, user, room,
            question="Q?", options=["only one"], multi_select=False,
        )


@pytest.mark.asyncio
async def test_create_poll_creates_message_and_poll():
    """Успешное создание: добавлены msg + poll, set last_message_at."""
    from app.services.staff_chat_service import create_poll_logic
    db = AsyncMock()
    db.flush = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock())
    db.add = MagicMock()
    user = MagicMock(id=uuid.uuid4())
    room = MagicMock(id=uuid.uuid4(), last_message_at=None)
    poll, msg = await create_poll_logic(
        db, user, room,
        question="Какой кофе?",
        options=["Эспрессо", "Капучино", "Латте"],
        multi_select=True,
    )
    # add вызвался хотя бы для msg + poll
    assert db.add.call_count >= 2
    assert room.last_message_at is not None
    assert poll.question == "Какой кофе?"
    assert poll.options == ["Эспрессо", "Капучино", "Латте"]
    assert poll.multi_select is True


@pytest.mark.asyncio
async def test_vote_toggle_single_select_replaces_previous():
    """Single-select: новый голос → старые удалены, новый добавлен."""
    from app.services.staff_chat_service import toggle_poll_vote_logic
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(
        scalar_one_or_none=lambda: None,  # нет существующего голоса за option 1
    ))
    db.add = MagicMock()
    db.delete = AsyncMock()
    user = MagicMock(id=uuid.uuid4())
    poll = MagicMock(
        id=uuid.uuid4(),
        options=["A", "B", "C"],
        multi_select=False,
        closes_at=None,
    )
    action = await toggle_poll_vote_logic(db, user, poll, option_index=1)
    assert action == "added"
    # Для single-select должен быть delete-вызов (очистка предыдущих)
    # 1 execute = поиск existing, 2-й = DELETE предыдущих → итого 2
    assert db.execute.call_count == 2
    assert db.add.called


@pytest.mark.asyncio
async def test_vote_toggle_removes_existing_vote():
    """Повторный голос за тот же option → removed."""
    from app.services.staff_chat_service import toggle_poll_vote_logic
    db = AsyncMock()
    existing = MagicMock()
    db.execute = AsyncMock(return_value=MagicMock(
        scalar_one_or_none=lambda: existing
    ))
    db.delete = AsyncMock()
    db.add = MagicMock()
    user = MagicMock(id=uuid.uuid4())
    poll = MagicMock(
        id=uuid.uuid4(),
        options=["A", "B"],
        multi_select=True,
        closes_at=None,
    )
    action = await toggle_poll_vote_logic(db, user, poll, option_index=0)
    assert action == "removed"
    db.delete.assert_awaited_once_with(existing)


@pytest.mark.asyncio
async def test_vote_rejects_closed_poll():
    """Голосование после closes_at → ValueError."""
    from app.services.staff_chat_service import toggle_poll_vote_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4())
    poll = MagicMock(
        id=uuid.uuid4(),
        options=["A", "B"],
        multi_select=False,
        closes_at=datetime.utcnow() - timedelta(hours=1),
    )
    with pytest.raises(ValueError):
        await toggle_poll_vote_logic(db, user, poll, option_index=0)
