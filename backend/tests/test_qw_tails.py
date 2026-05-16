"""Quick Wins хвосты — backend тесты (reply_to + upload size limit)."""
import uuid
import pytest
from unittest.mock import MagicMock


def test_reply_to_field_on_model():
    """Колонка reply_to_id присутствует в ChatMessage."""
    from app.models.chat import ChatMessage
    cols = [c.name for c in ChatMessage.__table__.columns]
    assert "reply_to_id" in cols


def test_serialize_message_includes_reply_preview():
    """serialize_message_with_reply при reply_to отдаёт preview оригинала."""
    from app.services.chat_service import serialize_message_with_reply
    original = MagicMock(
        id=uuid.uuid4(),
        body="Длинный оригинальный текст " * 20,
        sender_type="patient",
        sender_id=uuid.uuid4(),
    )
    msg = MagicMock(
        id=uuid.uuid4(),
        thread_id=uuid.uuid4(),
        sender_type="doctor",
        sender_id=uuid.uuid4(),
        body="Мой ответ",
        attachments=None,
        read_at=None,
        created_at=None,
        reply_to_id=original.id,
    )
    out = serialize_message_with_reply(msg, reply_to=original)
    assert out.get("reply_to") is not None
    rt = out["reply_to"]
    assert rt["id"] == str(original.id)
    assert len(rt["body_preview"]) <= 100
    assert rt["sender_type"] == "patient"
    assert out["reply_to_id"] == str(original.id)


def test_serialize_message_without_reply():
    """Если reply_to_id=None — reply_to=None и reply_to_id=None."""
    from app.services.chat_service import serialize_message_with_reply
    msg = MagicMock(
        id=uuid.uuid4(),
        thread_id=uuid.uuid4(),
        sender_type="doctor",
        sender_id=None,
        body="нет ответа",
        attachments=None,
        read_at=None,
        created_at=None,
        reply_to_id=None,
    )
    out = serialize_message_with_reply(msg, reply_to=None)
    assert out.get("reply_to") is None
    assert out.get("reply_to_id") is None


def test_upload_size_limit_constant():
    """Лимит upload 50MB зафиксирован константой MAX_UPLOAD_SIZE."""
    from app.routers.clinic_chat import MAX_UPLOAD_SIZE
    assert MAX_UPLOAD_SIZE == 50 * 1024 * 1024
