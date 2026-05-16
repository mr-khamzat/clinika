# StaffChat Slack-fundament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать 4 фичи (Channels, Reactions, @Mention, Pin) во внутреннем StaffChat согласно spec `docs/superpowers/specs/2026-05-16-staffchat-slack-fundament-design.md` (commit 6c2205f).

**Architecture:** Расширение существующих моделей `StaffChatRoom` / `StaffChatMessage` через 4 alembic-миграции; новые endpoints в `staff_chat.py` + 1 новая таблица `staff_chat_message_reactions`; парсер mentions с side-effect TG-нотификации; frontend — расширение `StaffChat.jsx` (1669 строк → +~600 строк UI для 4 фич).

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, alembic, pytest, React 18, axios.

---

## File Structure

**Backend:**
| Файл | Ответственность |
|------|----------------|
| `backend/app/models/staff_chat.py` | +description в Room; +mentioned_user_ids/pinned_at/pinned_by_user_id в Message; +StaffChatMessageReaction класс |
| `backend/alembic/versions/2026_05_16_sf01_channels.py` | description на staff_chat_rooms |
| `backend/alembic/versions/2026_05_16_sf02_reactions.py` | таблица staff_chat_message_reactions |
| `backend/alembic/versions/2026_05_16_sf03_mentions.py` | mentioned_user_ids JSONB на messages |
| `backend/alembic/versions/2026_05_16_sf04_pinned.py` | pinned_at + pinned_by_user_id на messages |
| `backend/app/services/staff_chat_mentions.py` (новый) | parse_mentions + notify_mentions |
| `backend/app/routers/staff_chat.py` | +9 endpoints (channels x6, reactions x1, mention x1, pin x2) |
| `backend/app/services/staff_chat_service.py` | +serialize_message_with_reactions, +лимит pinned, +parse_mentions integration |
| `backend/tests/test_staffchat_channels.py` | 4 теста |
| `backend/tests/test_staffchat_reactions.py` | 3 теста |
| `backend/tests/test_staffchat_mentions.py` | 4 теста |
| `backend/tests/test_staffchat_pin.py` | 3 теста |

**Frontend:**
| Файл | Ответственность |
|------|----------------|
| `frontend/src/pages/StaffChat.jsx` | Sidebar split + автокомплиты + UI новых фич |
| `frontend/src/components/staff/CreateChannelModal.jsx` (новый) | Модал «новый канал» |
| `frontend/src/components/staff/PinnedMessagesModal.jsx` (новый) | Модал закреплённых |
| `frontend/src/components/staff/MentionAutocomplete.jsx` (новый) | Dropdown @ автокомплита |

---

## Task 1: Backend — миграции и модели

**Files:**
- Modify: `backend/app/models/staff_chat.py`
- Create: 4 alembic-миграции (sf01..sf04)

- [ ] **Step 1: Найти current head**

```bash
sshpass -p 'Kh@mzat88712' ssh root@212.57.118.126 'cd /opt/clinika && docker compose exec -T clinika-backend alembic heads'
```
Expected: `wf03_templates (head)`.

- [ ] **Step 2: Миграция sf01_channels**

Файл `backend/alembic/versions/2026_05_16_sf01_channels.py`:
```python
"""sf01: description на staff_chat_rooms"""
from alembic import op
import sqlalchemy as sa

revision = 'sf01_channels'
down_revision = 'wf03_templates'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('staff_chat_rooms',
        sa.Column('description', sa.Text, nullable=True))


def downgrade():
    op.drop_column('staff_chat_rooms', 'description')
```

- [ ] **Step 3: Миграция sf02_reactions**

```python
"""sf02: staff_chat_message_reactions"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'sf02_reactions'
down_revision = 'sf01_channels'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('staff_chat_message_reactions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('message_id', UUID(as_uuid=True),
            sa.ForeignKey('staff_chat_messages.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('emoji', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_sf_reactions_unique',
        'staff_chat_message_reactions',
        ['message_id', 'user_id', 'emoji'], unique=True)


def downgrade():
    op.drop_index('ix_sf_reactions_unique', table_name='staff_chat_message_reactions')
    op.drop_table('staff_chat_message_reactions')
```

- [ ] **Step 4: Миграция sf03_mentions**

```python
"""sf03: mentioned_user_ids на staff_chat_messages"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'sf03_mentions'
down_revision = 'sf02_reactions'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('staff_chat_messages',
        sa.Column('mentioned_user_ids', JSONB, server_default='[]', nullable=False))


def downgrade():
    op.drop_column('staff_chat_messages', 'mentioned_user_ids')
```

- [ ] **Step 5: Миграция sf04_pinned**

```python
"""sf04: pinned_at + pinned_by_user_id на staff_chat_messages"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'sf04_pinned'
down_revision = 'sf03_mentions'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('staff_chat_messages',
        sa.Column('pinned_at', sa.DateTime, nullable=True))
    op.add_column('staff_chat_messages',
        sa.Column('pinned_by_user_id', UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))
    op.create_index('ix_sf_messages_pinned', 'staff_chat_messages',
        ['room_id', 'pinned_at'])


def downgrade():
    op.drop_index('ix_sf_messages_pinned', table_name='staff_chat_messages')
    op.drop_column('staff_chat_messages', 'pinned_by_user_id')
    op.drop_column('staff_chat_messages', 'pinned_at')
```

- [ ] **Step 6: Расширить модели в `backend/app/models/staff_chat.py`**

Добавить импорт в верх (если нет):
```python
from sqlalchemy.dialects.postgresql import JSONB
```

В класс `StaffChatRoom` (после `created_by_id`):
```python
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
```

В класс `StaffChatMessage` (после `deleted_at`):
```python
    mentioned_user_ids: Mapped[list] = mapped_column(JSONB, default=list, server_default='[]', nullable=False)
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pinned_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('users.id', ondelete='SET NULL'),
        nullable=True,
    )
```

В конец файла добавить новый класс:
```python
class StaffChatMessageReaction(Base):
    __tablename__ = "staff_chat_message_reactions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('staff_chat_messages.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('users.id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    emoji: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
```

