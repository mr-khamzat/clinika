# Workflow Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать 3 фичи Workflow батча — SLA-auto-escalate (с встроенным Reassign), Шаблоны быстрых ответов, Автозакрытие — согласно spec `docs/superpowers/specs/2026-05-16-workflow-batch-design.md` (commit 625defc).

**Architecture:** Backend (FastAPI) — 3 миграции alembic с одним общим head, новые модели/роутеры/сервисы, scheduler-job через существующий apscheduler. Frontend (React) — 2 новых компонента (ReassignModal, TemplateAutocomplete), 1 новая страница (ManagerChatTemplates), модификации ClinicChatSection и ThreadListItem. Параллельный запуск: 1 backend агент + 1 frontend агент (без файловых конфликтов).

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, alembic, apscheduler (уже работает в проекте), pytest, React 18, Vite, axios.

---

## File Structure

**Backend (один файл = одна ответственность):**

| Файл | Ответственность |
|------|----------------|
| `backend/app/models/chat.py` | +4 поля в ChatThread (sla/reassign) |
| `backend/app/models/message_template.py` (новый) | Модель MessageTemplate |
| `backend/app/models/__init__.py` | Экспорт MessageTemplate |
| `backend/alembic/versions/2026_05_16_wf01_chat_sla_fields.py` | Миграция: поля sla в chat_threads |
| `backend/alembic/versions/2026_05_16_wf02_tenant_chat_settings.py` | Миграция: settings JSONB на tenants (если нет) |
| `backend/alembic/versions/2026_05_16_wf03_message_templates.py` | Миграция: таблица message_templates |
| `backend/app/services/chat_workflow_service.py` (новый) | reassign_thread() helper + SLA helpers |
| `backend/app/services/chat_sla_job.py` (новый) | Scheduler job: эскалация + автозакрытие |
| `backend/app/services/chat_template_service.py` (новый) | CRUD-логика шаблонов |
| `backend/app/routers/clinic_chat.py` | +endpoint POST /clinic/chat/threads/{id}/reassign |
| `backend/app/routers/tenant_settings.py` (новый) | GET/PATCH /tenant/settings/chat |
| `backend/app/routers/chat_templates.py` (новый) | CRUD + use endpoints |
| `backend/app/main.py` | include_router + register scheduler-job |
| `backend/tests/test_workflow_reassign.py` (новый) | 4 теста reassign |
| `backend/tests/test_workflow_sla_job.py` (новый) | 4 теста SLA job + autoclose |
| `backend/tests/test_workflow_templates.py` (новый) | 3 теста templates |
| `backend/tests/test_workflow_settings.py` (новый) | 2 теста settings |

**Frontend:**

| Файл | Ответственность |
|------|----------------|
| `frontend/src/components/chat/ReassignModal.jsx` (новый) | Модал передачи треда |
| `frontend/src/components/chat/TemplateAutocomplete.jsx` (новый) | Dropdown шаблонов в input |
| `frontend/src/sections/ClinicChatSection.jsx` | +Reassign кнопка, +TemplateAutocomplete, +SLA badge |
| `frontend/src/components/chat/ThreadListItem.jsx` | +SLA badge |
| `frontend/src/pages/ManagerChatTemplates.jsx` (новый) | CRUD страница |
| `frontend/src/pages/ManagerChatSettings.jsx` (новый) | SLA settings UI |
| `frontend/src/App.jsx` | 2 новых route (manager only) |
| `frontend/src/pages/_ManagerShell.jsx` | 2 пункта меню |

---

## Task 1: Миграции и модели (backend)

**Файлы:**
- Create: `backend/alembic/versions/2026_05_16_wf01_chat_sla_fields.py`
- Create: `backend/alembic/versions/2026_05_16_wf02_tenant_chat_settings.py`
- Create: `backend/alembic/versions/2026_05_16_wf03_message_templates.py`
- Modify: `backend/app/models/chat.py`
- Create: `backend/app/models/message_template.py`
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: Найти current head**

```bash
sshpass -p 'Kh@mzat88712' ssh root@212.57.118.126 'cd /opt/clinika && docker compose exec -T clinika-backend alembic heads'
```
Expected: `chatqw04_color (head)` (один head после Quick Wins).

- [ ] **Step 2: Миграция wf01 — поля SLA в chat_threads**

Создать `backend/alembic/versions/2026_05_16_wf01_chat_sla_fields.py`:
```python
"""wf01: chat SLA fields (auto-escalate + reassign history)"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'wf01_sla'
down_revision = 'chatqw04_color'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('chat_threads',
        sa.Column('last_inbound_message_at', sa.DateTime, nullable=True))
    op.add_column('chat_threads',
        sa.Column('sla_breached_level', sa.String(20), nullable=True))
    op.add_column('chat_threads',
        sa.Column('sla_breached_at', sa.DateTime, nullable=True))
    op.add_column('chat_threads',
        sa.Column('reassigned_history', JSONB, server_default='[]', nullable=False))
    op.create_index('ix_chat_threads_last_inbound',
        'chat_threads', ['status', 'last_inbound_message_at'])


def downgrade():
    op.drop_index('ix_chat_threads_last_inbound', table_name='chat_threads')
    op.drop_column('chat_threads', 'reassigned_history')
    op.drop_column('chat_threads', 'sla_breached_at')
    op.drop_column('chat_threads', 'sla_breached_level')
    op.drop_column('chat_threads', 'last_inbound_message_at')
```

- [ ] **Step 3: Миграция wf02 — settings JSONB на tenants (idempotent)**

```python
"""wf02: tenant settings JSONB (idempotent — если столбец уже есть, ничего не делаем)"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'wf02_tenant_settings'
down_revision = 'wf01_sla'
branch_labels = None
depends_on = None


def upgrade():
    # Проверяем наличие столбца settings — он может уже существовать
    conn = op.get_bind()
    res = conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name='tenants' AND column_name='settings'"
    )).first()
    if not res:
        op.add_column('tenants',
            sa.Column('settings', JSONB, server_default='{}', nullable=False))


def downgrade():
    # Не дропаем — могут быть данные от других модулей.
    pass
```

- [ ] **Step 4: Миграция wf03 — таблица message_templates**

```python
"""wf03: message_templates таблица"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'wf03_templates'
down_revision = 'wf02_tenant_settings'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('message_templates',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('created_by_user_id', UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('shortcut', sa.String(50), nullable=False),
        sa.Column('title', sa.String(100), nullable=False),
        sa.Column('body', sa.Text, nullable=False),
        sa.Column('category', sa.String(50), nullable=True),
        sa.Column('usage_count', sa.Integer, server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    # Уникальность shortcut в пределах tenant+автор (NULL = общий для всех)
    op.create_index('ix_message_templates_tenant_shortcut',
        'message_templates', ['tenant_id', 'created_by_user_id', 'shortcut'],
        unique=True)


def downgrade():
    op.drop_index('ix_message_templates_tenant_shortcut', table_name='message_templates')
    op.drop_table('message_templates')
```

