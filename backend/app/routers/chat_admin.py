"""
Админ-роутер для управления чатом (Phase 2 + Phase 3).

Phase 2 — глобальные настройки:
  GET    /admin/chat-settings              — текущие настройки тенанта
  PUT    /admin/chat-settings              — обновить (только super_admin/franchise_owner)

Phase 3 — группы и broadcast-каналы:
  POST   /admin/chat/groups                — создать кастомную группу
  POST   /admin/chat/broadcasts            — создать broadcast-канал (read-only)
  POST   /admin/chat/groups/{id}/members   — добавить участников
  DELETE /admin/chat/groups/{id}/members/{user_id}  — убрать участника
  GET    /admin/chat/groups                — список групп (только тех к кому есть доступ)
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user, get_tenant_db
from app.models.user import User, UserRole
from app.models.chat_global_settings import ChatGlobalSettings
from app.models.staff_chat import (
    StaffChatRoom, StaffChatMember,
    ROOM_TYPE_GROUP, ROOM_TYPE_BROADCAST,
)
from app.services import staff_chat_service as svc


router = APIRouter(prefix="/admin", tags=["chat-admin"])


# ── Helpers ───────────────────────────────────────────────────────────────────
def _ensure_admin(user: User) -> None:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role not in ("super_admin", "franchise_owner", "admin", "manager"):
        raise HTTPException(403, "Требуется роль администратора")


def _ensure_owner_or_super(user: User) -> None:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role not in ("super_admin", "franchise_owner"):
        raise HTTPException(403, "Требуется super_admin или владелец сети")


async def _get_or_create_settings(db: AsyncSession, tenant_id: uuid.UUID | None) -> ChatGlobalSettings:
    r = await db.execute(
        select(ChatGlobalSettings).where(ChatGlobalSettings.tenant_id == tenant_id)
    )
    s = r.scalar_one_or_none()
    if s:
        return s
    s = ChatGlobalSettings(tenant_id=tenant_id)
    db.add(s)
    await db.flush()
    return s


# ── Settings ──────────────────────────────────────────────────────────────────
class SettingsResponse(BaseModel):
    file_ttl_hours: int
    max_file_mb: int
    inter_clinic_allowed: bool
    tg_notifications_enabled: bool
    tg_notify_super_admin: bool
    tg_notify_franchise_owner: bool
    patient_chat_tg_enabled: bool
    updated_at: str | None = None


class SettingsUpdate(BaseModel):
    file_ttl_hours: int | None = Field(None, ge=1, le=720)
    max_file_mb: int | None = Field(None, ge=1, le=500)
    inter_clinic_allowed: bool | None = None
    tg_notifications_enabled: bool | None = None
    tg_notify_super_admin: bool | None = None
    tg_notify_franchise_owner: bool | None = None
    patient_chat_tg_enabled: bool | None = None


@router.get("/chat-settings", response_model=SettingsResponse)
async def get_chat_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    _ensure_admin(user)
    s = await _get_or_create_settings(db, user.tenant_id)
    await db.commit()
    return SettingsResponse(
        file_ttl_hours=s.file_ttl_hours,
        max_file_mb=s.max_file_mb,
        inter_clinic_allowed=s.inter_clinic_allowed,
        tg_notifications_enabled=s.tg_notifications_enabled,
        tg_notify_super_admin=s.tg_notify_super_admin,
        tg_notify_franchise_owner=s.tg_notify_franchise_owner,
        patient_chat_tg_enabled=s.patient_chat_tg_enabled,
        updated_at=s.updated_at.isoformat() if s.updated_at else None,
    )


@router.put("/chat-settings", response_model=SettingsResponse)
async def update_chat_settings(
    payload: SettingsUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    _ensure_owner_or_super(user)
    s = await _get_or_create_settings(db, user.tenant_id)
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(s, k, v)
    s.updated_by_id = user.id
    s.updated_at = datetime.utcnow()
    await db.commit()
    return SettingsResponse(
        file_ttl_hours=s.file_ttl_hours,
        max_file_mb=s.max_file_mb,
        inter_clinic_allowed=s.inter_clinic_allowed,
        tg_notifications_enabled=s.tg_notifications_enabled,
        tg_notify_super_admin=s.tg_notify_super_admin,
        tg_notify_franchise_owner=s.tg_notify_franchise_owner,
        patient_chat_tg_enabled=s.patient_chat_tg_enabled,
        updated_at=s.updated_at.isoformat() if s.updated_at else None,
    )


# ── Groups ────────────────────────────────────────────────────────────────────
class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    member_ids: list[uuid.UUID] = Field(default_factory=list)
    broadcast: bool = False


class MembersAdd(BaseModel):
    user_ids: list[uuid.UUID]
    member_role: str = Field(default="member", pattern="^(member|admin)$")


@router.post("/chat/groups", status_code=201)
async def create_group(
    payload: GroupCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    _ensure_admin(user)
    if not user.tenant_id and not (user.role.value if hasattr(user.role, "value") else str(user.role)) == "super_admin":
        raise HTTPException(400, "Группа без tenant_id недопустима")
    room = StaffChatRoom(
        tenant_id=user.tenant_id,
        type=ROOM_TYPE_BROADCAST if payload.broadcast else ROOM_TYPE_GROUP,
        name=payload.name.strip(),
        created_by_id=user.id,
    )
    db.add(room)
    await db.flush()
    # Создатель — admin группы
    db.add(StaffChatMember(room_id=room.id, user_id=user.id, member_role="admin"))
    # Добавляем участников (проверяем RBAC видимости — только тех кого видит создатель)
    visible = await svc.visible_users_for(db, user)
    visible_ids = {u.id for u in visible}
    added = 0
    for uid in payload.member_ids:
        if uid == user.id:
            continue
        if uid not in visible_ids:
            continue
        db.add(StaffChatMember(room_id=room.id, user_id=uid, member_role="member"))
        added += 1
    await db.commit()
    return {
        "id": str(room.id),
        "name": room.name,
        "type": room.type,
        "members_added": added,
    }


@router.get("/chat/groups")
async def list_groups(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    # Видят группу ТОЛЬКО участники (creator → автоматически member).
    # super_admin/franchise_owner bypass'ов нет — изоляция важнее.
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role == "patient":
        raise HTTPException(403, "Пациентам недоступно")
    r_member = await db.execute(
        select(StaffChatMember.room_id).where(StaffChatMember.user_id == user.id)
    )
    my_room_ids = [row[0] for row in r_member.all()]
    if not my_room_ids:
        return {"groups": []}
    # Группы и broadcast-каналы тенанта (только те где user — admin)
    r = await db.execute(
        select(StaffChatRoom)
        .where(StaffChatRoom.id.in_(my_room_ids))
        .where(StaffChatRoom.type.in_([ROOM_TYPE_GROUP, ROOM_TYPE_BROADCAST]))
        .order_by(StaffChatRoom.created_at.desc())
    )
    rooms = list(r.scalars().all())
    result = []
    for room in rooms:
        members = await svc.list_room_members(db, room.id)
        is_admin_of_group = any(m.user_id == user.id and m.member_role == "admin" for m in members)
        ru = await db.execute(select(User).where(User.id.in_([m.user_id for m in members])))
        umap = {u.id: u for u in ru.scalars().all()}
        result.append({
            "id": str(room.id),
            "name": room.name,
            "type": room.type,
            "members_count": len(members),
            "members": [
                {
                    **svc.serialize_user_brief(umap[m.user_id]),
                    "member_role": m.member_role,
                } for m in members if m.user_id in umap
            ],
            "is_admin": is_admin_of_group,
            "created_at": room.created_at.isoformat(),
        })
    return {"groups": result}


@router.post("/chat/groups/{room_id}/members", status_code=201)
async def add_members(
    room_id: uuid.UUID,
    payload: MembersAdd,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    _ensure_admin(user)
    room = await svc.get_room(db, room_id)
    if not room or room.type not in (ROOM_TYPE_GROUP, ROOM_TYPE_BROADCAST):
        raise HTTPException(404, "Группа не найдена")
    # Проверяем что user — admin этой группы
    members = await svc.list_room_members(db, room_id)
    me = next((m for m in members if m.user_id == user.id), None)
    if not me or me.member_role != "admin":
        raise HTTPException(403, "Только admin группы может добавлять участников")
    visible = await svc.visible_users_for(db, user)
    visible_ids = {u.id for u in visible}
    existing_ids = {m.user_id for m in members}
    added = 0
    for uid in payload.user_ids:
        if uid in existing_ids or uid not in visible_ids:
            continue
        db.add(StaffChatMember(
            room_id=room_id, user_id=uid,
            member_role=payload.member_role,
        ))
        added += 1
    await db.commit()
    return {"added": added}


@router.delete("/chat/groups/{room_id}/members/{user_id}", status_code=204)
async def remove_member(
    room_id: uuid.UUID,
    user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    _ensure_admin(user)
    room = await svc.get_room(db, room_id)
    if not room or room.type not in (ROOM_TYPE_GROUP, ROOM_TYPE_BROADCAST):
        raise HTTPException(404, "Группа не найдена")
    members = await svc.list_room_members(db, room_id)
    me = next((m for m in members if m.user_id == user.id), None)
    if not me or me.member_role != "admin":
        raise HTTPException(403, "Только admin группы может удалять")
    await db.execute(
        delete(StaffChatMember).where(and_(
            StaffChatMember.room_id == room_id,
            StaffChatMember.user_id == user_id,
        ))
    )
    await db.commit()


class GroupUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


@router.patch("/chat/groups/{room_id}")
async def update_group(
    room_id: uuid.UUID,
    payload: GroupUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Переименовать группу. Только admin группы."""
    _ensure_admin(user)
    room = await svc.get_room(db, room_id)
    if not room or room.type not in (ROOM_TYPE_GROUP, ROOM_TYPE_BROADCAST):
        raise HTTPException(404, "Группа не найдена")
    members = await svc.list_room_members(db, room_id)
    me = next((m for m in members if m.user_id == user.id), None)
    if not me or me.member_role != "admin":
        raise HTTPException(403, "Только admin группы может редактировать")
    room.name = payload.name.strip()
    await db.commit()
    return {"id": str(room.id), "name": room.name}


@router.delete("/chat/groups/{room_id}", status_code=204)
async def delete_group(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Удалить группу полностью (включая все сообщения и файлы). Только admin группы."""
    _ensure_admin(user)
    room = await svc.get_room(db, room_id)
    if not room or room.type not in (ROOM_TYPE_GROUP, ROOM_TYPE_BROADCAST):
        raise HTTPException(404, "Группа не найдена")
    members = await svc.list_room_members(db, room_id)
    me = next((m for m in members if m.user_id == user.id), None)
    if not me or me.member_role != "admin":
        raise HTTPException(403, "Только admin группы может удалить")
    # CASCADE удалит staff_chat_members + staff_chat_messages + staff_chat_files
    await db.execute(delete(StaffChatRoom).where(StaffChatRoom.id == room_id))
    await db.commit()