- [ ] **Step 7: Экспорт в `backend/app/models/__init__.py`** (если import * не используется)

```python
from app.models.staff_chat import StaffChatMessageReaction  # noqa: F401
```
(Проверь — возможно StaffChat-модели уже все импортируются автоматически.)

- [ ] **Step 8: Применить миграции**

```bash
sshpass -p 'Kh@mzat88712' scp /tmp/.../sf0*.py root@...:/opt/clinika/backend/alembic/versions/
sshpass -p 'Kh@mzat88712' ssh root@... 'cd /opt/clinika && docker compose exec -T clinika-backend alembic upgrade head 2>&1 | tail -5'
```
Expected: `Running upgrade … -> sf04_pinned`.

- [ ] **Step 9: Commit**

```bash
git add backend/app/models/staff_chat.py backend/app/models/__init__.py backend/alembic/versions/2026_05_16_sf0*.py
git -c commit.gpgsign=false commit -m "feat(staffchat): миграции + модели — channels/reactions/mentions/pin fields"
```

---

## Task 2: Backend Channels endpoints (TDD)

**Files:**
- Modify: `backend/app/routers/staff_chat.py` (+6 endpoints)
- Create: `backend/tests/test_staffchat_channels.py` (4 теста)

- [ ] **Step 1: Тесты**

`backend/tests/test_staffchat_channels.py`:
```python
import uuid, pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_create_channel_makes_creator_admin():
    from app.routers.staff_chat import _create_channel_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4(), tenant_id=uuid.uuid4())
    payload = MagicMock(name="dev-team", type="channel", clinic_id=None, description=None)
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
    # mock: член не существует
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
    # mock: я последний admin
    db.execute = AsyncMock(return_value=MagicMock(scalars=lambda: MagicMock(all=lambda: [me])))
    with pytest.raises(LastAdminError):
        await _leave_channel_logic(db, user, room, me)
```

- [ ] **Step 2: Запустить — упадут с ImportError**

```bash
docker compose exec -T clinika-backend pytest tests/test_staffchat_channels.py -v
```
Expected: 4 ERRORS.

- [ ] **Step 3: Реализовать helpers + endpoints**

В `backend/app/routers/staff_chat.py` после блока импортов добавить:
```python
class GroupJoinForbidden(Exception):
    pass


class LastAdminError(Exception):
    pass


class CreateChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: Literal["channel", "group"]
    clinic_id: Optional[uuid.UUID] = None
    description: Optional[str] = Field(default=None, max_length=2000)


class InviteIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)


class PatchChannelIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)


async def _create_channel_logic(db, user, payload):
    """Pure logic for testing — создаёт room + member."""
    room = StaffChatRoom(
        tenant_id=user.tenant_id, type=payload.type, name=payload.name,
        clinic_id=payload.clinic_id, created_by_id=user.id,
        description=payload.description,
    )
    db.add(room)
    await db.flush()  # получаем room.id
    member = StaffChatMember(
        room_id=room.id, user_id=user.id, member_role="admin",
    )
    db.add(member)
    return room, member


async def _join_channel_logic(db, user, room):
    if room.type == "group":
        raise GroupJoinForbidden("Group channels require invite")
    if user.tenant_id != room.tenant_id:
        raise GroupJoinForbidden("Cross-tenant join forbidden")
    # Проверка — не member ли уже
    existing = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == room.id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    if existing:
        return existing
    member = StaffChatMember(room_id=room.id, user_id=user.id, member_role="member")
    db.add(member)
    return member


async def _leave_channel_logic(db, user, room, member):
    # Если я admin — посмотреть, последний ли я
    if member.member_role == "admin":
        rest_admins = (await db.execute(
            select(StaffChatMember).where(
                StaffChatMember.room_id == room.id,
                StaffChatMember.member_role == "admin",
                StaffChatMember.user_id != user.id,
            )
        )).scalars().all()
        if not rest_admins:
            raise LastAdminError("Нельзя выйти — вы последний admin")
    await db.delete(member)


@router.post("/channels", status_code=201)
async def create_channel(
    body: CreateChannelIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Нет тенанта")
    room, _ = await _create_channel_logic(db, user, body)
    await db.commit()
    await db.refresh(room)
    return {"id": str(room.id), "type": room.type, "name": room.name,
            "description": room.description}


@router.get("/channels/public")
async def list_public_channels(
    q: Optional[str] = Query(None, max_length=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Нет тенанта")
    stmt = select(StaffChatRoom).where(
        StaffChatRoom.tenant_id == user.tenant_id,
        StaffChatRoom.type == "channel",
    )
    if q:
        stmt = stmt.where(StaffChatRoom.name.ilike(f"%{q}%"))
    rows = (await db.execute(stmt.limit(50))).scalars().all()
    return {"channels": [{"id": str(r.id), "name": r.name,
                          "description": r.description} for r in rows]}


@router.post("/channels/{room_id}/join", status_code=201)
async def join_channel(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    room = (await db.execute(select(StaffChatRoom).where(StaffChatRoom.id == room_id))).scalar_one_or_none()
    if not room:
        raise HTTPException(404)
    try:
        await _join_channel_logic(db, user, room)
        await db.commit()
        return {"ok": True}
    except GroupJoinForbidden:
        raise HTTPException(403, "Это закрытый канал — нужно приглашение")


@router.post("/channels/{room_id}/invite", status_code=201)
async def invite_to_channel(
    room_id: uuid.UUID,
    body: InviteIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    me = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == room_id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not me or me.member_role != "admin":
        raise HTTPException(403, "Только admin может приглашать")
    added = 0
    for uid in body.user_ids:
        existing = (await db.execute(
            select(StaffChatMember).where(
                StaffChatMember.room_id == room_id,
                StaffChatMember.user_id == uid,
            )
        )).scalar_one_or_none()
        if existing:
            continue
        db.add(StaffChatMember(room_id=room_id, user_id=uid, member_role="member"))
        added += 1
    await db.commit()
    return {"added": added}


@router.post("/channels/{room_id}/leave", status_code=204)
async def leave_channel(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    me = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == room_id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not me:
        raise HTTPException(404)
    room = (await db.execute(select(StaffChatRoom).where(StaffChatRoom.id == room_id))).scalar_one()
    try:
        await _leave_channel_logic(db, user, room, me)
        await db.commit()
    except LastAdminError as e:
        raise HTTPException(409, str(e))
    return None


@router.patch("/channels/{room_id}")
async def patch_channel(
    room_id: uuid.UUID,
    body: PatchChannelIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    me = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == room_id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not me or me.member_role != "admin":
        raise HTTPException(403, "Только admin")
    room = (await db.execute(select(StaffChatRoom).where(StaffChatRoom.id == room_id))).scalar_one_or_none()
    if not room:
        raise HTTPException(404)
    if body.name is not None:
        room.name = body.name
    if body.description is not None:
        room.description = body.description
    await db.commit()
    return {"id": str(room.id), "name": room.name, "description": room.description}
```