- [ ] **Step 5: Расширить модель ChatThread**

В `backend/app/models/chat.py` — найти класс `ChatThread` и добавить (после существующих pinned_at/color_label):
```python
    last_inbound_message_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, index=True
    )
    sla_breached_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sla_breached_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reassigned_history: Mapped[list] = mapped_column(JSONB, default=list, server_default='[]', nullable=False)
```
(Импорт JSONB добавить вверху файла: `from sqlalchemy.dialects.postgresql import JSONB`)

- [ ] **Step 6: Создать `backend/app/models/message_template.py`**

```python
"""MessageTemplate — шаблоны быстрых ответов в чате."""
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class MessageTemplate(Base):
    __tablename__ = "message_templates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    shortcut: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

- [ ] **Step 7: Экспорт в `backend/app/models/__init__.py`**

Добавить строку:
```python
from app.models.message_template import MessageTemplate  # noqa: F401
```

- [ ] **Step 8: Применить миграции**

```bash
sshpass -p 'Kh@mzat88712' scp /tmp/.../wf0*.py root@...:/opt/clinika/backend/alembic/versions/
sshpass -p 'Kh@mzat88712' ssh root@... 'cd /opt/clinika && docker compose exec -T clinika-backend alembic upgrade head'
```
Expected: `Running upgrade … -> wf03_templates`.

- [ ] **Step 9: Commit**

```bash
git add backend/app/models/chat.py backend/app/models/message_template.py backend/app/models/__init__.py backend/alembic/versions/2026_05_16_wf0*.py
git -c commit.gpgsign=false commit -m "feat(workflow): миграции + модели — SLA fields + MessageTemplate"
```

---

## Task 2: Backend Reassign endpoint (TDD)

**Файлы:**
- Create: `backend/app/services/chat_workflow_service.py`
- Modify: `backend/app/routers/clinic_chat.py`
- Create: `backend/tests/test_workflow_reassign.py`

- [ ] **Step 1: Тесты падают**

`backend/tests/test_workflow_reassign.py`:
```python
"""Reassign endpoint — передача треда другому пользователю того же тенанта."""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime


@pytest.fixture
def fake_user(tenant_id=None):
    u = MagicMock()
    u.id = uuid.uuid4()
    u.tenant_id = tenant_id or uuid.uuid4()
    u.role = "manager"
    return u


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
```

- [ ] **Step 2: Запустить — должны упасть с ImportError**

```bash
docker compose exec -T clinika-backend pytest tests/test_workflow_reassign.py -v
```
Expected: 4 ERRORS «ImportError: chat_workflow_service».

- [ ] **Step 3: Реализовать `backend/app/services/chat_workflow_service.py`**

```python
"""chat_workflow_service — операции над тредами: reassign, SLA-breach."""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatThread, ChatMessage
from app.models.user import User


class CrossTenantError(Exception):
    pass


async def reassign_thread(
    db: AsyncSession,
    *,
    thread: ChatThread,
    target_user: User,
    actor: User,
    note: Optional[str] = None,
    reason: str = "manual",  # "manual" | "sla"
) -> ChatThread:
    """Передаёт тред target_user. Кидает CrossTenantError если разные тенанты.

    - Меняет thread.assigned_doctor_id
    - Добавляет запись в reassigned_history
    - Создаёт system-сообщение
    - Сбрасывает SLA-флаги
    """
    if thread.tenant_id != target_user.tenant_id:
        raise CrossTenantError(
            f"target user {target_user.id} not in tenant {thread.tenant_id}"
        )
    old_id = thread.assigned_doctor_id
    thread.assigned_doctor_id = target_user.id
    # history (JSONB — присвоить новый список целиком чтобы SQLAlchemy заметил изменение)
    history = list(thread.reassigned_history or [])
    history.append({
        "at": datetime.utcnow().isoformat(),
        "from_user_id": str(old_id) if old_id else None,
        "to_user_id": str(target_user.id),
        "actor_user_id": str(actor.id),
        "reason": reason,
        "note": note or "",
    })
    thread.reassigned_history = history
    # System message
    sys_msg = ChatMessage(
        thread_id=thread.id,
        sender_type="system",
        sender_id=None,
        body=f"Тред передан → {getattr(target_user, 'full_name', None) or target_user.id}"
             + (f" (заметка: {note})" if note else ""),
    )
    db.add(sys_msg)
    # Сброс SLA
    thread.sla_breached_level = None
    thread.sla_breached_at = None
    return thread
```

- [ ] **Step 4: Тесты проходят**

```bash
docker compose exec -T clinika-backend pytest tests/test_workflow_reassign.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Endpoint в `clinic_chat.py`**

Добавить в `backend/app/routers/clinic_chat.py`:
```python
from app.services.chat_workflow_service import reassign_thread, CrossTenantError


class ReassignIn(BaseModel):
    to_user_id: uuid.UUID
    note: Optional[str] = Field(default=None, max_length=500)


@router.post("/threads/{thread_id}/reassign")
async def reassign(
    thread_id: uuid.UUID,
    body: ReassignIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_clinic_role(user)
    rt = await db.execute(select(ChatThread).where(ChatThread.id == thread_id))
    th = rt.scalar_one_or_none()
    if not th:
        raise HTTPException(404, "Thread not found")
    allowed = await _user_clinic_ids(db, user)
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")
    if user.role not in ("manager", "franchise_owner", "reg") and th.assigned_doctor_id != user.id:
        raise HTTPException(403, "Передавать может только manager/owner/reg/текущий назначенный")
    rt2 = await db.execute(select(User).where(User.id == body.to_user_id))
    target = rt2.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Целевой пользователь не найден")
    try:
        await reassign_thread(db, thread=th, target_user=target, actor=user, note=body.note)
    except CrossTenantError:
        raise HTTPException(400, "Целевой пользователь не из вашей клиники")
    await db.commit()
    return {"ok": True, "thread_id": str(th.id), "to_user_id": str(target.id)}
```

- [ ] **Step 6: Smoke endpoint**

