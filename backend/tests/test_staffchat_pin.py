"""StaffChat pin/unpin сообщений + лимит 20 на канал."""
import uuid
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_pin_toggle_admin_can():
    from app.routers.staff_chat import _toggle_pin_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4(), role="manager")
    msg = MagicMock(pinned_at=None, pinned_by_user_id=None, room_id=uuid.uuid4())
    member = MagicMock(member_role="admin")
    # cnt = 5 (< лимита 20)
    db.execute = AsyncMock(return_value=MagicMock(scalar=lambda: 5))
    action = await _toggle_pin_logic(db, user, msg, member)
    assert action == "pinned"
    assert msg.pinned_at is not None
    assert msg.pinned_by_user_id == user.id


@pytest.mark.asyncio
async def test_pin_unpin_when_already_pinned():
    from app.routers.staff_chat import _toggle_pin_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4(), role="manager")
    msg = MagicMock(pinned_at=datetime.utcnow(), pinned_by_user_id=user.id, room_id=uuid.uuid4())
    member = MagicMock(member_role="admin")
    action = await _toggle_pin_logic(db, user, msg, member)
    assert action == "unpinned"
    assert msg.pinned_at is None
    assert msg.pinned_by_user_id is None


@pytest.mark.asyncio
async def test_pin_limit_20_returns_error():
    from app.routers.staff_chat import _toggle_pin_logic, PinLimitError
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4(), role="manager")
    msg = MagicMock(pinned_at=None, room_id=uuid.uuid4())
    member = MagicMock(member_role="admin")
    db.execute = AsyncMock(return_value=MagicMock(scalar=lambda: 20))
    with pytest.raises(PinLimitError):
        await _toggle_pin_logic(db, user, msg, member)