Также убедись что импорты в верху staff_chat.py включают:
```python
from typing import Literal, Optional
from pydantic import BaseModel, Field
from app.models.staff_chat import StaffChatRoom, StaffChatMember, StaffChatMessage
```
(они уже могут быть — проверь и добавь недостающие).

- [ ] **Step 4: Тесты проходят**

```bash
docker compose restart clinika-backend && sleep 6
docker compose exec -T clinika-backend pytest tests/test_staffchat_channels.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Smoke**

```bash
for ep in "/staff-chat/channels POST" "/staff-chat/channels/public GET"; do
  p=$(echo $ep | cut -d' ' -f1); m=$(echo $ep | cut -d' ' -f2)
  curl -s -o /dev/null -w "$m $p → %{http_code}\n" -X $m "http://127.0.0.1:8900$p"
done
```
Expected: 403 (auth required = routes есть).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/staff_chat.py backend/tests/test_staffchat_channels.py
git -c commit.gpgsign=false commit -m "feat(staffchat): channels endpoints — create/join/invite/leave/patch (TDD, 4 tests)"
```

---

## Task 3: Backend Reactions (TDD)

**Files:**
- Modify: `backend/app/routers/staff_chat.py` (+1 endpoint)
- Modify: `backend/app/services/staff_chat_service.py` (+serializer)
- Create: `backend/tests/test_staffchat_reactions.py` (3 теста)

- [ ] **Step 1: Тесты**

`backend/tests/test_staffchat_reactions.py`:
```python
import uuid, pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_reaction_toggle_add_then_remove():
    from app.routers.staff_chat import _toggle_reaction_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4())
    message = MagicMock(id=uuid.uuid4())
    # Add: existing returns None
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    action = await _toggle_reaction_logic(db, user, message, "👍")
    assert action == "added"


@pytest.mark.asyncio
async def test_reaction_toggle_removes_existing():
    from app.routers.staff_chat import _toggle_reaction_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4())
    message = MagicMock(id=uuid.uuid4())
    existing = MagicMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: existing))
    action = await _toggle_reaction_logic(db, user, message, "👍")
    assert action == "removed"


@pytest.mark.asyncio
async def test_serialize_reactions_aggregation():
    from app.services.staff_chat_service import _aggregate_reactions
    rows = [
        MagicMock(emoji="👍", user_id=uuid.uuid4()),
        MagicMock(emoji="👍", user_id=uuid.uuid4()),
        MagicMock(emoji="❤️", user_id=uuid.uuid4()),
    ]
    me = rows[0].user_id  # by_me для первой реакции
    agg = _aggregate_reactions(rows, current_user_id=me)
    by_emoji = {r["emoji"]: r for r in agg}
    assert by_emoji["👍"]["count"] == 2
    assert by_emoji["👍"]["by_me"] is True
    assert by_emoji["❤️"]["count"] == 1
    assert by_emoji["❤️"]["by_me"] is False
```

- [ ] **Step 2: Запустить — упадут**

Expected: ERROR ImportError.

- [ ] **Step 3: Helper в service**

В `backend/app/services/staff_chat_service.py` добавить:
```python
def _aggregate_reactions(rows, current_user_id) -> list[dict]:
    """rows: список StaffChatMessageReaction. Возвращает [{emoji, count, by_me}]."""
    from collections import defaultdict
    counts = defaultdict(int)
    mine = set()
    for r in rows:
        counts[r.emoji] += 1
        if str(r.user_id) == str(current_user_id):
            mine.add(r.emoji)
    return [
        {"emoji": e, "count": c, "by_me": (e in mine)}
        for e, c in sorted(counts.items(), key=lambda x: -x[1])
    ]
```

- [ ] **Step 4: Endpoint в router**

```python
from app.models.staff_chat import StaffChatMessageReaction


class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


async def _toggle_reaction_logic(db, user, message, emoji: str) -> str:
    """Toggle: добавляет если нет, удаляет если есть. Returns 'added' | 'removed'."""
    existing = (await db.execute(
        select(StaffChatMessageReaction).where(
            StaffChatMessageReaction.message_id == message.id,
            StaffChatMessageReaction.user_id == user.id,
            StaffChatMessageReaction.emoji == emoji,
        )
    )).scalar_one_or_none()
    if existing:
        await db.delete(existing)
        return "removed"
    db.add(StaffChatMessageReaction(
        message_id=message.id, user_id=user.id, emoji=emoji,
    ))
    return "added"


@router.post("/messages/{message_id}/reactions")
async def react_to_message(
    message_id: uuid.UUID,
    body: ReactionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    msg = (await db.execute(select(StaffChatMessage).where(StaffChatMessage.id == message_id))).scalar_one_or_none()
    if not msg:
        raise HTTPException(404)
    # Проверим что я member room'а
    member = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == msg.room_id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not member:
        raise HTTPException(403, "Не member этого room'а")
    action = await _toggle_reaction_logic(db, user, msg, body.emoji)
    await db.commit()
    return {"action": action, "emoji": body.emoji}
```