```bash
docker compose restart clinika-backend
sleep 6
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:8900/clinic/chat/threads/00000000-0000-0000-0000-000000000000/reassign"
```
Expected: 403 (auth required — endpoint зарегистрирован).

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/chat_workflow_service.py backend/app/routers/clinic_chat.py backend/tests/test_workflow_reassign.py
git -c commit.gpgsign=false commit -m "feat(workflow): reassign endpoint + service (TDD, 4 tests)"
```

---

## Task 3: SLA-checker job + автозакрытие (TDD)

**Файлы:**
- Create: `backend/app/services/chat_sla_job.py`
- Modify: `backend/app/main.py` (register job)
- Create: `backend/tests/test_workflow_sla_job.py`

- [ ] **Step 1: Тесты**

`backend/tests/test_workflow_sla_job.py`:
```python
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
    with patch("app.services.chat_sla_job._find_free_user_of_role", return_value=target_user) as m:
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
```

- [ ] **Step 2: Запустить — должны упасть**

```bash
docker compose exec -T clinika-backend pytest tests/test_workflow_sla_job.py -v
```
Expected: 4 ERRORS.

- [ ] **Step 3: Реализовать `chat_sla_job.py`**

```python
"""chat_sla_job — фоновое задание: SLA-эскалация + автозакрытие."""
from __future__ import annotations
import logging
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatThread, ChatMessage
from app.models.tenant import Tenant
from app.models.user import User
from app.services.chat_workflow_service import reassign_thread

log = logging.getLogger(__name__)

DEFAULT_SETTINGS = {
    "chat_sla_enabled": False,
    "chat_sla_minutes_reg": 15,
    "chat_sla_minutes_manager": 30,
    "chat_sla_minutes_owner": 60,
    "chat_autoclose_days": 7,
}

ROLE_PRIORITY = {"reg": 1, "manager": 2, "owner": 3}


def _resolve_level(mins: float, settings: dict) -> Optional[str]:
    """Возвращает 'reg'/'manager'/'owner' или None в зависимости от mins."""
    if mins >= settings.get("chat_sla_minutes_owner", 60):
        return "owner"
    if mins >= settings.get("chat_sla_minutes_manager", 30):
        return "manager"
    if mins >= settings.get("chat_sla_minutes_reg", 15):
        return "reg"
    return None


async def _find_free_user_of_role(
    db: AsyncSession, tenant_id, role_target: str
) -> Optional[User]:
    """Находит user'а нужной роли с минимальным числом open тредов в тенанте."""
    role_map = {"reg": "reg", "manager": "manager", "owner": "franchise_owner"}
    role = role_map.get(role_target, role_target)
    q = (
        select(User, func.count(ChatThread.id).label("load"))
        .outerjoin(ChatThread, (ChatThread.assigned_doctor_id == User.id)
                              & (ChatThread.status == "open"))
        .where(User.tenant_id == tenant_id, User.role == role)
        .group_by(User.id)
        .order_by("load")
        .limit(1)
    )
    r = await db.execute(q)
    row = r.first()
    return row[0] if row else None


async def _check_thread_sla(
    db: AsyncSession, thread: ChatThread, settings: dict
) -> Optional[str]:
    """Проверяет один тред. Возвращает новый sla_breached_level или None."""
    if not settings.get("chat_sla_enabled"):
        return None
    if thread.status != "open" or not thread.last_inbound_message_at:
        return None
    mins = (datetime.utcnow() - thread.last_inbound_message_at).total_seconds() / 60
    target_level = _resolve_level(mins, settings)
    if not target_level:
        return None
    current = thread.sla_breached_level
    if current and ROLE_PRIORITY.get(target_level, 0) <= ROLE_PRIORITY.get(current, 0):
        return None  # уже на этом или более высоком уровне
    target_user = await _find_free_user_of_role(db, thread.tenant_id, target_level)
    if not target_user:
        log.warning("SLA escalation: no user of role %s in tenant %s",
                    target_level, thread.tenant_id)
        return None
    actor = MagicMock_actor_or_real(thread)  # см. ниже
    try:
        await reassign_thread(
            db, thread=thread, target_user=target_user, actor=actor,
            note=f"SLA: {target_level} ({int(mins)} мин без ответа)",
            reason="sla",
        )
        thread.sla_breached_level = target_level
        thread.sla_breached_at = datetime.utcnow()
    except Exception as e:
        log.exception("Reassign failed in SLA: %s", e)
        return None
    return target_level


def MagicMock_actor_or_real(thread):
    # Псевдо-актёр для SLA-эскалации. Реальный класс — system-user (если есть)
    # или объект-обёртка с минимумом полей.
    import uuid as _uuid
    from types import SimpleNamespace
    return SimpleNamespace(
        id=_uuid.UUID("00000000-0000-0000-0000-000000000000"),
        tenant_id=thread.tenant_id,
        role="system",
        full_name="SLA-bot",
    )


def _should_autoclose(thread: ChatThread, days: int) -> bool:
    if thread.status != "open" or not thread.last_message_at:
        return False
    return (datetime.utcnow() - thread.last_message_at) >= timedelta(days=days)


async def chat_sla_checker_job(get_db_factory):
    """Запускается раз в минуту через apscheduler. get_db_factory — функция
    возвращающая AsyncSession context manager."""
    try:
        async for db in get_db_factory():
            # 1) Загружаем все open треды с last_inbound_message_at not null
            q = select(ChatThread).where(
                ChatThread.status == "open",
                ChatThread.last_inbound_message_at.is_not(None),
            ).limit(500)  # safety cap
            threads = (await db.execute(q)).scalars().all()
            if not threads:
                break
            # 2) Группируем по tenant_id, читаем settings раз
            from collections import defaultdict
            by_tenant = defaultdict(list)
            for t in threads:
                by_tenant[t.tenant_id].append(t)
            for tenant_id, tlist in by_tenant.items():
                tenant = (await db.execute(
                    select(Tenant).where(Tenant.id == tenant_id)
                )).scalar_one_or_none()
                settings = (tenant.settings or {}) if tenant else {}
                merged = {**DEFAULT_SETTINGS, **settings}
                for thr in tlist:
                    await _check_thread_sla(db, thr, merged)
                    if _should_autoclose(thr, merged.get("chat_autoclose_days", 7)):
                        thr.status = "closed"
                        db.add(ChatMessage(
                            thread_id=thr.id, sender_type="system", sender_id=None,
                            body=f"Тред автоматически закрыт после {merged.get('chat_autoclose_days', 7)} дней неактивности",
                        ))
            await db.commit()
            break
    except Exception as e:
        log.exception("chat_sla_checker_job failed: %s", e)
```

- [ ] **Step 4: Тесты проходят**

```bash
docker compose exec -T clinika-backend pytest tests/test_workflow_sla_job.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Зарегистрировать job в `main.py`**

