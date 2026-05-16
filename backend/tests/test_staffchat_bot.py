"""StaffChat bot/post endpoint (CI/мониторинг) — secret-auth + поиск канала."""
import os
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_bot_post_rejects_wrong_secret(client):
    """Без auth, но с неверным secret → 401."""
    os.environ["STAFF_CHAT_BOT_SECRET"] = "correct-secret-abc"
    r = await client.post(
        "/api/staff-chat/bot/post",
        json={"channel_name": "ops", "body": "deploy ok", "secret": "wrong"},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_bot_post_503_when_secret_not_configured(client):
    """Если env STAFF_CHAT_BOT_SECRET пустой → 503."""
    os.environ.pop("STAFF_CHAT_BOT_SECRET", None)
    r = await client.post(
        "/api/staff-chat/bot/post",
        json={"channel_name": "ops", "body": "x", "secret": "anything"},
    )
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_bot_post_404_when_channel_not_found(client, mock_db):
    """Корректный secret, но канала с таким именем нет → 404."""
    os.environ["STAFF_CHAT_BOT_SECRET"] = "test-secret-xyz"
    # mock_db.execute() уже возвращает scalar_one_or_none=None по умолчанию
    r = await client.post(
        "/api/staff-chat/bot/post",
        json={
            "channel_name": "no-such-channel",
            "body": "hello",
            "secret": "test-secret-xyz",
        },
    )
    assert r.status_code == 404