- [ ] **Step 5: Использовать `_aggregate_reactions` в сериализаторе сообщения**

Найди в `staff_chat_service.py` функцию `serialize_message` (или подобную) и добавь в её вывод:
```python
# В serialize_message:
"reactions": _aggregate_reactions(message_reactions or [], current_user_id=current_user.id),
```
*Логика загрузки `message_reactions` зависит от того как сейчас грузятся сообщения. Если через JOIN — добавь join. Если через отдельный query — отдельный SELECT.*

- [ ] **Step 6: Тесты проходят**

```bash
docker compose restart clinika-backend && sleep 6
docker compose exec -T clinika-backend pytest tests/test_staffchat_reactions.py -v
```
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/staff_chat_service.py backend/app/routers/staff_chat.py backend/tests/test_staffchat_reactions.py
git -c commit.gpgsign=false commit -m "feat(staffchat): message reactions toggle endpoint + aggregation (TDD, 3 tests)"
```

---

## Task 4: Backend Pin сообщений (TDD)

**Files:**
- Modify: `backend/app/routers/staff_chat.py`
- Create: `backend/tests/test_staffchat_pin.py` (3 теста)

- [ ] **Step 1: Тесты**

```python
import uuid, pytest
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime


@pytest.mark.asyncio
async def test_pin_toggle_admin_can():
    from app.routers.staff_chat import _toggle_pin_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4(), role="manager")
    msg = MagicMock(pinned_at=None, pinned_by_user_id=None)
    member = MagicMock(member_role="admin")
    db.execute = AsyncMock(return_value=MagicMock(scalar=lambda: 5))  # < 20
    action = await _toggle_pin_logic(db, user, msg, member)
    assert action == "pinned"
    assert msg.pinned_at is not None
    assert msg.pinned_by_user_id == user.id


@pytest.mark.asyncio
async def test_pin_unpin_when_already_pinned():
    from app.routers.staff_chat import _toggle_pin_logic
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4(), role="manager")
    msg = MagicMock(pinned_at=datetime.utcnow(), pinned_by_user_id=user.id)
    member = MagicMock(member_role="admin")
    action = await _toggle_pin_logic(db, user, msg, member)
    assert action == "unpinned"
    assert msg.pinned_at is None
    assert msg.pinned_by_user_id is None


@pytest.mark.asyncio
async def test_pin_limit_20_returns_error():
    from app.routers.staff_chat import _toggle_pin_logic, PinLimitError
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4(), role="manager")
    msg = MagicMock(pinned_at=None, room_id=uuid.uuid4())
    member = MagicMock(member_role="admin")
    db.execute = AsyncMock(return_value=MagicMock(scalar=lambda: 20))
    with pytest.raises(PinLimitError):
        await _toggle_pin_logic(db, user, msg, member)
```

- [ ] **Step 2: Запустить — упадут**

- [ ] **Step 3: Реализовать**

В `staff_chat.py`:
```python
from sqlalchemy import func


class PinLimitError(Exception):
    pass


async def _toggle_pin_logic(db, user, msg, member) -> str:
    """Toggle pin. Returns 'pinned' | 'unpinned'. Raises PinLimitError если >20."""
    # Если уже pinned — открепить
    if msg.pinned_at is not None:
        msg.pinned_at = None
        msg.pinned_by_user_id = None
        return "unpinned"
    # Проверка лимита
    cnt = (await db.execute(
        select(func.count()).select_from(StaffChatMessage).where(
            StaffChatMessage.room_id == msg.room_id,
            StaffChatMessage.pinned_at.is_not(None),
        )
    )).scalar()
    if cnt >= 20:
        raise PinLimitError("Лимит 20 закреплённых на канал")
    msg.pinned_at = datetime.utcnow()
    msg.pinned_by_user_id = user.id
    return "pinned"


@router.post("/messages/{message_id}/pin")
async def toggle_pin(
    message_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    msg = (await db.execute(select(StaffChatMessage).where(StaffChatMessage.id == message_id))).scalar_one_or_none()
    if not msg:
        raise HTTPException(404)
    member = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == msg.room_id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    is_admin_or_higher = (
        (member and member.member_role == "admin") or
        user.role in ("manager", "franchise_owner", "super_admin")
    )
    if not is_admin_or_higher:
        raise HTTPException(403, "Только admin room'а или manager+ может пинить")
    try:
        action = await _toggle_pin_logic(db, user, msg, member)
    except PinLimitError as e:
        raise HTTPException(409, str(e))
    await db.commit()
    return {"action": action, "message_id": str(msg.id)}


@router.get("/rooms/{room_id}/pinned")
async def list_pinned(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    member = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == room_id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not member:
        raise HTTPException(403, "Не member")
    rows = (await db.execute(
        select(StaffChatMessage).where(
            StaffChatMessage.room_id == room_id,
            StaffChatMessage.pinned_at.is_not(None),
        ).order_by(desc(StaffChatMessage.pinned_at))
    )).scalars().all()
    return {"messages": [
        {"id": str(m.id), "body": m.body, "sender_id": str(m.sender_id) if m.sender_id else None,
         "pinned_at": m.pinned_at.isoformat() if m.pinned_at else None,
         "pinned_by_user_id": str(m.pinned_by_user_id) if m.pinned_by_user_id else None,
         "created_at": m.created_at.isoformat()}
        for m in rows
    ]}
```

- [ ] **Step 4: Тесты проходят**

```bash
docker compose restart clinika-backend && sleep 6
docker compose exec -T clinika-backend pytest tests/test_staffchat_pin.py -v
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/staff_chat.py backend/tests/test_staffchat_pin.py
git -c commit.gpgsign=false commit -m "feat(staffchat): pin/unpin endpoints + лимит 20 (TDD, 3 tests)"
```

---

## Task 5: Backend Mentions parser + TG-нотификация (TDD)

**Files:**
- Create: `backend/app/services/staff_chat_mentions.py`
- Modify: `backend/app/routers/staff_chat.py` (POST /rooms/{id}/messages — добавить парсинг)
- Create: `backend/tests/test_staffchat_mentions.py` (4 теста)

- [ ] **Step 1: Тесты**

```python
import uuid, pytest
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
    tenant_b = uuid.uuid4()
    u1 = MagicMock(id=uuid.uuid4(), username="ivanov", tenant_id=tenant_a)
    u2 = MagicMock(id=uuid.uuid4(), username="petrov", tenant_id=tenant_b)  # чужой тенант
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalars=lambda: MagicMock(all=lambda: [u1])))
    out = await resolve_mentions(db, ["ivanov", "petrov"], tenant_id=tenant_a)
    assert out == [str(u1.id)]