Найти в `backend/app/main.py` блок где регистрируется apscheduler (например, `scheduler.add_job(...)`) и добавить:
```python
from app.services.chat_sla_job import chat_sla_checker_job
from app.database import get_db

@app.on_event("startup")
async def _register_sla_job():
    # Уже зарегистрированный scheduler доступен глобально (см. tg_owner_bot_poll_job выше)
    scheduler.add_job(
        chat_sla_checker_job, "interval", seconds=60,
        args=[get_db], id="chat_sla_checker", replace_existing=True,
        max_instances=1,
    )
```
*(Точное место привязки зависит от того, как scheduler инициализирован в main.py. Если scheduler уже есть — добавить add_job в его существующий блок.)*

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/chat_sla_job.py backend/app/main.py backend/tests/test_workflow_sla_job.py
git -c commit.gpgsign=false commit -m "feat(workflow): SLA-checker job + autoclose (TDD, 4 tests)"
```

---

## Task 4: Backend tenant settings endpoint (TDD)

**Файлы:**
- Create: `backend/app/routers/tenant_settings.py`
- Modify: `backend/app/main.py` (include_router)
- Create: `backend/tests/test_workflow_settings.py`

- [ ] **Step 1: Тесты**

`backend/tests/test_workflow_settings.py`:
```python
import uuid, pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_get_chat_settings_returns_defaults():
    from app.routers.tenant_settings import _get_chat_settings_dict
    tenant = MagicMock(settings={})
    out = _get_chat_settings_dict(tenant)
    assert out["chat_sla_enabled"] is False
    assert out["chat_sla_minutes_reg"] == 15
    assert out["chat_autoclose_days"] == 7


@pytest.mark.asyncio
async def test_patch_chat_settings_merges():
    from app.routers.tenant_settings import _merge_chat_settings
    tenant = MagicMock(settings={"chat_sla_enabled": False, "chat_sla_minutes_reg": 15})
    merged = _merge_chat_settings(tenant, {"chat_sla_enabled": True, "chat_sla_minutes_reg": 10})
    assert merged["chat_sla_enabled"] is True
    assert merged["chat_sla_minutes_reg"] == 10
    assert merged.get("chat_sla_minutes_manager") in (None, 30)
```

- [ ] **Step 2: Запустить — должны упасть**

Run: `pytest tests/test_workflow_settings.py -v`. Expected: ERROR ImportError.

- [ ] **Step 3: Реализовать**

`backend/app/routers/tenant_settings.py`:
```python
"""Tenant settings — chat-namespace для SLA и autoclose."""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services.chat_sla_job import DEFAULT_SETTINGS

router = APIRouter(prefix="/tenant/settings", tags=["tenant-settings"])

CHAT_KEYS = ("chat_sla_enabled", "chat_sla_minutes_reg", "chat_sla_minutes_manager",
             "chat_sla_minutes_owner", "chat_autoclose_days")


def _get_chat_settings_dict(tenant: Tenant) -> dict:
    s = tenant.settings or {}
    return {k: s.get(k, DEFAULT_SETTINGS.get(k)) for k in CHAT_KEYS}


def _merge_chat_settings(tenant: Tenant, payload: dict) -> dict:
    base = tenant.settings or {}
    merged = dict(base)
    for k in CHAT_KEYS:
        if k in payload and payload[k] is not None:
            merged[k] = payload[k]
    return merged


class ChatSettingsIn(BaseModel):
    chat_sla_enabled: Optional[bool] = None
    chat_sla_minutes_reg: Optional[int] = Field(default=None, ge=1, le=240)
    chat_sla_minutes_manager: Optional[int] = Field(default=None, ge=1, le=240)
    chat_sla_minutes_owner: Optional[int] = Field(default=None, ge=1, le=240)
    chat_autoclose_days: Optional[int] = Field(default=None, ge=1, le=90)


