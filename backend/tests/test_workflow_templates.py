"""Chat templates service helpers tests."""
import uuid
import pytest
from unittest.mock import MagicMock


@pytest.mark.asyncio
async def test_serialize_template_outputs_required_fields():
    from app.services.chat_template_service import serialize_template
    t = MagicMock(id=uuid.uuid4(), tenant_id=uuid.uuid4(), created_by_user_id=None,
                  shortcut="prices", title="Цены", body="Цены на сайте",
                  category="price", usage_count=5)
    out = serialize_template(t)
    for k in ("id", "shortcut", "title", "body", "category", "usage_count", "is_global"):
        assert k in out
    assert out["is_global"] is True  # created_by_user_id is None


@pytest.mark.asyncio
async def test_serialize_template_personal_is_not_global():
    from app.services.chat_template_service import serialize_template
    t = MagicMock(id=uuid.uuid4(), tenant_id=uuid.uuid4(), created_by_user_id=uuid.uuid4(),
                  shortcut="x", title="x", body="x", category=None, usage_count=0)
    out = serialize_template(t)
    assert out["is_global"] is False


@pytest.mark.asyncio
async def test_check_can_modify_owner_can():
    from app.services.chat_template_service import can_modify_template
    me = MagicMock(id=uuid.uuid4(), role="doctor")
    t = MagicMock(created_by_user_id=me.id)
    assert can_modify_template(t, me) is True


@pytest.mark.asyncio
async def test_check_can_modify_other_doctor_cannot():
    from app.services.chat_template_service import can_modify_template
    me = MagicMock(id=uuid.uuid4(), role="doctor")
    t = MagicMock(created_by_user_id=uuid.uuid4())
    assert can_modify_template(t, me) is False


@pytest.mark.asyncio
async def test_check_can_modify_manager_can_any():
    from app.services.chat_template_service import can_modify_template
    me = MagicMock(id=uuid.uuid4(), role="manager")
    t = MagicMock(created_by_user_id=uuid.uuid4())
    assert can_modify_template(t, me) is True