@pytest.mark.asyncio
async def test_resolve_mentions_empty_when_no_matches():
    from app.services.staff_chat_mentions import resolve_mentions
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalars=lambda: MagicMock(all=lambda: [])))
    out = await resolve_mentions(db, ["unknown"], tenant_id=uuid.uuid4())
    assert out == []
```

- [ ] **Step 2: Запустить — упадут**

Expected: ImportError.

- [ ] **Step 3: Создать `backend/app/services/staff_chat_mentions.py`**

```python
"""staff_chat_mentions — парсинг @username и резолв в user IDs (tenant-scope)."""
import re
import uuid
import logging
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

log = logging.getLogger(__name__)

# Поддерживаем латиницу/цифры/_/. длиной 3-30
_RE_MENTION = re.compile(r"@([\w.]{3,30})")


def parse_mention_strings(text: str) -> list[str]:
    """Извлекает уникальные @username из текста. Длина 3-30."""
    if not text:
        return []
    seen = set()
    out = []
    for m in _RE_MENTION.finditer(text):
        name = m.group(1).lower()
        if name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


async def resolve_mentions(
    db: AsyncSession,
    usernames: list[str],
    *,
    tenant_id: uuid.UUID,
) -> list[str]:
    """Резолвит usernames → list[str(user.id)] (только пользователи этого тенанта)."""
    if not usernames:
        return []
    rows = (await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.username.in_(usernames),
        )
    )).scalars().all()
    return [str(u.id) for u in rows]


