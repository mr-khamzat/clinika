"""
Роутер чата сотрудник↔сотрудник.

Endpoints:
  GET  /staff-chat/contacts                        — RBAC-фильтрованный список доступных собеседников (сгруппированный)
  GET  /staff-chat/rooms                            — мои комнаты
  POST /staff-chat/rooms/direct                     — создать/получить direct-чат с пользователем
  GET  /staff-chat/rooms/{id}                       — детали комнаты + участники
  GET  /staff-chat/rooms/{id}/messages              — сообщения (пагинация)
  POST /staff-chat/rooms/{id}/messages              — отправить сообщение
  POST /staff-chat/rooms/{id}/read                  — отметить прочитанным
  POST /staff-chat/rooms/{id}/mute                  — mute/unmute
  DELETE /staff-chat/messages/{id}                  — soft-delete (только свои)
  WS   /staff-chat/ws                               — real-time: новые сообщения + presence

Все endpoints требуют аутентификации. Пациенты — 403.
"""
import asyncio
import json
import mimetypes
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, or_, update, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, AsyncSessionLocal
from app.core.deps import get_current_user
from app.core.security import decode_token
from app.models.user import User
from app.models.staff_chat import (
    StaffChatRoom, StaffChatMember, StaffChatMessage, StaffChatFile,
    StaffChatMessageReaction,
    ROOM_TYPE_DIRECT,
)
from app.services import staff_chat_service as svc


# Конфигурация вложений: 50МБ лимит, 48 часов хранения
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
FILE_TTL_HOURS = 48
STORAGE_ROOT = Path("/opt/clinika/data/staff_chat_files")
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


router = APIRouter(prefix="/staff-chat", tags=["staff-chat"])


def _ensure_not_patient(user: User) -> None:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role == "patient":
        raise HTTPException(403, "Пациентам недоступен чат сотрудников")


# ── Pydantic ──────────────────────────────────────────────────────────────────
class DirectRoomCreate(BaseModel):
    user_id: uuid.UUID


class MessageCreate(BaseModel):
    body: str = Field(default="", max_length=10_000)
    attachments: list[dict] | None = None
    reply_to_id: uuid.UUID | None = None


class MuteRequest(BaseModel):
    muted: bool


# ── StaffChat Slack-fundament: каналы / реакции / mentions / pin ──────────────
class GroupJoinForbidden(Exception):
    """Попытка присоединиться к закрытому каналу без приглашения."""
    pass


class LastAdminError(Exception):
    """Последний admin не может выйти — передай права или удали канал."""
    pass


class PinLimitError(Exception):
    """Превышен лимит 20 закреплённых сообщений на канал."""
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


class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


# ── Helpers (pure logic, удобно для unit-тестов) ──────────────────────────────
async def _create_channel_logic(db, user, payload):
    """Создаёт room (channel/group) + сразу делает creator'а admin'ом."""
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
    """Присоединение к открытому channel. Group → exception."""
    if room.type == "group":
        raise GroupJoinForbidden("Это закрытый канал — нужно приглашение")
    if user.tenant_id != room.tenant_id:
        raise GroupJoinForbidden("Кросс-тенантное присоединение запрещено")
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
    """Выход из канала. Последний admin → exception."""
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