def _require_settings_role(user: User) -> None:
    if user.role not in (UserRole.MANAGER, UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
        raise HTTPException(403, "Только manager/owner")
    if user.role != UserRole.SUPER_ADMIN and not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")


@router.get("/chat")
async def get_chat_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    tenant = (await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Тенант не найден")
    return _get_chat_settings_dict(tenant)


@router.patch("/chat")
async def patch_chat_settings(
    body: ChatSettingsIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    tenant = (await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Тенант не найден")
    merged = _merge_chat_settings(tenant, body.model_dump(exclude_none=True))
    tenant.settings = merged
    await db.commit()
    return _get_chat_settings_dict(tenant)
```

- [ ] **Step 4: include_router в main.py**

В `backend/app/main.py`, рядом с другими `app.include_router(...)`:
```python
from app.routers.tenant_settings import router as _tenant_settings_router
app.include_router(_tenant_settings_router)
```

- [ ] **Step 5: Тесты проходят**

```bash
docker compose restart clinika-backend && sleep 6
docker compose exec -T clinika-backend pytest tests/test_workflow_settings.py -v
```
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/tenant_settings.py backend/app/main.py backend/tests/test_workflow_settings.py
git -c commit.gpgsign=false commit -m "feat(workflow): tenant/settings/chat endpoints (TDD, 2 tests)"
```

---

## Task 5: Backend MessageTemplate router (TDD)

**Файлы:**
- Create: `backend/app/services/chat_template_service.py`
- Create: `backend/app/routers/chat_templates.py`
- Modify: `backend/app/main.py` (include_router)
- Create: `backend/tests/test_workflow_templates.py`

- [ ] **Step 1: Тесты**

`backend/tests/test_workflow_templates.py`:
```python
import uuid, pytest
from unittest.mock import AsyncMock, MagicMock


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
```

- [ ] **Step 2: Запустить — упадут**

Expected: ERROR ImportError.

- [ ] **Step 3: Реализовать `chat_template_service.py`**

```python
"""chat_template_service — CRUD-логика шаблонов сообщений."""
from app.models.message_template import MessageTemplate
from app.models.user import User


def serialize_template(t: MessageTemplate) -> dict:
    return {
        "id": str(t.id),
        "shortcut": t.shortcut,
        "title": t.title,
        "body": t.body,
        "category": t.category,
        "usage_count": int(t.usage_count or 0),
        "is_global": t.created_by_user_id is None,
        "created_by_user_id": str(t.created_by_user_id) if t.created_by_user_id else None,
    }


def can_modify_template(t: MessageTemplate, user: User) -> bool:
    """Можно ли user'у редактировать/удалять шаблон t."""
    if user.role in ("manager", "franchise_owner", "super_admin"):
        return True
    return t.created_by_user_id == user.id
```

- [ ] **Step 4: Реализовать router `chat_templates.py`**

```python
"""chat_templates — CRUD для MessageTemplate."""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.message_template import MessageTemplate
from app.models.user import User
from app.services.chat_template_service import serialize_template, can_modify_template

router = APIRouter(prefix="/chat/templates", tags=["chat-templates"])


def _require_staff(user: User):
    if user.role in ("patient", "visiting_doctor", "partner_doctor"):
        raise HTTPException(403, "Доступ запрещён")
    if not user.tenant_id:
        raise HTTPException(403, "Нет тенанта")


class TemplateIn(BaseModel):
    shortcut: str = Field(min_length=1, max_length=50, pattern=r"^[\w\-_а-яА-Я]+$")
    title: str = Field(min_length=1, max_length=100)
    body: str = Field(min_length=1, max_length=4000)
    category: Optional[str] = Field(default=None, max_length=50)
    is_global: bool = False


@router.get("")
async def list_templates(
    q: Optional[str] = Query(None, max_length=50),
    category: Optional[str] = Query(None, max_length=50),
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_staff(user)
    stmt = (select(MessageTemplate)
            .where(MessageTemplate.tenant_id == user.tenant_id)
            .where(or_(
                MessageTemplate.created_by_user_id.is_(None),
                MessageTemplate.created_by_user_id == user.id,
            )))
    if q:
        ql = f"%{q.lower()}%"
        stmt = stmt.where(or_(
            MessageTemplate.shortcut.ilike(ql),
            MessageTemplate.title.ilike(ql),
        ))
    if category:
        stmt = stmt.where(MessageTemplate.category == category)
    stmt = stmt.order_by(desc(MessageTemplate.usage_count), MessageTemplate.title).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return {"templates": [serialize_template(t) for t in rows]}


@router.post("", status_code=201)
async def create_template(
    body: TemplateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_staff(user)
    if body.is_global and user.role not in ("manager", "franchise_owner", "super_admin"):
        raise HTTPException(403, "Только manager/owner может создавать общие шаблоны")
    t = MessageTemplate(
        tenant_id=user.tenant_id,
        created_by_user_id=None if body.is_global else user.id,
        shortcut=body.shortcut.strip(),
        title=body.title.strip(),
        body=body.body,
        category=body.category,
    )
    db.add(t)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Шаблон с таким shortcut уже есть")
    return serialize_template(t)


@router.put("/{template_id}")
async def update_template(
    template_id: uuid.UUID,
    body: TemplateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_staff(user)
    t = (await db.execute(select(MessageTemplate).where(MessageTemplate.id == template_id))).scalar_one_or_none()
    if not t or t.tenant_id != user.tenant_id:
        raise HTTPException(404, "Не найден")
    if not can_modify_template(t, user):
        raise HTTPException(403, "Нет прав")
    t.shortcut = body.shortcut.strip()
    t.title = body.title.strip()
    t.body = body.body
    t.category = body.category
    await db.commit()
    return serialize_template(t)


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_staff(user)
    t = (await db.execute(select(MessageTemplate).where(MessageTemplate.id == template_id))).scalar_one_or_none()
    if not t or t.tenant_id != user.tenant_id:
        raise HTTPException(404, "Не найден")
    if not can_modify_template(t, user):
        raise HTTPException(403, "Нет прав")
    await db.delete(t)
    await db.commit()
    return None


@router.post("/{template_id}/use")
async def use_template(
    template_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_staff(user)
    t = (await db.execute(select(MessageTemplate).where(MessageTemplate.id == template_id))).scalar_one_or_none()
    if not t or t.tenant_id != user.tenant_id:
        raise HTTPException(404, "Не найден")
    t.usage_count = (t.usage_count or 0) + 1
    await db.commit()
    return {"body": t.body, "usage_count": t.usage_count}
```

- [ ] **Step 5: include_router в main.py + smoke**

```python
from app.routers.chat_templates import router as _chat_templates_router
app.include_router(_chat_templates_router)
```
Затем:
```bash
docker compose restart clinika-backend && sleep 6
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8900/chat/templates
```
Expected: 403 (без auth).

- [ ] **Step 6: Тесты проходят**

```bash
docker compose exec -T clinika-backend pytest tests/test_workflow_templates.py -v
```
Expected: 5 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/chat_template_service.py backend/app/routers/chat_templates.py backend/app/main.py backend/tests/test_workflow_templates.py
git -c commit.gpgsign=false commit -m "feat(workflow): chat templates CRUD (TDD, 5 tests)"
```

---

## Task 6: Frontend — Reassign modal + SLA badge

**Файлы:**
- Create: `frontend/src/components/chat/ReassignModal.jsx`
- Modify: `frontend/src/sections/ClinicChatSection.jsx` (импорт + кнопка + state)
- Modify: `frontend/src/components/chat/ThreadListItem.jsx` (SLA badge)

- [ ] **Step 1: Создать `ReassignModal.jsx`**

```jsx
/**
 * ReassignModal — модал передачи треда другому сотруднику.
 *
 * Использование:
 *   <ReassignModal open={open} onClose={...} threadId={id} onDone={refetch}/>
 */
import { useEffect, useState } from 'react'
import api from '../../api'
import { useToast } from '../../design'

export default function ReassignModal({ open, onClose, threadId, clinicId, onDone }) {
  const { toast } = useToast() || {}
  const [users, setUsers] = useState([])
  const [picked, setPicked] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) { setUsers([]); setPicked(''); setNote(''); return }
    setLoading(true)
    // Используем тот же fallback что в AssignDoctorModal:
    const params = clinicId ? { clinic_id: clinicId } : {}
    api.get('/users/clinic-staff', { params })
      .then(r => setUsers(Array.isArray(r.data) ? r.data : (r.data?.items || [])))
      .catch(() => api.get('/doctors', { params })
        .then(r => setUsers(Array.isArray(r.data) ? r.data : (r.data?.items || [])))
        .catch(() => setUsers([])))
      .finally(() => setLoading(false))
  }, [open, clinicId])

  if (!open) return null

  const submit = async () => {
    if (!picked) return
    setBusy(true)
    try {
      await api.post(`/clinic/chat/threads/${threadId}/reassign`, {
        to_user_id: picked, note: note.trim() || undefined,
      })
      toast?.('Тред передан', 'success')
      onDone?.()
      onClose?.()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Не удалось передать', 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center"
         style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)' }}
         onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
           className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
           style={{ background: 'var(--bg, #fff)', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border, #e2e8f0)' }}>
          <div className="font-bold" style={{ fontSize: 16 }}>Передать тред</div>
        </div>
        <div className="p-5 space-y-3">
          {loading ? (
            <div className="text-center py-4" style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>Загрузка…</div>
          ) : users.length === 0 ? (
            <div className="text-center py-4" style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>Нет доступных сотрудников</div>
          ) : (
            <select value={picked} onChange={e => setPicked(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl outline-none"
                    style={{ background: 'var(--bg-1, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', fontSize: 14 }}>
              <option value="">— выберите сотрудника —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.name || u.username || u.id}
                  {u.role ? ` · ${u.role}` : ''}
                </option>
              ))}
            </select>
          )}
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                    placeholder="Заметка (необязательно)…"
                    className="w-full px-3 py-2 rounded-xl outline-none resize-none"
                    style={{ background: 'var(--bg-1, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', fontSize: 14 }} />
          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl font-semibold"
                    style={{ background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}>
              Отмена
            </button>
            <button onClick={submit} disabled={!picked || busy}
                    className="flex-1 py-2.5 rounded-xl font-semibold text-white disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
              {busy ? 'Передаём…' : 'Передать'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Импорт + state + кнопка в ClinicChatSection**

В `frontend/src/sections/ClinicChatSection.jsx`:
- В импорты:
```jsx
import ReassignModal from '../components/chat/ReassignModal'
```
- Рядом с `const [assignOpen, setAssignOpen] = useState(false)`:
```jsx
const [reassignOpen, setReassignOpen] = useState(false)
```
- В шапке треда между «Назначить врача» и «Закрыть» — кнопка:
```jsx
{canAssign && active?.thread?.status !== 'closed' && (
  <button onClick={() => setReassignOpen(true)}
    className="grid place-items-center"
    style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
    title="Передать тред">
    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>swap_horiz</span>
  </button>
)}
```
- Рядом с `<AssignDoctorModal ... />` в самом низу JSX:
```jsx
<ReassignModal
  open={reassignOpen}
  onClose={() => setReassignOpen(false)}
  threadId={activeId}
  clinicId={active?.thread?.clinic_id || clinicIdProp}
  onDone={() => { fetchThread(activeId, true); fetchThreads() }}
/>
```

- [ ] **Step 3: SLA badge в шапке треда**

В `ClinicChatSection.jsx`, в шапке треда (рядом с pin/label) добавить:
```jsx
{active?.thread?.sla_breached_level && (
  <span className="px-2 py-1 rounded-md inline-flex items-center gap-1"
        style={{
          background: '#fee2e2', color: '#991b1b',
          fontSize: 10.5, fontWeight: 700, letterSpacing: '.02em',
        }}
        title={`SLA нарушен — эскалирован до ${active.thread.sla_breached_level}`}>
    <span className="material-symbols-outlined" style={{ fontSize: 12, fontVariationSettings: "'FILL' 1" }}>warning</span>
    SLA: {active.thread.sla_breached_level.toUpperCase()}
  </span>
)}
```

- [ ] **Step 4: SLA badge в `ThreadListItem.jsx`**

Найти `{unread > 0 && (...)` и перед ним добавить:
```jsx
{thread.sla_breached_level && (
  <span className="flex-shrink-0 px-2 py-0.5 rounded-full font-bold"
        style={{ fontSize: 10, background: '#fee2e2', color: '#991b1b' }}>
    SLA
  </span>
)}
```

- [ ] **Step 5: Smoke**

```bash
docker compose build --no-cache clinika-frontend && docker compose up -d clinika-frontend
sleep 6
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8901/
```
Expected: 200.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/ReassignModal.jsx frontend/src/sections/ClinicChatSection.jsx frontend/src/components/chat/ThreadListItem.jsx
git -c commit.gpgsign=false commit -m "feat(workflow): reassign modal + SLA badge UI"
```

---

## Task 7: Frontend — TemplateAutocomplete + страницы CRUD/Settings

**Файлы:**
- Create: `frontend/src/components/chat/TemplateAutocomplete.jsx`
- Create: `frontend/src/pages/ManagerChatTemplates.jsx`
- Create: `frontend/src/pages/ManagerChatSettings.jsx`
- Modify: `frontend/src/sections/ClinicChatSection.jsx` (интеграция автокомплита в textarea)
- Modify: `frontend/src/App.jsx` (2 новых route)
- Modify: `frontend/src/pages/_ManagerShell.jsx` (2 пункта меню)

- [ ] **Step 1: Создать `TemplateAutocomplete.jsx`**

```jsx
/**
 * TemplateAutocomplete — выпадающий список шаблонов в чате.
 *
 * Использование (внутри ClinicChatSection):
 *   <TemplateAutocomplete
 *     query={shortcutQuery}      // '' если не активен; иначе текст после '/'
 *     onPick={(template) => { setDraft(t.body); textareaRef.current.focus() }}
 *     onClose={() => setShortcutQuery('')}
 *   />
 */
import { useEffect, useState } from 'react'
import api from '../../api'

export default function TemplateAutocomplete({ query, onPick, onClose }) {
  const [items, setItems] = useState([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (query == null) { setItems([]); return }
    let alive = true
    api.get('/chat/templates', { params: { q: query || '', limit: 10 } })
      .then(r => { if (alive) setItems(r.data?.templates || []) })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [query])

  useEffect(() => {
    const onKey = (e) => {
      if (items.length === 0) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, items.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter')  {
        e.preventDefault()
        const t = items[active]; if (t) onPick(t)
      } else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, active, onPick, onClose])

  if (query == null || items.length === 0) return null

  return (
    <div
      className="absolute bottom-full left-2 right-2 mb-2 z-30 overflow-hidden"
      style={{
        background: 'var(--surface, #fff)',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: 14,
        boxShadow: '0 12px 32px rgba(15,23,42,.18)',
        maxHeight: 260, overflowY: 'auto',
      }}
    >
      {items.map((t, i) => (
        <button
          key={t.id}
          onMouseEnter={() => setActive(i)}
          onClick={() => onPick(t)}
          className="w-full text-left px-3 py-2 transition-colors"
          style={{
            background: active === i ? 'var(--bg-1, #f1f5f9)' : 'transparent',
            borderBottom: '1px solid var(--border, #e2e8f0)',
            cursor: 'pointer',
          }}
        >
          <div className="flex items-center gap-2">
            <code style={{
              fontSize: 11, padding: '2px 6px', borderRadius: 6,
              background: 'var(--bg-1, #f1f5f9)', color: 'var(--accent, #0097A7)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}>/{t.shortcut}</code>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg, #0F172A)' }}>{t.title}</span>
            {t.is_global && (
              <span style={{ fontSize: 10, color: 'var(--fg-3, #94a3b8)', marginLeft: 'auto' }}>общий</span>
            )}
          </div>
          <div className="truncate" style={{ fontSize: 12, color: 'var(--fg-3, #94a3b8)', marginTop: 2 }}>
            {t.body}
          </div>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Интеграция в ClinicChatSection textarea**

В `frontend/src/sections/ClinicChatSection.jsx`:
- импорт: `import TemplateAutocomplete from '../components/chat/TemplateAutocomplete'`
- state: `const [tplQuery, setTplQuery] = useState(null)  // null = неактивен, '' = пустой запрос`
- модифицировать `onDraftChange`:
```jsx
const onDraftChange = (e) => {
  const v = e.target.value
  setDraft(v)
  const ta = e.target
  ta.style.height = 'auto'
  ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  if (v.trim().length > 0) emitTyping()
  // Триггер шаблонов: если строка начинается с / — открываем picker
  const m = v.match(/^\/(\S*)$/)
  if (m) setTplQuery(m[1])
  else setTplQuery(null)
}
```
- Сразу перед textarea-блоком в input-зоне (внутри обёртки которая `position: relative`) вставить:
```jsx
<TemplateAutocomplete
  query={tplQuery}
  onPick={async (t) => {
    try { const r = await api.post(`/chat/templates/${t.id}/use`); setDraft(r.data?.body || t.body) }
    catch { setDraft(t.body) }
    setTplQuery(null)
    setTimeout(() => textareaRef.current?.focus(), 30)
  }}
  onClose={() => setTplQuery(null)}
/>
```
*Внимание:* родитель textarea должен иметь `position: relative`. Если нет — добавить.

- [ ] **Step 3: Создать `ManagerChatTemplates.jsx`**

```jsx
/**
 * Manager: CRUD страница шаблонов чата.
 * Route: /manager/chat-templates
 */
import { useEffect, useState } from 'react'
import api from '../api'
import { useToast } from '../design'
import ManagerShell from './_ManagerShell'

export default function ManagerChatTemplates() {
  const { toast } = useToast() || {}
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)  // null = none, {} = new, {id,...} = edit

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/chat/templates', { params: { limit: 100 } })
      setItems(r.data?.templates || [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!edit?.shortcut?.trim() || !edit?.title?.trim() || !edit?.body?.trim()) {
      toast?.('Все поля обязательны', 'error'); return
    }
    const payload = {
      shortcut: edit.shortcut.trim(),
      title: edit.title.trim(),
      body: edit.body,
      category: edit.category || null,
      is_global: !!edit.is_global,
    }
    try {
      if (edit.id) await api.put(`/chat/templates/${edit.id}`, payload)
      else await api.post('/chat/templates', payload)
      toast?.('Сохранено', 'success')
      setEdit(null); load()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Ошибка', 'error')
    }
  }
  const del = async (id) => {
    if (!confirm('Удалить шаблон?')) return
    try { await api.delete(`/chat/templates/${id}`); toast?.('Удалено', 'success'); load() }
    catch (e) { toast?.(e?.response?.data?.detail || 'Ошибка', 'error') }
  }

  return (
    <ManagerShell active="chat-templates" title="Шаблоны ответов" icon="dynamic_form">
      <div className="flex justify-end mb-3">
        <button onClick={() => setEdit({ shortcut: '', title: '', body: '', category: '', is_global: false })}
                className="px-4 py-2 rounded-xl font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
          + Новый шаблон
        </button>
      </div>
      {loading ? (
        <div className="text-center py-12" style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--fg-3)' }}>Нет шаблонов</div>
      ) : (
        <div className="grid gap-2">
          {items.map(t => (
            <div key={t.id} className="p-3 rounded-2xl flex items-start gap-3"
                 style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border, #e2e8f0)' }}>
              <code style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8,
                             background: 'var(--bg-1, #f1f5f9)', color: 'var(--accent, #0097A7)',
                             alignSelf: 'flex-start' }}>/{t.shortcut}</code>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span style={{ fontWeight: 700 }}>{t.title}</span>
                  {t.is_global && (
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999,
                                   background: 'rgba(14,165,233,.15)', color: '#0369a1' }}>общий</span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 'auto' }}>
                    использован: {t.usage_count}
                  </span>
                </div>
                <div className="truncate mt-1" style={{ fontSize: 13, color: 'var(--fg-2)' }}>{t.body}</div>
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => setEdit({ ...t })}
                        className="px-2 py-1 rounded-lg" style={{ background: 'var(--bg-1)', fontSize: 12 }}>
                  Изменить
                </button>
                <button onClick={() => del(t.id)}
                        className="px-2 py-1 rounded-lg" style={{ background: '#fee2e2', color: '#991b1b', fontSize: 12 }}>
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Модал редактирования */}
      {edit && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"
             style={{ background: 'rgba(15,23,42,.55)' }} onClick={() => setEdit(null)}>
          <div onClick={e => e.stopPropagation()}
               className="w-full max-w-md rounded-3xl overflow-hidden p-5 space-y-3"
               style={{ background: 'var(--bg, #fff)' }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {edit.id ? 'Изменить шаблон' : 'Новый шаблон'}
            </div>
            <input placeholder="shortcut (анализы, цены)" value={edit.shortcut || ''}
                   onChange={e => setEdit({ ...edit, shortcut: e.target.value })}
                   className="w-full px-3 py-2 rounded-xl outline-none"
                   style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}/>
            <input placeholder="Название" value={edit.title || ''}
                   onChange={e => setEdit({ ...edit, title: e.target.value })}
                   className="w-full px-3 py-2 rounded-xl outline-none"
                   style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}/>
            <textarea placeholder="Текст ответа…" rows={5} value={edit.body || ''}
                      onChange={e => setEdit({ ...edit, body: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl outline-none resize-none"
                      style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}/>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={!!edit.is_global}
                     onChange={e => setEdit({ ...edit, is_global: e.target.checked })}/>
              Общий для всей клиники
            </label>
            <div className="flex gap-2">
              <button onClick={() => setEdit(null)}
                      className="flex-1 py-2.5 rounded-xl"
                      style={{ background: 'var(--bg-1)' }}>Отмена</button>
              <button onClick={save}
                      className="flex-1 py-2.5 rounded-xl text-white font-semibold"
                      style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </ManagerShell>
  )
}
```

- [ ] **Step 4: Создать `ManagerChatSettings.jsx`**

```jsx
/**
 * Manager: SLA-настройки чата.
 * Route: /manager/chat-settings
 */
import { useEffect, useState } from 'react'
import api from '../api'
import { useToast } from '../design'
import ManagerShell from './_ManagerShell'

const DEFAULTS = {
  chat_sla_enabled: false,
  chat_sla_minutes_reg: 15,
  chat_sla_minutes_manager: 30,
  chat_sla_minutes_owner: 60,
  chat_autoclose_days: 7,
}

export default function ManagerChatSettings() {
  const { toast } = useToast() || {}
  const [s, setS] = useState(DEFAULTS)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/tenant/settings/chat').then(r => setS({ ...DEFAULTS, ...(r.data || {}) })).catch(() => {})
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      const r = await api.patch('/tenant/settings/chat', s)
      setS({ ...DEFAULTS, ...(r.data || {}) })
      toast?.('Сохранено', 'success')
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Ошибка', 'error')
    } finally { setBusy(false) }
  }
  const setNum = (k) => (e) => setS({ ...s, [k]: Number(e.target.value) || 0 })

  return (
    <ManagerShell active="chat-settings" title="Настройки чата" icon="tune">
      <div className="grid gap-4 max-w-md">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={s.chat_sla_enabled}
                 onChange={e => setS({ ...s, chat_sla_enabled: e.target.checked })}/>
          <span>SLA-эскалация включена</span>
        </label>
        {[
          ['chat_sla_minutes_reg',     'Эскалация на reg через (мин)'],
          ['chat_sla_minutes_manager', 'Эскалация на manager через (мин)'],
          ['chat_sla_minutes_owner',   'Эскалация на владельца через (мин)'],
          ['chat_autoclose_days',      'Автозакрытие после (дней)'],
        ].map(([k, label]) => (
          <label key={k}>
            <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}>{label}</div>
            <input type="number" value={s[k]} onChange={setNum(k)}
                   className="w-full px-3 py-2 rounded-xl outline-none"
                   style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}/>
          </label>
        ))}
        <button onClick={save} disabled={busy}
                className="px-4 py-2.5 rounded-xl text-white font-semibold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </ManagerShell>
  )
}
```

- [ ] **Step 5: Routes в App.jsx**

Найти блок `{user?.role === 'manager' && (...)` и добавить 2 route внутри:
```jsx
<Route path="manager/chat-templates" element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerChatTemplates /></Suspense>} />
<Route path="manager/chat-settings"  element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerChatSettings /></Suspense>} />
```
В импорты (lazy):
```jsx
const ManagerChatTemplates = lazy(() => import('./pages/ManagerChatTemplates'))
const ManagerChatSettings  = lazy(() => import('./pages/ManagerChatSettings'))
```

- [ ] **Step 6: Пункты меню в `_ManagerShell.jsx`**

В массиве MENU_ITEMS добавить:
```jsx
{ key:'chat-templates', label:'Шаблоны ответов', icon:'dynamic_form', path:'/manager/chat-templates', group:'communications' },
{ key:'chat-settings',  label:'Настройки чата',  icon:'tune',         path:'/manager/chat-settings',  group:'communications' },
```

- [ ] **Step 7: Build + smoke**

```bash
docker compose build --no-cache clinika-frontend && docker compose up -d clinika-frontend
sleep 6
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8901/
```
Expected: 200.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/chat/TemplateAutocomplete.jsx \
        frontend/src/pages/ManagerChatTemplates.jsx \
        frontend/src/pages/ManagerChatSettings.jsx \
        frontend/src/sections/ClinicChatSection.jsx \
        frontend/src/App.jsx \
        frontend/src/pages/_ManagerShell.jsx
git -c commit.gpgsign=false commit -m "feat(workflow): templates autocomplete + manager CRUD/settings pages"
```

---

## Task 8: Финальный smoke + TG-уведомление

- [ ] **Step 1: Прогнать все тесты Workflow**

```bash
docker compose exec -T clinika-backend pytest tests/test_workflow_reassign.py tests/test_workflow_sla_job.py tests/test_workflow_settings.py tests/test_workflow_templates.py -v 2>&1 | tail -10
```
Expected: 4+4+2+5 = 15 passed.

- [ ] **Step 2: Smoke endpoints**

```bash
for ep in "/clinic/chat/threads/00000000-0000-0000-0000-000000000000/reassign POST" \
          "/tenant/settings/chat GET" \
          "/chat/templates GET" \
          "/chat/templates POST"; do
  path=$(echo $ep | cut -d' ' -f1); method=$(echo $ep | cut -d' ' -f2)
  printf "%-65s " "$method $path"
  curl -s -o /dev/null -w "HTTP %{http_code}\n" -X $method "http://127.0.0.1:8900$path"
done
```
Expected: все 403 (auth required) — значит routes зарегистрированы.

- [ ] **Step 3: Отчёт в TG (текстом)**

Через скрипт по образцу `/tmp/clinika_edit/tg_qw_done.py` — несколько сообщений по 4 KB:
- что сделано (3 фичи)
- список коммитов
- список новых таблиц / endpoint'ов
- что протестировать в браузере

---

## Self-Review

**1. Spec coverage:**
- §3.1 SLA-auto-escalate → Task 1 (миграция wf01) + Task 2 (reassign) + Task 3 (job) + Task 4 (settings)
- §3.2 Шаблоны → Task 1 (миграция wf03 + модель) + Task 5 (router) + Task 7 (frontend)
- §3.3 Автозакрытие → Task 3 (тот же job)
- §4 Безопасность → встроена в Task 2 (cross-tenant check), Task 4 (role check), Task 5 (`can_modify_template`)
- §5 Тестирование → Task 2 (4), Task 3 (4), Task 4 (2), Task 5 (5) = 15 тестов
- §6 Миграции → Task 1 шаги 2-4

**2. Placeholder scan:** все шаги содержат код / точные команды. Один `MagicMock_actor_or_real` — это не placeholder, а реальная функция-фабрика SLA-actor'а внутри chat_sla_job.py.

**3. Type consistency:**
- `reassign_thread(db, *, thread, target_user, actor, note, reason)` — одна сигнатура в Task 2 и Task 3.
- `_check_thread_sla(db, thread, settings) -> Optional[str]` — Task 3.
- `_find_free_user_of_role(db, tenant_id, role_target) -> Optional[User]` — Task 3.
- `serialize_template(t) -> dict` ключи `{id, shortcut, title, body, category, usage_count, is_global, created_by_user_id}` — Task 5 (определена) и используется в Task 7 (frontend ожидает те же ключи).
- `CHAT_KEYS` — Task 4 (определена) и используется в `_get_chat_settings_dict` / `_merge_chat_settings`.

Всё консистентно.
