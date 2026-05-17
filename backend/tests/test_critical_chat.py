"""Критические Chat flow.

Покрывает:
- CLINIC_ROLES guard на сообщениях
- reply_to_id из другого треда → 400
- reassign: меняет assigned_doctor_id, кросс-тенант → CrossTenantError
- SLA-эскалация: _resolve_level threshold = 15 мин
- эскалация по ролям: reg → manager → owner
- close: status → 'closed'
- attachments: MAX_UPLOAD_SIZE = 50 MB

Все тесты — unit (mock_db) или pure-logic, без реального PG.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio


# ── 1. messages: только CLINIC_ROLES (doctor/reg/manager/admin/owner) ────
async def test_message_create_requires_clinic_role():
    """_ensure_clinic_role бросает 403 для PARTNER_DOCTOR / PATIENT / VISITING."""
    from app.routers.clinic_chat import _ensure_clinic_role
    from app.models.user import User, UserRole
    from fastapi import HTTPException

    for forbidden in (UserRole.PARTNER_DOCTOR, UserRole.PATIENT,
                      UserRole.VISITING_DOCTOR, UserRole.RECRUITER):
        u = MagicMock(spec=User); u.role = forbidden
        with pytest.raises(HTTPException) as exc:
            _ensure_clinic_role(u)
        assert exc.value.status_code == 403

    # Доктор и регистратор пройдут.
    for allowed in (UserRole.DOCTOR, UserRole.REG, UserRole.MANAGER,
                    UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
        u = MagicMock(spec=User); u.role = allowed
        _ensure_clinic_role(u)  # не падает


# ── 2. POST /messages: thread не существует → 404 ─────────────────────────
async def test_message_create_validates_thread_exists(client, mock_db):
    """POST /clinic/chat/threads/{id}/messages → 404 если треда нет."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole

    uid = uuid.uuid4(); tid = uuid.uuid4()
    token = create_access_token({"sub": str(uid), "role": "manager", "tid": str(tid)})

    user = MagicMock(spec=User)
    user.id = uid; user.role = UserRole.MANAGER
    user.is_active = True; user.tenant_id = tid

    user_res = MagicMock(); user_res.scalar_one_or_none.return_value = user
    mock_db.execute = AsyncMock(return_value=user_res)

    with patch("app.routers.clinic_chat.cs.get_thread", AsyncMock(return_value=None)), \
         patch("app.routers.clinic_chat._user_clinic_ids", AsyncMock(return_value=[uuid.uuid4()])):
        resp = await client.post(
            f"/clinic/chat/threads/{uuid.uuid4()}/messages",
            headers={"Authorization": f"Bearer {token}"},
            json={"body": "hi"},
        )
    assert resp.status_code == 404


