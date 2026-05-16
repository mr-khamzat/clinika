"""StaffChat reactions — toggle (add/remove) + агрегация."""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_reaction_toggle_add_then_remove():
    from app.routers.staff_chat import _toggle_reaction_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4())
    message = MagicMock(id=uuid.uuid4())
    # Add: existing returns None
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    action = await _toggle_reaction_logic(db, user, message, "\U0001F44D")
    assert action == "added"


@pytest.mark.asyncio
async def test_reaction_toggle_removes_existing():
    from app.routers.staff_chat import _toggle_reaction_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4())
    message = MagicMock(id=uuid.uuid4())
    existing = MagicMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: existing))
    action = await _toggle_reaction_logic(db, user, message, "\U0001F44D")
    assert action == "removed"


@pytest.mark.asyncio
async def test_serialize_reactions_aggregation():
    from app.services.staff_chat_service import _aggregate_reactions
    me = uuid.uuid4()
    other = uuid.uuid4()
    # 2 эмодзи: 👍 (от меня + от другого) и ❤️ (от другого)
    rows = [
        MagicMock(emoji="\U0001F44D", user_id=me),
        MagicMock(emoji="\U0001F44D", user_id=other),
        MagicMock(emoji="❤️", user_id=other),
    ]
    agg = _aggregate_reactions(rows, current_user_id=me)
    by_emoji = {r["emoji"]: r for r in agg}
    assert by_emoji["\U0001F44D"]["count"] == 2
    assert by_emoji["\U0001F44D"]["by_me"] is True
    assert by_emoji["❤️"]["count"] == 1
    assert by_emoji["❤️"]["by_me"] is False
