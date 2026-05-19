"""
Сервис для чата сотрудник↔сотрудник.

Содержит:
  - visible_users_for(user) — RBAC: каких пользователей видит данный
  - user_room_ids(user) — список room_id где пользователь состоит
  - get_or_create_direct_room(a, b) — создать/найти 1-1 комнату между двумя
  - ensure_member(room, user) — проверка членства
  - serialize_room, serialize_message, serialize_user_brief
  - send_message(room, sender, body, attachments) — добавить + обновить last_message_at
  - mark_read(room, user) — установить last_read_at

RBAC видимости:
  super_admin / franchise_owner / admin / manager / recruiter → все в тенанте
  doctor → свои клиники (DoctorClinicAccess) + менеджеры/админы тенанта
  reg / nurse / partner_doctor / visiting_doctor → своя(и) клиника(и)
  patient → запрещено

Inter-clinic чат: только в рамках одного tenant_id (изоляция).
"""
import uuid
from datetime import datetime
from typing import Optional, Sequence

from sqlalchemy import select, and_, or_, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole
from app.models.clinic import Clinic
from app.models.staff_chat import (
    StaffChatRoom, StaffChatMember, StaffChatMessage, StaffChatMessageReaction,
    ROOM_TYPE_DIRECT, ROOM_TYPE_CLINIC, ROOM_TYPE_GROUP, ROOM_TYPE_BROADCAST,
)


# ── RBAC: какие clinic_id видит пользователь ──────────────────────────────────
async def user_clinic_ids(db: AsyncSession, user: User) -> list[uuid.UUID]:
    """Возвращает список clinic_id, доступных пользователю в рамках его тенанта.

    super_admin без tenant → все клиники глобально.
    Иначе ограничено tenant_id пользователя.
    """
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    # Глобальный super_admin без tenant — видит все клиники
    if role == "super_admin" and not user.tenant_id:
        r = await db.execute(select(Clinic.id))
        return [row[0] for row in r.all()]
    # Роли с tenant-wide доступом
    if role in ("super_admin", "franchise_owner", "admin", "manager", "recruiter"):
        if not user.tenant_id:
            return []
        r = await db.execute(
            select(Clinic.id).where(Clinic.tenant_id == user.tenant_id)
        )
        return [row[0] for row in r.all()]
    # Doctor — через DoctorClinicAccess
    if role == "doctor":
        try:
            from app.models.doctor_clinic_access import DoctorClinicAccess
            r = await db.execute(
                select(DoctorClinicAccess.clinic_id).where(
                    DoctorClinicAccess.doctor_id == user.id,
                )
            )
            ids = [row[0] for row in r.all()]
            if ids:
                return ids
        except Exception:
            pass
        if getattr(user, "clinic_id", None):
            return [user.clinic_id]
        return []
    # Все остальные — только своя клиника
    if getattr(user, "clinic_id", None):
        return [user.clinic_id]
    return []