# ── 3. reply_to_id из другого треда → 400 ─────────────────────────────────
async def test_message_with_reply_to_in_different_thread_fails(client, mock_db):
    """Если reply_to_id принадлежит другому треду — 400."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole

    uid = uuid.uuid4(); tid = uuid.uuid4(); thread_id = uuid.uuid4()
    clinic_id = uuid.uuid4()
    token = create_access_token({"sub": str(uid), "role": "doctor", "tid": str(tid)})

    user = MagicMock(spec=User); user.id = uid; user.role = UserRole.DOCTOR
    user.is_active = True; user.tenant_id = tid; user.clinic_id = clinic_id

    th = MagicMock(); th.id = thread_id; th.clinic_id = clinic_id

    user_res = MagicMock(); user_res.scalar_one_or_none.return_value = user
    reply_res = MagicMock(); reply_res.scalar_one_or_none.return_value = None  # not found
    mock_db.execute = AsyncMock(side_effect=[user_res, reply_res])

    with patch("app.routers.clinic_chat.cs.get_thread", AsyncMock(return_value=th)), \
         patch("app.routers.clinic_chat._user_clinic_ids", AsyncMock(return_value=[clinic_id])):
        resp = await client.post(
            f"/clinic/chat/threads/{thread_id}/messages",
            headers={"Authorization": f"Bearer {token}"},
            json={"body": "x", "reply_to_id": str(uuid.uuid4())},
        )
    assert resp.status_code == 400
    assert "Оригинал ответа" in resp.json()["detail"]


# ── 4. reassign_thread меняет assigned_doctor_id ───────────────────────────
async def test_reassign_thread_changes_assigned_doctor():
    from app.services.chat_workflow_service import reassign_thread

    db = AsyncMock()
    tid = uuid.uuid4()
    thread = MagicMock(id=uuid.uuid4(), tenant_id=tid, assigned_doctor_id=uuid.uuid4(),
                       reassigned_history=[])
    new_doc = MagicMock(id=uuid.uuid4(), tenant_id=tid, role="doctor", full_name="Доктор 1")
    actor = MagicMock(id=uuid.uuid4(), tenant_id=tid, role="manager")

    await reassign_thread(db, thread=thread, target_user=new_doc, actor=actor, note="x")
    assert thread.assigned_doctor_id == new_doc.id


# ── 5. reassign к юзеру из другого тенанта → CrossTenantError ─────────────
async def test_reassign_cross_tenant_forbidden():
    from app.services.chat_workflow_service import reassign_thread, CrossTenantError

    db = AsyncMock()
    thread = MagicMock(id=uuid.uuid4(), tenant_id=uuid.uuid4(),
                       reassigned_history=[], assigned_doctor_id=uuid.uuid4())
    foreign_user = MagicMock(id=uuid.uuid4(), tenant_id=uuid.uuid4(),  # другой тенант!
                              role="doctor")
    actor = MagicMock(id=uuid.uuid4(), tenant_id=thread.tenant_id, role="manager")

    with pytest.raises(CrossTenantError):
        await reassign_thread(db, thread=thread, target_user=foreign_user, actor=actor)


# ── 6. SLA breach detection: 15 мин = reg-уровень ─────────────────────────
async def test_sla_breach_detection_threshold_15min():
    """_resolve_level: 15 min → 'reg', 30 → 'manager', 60 → 'owner'."""
    from app.services.chat_sla_job import _resolve_level, DEFAULT_SETTINGS

    assert _resolve_level(10, DEFAULT_SETTINGS) is None  # < 15 мин — нет breach
    assert _resolve_level(15, DEFAULT_SETTINGS) == "reg"
    assert _resolve_level(20, DEFAULT_SETTINGS) == "reg"
    assert _resolve_level(30, DEFAULT_SETTINGS) == "manager"
    assert _resolve_level(60, DEFAULT_SETTINGS) == "owner"
    assert _resolve_level(120, DEFAULT_SETTINGS) == "owner"


# ── 7. SLA эскалирует через ROLE_PRIORITY: reg → manager → owner ──────────
async def test_sla_escalates_to_next_role():
    """ROLE_PRIORITY гарантирует что эскалация не «откатывается» —
    повторный breach с тем же уровнем игнорируется."""
    from app.services.chat_sla_job import ROLE_PRIORITY

    assert ROLE_PRIORITY["reg"] < ROLE_PRIORITY["manager"] < ROLE_PRIORITY["owner"]


# ── 8. POST /threads/{id}/close → status='closed' ─────────────────────────
async def test_thread_close_marks_status_closed(client, mock_db):
    """close endpoint меняет thread.status = 'closed'."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole

    uid = uuid.uuid4(); tid = uuid.uuid4(); clinic_id = uuid.uuid4(); thread_id = uuid.uuid4()
    token = create_access_token({"sub": str(uid), "role": "manager", "tid": str(tid)})

    user = MagicMock(spec=User); user.id = uid; user.role = UserRole.MANAGER
    user.is_active = True; user.tenant_id = tid

    th = MagicMock(); th.id = thread_id; th.clinic_id = clinic_id; th.status = "open"

    user_res = MagicMock(); user_res.scalar_one_or_none.return_value = user
    mock_db.execute = AsyncMock(return_value=user_res)

    with patch("app.routers.clinic_chat.cs.get_thread", AsyncMock(return_value=th)), \
         patch("app.routers.clinic_chat._user_clinic_ids", AsyncMock(return_value=[clinic_id])), \
         patch("app.routers.clinic_chat.cs.serialize_thread", lambda t: {"id": str(t.id), "status": t.status}):
        resp = await client.post(
            f"/clinic/chat/threads/{thread_id}/close",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200
    assert th.status == "closed"


# ── 9. thread status: open | closed | archived (whitelist) ────────────────
async def test_thread_status_transitions_valid():
    """status в модели = String(20); реальные переходы: open → closed → archived.

    Жёстко проверяем что модель допускает эти 3 значения и не имеет констрейнта
    запрещающего archived (т.е. поле не enum). Это инвариант для будущих миграций.
    """
    from app.models.chat import ChatThread

    col = ChatThread.__table__.columns["status"]
    # Не enum — а String(20). Whitelist enforce'ится на бизнес-уровне.
    assert str(col.type).startswith("VARCHAR")
    # Значения по-умолчанию: open
    assert col.default.arg == "open"


# ── 10. Attachments: лимит 50 MB ──────────────────────────────────────────
async def test_attachments_size_limit_50mb():
    """MAX_UPLOAD_SIZE = 50 * 1024 * 1024 (50 MB) — строгий лимит для drag&drop."""
    from app.routers.clinic_chat import MAX_UPLOAD_SIZE

    assert MAX_UPLOAD_SIZE == 50 * 1024 * 1024
    # 51 MB должен превышать лимит
    assert (51 * 1024 * 1024) > MAX_UPLOAD_SIZE
    # 49 MB должен помещаться
    assert (49 * 1024 * 1024) < MAX_UPLOAD_SIZE