# ── Channels endpoints ────────────────────────────────────────────────────────
@router.post("/channels", status_code=201)
async def create_channel(
    body: CreateChannelIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_not_patient(user)
    if not user.tenant_id:
        raise HTTPException(403, "Нет тенанта")
    room, _ = await _create_channel_logic(db, user, body)
    await db.commit()
    await db.refresh(room)
    return {
        "id": str(room.id), "type": room.type, "name": room.name,
        "description": room.description, "tenant_id": str(room.tenant_id),
    }


@router.get("/channels/public")
async def list_public_channels(
    q: Optional[str] = Query(None, max_length=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_not_patient(user)
    if not user.tenant_id:
        raise HTTPException(403, "Нет тенанта")
    stmt = select(StaffChatRoom).where(
        StaffChatRoom.tenant_id == user.tenant_id,
        StaffChatRoom.type == "channel",
    )
    if q:
        stmt = stmt.where(StaffChatRoom.name.ilike(f"%{q}%"))
    rows = (await db.execute(stmt.limit(50))).scalars().all()
    return {"channels": [
        {"id": str(r.id), "name": r.name, "description": r.description}
        for r in rows
    ]}


@router.post("/channels/{room_id}/join", status_code=201)
async def join_channel(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_not_patient(user)
    room = (await db.execute(
        select(StaffChatRoom).where(StaffChatRoom.id == room_id)
    )).scalar_one_or_none()
    if not room:
        raise HTTPException(404, "Канал не найден")
    try:
        await _join_channel_logic(db, user, room)
        await db.commit()
        return {"ok": True, "room_id": str(room.id)}
    except GroupJoinForbidden as e:
        await db.rollback()
        raise HTTPException(403, str(e))


@router.post("/channels/{room_id}/invite", status_code=201)
async def invite_to_channel(
    room_id: uuid.UUID,
    body: InviteIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_not_patient(user)
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
    _ensure_not_patient(user)
    me = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == room_id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not me:
        raise HTTPException(404, "Вы не участник")
    room = (await db.execute(
        select(StaffChatRoom).where(StaffChatRoom.id == room_id)
    )).scalar_one()
    try:
        await _leave_channel_logic(db, user, room, me)
        await db.commit()
    except LastAdminError as e:
        await db.rollback()
        raise HTTPException(409, str(e))
    return None


@router.patch("/channels/{room_id}")
async def patch_channel(
    room_id: uuid.UUID,
    body: PatchChannelIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_not_patient(user)
    me = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == room_id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not me or me.member_role != "admin":
        raise HTTPException(403, "Только admin может редактировать канал")
    room = (await db.execute(
        select(StaffChatRoom).where(StaffChatRoom.id == room_id)
    )).scalar_one_or_none()
    if not room:
        raise HTTPException(404, "Канал не найден")
    if body.name is not None:
        room.name = body.name
    if body.description is not None:
        room.description = body.description
    await db.commit()
    return {"id": str(room.id), "name": room.name, "description": room.description}



@router.delete("/channels/{room_id}", status_code=204)
async def delete_channel(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Удаляет канал. Только admin канала ИЛИ manager/franchise_owner/super_admin."""
    _ensure_not_patient(user)
    room = (await db.execute(
        select(StaffChatRoom).where(StaffChatRoom.id == room_id)
    )).scalar_one_or_none()
    if not room:
        raise HTTPException(404, "Канал не найден")
    if room.type == "direct":
        raise HTTPException(400, "DM нельзя удалить — выйдите из переписки")
    # Проверка прав: admin канала ИЛИ глобальная роль manager+
    me = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == room_id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    is_admin = me and me.member_role == "admin"
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    is_global_admin = role_val in ("manager", "franchise_owner", "super_admin")
    if not (is_admin or is_global_admin):
        raise HTTPException(403, "Только admin канала или manager+ может удалить")
    # Каскадно удалятся через FK ondelete=CASCADE (members, messages, reactions, files)
    await db.delete(room)
    await db.commit()
    return None

# ── Reactions ─────────────────────────────────────────────────────────────────
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
    _ensure_not_patient(user)
    msg = (await db.execute(
        select(StaffChatMessage).where(StaffChatMessage.id == message_id)
    )).scalar_one_or_none()
    if not msg:
        raise HTTPException(404, "Сообщение не найдено")
    member = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == msg.room_id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not member:
        raise HTTPException(403, "Не участник этой комнаты")
    action = await _toggle_reaction_logic(db, user, msg, body.emoji)
    await db.commit()
    return {"action": action, "emoji": body.emoji, "message_id": str(msg.id)}


# ── Pin / Unpin сообщений ─────────────────────────────────────────────────────
async def _toggle_pin_logic(db, user, msg, member) -> str:
    """Toggle pin. Returns 'pinned' | 'unpinned'. Raises PinLimitError если >=20."""
    if msg.pinned_at is not None:
        msg.pinned_at = None
        msg.pinned_by_user_id = None
        return "unpinned"
    cnt = (await db.execute(
        select(func.count()).select_from(StaffChatMessage).where(
            StaffChatMessage.room_id == msg.room_id,
            StaffChatMessage.pinned_at.is_not(None),
        )
    )).scalar()
    if (cnt or 0) >= 20:
        raise PinLimitError("Лимит 20 закреплённых сообщений на канал")
    msg.pinned_at = datetime.utcnow()
    msg.pinned_by_user_id = user.id
    return "pinned"


@router.post("/messages/{message_id}/pin")
async def toggle_pin(
    message_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_not_patient(user)
    msg = (await db.execute(
        select(StaffChatMessage).where(StaffChatMessage.id == message_id)
    )).scalar_one_or_none()
    if not msg:
        raise HTTPException(404, "Сообщение не найдено")
    member = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == msg.room_id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    is_admin_or_higher = (
        (member is not None and member.member_role == "admin")
        or role_val in ("manager", "franchise_owner", "super_admin")
    )
    if not is_admin_or_higher:
        raise HTTPException(403, "Только admin room'а или manager+ может пинить")
    try:
        action = await _toggle_pin_logic(db, user, msg, member)
    except PinLimitError as e:
        await db.rollback()
        raise HTTPException(409, str(e))
    await db.commit()
    return {"action": action, "message_id": str(msg.id),
            "pinned_at": msg.pinned_at.isoformat() if msg.pinned_at else None}


@router.get("/mentions/unread")
async def unread_mentions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список room_id где меня упомянули после моего last_read_at."""
    _ensure_not_patient(user)
    my_id = str(user.id)
    rows = (await db.execute(
        select(StaffChatMember).where(StaffChatMember.user_id == user.id)
    )).scalars().all()
    out: list[dict] = []
    epoch = datetime(1970, 1, 1)
    for m in rows:
        last_read = m.last_read_at or epoch
        msgs = (await db.execute(
            select(StaffChatMessage).where(
                StaffChatMessage.room_id == m.room_id,
                StaffChatMessage.created_at > last_read,
            )
        )).scalars().all()
        cnt = sum(
            1 for msg in msgs
            if my_id in (msg.mentioned_user_ids or [])
        )
        if cnt > 0:
            out.append({"room_id": str(m.room_id), "mention_count": cnt})
    return {"rooms": out}


@router.get("/rooms/{room_id}/pinned")
async def list_pinned(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_not_patient(user)
    member = (await db.execute(
        select(StaffChatMember).where(
            StaffChatMember.room_id == room_id,
            StaffChatMember.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not member:
        raise HTTPException(403, "Не участник")
    rows = (await db.execute(
        select(StaffChatMessage).where(
            StaffChatMessage.room_id == room_id,
            StaffChatMessage.pinned_at.is_not(None),
        ).order_by(desc(StaffChatMessage.pinned_at))
    )).scalars().all()
    return {"messages": [
        {
            "id": str(m.id),
            "body": m.body,
            "sender_id": str(m.sender_id) if m.sender_id else None,
            "pinned_at": m.pinned_at.isoformat() if m.pinned_at else None,
            "pinned_by_user_id": str(m.pinned_by_user_id) if m.pinned_by_user_id else None,
            "created_at": m.created_at.isoformat(),
        }
        for m in rows
    ]}


# ── /me — текущий пользователь (краткая инфа для UI) ─────────────────────────
@router.get("/me")
async def staff_chat_me(
    user: User = Depends(get_current_user),
):
    _ensure_not_patient(user)
    return svc.serialize_user_brief(user)


# ── /contacts ─────────────────────────────────────────────────────────────────
@router.get("/contacts")
async def list_contacts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ensure_not_patient(user)
    users = await svc.visible_users_for(db, user)
    # Группируем по клинике
    from app.models.clinic import Clinic
    clinic_ids = {u.clinic_id for u in users if getattr(u, "clinic_id", None)}
    clinics_map: dict[uuid.UUID, Clinic] = {}
    if clinic_ids:
        r = await db.execute(select(Clinic).where(Clinic.id.in_(clinic_ids)))
        clinics_map = {c.id: c for c in r.scalars().all()}
    groups: dict[str, dict] = {}
    for u in users:
        cid = getattr(u, "clinic_id", None)
        if cid and cid in clinics_map:
            key = str(cid)
            label = clinics_map[cid].name
        else:
            key = "tenant-wide"
            label = "Управление сетью"
        if key not in groups:
            groups[key] = {"clinic_id": key if key != "tenant-wide" else None, "label": label, "users": []}
        groups[key]["users"].append(svc.serialize_user_brief(u))
    # Сортируем группы: tenant-wide последней
    groups_list = sorted(
        groups.values(),
        key=lambda g: (g["clinic_id"] is None, g["label"] or ""),
    )
    return {"groups": groups_list, "total": len(users)}


# ── /rooms ────────────────────────────────────────────────────────────────────
@router.get("/rooms")
async def list_rooms(
    include_cross: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Мои комнаты StaffChat.

    По умолчанию (`include_cross=False`) возвращаются только per-tenant комнаты.
    Это сохраняет прежнее поведение для существующих UI-клиентов.
    При `include_cross=True` дополнительно вернутся cross-tenant комнаты,
    членом которых я являюсь (отдельный endpoint для cross-rooms — в
    `staff_chat_cross.py`).
    """
    _ensure_not_patient(user)
    room_ids = await svc.user_room_ids(db, user.id)
    if not room_ids:
        return {"rooms": []}
    rooms_q = select(StaffChatRoom).where(StaffChatRoom.id.in_(room_ids))
    if not include_cross:
        # Отфильтровываем cross-tenant комнаты — у них отдельный UI
        rooms_q = rooms_q.where(StaffChatRoom.is_cross_tenant == False)  # noqa: E712
    r = await db.execute(
        rooms_q.order_by(StaffChatRoom.last_message_at.desc().nullslast())
    )
    rooms = list(r.scalars().all())
    # Все участники всех комнат
    r2 = await db.execute(
        select(StaffChatMember).where(StaffChatMember.room_id.in_(room_ids))
    )
    members_all = list(r2.scalars().all())
    user_ids = {m.user_id for m in members_all}
    r3 = await db.execute(select(User).where(User.id.in_(user_ids)))
    user_map: dict[uuid.UUID, User] = {u.id: u for u in r3.scalars().all()}
    members_by_room: dict[uuid.UUID, list[StaffChatMember]] = {}
    for m in members_all:
        members_by_room.setdefault(m.room_id, []).append(m)
    # Свои last_read_at — для подсчёта unread
    my_last_read: dict[uuid.UUID, datetime | None] = {
        m.room_id: m.last_read_at for m in members_all if m.user_id == user.id
    }
    result = []
    for room in rooms:
        members = members_by_room.get(room.id, [])
        last_msg = await svc.last_message(db, room.id)
        unread = await svc.count_unread(db, room.id, user.id, my_last_read.get(room.id))
        # Для direct — заголовок = ФИО другого участника
        title_override = None
        if room.type == ROOM_TYPE_DIRECT:
            other_member = next((m for m in members if m.user_id != user.id), None)
            if other_member and other_member.user_id in user_map:
                title_override = svc.serialize_user_brief(user_map[other_member.user_id])["name"]
        result.append(svc.serialize_room(
            room, members=members, member_users=user_map,
            last_msg=last_msg, unread=unread, title_override=title_override,
        ))
    return {"rooms": result}


@router.post("/rooms/direct", status_code=201)
async def create_direct_room(
    payload: DirectRoomCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ensure_not_patient(user)
    # Проверяем что other_user доступен пользователю (RBAC)
    visible = await svc.visible_users_for(db, user)
    other = next((u for u in visible if u.id == payload.user_id), None)
    if not other:
        raise HTTPException(403, "Этот пользователь недоступен для чата")
    try:
        room = await svc.get_or_create_direct_room(db, user, other)
        await db.commit()
    except ValueError as e:
        await db.rollback()
        raise HTTPException(400, str(e))
    # Возвращаем комнату с заголовком
    members = await svc.list_room_members(db, room.id)
    r = await db.execute(select(User).where(User.id.in_([m.user_id for m in members])))
    user_map = {u.id: u for u in r.scalars().all()}
    title = svc.serialize_user_brief(user_map[other.id])["name"]
    return svc.serialize_room(
        room, members=members, member_users=user_map,
        last_msg=None, unread=0, title_override=title,
    )


@router.get("/rooms/{room_id}")
async def get_room_details(
    room_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ensure_not_patient(user)
    if not await svc.is_member(db, room_id, user.id):
        raise HTTPException(403, "Вы не участник этой комнаты")
    room = await svc.get_room(db, room_id)
    if not room:
        raise HTTPException(404, "Комната не найдена")
    members = await svc.list_room_members(db, room_id)
    r = await db.execute(select(User).where(User.id.in_([m.user_id for m in members])))
    user_map = {u.id: u for u in r.scalars().all()}
    title_override = None
    if room.type == ROOM_TYPE_DIRECT:
        other = next((m for m in members if m.user_id != user.id), None)
        if other and other.user_id in user_map:
            title_override = svc.serialize_user_brief(user_map[other.user_id])["name"]
    my_member = next((m for m in members if m.user_id == user.id), None)
    last_msg = await svc.last_message(db, room_id)
    unread = await svc.count_unread(db, room_id, user.id, my_member.last_read_at if my_member else None)
    return svc.serialize_room(
        room, members=members, member_users=user_map,
        last_msg=last_msg, unread=unread, title_override=title_override,
    )


# ── /rooms/{id}/messages ──────────────────────────────────────────────────────
@router.get("/rooms/{room_id}/messages")
async def list_room_messages(
    room_id: uuid.UUID,
    before: Optional[datetime] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ensure_not_patient(user)
    if not await svc.is_member(db, room_id, user.id):
        raise HTTPException(403, "Вы не участник этой комнаты")
    msgs = await svc.list_messages(db, room_id, before=before, limit=limit)
    return {"messages": [svc.serialize_message(m) for m in reversed(msgs)]}


@router.post("/rooms/{room_id}/messages", status_code=201)
async def post_room_message(
    room_id: uuid.UUID,
    payload: MessageCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ensure_not_patient(user)
    if not await svc.is_member(db, room_id, user.id):
        raise HTTPException(403, "Вы не участник этой комнаты")
    room = await svc.get_room(db, room_id)
    if not room:
        raise HTTPException(404, "Комната не найдена")
    try:
        msg = await svc.send_message(
            db, room, user,
            body=payload.body,
            attachments=payload.attachments,
            reply_to_id=payload.reply_to_id,
        )
        # @mentions: parse → resolve (tenant-scope) → сохранить в msg.mentioned_user_ids
        try:
            from app.services.staff_chat_mentions import (
                parse_mention_strings, resolve_mentions,
            )
            usernames = parse_mention_strings(msg.body or "")
            mention_ids: list[str] = []
            if usernames and user.tenant_id:
                mention_ids = await resolve_mentions(
                    db, usernames, tenant_id=user.tenant_id,
                )
            msg.mentioned_user_ids = mention_ids
        except Exception:
            # парсинг не должен ломать отправку
            mention_ids = []
        await db.commit()
    except ValueError as e:
        await db.rollback()
        raise HTTPException(400, str(e))
    payload_event = svc.serialize_message(msg)
    # TG-нотификация upmentioned user'ам — fire-and-forget, после commit'а
    try:
        if mention_ids:
            from app.services.staff_chat_mentions import notify_mentions
            await notify_mentions(
                db, sender=user, room=room,
                mention_ids=mention_ids,
                text_preview=(msg.body or "")[:200],
            )
    except Exception:
        pass
    # Бродкаст всем участникам через WS hub
    await ws_hub.broadcast_to_room(room.id, {"type": "message:new", "data": payload_event})
    # Telegram-нотификация владельцу: если в комнате есть super_admin/franchise_owner —
    # отправляем им сообщение в owner-бот (можно ответить прямо из Telegram через Reply).
    try:
        from app.services.alert_service import send_to_owner
        import asyncio as _asyncio, html as _html
        from datetime import datetime as _dt, timezone as _tz, timedelta as _td
        from app.models.clinic import Clinic as _Clinic
        members = await svc.list_room_members(db, room.id)
        other_member_ids = [m.user_id for m in members if m.user_id != user.id]
        if other_member_ids:
            r_users = await db.execute(select(User).where(User.id.in_(other_member_ids)))
            recipients = list(r_users.scalars().all())
            needs_owner = any(
                (u.role.value if hasattr(u.role, "value") else str(u.role)) in ("super_admin", "franchise_owner")
                for u in recipients
            )
            # Получатели — super_admin/franchise_owner (не отправитель)
            owner_recipients = [
                u for u in recipients
                if (u.role.value if hasattr(u.role, "value") else str(u.role)) in ("super_admin", "franchise_owner")
            ]
            if owner_recipients:
                # Имя и роль отправителя
                sender_brief = svc.serialize_user_brief(user)
                sender_name = _html.escape(sender_brief["name"])
                role_labels = {
                    "super_admin": "Платформа", "franchise_owner": "Владелец сети",
                    "manager": "Управляющий", "admin": "Управляющий клиники",
                    "doctor": "Врач", "reg": "Регистратор", "nurse": "Медсестра",
                    "recruiter": "Рекрутер",
                    "partner_doctor": "Партнёрский врач",
                    "visiting_doctor": "Приглашённый врач",
                }
                role_label = role_labels.get(sender_brief["role"], sender_brief["role"])
                # Клиника отправителя
                clinic_name = "—"
                if getattr(user, "clinic_id", None):
                    rc = await db.execute(select(_Clinic).where(_Clinic.id == user.clinic_id))
                    c = rc.scalar_one_or_none()
                    if c:
                        clinic_name = c.name
                # Тип чата
                if room.type == "direct":
                    chat_label = "личный с вами"
                elif room.type == "clinic":
                    chat_label = f"общий чат клиники"
                elif room.type == "group":
                    chat_label = "группа «" + (room.name or "без названия") + "»"
                else:
                    chat_label = room.type
                # Тело
                body_text = (msg.body or "").strip()
                body_preview = _html.escape(body_text[:1500])
                if msg.attachments:
                    body_preview += "\n📎 <i>файл во вложении</i>"
                # Время МСК
                msk = _dt.now(_tz.utc).astimezone(_tz(_td(hours=3)))
                stamp = msk.strftime("%d.%m.%Y %H:%M МСК")
                tg_text = (
                    f"💬 <b>Новое сообщение в КлиникСеть</b>\n\n"
                    f"👤 <b>От:</b> {sender_name} ({_html.escape(role_label)})\n"
                    f"🏥 <b>Клиника:</b> {_html.escape(clinic_name)}\n"
                    f"💭 <b>Чат:</b> {_html.escape(chat_label)}\n\n"
                    f"«{body_preview}»\n\n"
                    f"⏰ {stamp}\n"
                    f"🔗 <a href=\"https://xn--e1afagcdp8ak4h.xn--p1ai/staff-chat\">Открыть в браузере</a>\n\n"
                    f"<i>↩️ Ответьте на это сообщение в Telegram — текст уйдёт в чат</i>\n"
                    f"<code>room:{room.id}</code>"
                )
                # Если есть файлы — отправляем как документы с caption=tg_text;
                # иначе обычный текст.
                # Собираем целевые chat_id: главный админ (OWNER_TELEGRAM_ID) ВСЕГДА получает
                # копию + каждый получатель-super_admin/franchise_owner с собственным telegram_id.
                # Дедуп: одна и та же telegram_id шлётся один раз.
                from app.config import settings as _settings
                _target_chat_ids: set[str] = set()
                _main_owner = (_settings.owner_telegram_id or "").strip()
                if _main_owner:
                    _target_chat_ids.add(_main_owner)
                for _orec in owner_recipients:
                    _ot = (getattr(_orec, "telegram_id", None) or "").strip()
                    if _ot:
                        _target_chat_ids.add(_ot)
                # Не шлём отправителю самому себе (он же = главный owner)
                _sender_tg = (getattr(user, "telegram_id", None) or "").strip()
                if _sender_tg:
                    _target_chat_ids.discard(_sender_tg)
                for _chat_id in _target_chat_ids:
                    if msg.attachments:
                        from app.services.alert_service import send_document_to_owner_to, send_to_owner_to
                        from app.models.staff_chat import StaffChatFile as _SCF
                        file_ids = [a.get("id") for a in msg.attachments if a.get("id")]
                        if file_ids:
                            import uuid as _uuid
                            try:
                                ids = [_uuid.UUID(str(fid)) for fid in file_ids]
                                rf = await db.execute(select(_SCF).where(_SCF.id.in_(ids)))
                                files = list(rf.scalars().all())
                                for i, f in enumerate(files):
                                    cap = tg_text if i == 0 else ""
                                    _asyncio.create_task(send_document_to_owner_to(_chat_id, f.storage_path, f.filename, cap))
                                if not files:
                                    _asyncio.create_task(send_to_owner_to(_chat_id, tg_text))
                            except Exception:
                                _asyncio.create_task(send_to_owner_to(_chat_id, tg_text))
                        else:
                            _asyncio.create_task(send_to_owner_to(_chat_id, tg_text))
                    else:
                        from app.services.alert_service import send_to_owner_to
                        _asyncio.create_task(send_to_owner_to(_chat_id, tg_text))
    except Exception as _e:
        pass  # нотификация не должна ломать основной flow
    return payload_event


@router.post("/rooms/{room_id}/read", status_code=204)
async def post_room_read(
    room_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ensure_not_patient(user)
    if not await svc.is_member(db, room_id, user.id):
        raise HTTPException(403, "Вы не участник этой комнаты")
    room = await svc.get_room(db, room_id)
    if not room:
        return
    await svc.mark_read(db, room, user)
    await db.commit()
    await ws_hub.broadcast_to_room(room_id, {
        "type": "read",
        "data": {"room_id": str(room_id), "user_id": str(user.id), "at": datetime.utcnow().isoformat()},
    })


@router.post("/rooms/{room_id}/mute", status_code=204)
async def post_room_mute(
    room_id: uuid.UUID,
    payload: MuteRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ensure_not_patient(user)
    if not await svc.is_member(db, room_id, user.id):
        raise HTTPException(403, "Вы не участник этой комнаты")
    await db.execute(
        update(StaffChatMember)
        .where(and_(
            StaffChatMember.room_id == room_id,
            StaffChatMember.user_id == user.id,
        ))
        .values(muted=bool(payload.muted))
    )
    await db.commit()


@router.delete("/messages/{message_id}", status_code=204)
async def delete_message(
    message_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ensure_not_patient(user)
    r = await db.execute(
        select(StaffChatMessage).where(StaffChatMessage.id == message_id)
    )
    msg = r.scalar_one_or_none()
    if not msg:
        raise HTTPException(404, "Сообщение не найдено")
    if msg.sender_id != user.id:
        raise HTTPException(403, "Можно удалять только свои сообщения")
    msg.deleted_at = datetime.utcnow()
    msg.body = ""
    msg.attachments = None
    await db.commit()
    await ws_hub.broadcast_to_room(msg.room_id, {
        "type": "message:deleted",
        "data": {"id": str(message_id), "room_id": str(msg.room_id)},
    })


# ── WebSocket Hub ─────────────────────────────────────────────────────────────
class WsHub:
    """In-memory WebSocket hub для real-time обновлений чата.

    Простая реализация без Redis pub-sub — подходит для single-instance.
    Для multi-instance потребуется бэк-pubsub.
    """
    def __init__(self) -> None:
        # user_id -> set[WebSocket]
        self.connections: dict[uuid.UUID, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def register(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        async with self._lock:
            self.connections.setdefault(user_id, set()).add(ws)

    async def unregister(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        async with self._lock:
            conns = self.connections.get(user_id)
            if not conns:
                return
            conns.discard(ws)
            if not conns:
                self.connections.pop(user_id, None)

    async def online_users(self) -> set[uuid.UUID]:
        async with self._lock:
            return set(self.connections.keys())

    async def broadcast_to_users(self, user_ids: set[uuid.UUID], payload: dict) -> None:
        msg = json.dumps(payload, default=str)
        dead: list[tuple[uuid.UUID, WebSocket]] = []
        async with self._lock:
            targets = []
            for uid in user_ids:
                for ws in self.connections.get(uid, set()):
                    targets.append((uid, ws))
        for uid, ws in targets:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append((uid, ws))
        for uid, ws in dead:
            await self.unregister(uid, ws)

    async def broadcast_to_room(self, room_id: uuid.UUID, payload: dict) -> None:
        async with AsyncSessionLocal() as db:
            r = await db.execute(
                select(StaffChatMember.user_id).where(StaffChatMember.room_id == room_id)
            )
            user_ids = {row[0] for row in r.all()}
        await self.broadcast_to_users(user_ids, payload)


ws_hub = WsHub()


async def _authenticate_ws(token: str) -> User | None:
    """JWT-аутентификация для WebSocket (Depends в WS не работает корректно)."""
    payload = decode_token(token)
    if not payload:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    try:
        uid = uuid.UUID(str(user_id))
    except Exception:
        return None
    async with AsyncSessionLocal() as db:
        r = await db.execute(select(User).where(User.id == uid))
        u = r.scalar_one_or_none()
    if not u or not getattr(u, "is_active", True):
        return None
    return u


@router.websocket("/ws")
async def ws_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
):
    user = await _authenticate_ws(token)
    if not user:
        await websocket.close(code=4401)
        return
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role == "patient":
        await websocket.close(code=4403)
        return
    await websocket.accept()
    await ws_hub.register(user.id, websocket)
    # Уведомляем других о presence:online
    try:
        async with AsyncSessionLocal() as db:
            visible_ids = {u.id for u in await svc.visible_users_for(db, user)}
        if visible_ids:
            await ws_hub.broadcast_to_users(visible_ids, {
                "type": "presence", "data": {"user_id": str(user.id), "online": True},
            })
    except Exception:
        pass
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            msg_type = msg.get("type")
            if msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif msg_type == "typing":
                room_id = msg.get("room_id")
                if room_id:
                    try:
                        rid = uuid.UUID(room_id)
                        async with AsyncSessionLocal() as db:
                            if not await svc.is_member(db, rid, user.id):
                                continue
                            r = await db.execute(
                                select(StaffChatMember.user_id).where(and_(
                                    StaffChatMember.room_id == rid,
                                    StaffChatMember.user_id != user.id,
                                ))
                            )
                            others = {row[0] for row in r.all()}
                        if others:
                            await ws_hub.broadcast_to_users(others, {
                                "type": "typing",
                                "data": {"room_id": room_id, "user_id": str(user.id)},
                            })
                    except Exception:
                        pass
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await ws_hub.unregister(user.id, websocket)
        try:
            async with AsyncSessionLocal() as db:
                visible_ids = {u.id for u in await svc.visible_users_for(db, user)}
            if visible_ids:
                await ws_hub.broadcast_to_users(visible_ids, {
                    "type": "presence", "data": {"user_id": str(user.id), "online": False},
                })
        except Exception:
            pass


@router.get("/presence")
async def get_presence(
    user: User = Depends(get_current_user),
):
    """Возвращает список user_id, кто сейчас онлайн (есть активный WS)."""
    _ensure_not_patient(user)
    online = await ws_hub.online_users()
    return {"online": [str(u) for u in online]}


# ── Files (вложения, 50МБ, TTL 48ч) ───────────────────────────────────────────
@router.post("/rooms/{room_id}/files", status_code=201)
async def upload_file(
    room_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Загружает файл-вложение в комнату. Лимит 50МБ.
    Файл хранится 48 часов, затем автоматически удаляется.
    Возвращает мета-объект для использования в `attachments` сообщения.
    """
    _ensure_not_patient(user)
    if not await svc.is_member(db, room_id, user.id):
        raise HTTPException(403, "Вы не участник этой комнаты")
    # Проверяем размер — UploadFile.size доступен в Starlette
    size = 0
    chunks: list[bytes] = []
    CHUNK_SIZE = 1024 * 1024  # 1MB
    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_FILE_SIZE:
            raise HTTPException(413, f"Файл больше {MAX_FILE_SIZE // (1024*1024)} МБ")
        chunks.append(chunk)
    if size == 0:
        raise HTTPException(400, "Пустой файл")
    # Сохраняем
    file_id = uuid.uuid4()
    safe_name = (file.filename or "file").replace("/", "_").replace("\\", "_")[:200]
    mime = file.content_type or mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
    day_dir = STORAGE_ROOT / datetime.utcnow().strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    storage_path = day_dir / f"{file_id}_{safe_name}"
    try:
        with open(storage_path, "wb") as fh:
            for c in chunks:
                fh.write(c)
    except OSError as e:
        raise HTTPException(500, f"Не удалось сохранить файл: {e}")
    expires_at = datetime.utcnow() + timedelta(hours=FILE_TTL_HOURS)
    f = StaffChatFile(
        id=file_id,
        room_id=room_id,
        uploaded_by_id=user.id,
        filename=safe_name,
        mime=mime,
        size_bytes=size,
        storage_path=str(storage_path),
        expires_at=expires_at,
    )
    db.add(f)
    await db.commit()
    return {
        "id": str(file_id),
        "filename": safe_name,
        "mime": mime,
        "size": size,
        "url": f"/staff-chat/files/{file_id}/download",
        "expires_at": expires_at.isoformat(),
        "ttl_hours": FILE_TTL_HOURS,
    }


@router.get("/files/{file_id}/download")
async def download_file(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Скачивание файла. Проверяет членство в комнате и срок жизни."""
    _ensure_not_patient(user)
    r = await db.execute(select(StaffChatFile).where(StaffChatFile.id == file_id))
    rec = r.scalar_one_or_none()
    if not rec or rec.deleted_at:
        raise HTTPException(404, "Файл не найден или удалён")
    if rec.expires_at.replace(tzinfo=None) < datetime.utcnow():
        raise HTTPException(410, "Срок хранения файла истёк (48 часов)")
    if not await svc.is_member(db, rec.room_id, user.id):
        raise HTTPException(403, "Нет доступа к этому файлу")
    p = Path(rec.storage_path)
    if not p.exists():
        raise HTTPException(404, "Файл недоступен на сервере")
    return FileResponse(
        path=str(p),
        filename=rec.filename,
        media_type=rec.mime,
    )


@router.get("/files/policy")
async def file_policy():
    """Метаданные о лимитах и TTL — для UI-предупреждения."""
    return {
        "max_size_mb": MAX_FILE_SIZE // (1024 * 1024),
        "ttl_hours": FILE_TTL_HOURS,
        "notice": (
            f"Файлы хранятся {FILE_TTL_HOURS} часов и автоматически удаляются. "
            "Для длительного хранения используйте документы пациента или внешнее хранилище."
        ),
    }


# ── Search endpoint (sf05) ────────────────────────────────────────────────────

@router.get("/search")
async def search_staff_chat(
    q: str = Query(min_length=2, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Глобальный поиск по body в room'ах текущего пользователя (ILIKE).

    Возвращает: [{message_id, room_id, room_name, body_snippet, created_at, sender_id}].
    """
    _ensure_not_patient(user)
    results = await svc.search_messages_logic(db, user, q, limit=limit)
    return {"q": q, "count": len(results), "results": results}


# ── Polls endpoints (sf05) ────────────────────────────────────────────────────

class CreatePollIn(BaseModel):
    room_id: uuid.UUID
    question: str = Field(min_length=1, max_length=500)
    options: list[str] = Field(min_length=2, max_length=20)
    multi_select: bool = False
    closes_at: Optional[datetime] = None


class VotePollIn(BaseModel):
    option_index: int = Field(ge=0)


@router.post("/polls", status_code=201)
async def create_poll(
    body: CreatePollIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Создаёт опрос в указанной комнате (только для member-а).

    Создаёт system-message в треде комнаты со связанным poll-объектом.
    """
    _ensure_not_patient(user)
    room = await svc.get_room(db, body.room_id)
    if not room:
        raise HTTPException(404, "Комната не найдена")
    if not await svc.is_member(db, room.id, user.id):
        raise HTTPException(403, "Нет доступа к этой комнате")
    try:
        poll, msg = await svc.create_poll_logic(
            db, user, room,
            question=body.question,
            options=body.options,
            multi_select=body.multi_select,
            closes_at=body.closes_at,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    await db.refresh(poll)
    await db.refresh(msg)
    poll_dict = await svc.serialize_poll_for_message(db, msg.id, current_user_id=user.id)
    return {
        "poll": poll_dict,
        "message_id": str(msg.id),
        "room_id": str(room.id),
    }


@router.post("/polls/{poll_id}/vote")
async def vote_poll(
    poll_id: uuid.UUID,
    body: VotePollIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle голоса за опцию. Single-select: новый голос заменяет старый."""
    _ensure_not_patient(user)
    from app.models.staff_chat import StaffChatPoll
    r = await db.execute(select(StaffChatPoll).where(StaffChatPoll.id == poll_id))
    poll = r.scalar_one_or_none()
    if not poll:
        raise HTTPException(404, "Опрос не найден")
    if not await svc.is_member(db, poll.room_id, user.id):
        raise HTTPException(403, "Нет доступа к этой комнате")
    try:
        action = await svc.toggle_poll_vote_logic(db, user, poll, body.option_index)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    poll_dict = await svc.serialize_poll_for_message(db, poll.message_id, current_user_id=user.id)
    return {"action": action, "poll": poll_dict}


# ── Bot/CI endpoint (sf05) ────────────────────────────────────────────────────

class BotPostIn(BaseModel):
    channel_name: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=10_000)
    secret: str = Field(min_length=1, max_length=200)
    tenant_slug: Optional[str] = None


# Bot-router: использует префикс /api для совместимости с CI/мониторингом
# (вне auth-цикла, проверка по shared secret).
_bot_router = APIRouter(prefix="/api/staff-chat", tags=["staff-chat-bot"])


def _check_bot_secret(secret: str) -> None:
    expected = os.environ.get("STAFF_CHAT_BOT_SECRET", "").strip()
    if not expected:
        raise HTTPException(503, "Bot endpoint не настроен (STAFF_CHAT_BOT_SECRET)")
    if not secret or secret != expected:
        raise HTTPException(401, "Неверный bot secret")


@_bot_router.post("/bot/post")
async def bot_post_message(
    body: BotPostIn,
    db: AsyncSession = Depends(get_db),
):
    """Постинг сообщения от CI/мониторинга в канал по имени.

    Аутентификация: shared secret в теле запроса (STAFF_CHAT_BOT_SECRET env).
    Поиск канала: по точному имени (StaffChatRoom.name). Если задан
    tenant_slug — ограничиваем поиск этим тенантом.
    """
    _check_bot_secret(body.secret)
    # Резолв тенанта (если задан slug)
    tenant_filter = None
    if body.tenant_slug:
        from app.models.tenant import Tenant
        rt = await db.execute(
            select(Tenant.id).where(Tenant.slug == body.tenant_slug)
        )
        tid = rt.scalar_one_or_none()
        if not tid:
            raise HTTPException(404, "Тенант не найден")
        tenant_filter = tid
    # Ищем комнату по имени
    q = select(StaffChatRoom).where(StaffChatRoom.name == body.channel_name)
    if tenant_filter is not None:
        q = q.where(StaffChatRoom.tenant_id == tenant_filter)
    rr = await db.execute(q.limit(1))
    room = rr.scalar_one_or_none()
    if not room:
        raise HTTPException(404, "Канал не найден")
    # Постим сообщение от имени bot — sender_id = NULL (system).
    msg = StaffChatMessage(
        room_id=room.id,
        sender_id=None,
        body=(body.body or "").strip(),
    )
    db.add(msg)
    room.last_message_at = datetime.utcnow()
    await db.commit()
    await db.refresh(msg)
    return {
        "message_id": str(msg.id),
        "room_id": str(room.id),
        "channel_name": room.name,
        "created_at": msg.created_at.isoformat(),
    }
