"""StaffChat @mention parser + резолв в user_ids (tenant-scope)."""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_parse_mentions_extracts_usernames():
    from app.services.staff_chat_mentions import parse_mention_strings
    text = "Привет @ivanov и @petrov, см. https://example.com (без @)"
    out = parse_mention_strings(text)
    assert set(out) == {"ivanov", "petrov"}


@pytest.mark.asyncio
async def test_parse_mentions_filters_short_names():
    from app.services.staff_chat_mentions import parse_mention_strings
    text = "@a @ab @abc @abcd"  # < 3 символов отфильтруются
    out = parse_mention_strings(text)
    assert "abc" in out
    assert "abcd" in out
    assert "a" not in out
    assert "ab" not in out


@pytest.mark.asyncio
async def test_resolve_mentions_returns_only_tenant_users():
    from app.services.staff_chat_mentions import resolve_mentions
    tenant_a = uuid.uuid4()
    u1 = MagicMock(id=uuid.uuid4(), username="ivanov", tenant_id=tenant_a)
    # БД уже отдала только u1 (т.к. фильтр по tenant_id в запросе)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(
        scalars=lambda: MagicMock(all=lambda: [u1])
    ))
    out = await resolve_mentions(db, ["ivanov", "petrov"], tenant_id=tenant_a)
    assert out == [str(u1.id)]


@pytest.mark.asyncio
async def test_resolve_mentions_empty_when_no_matches():
    from app.services.staff_chat_mentions import resolve_mentions
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(
        scalars=lambda: MagicMock(all=lambda: [])
    ))
    out = await resolve_mentions(db, ["unknown"], tenant_id=uuid.uuid4())
    assert out == []
