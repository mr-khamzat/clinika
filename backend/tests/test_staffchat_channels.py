"""Channels (StaffChat Slack-fundament) — endpoints unit-логика.

Покрытие: create_channel (creator → admin), join (public OK, group → 403),
leave (last admin → 409).
"""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_create_channel_makes_creator_admin():
    from app.routers.staff_chat import _create_channel_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4(), tenant_id=uuid.uuid4())
    payload = MagicMock(type="channel", clinic_id=None, description=None)
    # `name` зарезервировано у MagicMock → задаём явно
    payload.name = "dev-team"
    room, member = await _create_channel_logic(db, user, payload)
    assert room.type == "channel"
    assert room.name == "dev-team"
    assert member.member_role == "admin"
    assert member.user_id == user.id


@pytest.mark.asyncio
async def test_join_public_channel_creates_member():
    from app.routers.staff_chat import _join_channel_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4(), tenant_id=uuid.uuid4())
    room = MagicMock(id=uuid.uuid4(), tenant_id=user.tenant_id, type="channel")
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    member = await _join_channel_logic(db, user, room)
    assert member.user_id == user.id
    assert member.member_role == "member"


@pytest.mark.asyncio
async def test_join_group_channel_returns_forbidden_via_exception():
    from app.routers.staff_chat import _join_channel_logic, GroupJoinForbidden
    db = AsyncMock()
    user = MagicMock(tenant_id=uuid.uuid4())
    room = MagicMock(tenant_id=user.tenant_id, type="group")
    with pytest.raises(GroupJoinForbidden):
        await _join_channel_logic(db, user, room)


@pytest.mark.asyncio
async def test_leave_last_admin_returns_conflict():
    from app.routers.staff_chat import _leave_channel_logic, LastAdminError
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4())
    room = MagicMock(id=uuid.uuid4())
    me = MagicMock(user_id=user.id, member_role="admin")
    # mock: после исключения меня — admin'ов нет
    db.execute = AsyncMock(return_value=MagicMock(
        scalars=lambda: MagicMock(all=lambda: [])
    ))
    with pytest.raises(LastAdminError):
        await _leave_channel_logic(db, user, room, me)
