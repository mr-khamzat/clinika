"""SLA-checker job + autoclose tests."""
import uuid
import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_sla_check_escalates_to_reg_at_15min():
    from app.services.chat_sla_job import _check_thread_sla

    thread = MagicMock(
        id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        assigned_doctor_id=uuid.uuid4(),
        last_inbound_message_at=datetime.utcnow() - timedelta(minutes=16),
        sla_breached_level=None, sla_breached_at=None,
        reassigned_history=[], status="open",
    )
    settings = {"chat_sla_enabled": True,
                "chat_sla_minutes_reg": 15, "chat_sla_minutes_manager": 30, "chat_sla_minutes_owner": 60}
    target_user = MagicMock(id=uuid.uuid4(), tenant_id=thread.tenant_id, role="reg")
    db = AsyncMock()
    with patch("app.services.chat_sla_job._find_free_user_of_role", return_value=target_user):
        level = await _check_thread_sla(db, thread, settings)
    assert level == "reg"
    assert thread.sla_breached_level == "reg"
    assert thread.assigned_doctor_id == target_user.id


@pytest.mark.asyncio
async def test_sla_check_no_action_below_threshold():
    from app.services.chat_sla_job import _check_thread_sla
    thread = MagicMock(
        last_inbound_message_at=datetime.utcnow() - timedelta(minutes=5),
        sla_breached_level=None, status="open",
    )
    settings = {"chat_sla_enabled": True, "chat_sla_minutes_reg": 15,
                "chat_sla_minutes_manager": 30, "chat_sla_minutes_owner": 60}
    db = AsyncMock()
    level = await _check_thread_sla(db, thread, settings)
    assert level is None


@pytest.mark.asyncio
async def test_sla_check_skips_when_disabled():
    from app.services.chat_sla_job import _check_thread_sla
    thread = MagicMock(
        last_inbound_message_at=datetime.utcnow() - timedelta(minutes=120),
        sla_breached_level=None, status="open",
    )
    settings = {"chat_sla_enabled": False}
    db = AsyncMock()
    level = await _check_thread_sla(db, thread, settings)
    assert level is None


@pytest.mark.asyncio
async def test_autoclose_after_n_days():
    from app.services.chat_sla_job import _should_autoclose
    thread = MagicMock(
        status="open",
        last_message_at=datetime.utcnow() - timedelta(days=8),
    )
    assert _should_autoclose(thread, days=7) is True
    thread.last_message_at = datetime.utcnow() - timedelta(days=3)
    assert _should_autoclose(thread, days=7) is False