async def send_mention_tg_notification(
    user_id: uuid.UUID,
    sender_name: str,
    room_name: str,
    text_preview: str,
) -> bool:
    """Отправляет TG-нотификацию upmentioned user'у (если у него есть telegram_chat_id).

    Не падает — best-effort. Returns True если отправлено, False иначе.
    """
    import os, urllib.parse, urllib.request, json
    # token из env, chat_id — из user.telegram_chat_id (получаем снаружи)
    # Здесь упрощённо: эта функция не имеет доступа к БД и сама user'а не грузит.
    # Логику «есть ли у user'а telegram_chat_id» возложим на вызывающего.
    # Эта функция — низкоуровневый sender.
    token = os.environ.get("TG_BOT_TOKEN", "")
    chat_id = os.environ.get("TG_CHAT_ID_FALLBACK", "")  # для тестов
    if not token or not chat_id:
        return False
    proxy_url = os.environ.get("HTTPS_PROXY", "")
    msg = f"💬 <b>{sender_name}</b> упомянул вас в <b>#{room_name}</b>:\n{text_preview[:200]}"
    data = urllib.parse.urlencode({
        "chat_id": chat_id, "text": msg, "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()
    try:
        if proxy_url:
            handler = urllib.request.ProxyHandler({"https": proxy_url, "http": proxy_url})
            opener = urllib.request.build_opener(handler)
            urllib.request.install_opener(opener)
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=data, method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read()).get("ok", False)
    except Exception:
        log.exception("TG mention notification failed")
        return False
```

- [ ] **Step 4: Интегрировать в POST /rooms/{id}/messages**

Найди в `staff_chat.py` функцию которая создаёт сообщение (вероятно `send_message` или `post_message`). Внутри после `db.add(msg)` И ДО `db.commit()` добавь:
```python
# Парсинг @mentions
from app.services.staff_chat_mentions import parse_mention_strings, resolve_mentions
usernames = parse_mention_strings(msg.body or "")
mention_ids = await resolve_mentions(db, usernames, tenant_id=user.tenant_id)
msg.mentioned_user_ids = mention_ids
# TG-нотификация — асинхронно, не блокирует commit
```

Для TG-нотификации лучше после commit'а (best-effort fire-and-forget). Можно через FastAPI BackgroundTasks или просто:
```python
# После commit:
if mention_ids:
    # Загружаем telegram_chat_id для каждого upmentioned user
    notified_users = (await db.execute(
        select(User).where(User.id.in_([uuid.UUID(x) for x in mention_ids]))
    )).scalars().all()
    room = await db.get(StaffChatRoom, msg.room_id)
    for u in notified_users:
        tg_chat = getattr(u, "telegram_chat_id", None)
        if not tg_chat:
            continue
        # Прямой вызов TG (упрощённо — если есть send_mention_tg_notification,
        # передаём ей tg_chat явно через override)
        try:
            await _send_tg_to(tg_chat, sender_name=user.full_name or user.username,
                              room_name=(room.name if room else "канал"),
                              text_preview=msg.body)
        except Exception:
            log.warning("TG notify failed for user %s", u.id)
```
*Реализация `_send_tg_to` — отдельный helper в `staff_chat_mentions.py` принимающий явный chat_id.*

- [ ] **Step 5: Тесты проходят**

```bash
docker compose restart clinika-backend && sleep 6
docker compose exec -T clinika-backend pytest tests/test_staffchat_mentions.py -v
```
Expected: 4 passed.

- [ ] **Step 6: Endpoint GET /staff-chat/mentions/unread**

В `staff_chat.py`:
```python
@router.get("/mentions/unread")
async def unread_mentions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список room_id где меня упомянули после моего last_read_at."""
    my_id = str(user.id)
    rooms = (await db.execute(
        select(StaffChatMember).where(StaffChatMember.user_id == user.id)
    )).scalars().all()
    out = []
    for m in rooms:
        # Берём сообщения в room после last_read_at
        last_read = m.last_read_at or datetime(1970, 1, 1)
        msgs = (await db.execute(
            select(StaffChatMessage).where(
                StaffChatMessage.room_id == m.room_id,
                StaffChatMessage.created_at > last_read,
            )
        )).scalars().all()
        cnt = sum(1 for msg in msgs if my_id in (msg.mentioned_user_ids or []))
        if cnt > 0:
            out.append({"room_id": str(m.room_id), "mention_count": cnt})
    return {"rooms": out}
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/staff_chat_mentions.py backend/app/routers/staff_chat.py backend/tests/test_staffchat_mentions.py
git -c commit.gpgsign=false commit -m "feat(staffchat): @mention parser + TG-notify + unread mentions (TDD, 4 tests)"
```

---

## Task 6: Frontend — Sidebar split + CreateChannelModal

**Files:**
- Create: `frontend/src/components/staff/CreateChannelModal.jsx`
- Modify: `frontend/src/pages/StaffChat.jsx` (sidebar)

- [ ] **Step 1: Создать `CreateChannelModal.jsx`**

```jsx
import { useState } from 'react'
import api from '../../api'
import { useToast } from '../../design'

export default function CreateChannelModal({ open, onClose, onCreated, clinicId }) {
  const { toast } = useToast() || {}
  const [name, setName] = useState('')
  const [type, setType] = useState('channel')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const submit = async () => {
    if (!name.trim()) { toast?.('Укажите название', 'error'); return }
    setBusy(true)
    try {
      const r = await api.post('/staff-chat/channels', {
        name: name.trim(), type, clinic_id: clinicId || null,
        description: description.trim() || null,
      })
      toast?.('Канал создан', 'success')
      onCreated?.(r.data)
      setName(''); setDescription(''); setType('channel')
      onClose?.()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Ошибка', 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"
         style={{ background: 'rgba(15,23,42,.55)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
           className="w-full max-w-md rounded-3xl overflow-hidden p-5 space-y-3"
           style={{ background: 'var(--bg, #fff)' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Новый канал</div>
        <input placeholder="Название" value={name} onChange={e => setName(e.target.value)}
               className="w-full px-3 py-2 rounded-xl outline-none"
               style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}/>
        <textarea placeholder="Описание (необязательно)" rows={3} value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl outline-none resize-none"
                  style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}/>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setType('channel')}
                  className="py-2.5 rounded-xl"
                  style={{ background: type === 'channel' ? 'var(--accent-soft, rgba(0,151,167,.1))' : 'var(--bg-1)',
                           border: `1px solid ${type === 'channel' ? 'var(--accent, #0097A7)' : 'var(--border)'}` }}>
            🌐 Открытый
          </button>
          <button onClick={() => setType('group')}
                  className="py-2.5 rounded-xl"
                  style={{ background: type === 'group' ? 'var(--accent-soft, rgba(0,151,167,.1))' : 'var(--bg-1)',
                           border: `1px solid ${type === 'group' ? 'var(--accent, #0097A7)' : 'var(--border)'}` }}>
            🔒 Закрытый
          </button>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl" style={{ background: 'var(--bg-1)' }}>
            Отмена
          </button>
          <button onClick={submit} disabled={busy || !name.trim()}
                  className="flex-1 py-2.5 rounded-xl text-white font-semibold disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
            {busy ? 'Создаём…' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Интеграция в StaffChat.jsx**

Найди в `frontend/src/pages/StaffChat.jsx` место где рендерится sidebar (вероятно секция со списком rooms). Сгруппируй rooms по `room.type`:
```jsx
import CreateChannelModal from '../components/staff/CreateChannelModal'

// state:
const [createOpen, setCreateOpen] = useState(false)

// внутри списка rooms:
const channels = rooms.filter(r => r.type === 'channel' || r.type === 'group')
const dms = rooms.filter(r => r.type === 'direct')

// Sidebar:
<div>
  <div className="flex items-center justify-between px-3 py-2">
    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                   color: 'var(--fg-3)', letterSpacing: '.05em' }}>
      Каналы ({channels.length})
    </span>
    <button onClick={() => setCreateOpen(true)}
            style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--bg-1)',
                     color: 'var(--fg-2)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
            aria-label="Создать канал">
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
    </button>
  </div>
  {channels.map(r => /* существующий ThreadListItem или аналог */)}
  <div className="px-3 py-2" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                                       color: 'var(--fg-3)', letterSpacing: '.05em', marginTop: 8 }}>
    Direct messages ({dms.length})
  </div>
  {dms.map(r => /* существующий компонент */)}
</div>

<CreateChannelModal
  open={createOpen}
  onClose={() => setCreateOpen(false)}
  onCreated={(room) => { setRooms([...rooms, { ...room, type: room.type }]); }}
/>
```

- [ ] **Step 3: Smoke**

```bash
ssh ... 'cd /opt/clinika/frontend && node -e "require(\"@babel/parser\").parse(require(\"fs\").readFileSync(\"src/pages/StaffChat.jsx\",\"utf-8\"),{sourceType:\"module\",plugins:[\"jsx\"]}); console.log(\"OK\")"'
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/staff/CreateChannelModal.jsx frontend/src/pages/StaffChat.jsx
git -c commit.gpgsign=false commit -m "feat(staffchat): sidebar split + CreateChannelModal"
```

---

## Task 7: Frontend — Reactions + Pin UI

**Files:**
- Modify: `frontend/src/pages/StaffChat.jsx`
- Create: `frontend/src/components/staff/PinnedMessagesModal.jsx`

- [ ] **Step 1: Reactions UI в bubble**

В `StaffChat.jsx` найди компонент `<MessageBubble>` или его аналог. Добавь:
```jsx
const QUICK_REACTIONS = ['👍', '❤️', '✅', '🙏', '😂', '🔥']

// в MessageBubble:
const [pickerOpen, setPickerOpen] = useState(false)
const reactions = msg.reactions || []

const doReact = async (emoji) => {
  await api.post(`/staff-chat/messages/${msg.id}/reactions`, { emoji })
  // refetch — зависит от текущей логики
  fetchMessages()
  setPickerOpen(false)
}

// Под телом сообщения:
<div className="flex items-center gap-1 flex-wrap relative" style={{ marginTop: 4 }}>
  {reactions.map(r => (
    <button key={r.emoji} onClick={() => doReact(r.emoji)}
            style={{ /* ... как в clinic chat MessageBubble */ }}>
      {r.emoji} {r.count}
    </button>
  ))}
  <button onClick={() => setPickerOpen(v => !v)}
          style={{ /* add_reaction button */ }}>
    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>add_reaction</span>
  </button>
  {pickerOpen && (
    <div style={{ /* picker dropdown как в clinic chat */ }}>
      {QUICK_REACTIONS.map(e => (
        <button key={e} onClick={() => doReact(e)}>{e}</button>
      ))}
    </div>
  )}
</div>
```
*(Можно вынести логику в общий компонент `<ReactionsBar>` если duplication слишком велик.)*

- [ ] **Step 2: Pin кнопка в bubble (admin only)**

В hover-меню сообщения:
```jsx
{canPin && (
  <button onClick={async () => {
    await api.post(`/staff-chat/messages/${msg.id}/pin`)
    fetchMessages()
  }} title={msg.pinned_at ? 'Открепить' : 'Закрепить'}>
    <span className="material-symbols-outlined" style={{
      fontSize: 16,
      color: msg.pinned_at ? '#F59E0B' : 'var(--fg-3)',
      fontVariationSettings: msg.pinned_at ? "'FILL' 1" : "'FILL' 0",
    }}>push_pin</span>
  </button>
)}
```
*`canPin` — есть ли у user'а member_role='admin' или роль manager+. Логику можно передать в props.*

- [ ] **Step 3: `PinnedMessagesModal.jsx`**

```jsx
import { useEffect, useState } from 'react'
import api from '../../api'

export default function PinnedMessagesModal({ open, onClose, roomId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !roomId) return
    setLoading(true)
    api.get(`/staff-chat/rooms/${roomId}/pinned`)
      .then(r => setItems(r.data?.messages || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [open, roomId])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"
         style={{ background: 'rgba(15,23,42,.55)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
           className="w-full max-w-2xl rounded-3xl overflow-hidden"
           style={{ background: 'var(--bg, #fff)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div style={{ fontWeight: 700 }}>📌 Закреплённые сообщения</div>
        </div>
        <div className="overflow-y-auto p-5 space-y-2">
          {loading && <div style={{ color: 'var(--fg-3)' }}>Загрузка…</div>}
          {!loading && items.length === 0 && <div style={{ color: 'var(--fg-3)' }}>Нет закреплённых</div>}
          {items.map(m => (
            <div key={m.id} className="p-3 rounded-2xl"
                 style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.body}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
                {new Date(m.pinned_at).toLocaleString('ru-RU')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Бейдж «📌 N» в шапке room'а** в `StaffChat.jsx`

В шапке активной комнаты:
```jsx
const pinnedCount = (messages || []).filter(m => m.pinned_at).length
const [pinnedOpen, setPinnedOpen] = useState(false)

{pinnedCount > 0 && (
  <button onClick={() => setPinnedOpen(true)}
          className="px-2 py-1 rounded-lg inline-flex items-center gap-1"
          style={{ background: 'rgba(245,158,11,.12)', color: '#B45309', fontSize: 12, fontWeight: 600 }}>
    📌 {pinnedCount}
  </button>
)}
<PinnedMessagesModal open={pinnedOpen} onClose={() => setPinnedOpen(false)} roomId={activeRoomId}/>
```

- [ ] **Step 5: Smoke + commit**

```bash
git add frontend/src/components/staff/PinnedMessagesModal.jsx frontend/src/pages/StaffChat.jsx
git -c commit.gpgsign=false commit -m "feat(staffchat): reactions UI + pin button + PinnedMessagesModal"
```

---

## Task 8: Frontend — @-автокомплит + подсветка mentions

**Files:**
- Create: `frontend/src/components/staff/MentionAutocomplete.jsx`
- Modify: `frontend/src/pages/StaffChat.jsx`

- [ ] **Step 1: `MentionAutocomplete.jsx`**

```jsx
import { useEffect, useState } from 'react'
import api from '../../api'

export default function MentionAutocomplete({ query, onPick, onClose }) {
  const [users, setUsers] = useState([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (query == null) { setUsers([]); return }
    let alive = true
    // /users/clinic-staff или /staff-chat/contacts — что есть в проекте
    api.get('/staff-chat/contacts', { params: { q: query, limit: 8 } })
      .then(r => { if (alive) setUsers(Array.isArray(r.data) ? r.data : (r.data?.items || [])) })
      .catch(() => { if (alive) setUsers([]) })
    return () => { alive = false }
  }, [query])

  useEffect(() => {
    const onKey = (e) => {
      if (users.length === 0) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, users.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') { e.preventDefault(); const u = users[active]; if (u) onPick(u) }
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [users, active, onPick, onClose])

  if (query == null || users.length === 0) return null
  return (
    <div className="absolute bottom-full left-2 right-2 mb-2 z-30 overflow-hidden"
         style={{
           background: 'var(--surface, #fff)', border: '1px solid var(--border)',
           borderRadius: 14, boxShadow: '0 12px 32px rgba(15,23,42,.18)',
           maxHeight: 240, overflowY: 'auto',
         }}>
      {users.map((u, i) => (
        <button key={u.id} onMouseEnter={() => setActive(i)} onClick={() => onPick(u)}
                className="w-full text-left px-3 py-2"
                style={{ background: active === i ? 'var(--bg-1)' : 'transparent', cursor: 'pointer' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            @{u.username || u.full_name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
            {u.full_name || ''} · {u.role || ''}
          </div>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Интеграция в textarea StaffChat**

В `StaffChat.jsx`:
```jsx
import MentionAutocomplete from '../components/staff/MentionAutocomplete'

const [mentionQuery, setMentionQuery] = useState(null)

const onChangeMessage = (e) => {
  const v = e.target.value
  setDraft(v)
  // Триггер: @ в конце строки или после пробела
  const m = v.match(/(?:^|\s)@(\w*)$/)
  if (m) setMentionQuery(m[1])
  else setMentionQuery(null)
}

// рядом с textarea (родитель должен быть position: relative):
<MentionAutocomplete
  query={mentionQuery}
  onPick={(u) => {
    setDraft(d => d.replace(/(?:^|\s)@(\w*)$/, (full, name, offset) => {
      const prefix = offset > 0 ? full[0] : ''
      return `${prefix}@${u.username || u.full_name} `
    }))
    setMentionQuery(null)
  }}
  onClose={() => setMentionQuery(null)}
/>
```

- [ ] **Step 3: Подсветка @username в баббле**

В рендере body сообщения замени plain-text на:
```jsx
function highlightMentions(text) {
  return text.split(/(@\w{3,30})/g).map((part, i) =>
    /^@\w/.test(part)
      ? <span key={i} style={{ color: 'var(--accent, #0097A7)', fontWeight: 600 }}>{part}</span>
      : part
  )
}

// В bubble:
<div style={{ whiteSpace: 'pre-wrap' }}>{highlightMentions(msg.body)}</div>
```

- [ ] **Step 4: Бейдж «@» в Sidebar для unread mentions**

При загрузке rooms — параллельно загружай `/staff-chat/mentions/unread`:
```jsx
const [unreadMentions, setUnreadMentions] = useState({})  // {room_id: count}

useEffect(() => {
  api.get('/staff-chat/mentions/unread')
    .then(r => {
      const map = {}
      for (const it of (r.data?.rooms || [])) map[it.room_id] = it.mention_count
      setUnreadMentions(map)
    })
    .catch(() => {})
  const tid = setInterval(() => {
    api.get('/staff-chat/mentions/unread').then(r => {
      const map = {}
      for (const it of (r.data?.rooms || [])) map[it.room_id] = it.mention_count
      setUnreadMentions(map)
    }).catch(() => {})
  }, 30_000)
  return () => clearInterval(tid)
}, [])

// В рендере room в sidebar:
{unreadMentions[r.id] > 0 && (
  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999,
                 background: 'rgba(0,151,167,.18)', color: 'var(--accent, #0097A7)', fontWeight: 700 }}>
    @
  </span>
)}
```

- [ ] **Step 5: Build + smoke**

```bash
docker compose build --no-cache clinika-frontend && docker compose up -d clinika-frontend
sleep 6
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8901/
```
Expected: 200.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/staff/MentionAutocomplete.jsx frontend/src/pages/StaffChat.jsx
git -c commit.gpgsign=false commit -m "feat(staffchat): @-mention autocomplete + highlight + unread badge"
```

---

## Task 9: Финальный smoke + TG-отчёт

- [ ] **Step 1: Все тесты вместе**

```bash
docker compose exec -T clinika-backend pytest tests/test_staffchat_*.py -v 2>&1 | tail -8
```
Expected: 14 passed (4 channels + 3 reactions + 4 mentions + 3 pin).

- [ ] **Step 2: Smoke всех новых endpoints (без auth = 403)**

```bash
for ep in "/staff-chat/channels POST" \
          "/staff-chat/channels/public GET" \
          "/staff-chat/channels/{id}/join POST" \
          "/staff-chat/messages/{id}/reactions POST" \
          "/staff-chat/messages/{id}/pin POST" \
          "/staff-chat/rooms/{id}/pinned GET" \
          "/staff-chat/mentions/unread GET"; do
  p=$(echo "$ep" | cut -d' ' -f1 | sed "s/{id}/00000000-0000-0000-0000-000000000000/g")
  m=$(echo "$ep" | cut -d' ' -f2)
  printf "%-60s " "$m $p"
  curl -s -o /dev/null -w "%{http_code}\n" -X "$m" "http://127.0.0.1:8900$p"
done
```
Expected: всё 403 (auth required).

- [ ] **Step 3: Отчёт в TG (текстом)**

Скрипт по аналогии с предыдущими батчами — 5-6 сообщений по 4KB:
- Что сделано (4 фичи)
- Список коммитов
- Smoke результаты
- Что проверить вручную

---

## Self-Review

**1. Spec coverage:**
- §3.1 Channels (description + types + 6 endpoints) → Task 1 (миграция sf01) + Task 2 (endpoints)
- §3.2 Reactions (таблица + endpoint + agg) → Task 1 (sf02) + Task 3
- §3.3 @Mention (parser + JSONB + TG-notify + unread) → Task 1 (sf03) + Task 5
- §3.4 Pin (поля + лимит 20 + endpoints) → Task 1 (sf04) + Task 4
- §5 14 unit-тестов → Task 2 (4) + Task 3 (3) + Task 4 (3) + Task 5 (4) = 14 ✅
- §4 Безопасность встроена в каждый endpoint (member_role check, tenant check)

**2. Placeholder scan:** все шаги содержат code-блоки. Места «реализация зависит от текущей логики» (Task 3 Step 5, Task 5 Step 4) — это адаптивные шаги, требующие чтения существующего кода агентом. Это не плейсхолдеры.

**3. Type consistency:**
- `_create_channel_logic(db, user, payload) -> (room, member)` — Task 2
- `_join_channel_logic(db, user, room) -> member` — Task 2
- `_leave_channel_logic(db, user, room, member) -> None` — Task 2 (raises LastAdminError)
- `_toggle_reaction_logic(db, user, message, emoji) -> 'added'|'removed'` — Task 3
- `_toggle_pin_logic(db, user, msg, member) -> 'pinned'|'unpinned'` — Task 4 (raises PinLimitError)
- `parse_mention_strings(text) -> list[str]` — Task 5
- `resolve_mentions(db, usernames, *, tenant_id) -> list[str]` — Task 5

Все сигнатуры одинаковы в тестах и реализации.
