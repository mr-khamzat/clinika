"""Reassign endpoint — передача треда другому пользователю того же тенанта."""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime


@pytest.mark.asyncio
async def test_reassign_changes_assigned_doctor():
    from app.services.chat_workflow_service import reassign_thread

    db = AsyncMock()
    thread = MagicMock(id=uuid.uuid4(), assigned_doctor_id=uuid.uuid4(),
                       reassigned_history=[], tenant_id=uuid.uuid4())
    target_user = MagicMock(id=uuid.uuid4(), tenant_id=thread.tenant_id, role="doctor")
    actor = MagicMock(id=uuid.uuid4(), tenant_id=thread.tenant_id, role="manager")

    new_thread = await reassign_thread(
        db, thread=thread, target_user=target_user, actor=actor,
        note="перенаправляю к терапевту", reason="manual",
    )
    assert new_thread.assigned_doctor_id == target_user.id


@pytest.mark.asyncio
async def test_reassign_logs_history():
    from app.services.chat_workflow_service import reassign_thread

    db = AsyncMock()
    thread = MagicMock(id=uuid.uuid4(), assigned_doctor_id=uuid.uuid4(),
                       reassigned_history=[], tenant_id=uuid.uuid4())
    target_user = MagicMock(id=uuid.uuid4(), tenant_id=thread.tenant_id, role="doctor")
    actor = MagicMock(id=uuid.uuid4(), tenant_id=thread.tenant_id, role="manager")

    await reassign_thread(db, thread=thread, target_user=target_user, actor=actor, note="x")
    assert len(thread.reassigned_history) == 1
    entry = thread.reassigned_history[0]
    assert entry["to_user_id"] == str(target_user.id)
    assert entry["reason"] == "manual"


@pytest.mark.asyncio
async def test_reassign_rejects_cross_tenant():
    from app.services.chat_workflow_service import reassign_thread, CrossTenantError

    db = AsyncMock()
    thread = MagicMock(id=uuid.uuid4(), tenant_id=uuid.uuid4(),
                       reassigned_history=[], assigned_doctor_id=uuid.uuid4())
    target_user = MagicMock(id=uuid.uuid4(), tenant_id=uuid.uuid4(), role="doctor")
    actor = MagicMock(id=uuid.uuid4(), tenant_id=thread.tenant_id, role="manager")

    with pytest.raises(CrossTenantError):
        await reassign_thread(db, thread=thread, target_user=target_user, actor=actor)


@pytest.mark.asyncio
async def test_reassign_resets_sla_breach():
    from app.services.chat_workflow_service import reassign_thread

    db = AsyncMock()
    thread = MagicMock(id=uuid.uuid4(), tenant_id=uuid.uuid4(), assigned_doctor_id=uuid.uuid4(),
                       reassigned_history=[],
                       sla_breached_level="reg", sla_breached_at=datetime.utcnow())
    target_user = MagicMock(id=uuid.uuid4(), tenant_id=thread.tenant_id, role="doctor")
    actor = MagicMock(id=uuid.uuid4(), tenant_id=thread.tenant_id, role="manager")

    await reassign_thread(db, thread=thread, target_user=target_user, actor=actor)
    assert thread.sla_breached_level is None
    assert thread.sla_breached_at is None