# ── RBAC: каких пользователей видит данный ────────────────────────────────────
async def _user_franchise_id(db: AsyncSession, user: User):
    """franchise_id тенанта пользователя или None."""
    if not user.tenant_id:
        return None
    from app.models.tenant import Tenant
    t = (await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    return getattr(t, "franchise_id", None) if t else None


async def visible_users_for(
    db: AsyncSession, user: User
) -> Sequence[User]:
    """
    Возвращает список пользователей, с которыми данный сотрудник может
    начать чат.

    Видимость:
      - super_admin / franchise_owner с franchise_id → все юзеры всех клиник
        своей франшизы (cross-tenant). Без franchise_id → весь свой тенант.
      - admin / manager / recruiter → все в своём тенанте + админы франшизы
        (super_admin / franchise_owner) из любых клиник той же франшизы.
      - doctor / reg / nurse / partner_doctor / visiting_doctor → свои
        клиники + tenant-wide роли своего тенанта + админы франшизы (другие
        клиники). Без клиники — никого.
    """
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role == "patient":
        return []

    from app.models.tenant import Tenant

    base_conds = [
        User.id != user.id,
        User.role != UserRole.PATIENT,
        getattr(User, "is_active", User.id == User.id),
    ]

    my_franchise_id = await _user_franchise_id(db, user)
    franchise_tenant_subq = None
    if my_franchise_id:
        franchise_tenant_subq = select(Tenant.id).where(Tenant.franchise_id == my_franchise_id)

    franchise_admin_roles = (UserRole.SUPER_ADMIN, UserRole.FRANCHISE_OWNER)

    # ── super_admin / franchise_owner ─────────────────────────────────────────
    if role in ("super_admin", "franchise_owner"):
        if franchise_tenant_subq is not None:
            r = await db.execute(select(User).where(and_(*base_conds, User.tenant_id.in_(franchise_tenant_subq))))
            return r.scalars().all()
        if user.tenant_id:
            r = await db.execute(select(User).where(and_(*base_conds, User.tenant_id == user.tenant_id)))
            return r.scalars().all()
        if role == "super_admin":
            r = await db.execute(select(User).where(and_(*base_conds)))
            return r.scalars().all()
        return []

    # Дальше — обязателен tenant_id у самого юзера.
    if not user.tenant_id:
        return []

    base_conds_t = base_conds + [User.tenant_id == user.tenant_id]

    async def _add_franchise_admins(acc: list[User]):
        """Добавляет в acc super_admin/franchise_owner других клиник франшизы."""
        if franchise_tenant_subq is None:
            return
        q = select(User).where(and_(
            *base_conds,
            User.tenant_id.in_(franchise_tenant_subq),
            User.tenant_id != user.tenant_id,
            User.role.in_(franchise_admin_roles),
        ))
        acc.extend((await db.execute(q)).scalars().all())

    # ── admin / manager / recruiter ───────────────────────────────────────────
    if role in ("admin", "manager", "recruiter"):
        results = list((await db.execute(select(User).where(and_(*base_conds_t)))).scalars().all())
        await _add_franchise_admins(results)
        return _dedup_by_id(results)

    # ── doctor / reg / nurse / partner_doctor / visiting_doctor ───────────────
    own_clinics = await user_clinic_ids(db, user)
    if not own_clinics:
        return []

    tenant_wide_roles = (
        UserRole.SUPER_ADMIN, UserRole.FRANCHISE_OWNER,
        UserRole.MANAGER, UserRole.RECRUITER,
    )

    same_clinic_user_ids: set[uuid.UUID] = set()
    r = await db.execute(select(User.id).where(and_(*base_conds_t, User.clinic_id.in_(own_clinics))))
    same_clinic_user_ids.update(row[0] for row in r.all())
    try:
        from app.models.doctor_clinic_access import DoctorClinicAccess
        r = await db.execute(select(DoctorClinicAccess.doctor_id).where(DoctorClinicAccess.clinic_id.in_(own_clinics)))
        same_clinic_user_ids.update(row[0] for row in r.all())
    except Exception:
        pass

    cond = or_(
        User.id.in_(same_clinic_user_ids) if same_clinic_user_ids else (User.id == None),  # noqa: E711
        User.role.in_(tenant_wide_roles),
    )
    results = list((await db.execute(select(User).where(and_(*base_conds_t, cond)))).scalars().all())
    await _add_franchise_admins(results)
    return _dedup_by_id(results)


def _dedup_by_id(users: list[User]) -> list[User]:
    seen: set[uuid.UUID] = set()
    out: list[User] = []
    for u in users:
        if u.id in seen:
            continue
        seen.add(u.id)
        out.append(u)
    return out


# ── Membership + queries ──────────────────────────────────────────────────────
async def user_room_ids(db: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    r = await db.execute(
        select(StaffChatMember.room_id).where(StaffChatMember.user_id == user_id)
    )
    return [row[0] for row in r.all()]


async def get_room(db: AsyncSession, room_id: uuid.UUID) -> StaffChatRoom | None:
    r = await db.execute(select(StaffChatRoom).where(StaffChatRoom.id == room_id))
    return r.scalar_one_or_none()


async def is_member(db: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    r = await db.execute(
        select(func.count()).select_from(StaffChatMember).where(and_(
            StaffChatMember.room_id == room_id,
            StaffChatMember.user_id == user_id,
        ))
    )
    return (r.scalar() or 0) > 0


async def list_room_members(db: AsyncSession, room_id: uuid.UUID) -> list[StaffChatMember]:
    r = await db.execute(
        select(StaffChatMember).where(StaffChatMember.room_id == room_id)
    )
    return list(r.scalars().all())


async def get_or_create_direct_room(
    db: AsyncSession, user_a: User, user_b: User
) -> StaffChatRoom:
    """Находит или создаёт 1-1 direct-комнату между двумя пользователями.

    Tenant: одинаковый — same-tenant DM. Разный — допустим, если оба в одной
    франшизе и хотя бы один из них super_admin/franchise_owner (cross-tenant
    DM админа сети с сотрудником конкретной клиники).
    """
    if user_a.id == user_b.id:
        raise ValueError("cannot create direct chat with self")

    same_tenant = (user_a.tenant_id == user_b.tenant_id)
    if not same_tenant:
        # Cross-tenant DM: проверяем франшизу и роль admin'а
        fa = await _user_franchise_id(db, user_a)
        fb = await _user_franchise_id(db, user_b)
        if not fa or fa != fb:
            raise ValueError("inter-tenant direct chat allowed only within same franchise")
        admin_roles = (UserRole.SUPER_ADMIN, UserRole.FRANCHISE_OWNER)
        if user_a.role not in admin_roles and user_b.role not in admin_roles:
            raise ValueError("inter-tenant direct chat requires franchise admin participant")

    tenant_id = user_a.tenant_id or user_b.tenant_id
    if tenant_id is None:
        raise ValueError("both users must have tenant_id")
    # Ищем существующую direct-комнату с этими двумя
    subq = (
        select(StaffChatMember.room_id)
        .where(StaffChatMember.user_id.in_([user_a.id, user_b.id]))
        .group_by(StaffChatMember.room_id)
        .having(func.count(StaffChatMember.user_id) == 2)
    )
    r = await db.execute(
        select(StaffChatRoom).where(and_(
            StaffChatRoom.id.in_(subq),
            StaffChatRoom.type == ROOM_TYPE_DIRECT,
        ))
    )
    existing = r.scalars().first()
    if existing:
        return existing
    # Создаём
    room = StaffChatRoom(
        tenant_id=tenant_id,
        type=ROOM_TYPE_DIRECT,
        name=None,
        created_by_id=user_a.id,
    )
    db.add(room)
    await db.flush()
    db.add(StaffChatMember(room_id=room.id, user_id=user_a.id, member_role="admin"))
    db.add(StaffChatMember(room_id=room.id, user_id=user_b.id, member_role="member"))
    await db.flush()
    return room


# ── Send / read ───────────────────────────────────────────────────────────────
async def send_message(
    db: AsyncSession,
    room: StaffChatRoom,
    sender: User,
    body: str,
    attachments: list[dict] | None = None,
    reply_to_id: uuid.UUID | None = None,
) -> StaffChatMessage:
    body_trimmed = (body or "").strip()
    if not body_trimmed and not attachments:
        raise ValueError("empty message")
    msg = StaffChatMessage(
        room_id=room.id,
        sender_id=sender.id,
        body=body_trimmed,
        attachments=attachments or None,
        reply_to_id=reply_to_id,
    )
    db.add(msg)
    room.last_message_at = datetime.utcnow()
    await db.flush()
    # Автоматически помечаем прочитанным для отправителя
    await db.execute(
        update(StaffChatMember)
        .where(and_(
            StaffChatMember.room_id == room.id,
            StaffChatMember.user_id == sender.id,
        ))
        .values(last_read_at=msg.created_at)
    )
    return msg


async def mark_read(
    db: AsyncSession,
    room: StaffChatRoom,
    user: User,
    until: datetime | None = None,
) -> None:
    await db.execute(
        update(StaffChatMember)
        .where(and_(
            StaffChatMember.room_id == room.id,
            StaffChatMember.user_id == user.id,
        ))
        .values(last_read_at=until or datetime.utcnow())
    )


async def list_messages(
    db: AsyncSession,
    room_id: uuid.UUID,
    before: datetime | None = None,
    limit: int = 50,
) -> list[StaffChatMessage]:
    q = select(StaffChatMessage).where(StaffChatMessage.room_id == room_id)
    if before:
        q = q.where(StaffChatMessage.created_at < before)
    q = q.order_by(StaffChatMessage.created_at.desc()).limit(min(max(limit, 1), 200))
    r = await db.execute(q)
    return list(r.scalars().all())


async def last_message(
    db: AsyncSession, room_id: uuid.UUID
) -> StaffChatMessage | None:
    r = await db.execute(
        select(StaffChatMessage)
        .where(StaffChatMessage.room_id == room_id)
        .order_by(StaffChatMessage.created_at.desc())
        .limit(1)
    )
    return r.scalar_one_or_none()


async def count_unread(
    db: AsyncSession,
    room_id: uuid.UUID,
    user_id: uuid.UUID,
    last_read_at: datetime | None,
) -> int:
    q = select(func.count()).select_from(StaffChatMessage).where(and_(
        StaffChatMessage.room_id == room_id,
        StaffChatMessage.sender_id != user_id,
    ))
    if last_read_at:
        q = q.where(StaffChatMessage.created_at > last_read_at)
    r = await db.execute(q)
    return int(r.scalar() or 0)


# ── Serialization ─────────────────────────────────────────────────────────────
def serialize_user_brief(u: User) -> dict:
    role_val = u.role.value if hasattr(u.role, "value") else str(u.role)
    return {
        "id": str(u.id),
        "name": (getattr(u, "full_name", None) or u.email or u.username or "Сотрудник").strip(),
        "role": role_val,
        "clinic_id": str(u.clinic_id) if getattr(u, "clinic_id", None) else None,
        "avatar_url": getattr(u, "avatar_url", None),
    }


def _aggregate_reactions(rows, current_user_id) -> list[dict]:
    """Агрегирует список StaffChatMessageReaction → [{emoji, count, by_me}].

    rows: iterable объектов с полями .emoji и .user_id.
    Сортировка: по count DESC (популярные сверху), затем emoji asc.
    """
    from collections import defaultdict
    counts: dict[str, int] = defaultdict(int)
    mine: set[str] = set()
    cur = str(current_user_id) if current_user_id else None
    for r in rows:
        counts[r.emoji] += 1
        if cur and str(r.user_id) == cur:
            mine.add(r.emoji)
    return [
        {"emoji": e, "count": c, "by_me": (e in mine)}
        for e, c in sorted(counts.items(), key=lambda x: (-x[1], x[0]))
    ]


def serialize_message(
    m: StaffChatMessage,
    *,
    reactions: list | None = None,
    current_user_id: uuid.UUID | None = None,
) -> dict:
    """Сериализатор сообщения.

    Backward-compat: при вызове без kwargs reactions/mentions/pin поля
    добавляются с дефолтами ([]/None), что не ломает существующие clients.

    reactions: список StaffChatMessageReaction (или None — тогда вернётся [])
    current_user_id: для расчёта by_me в reactions
    """
    return {
        "id": str(m.id),
        "room_id": str(m.room_id),
        "sender_id": str(m.sender_id) if m.sender_id else None,
        "body": m.body,
        "attachments": m.attachments,
        "reply_to_id": str(m.reply_to_id) if m.reply_to_id else None,
        "edited_at": m.edited_at.isoformat() if m.edited_at else None,
        "deleted_at": m.deleted_at.isoformat() if m.deleted_at else None,
        "created_at": m.created_at.isoformat(),
        # Slack-fundament поля:
        "reactions": _aggregate_reactions(reactions or [], current_user_id),
        "mentioned_user_ids": list(getattr(m, "mentioned_user_ids", None) or []),
        "pinned_at": m.pinned_at.isoformat() if getattr(m, "pinned_at", None) else None,
        "pinned_by_user_id": str(m.pinned_by_user_id) if getattr(m, "pinned_by_user_id", None) else None,
    }


async def load_reactions_for_messages(
    db: AsyncSession, message_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[StaffChatMessageReaction]]:
    """Грузит реакции для списка сообщений батчем. Returns {message_id: [reactions]}."""
    if not message_ids:
        return {}
    r = await db.execute(
        select(StaffChatMessageReaction).where(
            StaffChatMessageReaction.message_id.in_(message_ids),
        )
    )
    out: dict[uuid.UUID, list[StaffChatMessageReaction]] = {}
    for row in r.scalars().all():
        out.setdefault(row.message_id, []).append(row)
    return out


def serialize_room(
    r: StaffChatRoom,
    *,
    members: list[StaffChatMember] | None = None,
    member_users: dict[uuid.UUID, User] | None = None,
    last_msg: StaffChatMessage | None = None,
    unread: int = 0,
    title_override: str | None = None,
) -> dict:
    members_list = []
    if members and member_users is not None:
        for m in members:
            u = member_users.get(m.user_id)
            if not u:
                continue
            d = serialize_user_brief(u)
            d["member_role"] = m.member_role
            d["last_read_at"] = m.last_read_at.isoformat() if m.last_read_at else None
            d["muted"] = bool(m.muted)
            members_list.append(d)
    return {
        "id": str(r.id),
        "tenant_id": str(r.tenant_id),
        "type": r.type,
        "name": title_override or r.name,
        "clinic_id": str(r.clinic_id) if r.clinic_id else None,
        "created_at": r.created_at.isoformat(),
        "last_message_at": r.last_message_at.isoformat() if r.last_message_at else None,
        "members": members_list,
        "last_message": serialize_message(last_msg) if last_msg else None,
        "unread": unread,
    }


# ── Global search ─────────────────────────────────────────────────────────────
async def search_messages_logic(
    db: AsyncSession,
    user: User,
    q: str,
    limit: int = 50,
) -> list[dict]:
    """ILIKE-поиск по `body` среди сообщений в room'ах, где user — member.

    Возвращает список dict'ов, отсортированный по created_at DESC.
    """
    q_stripped = (q or "").strip()
    if len(q_stripped) < 2:
        return []
    rooms = await user_room_ids(db, user.id)
    if not rooms:
        return []
    safe_limit = min(max(limit, 1), 200)
    like_pattern = f"%{q_stripped}%"
    res = await db.execute(
        select(StaffChatMessage, StaffChatRoom)
        .join(StaffChatRoom, StaffChatRoom.id == StaffChatMessage.room_id)
        .where(and_(
            StaffChatMessage.room_id.in_(rooms),
            StaffChatMessage.body.ilike(like_pattern),
            StaffChatMessage.deleted_at.is_(None),
        ))
        .order_by(StaffChatMessage.created_at.desc())
        .limit(safe_limit)
    )
    out: list[dict] = []
    for msg, room in res.all():
        body = msg.body or ""
        snippet = body if len(body) <= 240 else body[:240] + "…"
        out.append({
            "message_id": str(msg.id),
            "room_id": str(msg.room_id),
            "room_name": room.name,
            "body_snippet": snippet,
            "created_at": msg.created_at.isoformat(),
            "sender_id": str(msg.sender_id) if msg.sender_id else None,
        })
    return out


# ── Polls serialization ───────────────────────────────────────────────────────
async def serialize_poll_for_message(
    db: AsyncSession,
    message_id: uuid.UUID,
    *,
    current_user_id: uuid.UUID | None = None,
) -> dict | None:
    """Если у сообщения есть связанный опрос — возвращает его сериализованным.

    Шейп:
        {id, question, options: [{text, votes, by_me}], multi_select,
         closes_at, total_votes}
    """
    from app.models.staff_chat import StaffChatPoll
    r = await db.execute(
        select(StaffChatPoll).where(StaffChatPoll.message_id == message_id)
    )
    poll = r.scalar_one_or_none()
    if not poll:
        return None
    return await _serialize_poll_obj(db, poll, current_user_id=current_user_id)


async def _serialize_poll_obj(
    db: AsyncSession,
    poll,  # StaffChatPoll
    *,
    current_user_id: uuid.UUID | None = None,
) -> dict:
    from app.models.staff_chat import StaffChatPollVote
    r = await db.execute(
        select(StaffChatPollVote).where(StaffChatPollVote.poll_id == poll.id)
    )
    votes = list(r.scalars().all())
    my_indices: set[int] = set()
    counts: dict[int, int] = {}
    cur = str(current_user_id) if current_user_id else None
    for v in votes:
        counts[v.option_index] = counts.get(v.option_index, 0) + 1
        if cur and str(v.user_id) == cur:
            my_indices.add(v.option_index)
    options_out = []
    for idx, text in enumerate(poll.options or []):
        options_out.append({
            "text": text,
            "votes": counts.get(idx, 0),
            "by_me": idx in my_indices,
        })
    return {
        "id": str(poll.id),
        "question": poll.question,
        "options": options_out,
        "multi_select": bool(poll.multi_select),
        "closes_at": poll.closes_at.isoformat() if poll.closes_at else None,
        "total_votes": len(votes),
    }


# ── Polls business logic ──────────────────────────────────────────────────────
async def create_poll_logic(
    db: AsyncSession,
    user: User,
    room,  # StaffChatRoom
    question: str,
    options: list[str],
    multi_select: bool = False,
    closes_at: datetime | None = None,
):
    """Создаёт опрос + связанное system-message в треде комнаты.

    Возвращает (poll, message). Вызывающий выполняет commit.
    """
    from app.models.staff_chat import StaffChatPoll, StaffChatMessage
    q = (question or "").strip()
    opts = [str(o).strip() for o in (options or []) if str(o).strip()]
    if not q:
        raise ValueError("Пустой вопрос опроса")
    if len(opts) < 2:
        raise ValueError("Нужно минимум 2 варианта")
    if len(opts) > 20:
        raise ValueError("Максимум 20 вариантов")
    # system-message с body=question (для feed-ленты), без attachments
    msg = StaffChatMessage(
        room_id=room.id,
        sender_id=user.id,
        body=q,
    )
    db.add(msg)
    room.last_message_at = datetime.utcnow()
    await db.flush()
    poll = StaffChatPoll(
        message_id=msg.id,
        room_id=room.id,
        creator_id=user.id,
        question=q,
        options=opts,
        multi_select=bool(multi_select),
        closes_at=closes_at,
    )
    db.add(poll)
    # отправителю auto-read
    await db.execute(
        update(StaffChatMember)
        .where(and_(
            StaffChatMember.room_id == room.id,
            StaffChatMember.user_id == user.id,
        ))
        .values(last_read_at=msg.created_at)
    )
    await db.flush()
    return poll, msg


async def toggle_poll_vote_logic(
    db: AsyncSession,
    user: User,
    poll,  # StaffChatPoll
    option_index: int,
) -> str:
    """Toggle голоса. Single-select: при выборе нового — старый снимается.

    Возвращает "added" | "removed".
    """
    from app.models.staff_chat import StaffChatPollVote
    if option_index < 0 or option_index >= len(poll.options or []):
        raise ValueError("Неверный option_index")
    if poll.closes_at and poll.closes_at.replace(tzinfo=None) < datetime.utcnow():
        raise ValueError("Опрос закрыт")
    # Ищем существующий голос (этот user, этот option)
    r = await db.execute(
        select(StaffChatPollVote).where(and_(
            StaffChatPollVote.poll_id == poll.id,
            StaffChatPollVote.user_id == user.id,
            StaffChatPollVote.option_index == option_index,
        ))
    )
    existing = r.scalar_one_or_none()
    if existing:
        await db.delete(existing)
        return "removed"
    # Single-select: удаляем все предыдущие голоса user'а в этом poll'е
    if not poll.multi_select:
        await db.execute(
            delete(StaffChatPollVote).where(and_(
                StaffChatPollVote.poll_id == poll.id,
                StaffChatPollVote.user_id == user.id,
            ))
        )
    vote = StaffChatPollVote(
        poll_id=poll.id,
        user_id=user.id,
        option_index=option_index,
    )
    db.add(vote)
    return "added"
