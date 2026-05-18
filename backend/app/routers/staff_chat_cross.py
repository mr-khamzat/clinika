"""
Cross-tenant StaffChat — общие комнаты для всех клиник одной франшизы.

Endpoints (prefix `/staff-chat`):
  POST /cross-rooms                          — создать cross-tenant room
  GET  /cross-rooms                          — список cross-rooms, доступных мне
  GET  /cross-rooms/{room_id}/members-by-tenant
                                             — члены, сгруппированные по тенантам
  POST /cross-rooms/{room_id}/add-tenant-users
                                             — массово добавить членов из тенанта

Доступ к созданию / администрированию:
  - franchise_owner (по своей франшизе)
  - super_admin (для отладки)
  - director / deputy_director (по своей франшизе)

Изоляция:
  * Cross-room привязан к франшизе (`franchise_id`) и к тенанту инициатора
    (`tenant_id` — обязательное по схеме). Сам флаг `is_cross_tenant=True`.
  * Members могут быть из любого тенанта, у которого `franchise_id` совпадает
    с франшизой комнаты. Платформенный super_admin может добавить любого.
"""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.staff_chat import (
    StaffChatRoom,
    StaffChatMember,
    ROOM_TYPE_GROUP,
)


router = APIRouter(prefix="/staff-chat", tags=["staff-chat-cross"])


# ── helpers ──────────────────────────────────────────────────────────────────
def _ensure_not_patient(user: User) -> None:
    """Пациенты не имеют доступа к StaffChat в принципе."""
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role == "patient":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Пациентам недоступен чат сотрудников",
        )


# Роли, которые могут создавать / администрировать cross-tenant rooms
_ADMIN_ROLES = {
    UserRole.FRANCHISE_OWNER,
    UserRole.SUPER_ADMIN,
    UserRole.DIRECTOR,
    UserRole.DEPUTY_DIRECTOR,
}


def _ensure_room_admin_role(user: User) -> None:
    """Проверяет, что роль пользователя позволяет управлять cross-rooms."""
    if user.role not in _ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Управление общими комнатами франшизы доступно только владельцу "
                "франшизы, директору или его заместителю"
            ),
        )


async def _resolve_user_franchise_id(
    db: AsyncSession, user: User
) -> uuid.UUID | None:
    """Возвращает franchise_id пользователя через его тенант.

    Super_admin без тенанта обслуживается через явный параметр в payload.
    """
    if user.tenant_id is None:
        return None
    r = await db.execute(
        select(Tenant.franchise_id).where(Tenant.id == user.tenant_id)
    )
    return r.scalar_one_or_none()


async def _list_tenant_ids_of_franchise(
    db: AsyncSession, franchise_id: uuid.UUID
) -> list[uuid.UUID]:
    """Все active tenant_id указанной франшизы."""
    r = await db.execute(
        select(Tenant.id).where(
            and_(Tenant.franchise_id == franchise_id, Tenant.is_active == True)  # noqa: E712
        )
    )
    return [row[0] for row in r.all()]


async def _list_active_staff_users(
    db: AsyncSession, tenant_ids: list[uuid.UUID]
) -> list[User]:
    """Все active сотрудники (не PATIENT) из указанных тенантов."""
    if not tenant_ids:
        return []
    r = await db.execute(
        select(User).where(
            and_(
                User.tenant_id.in_(tenant_ids),
                User.is_active == True,  # noqa: E712
                User.role != UserRole.PATIENT,
            )
        )
    )
    return list(r.scalars().all())


async def _get_cross_room_or_404(
    db: AsyncSession, room_id: uuid.UUID
) -> StaffChatRoom:
    r = await db.execute(select(StaffChatRoom).where(StaffChatRoom.id == room_id))
    room = r.scalar_one_or_none()
    if not room:
        raise HTTPException(404, "Комната не найдена")
    if not room.is_cross_tenant:
        raise HTTPException(400, "Это не cross-tenant комната")
    return room


async def _ensure_can_manage_room(
    db: AsyncSession, user: User, room: StaffChatRoom
) -> None:
    """Может администрировать только super_admin или owner_role своей франшизы."""
    if user.role == UserRole.SUPER_ADMIN:
        return
    _ensure_room_admin_role(user)
    user_fr = await _resolve_user_franchise_id(db, user)
    if room.franchise_id is None or user_fr != room.franchise_id:
        raise HTTPException(403, "Эта комната принадлежит другой франшизе")


# ── Pydantic ─────────────────────────────────────────────────────────────────
class CrossRoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    # Если None — добавляем всех активных не-PATIENT юзеров всех тенантов франшизы.
    member_user_ids: list[uuid.UUID] | None = None


class AddTenantUsers(BaseModel):
    tenant_id: uuid.UUID
    # Литерал "all_active" — добавить всех активных не-PATIENT юзеров тенанта.
    user_ids: list[uuid.UUID] | Literal["all_active"] | None = None


# ── POST /cross-rooms ────────────────────────────────────────────────────────
@router.post("/cross-rooms", status_code=201)
async def create_cross_room(
    payload: CrossRoomCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Создать cross-tenant комнату на уровне всей франшизы.

    Если `member_user_ids` не задан — добавит ВСЕХ активных не-PATIENT юзеров
    всех тенантов франшизы (включая инициатора).
    """
    _ensure_not_patient(user)
    _ensure_room_admin_role(user)

    franchise_id = await _resolve_user_franchise_id(db, user)
    if franchise_id is None:
        raise HTTPException(
            400,
            "Текущий пользователь не привязан к франшизе — создать общую комнату нельзя",
        )

    if user.tenant_id is None:
        raise HTTPException(400, "У пользователя не задан tenant_id")

    # Список тенантов франшизы — для валидации членов
    tenant_ids = await _list_tenant_ids_of_franchise(db, franchise_id)
    if not tenant_ids:
        raise HTTPException(400, "В франшизе нет активных тенантов")

    # 1) Создаём саму комнату
    room = StaffChatRoom(
        tenant_id=user.tenant_id,  # тенант инициатора (схема требует NOT NULL)
        franchise_id=franchise_id,
        is_cross_tenant=True,
        type=ROOM_TYPE_GROUP,
        name=payload.name.strip(),
        description=payload.description,
        created_by_id=user.id,
    )
    db.add(room)
    await db.flush()  # нужен room.id для members

    # 2) Резолвим членов
    if payload.member_user_ids is None:
        # все активные не-PATIENT юзеры всех тенантов франшизы
        users_to_add = await _list_active_staff_users(db, tenant_ids)
    else:
        if not payload.member_user_ids:
            users_to_add = []
        else:
            r = await db.execute(
                select(User).where(
                    and_(
                        User.id.in_(payload.member_user_ids),
                        User.tenant_id.in_(tenant_ids),
                        User.is_active == True,  # noqa: E712
                        User.role != UserRole.PATIENT,
                    )
                )
            )
            users_to_add = list(r.scalars().all())

    # 3) Гарантируем, что инициатор тоже член (как admin)
    member_ids_seen: set[uuid.UUID] = set()
    db.add(
        StaffChatMember(
            room_id=room.id, user_id=user.id, member_role="admin"
        )
    )
    member_ids_seen.add(user.id)

    for u in users_to_add:
        if u.id in member_ids_seen:
            continue
        db.add(
            StaffChatMember(
                room_id=room.id,
                user_id=u.id,
                member_role="member",
            )
        )
        member_ids_seen.add(u.id)

    await db.commit()
    await db.refresh(room)

    return {
        "id": str(room.id),
        "name": room.name,
        "description": room.description,
        "franchise_id": str(room.franchise_id),
        "tenant_id": str(room.tenant_id),
        "is_cross_tenant": True,
        "type": room.type,
        "members_count": len(member_ids_seen),
        "created_at": room.created_at.isoformat(),
    }


# ── GET /cross-rooms ─────────────────────────────────────────────────────────
@router.get("/cross-rooms")
async def list_cross_rooms(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Список cross-tenant комнат, доступных текущему пользователю.

    Видим:
      - комнаты, в которых я — member;
      - комнаты МОЕЙ франшизы, если у меня admin-роль (franchise_owner /
        director / deputy_director) — даже если я не член.
      - super_admin видит все cross-rooms.
    """
    _ensure_not_patient(user)

    # 1) комнаты, где я член
    member_q = select(StaffChatMember.room_id).where(
        StaffChatMember.user_id == user.id
    )

    if user.role == UserRole.SUPER_ADMIN:
        # super_admin — все cross-rooms
        r = await db.execute(
            select(StaffChatRoom)
            .where(StaffChatRoom.is_cross_tenant == True)  # noqa: E712
            .order_by(StaffChatRoom.last_message_at.desc().nullslast())
        )
    elif user.role in _ADMIN_ROLES:
        # admin-роль франшизы → все комнаты своей франшизы + где я член
        franchise_id = await _resolve_user_franchise_id(db, user)
        r = await db.execute(
            select(StaffChatRoom)
            .where(
                and_(
                    StaffChatRoom.is_cross_tenant == True,  # noqa: E712
                    or_(
                        StaffChatRoom.franchise_id == franchise_id,
                        StaffChatRoom.id.in_(member_q),
                    ),
                )
            )
            .order_by(StaffChatRoom.last_message_at.desc().nullslast())
        )
    else:
        # обычные сотрудники — только где член
        r = await db.execute(
            select(StaffChatRoom)
            .where(
                and_(
                    StaffChatRoom.is_cross_tenant == True,  # noqa: E712
                    StaffChatRoom.id.in_(member_q),
                )
            )
            .order_by(StaffChatRoom.last_message_at.desc().nullslast())
        )

    rooms = list(r.scalars().all())

    return {
        "rooms": [
            {
                "id": str(room.id),
                "name": room.name,
                "description": room.description,
                "franchise_id": str(room.franchise_id) if room.franchise_id else None,
                "tenant_id": str(room.tenant_id),
                "type": room.type,
                "is_cross_tenant": True,
                "last_message_at": room.last_message_at.isoformat()
                if room.last_message_at
                else None,
                "created_at": room.created_at.isoformat(),
            }
            for room in rooms
        ]
    }


# ── GET /cross-rooms/{room_id}/members-by-tenant ─────────────────────────────
@router.get("/cross-rooms/{room_id}/members-by-tenant")
async def list_members_by_tenant(
    room_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Возвращает членов комнаты, сгруппированных по их тенантам.

    Доступ:
      - super_admin;
      - admin-роль своей франшизы;
      - любой member комнаты (read-only).
    """
    _ensure_not_patient(user)
    room = await _get_cross_room_or_404(db, room_id)

    # Доступ — admin своей франшизы ИЛИ член комнаты
    can_view = False
    if user.role == UserRole.SUPER_ADMIN:
        can_view = True
    elif user.role in _ADMIN_ROLES:
        user_fr = await _resolve_user_franchise_id(db, user)
        if room.franchise_id and user_fr == room.franchise_id:
            can_view = True
    if not can_view:
        # проверим членство
        r = await db.execute(
            select(StaffChatMember).where(
                and_(
                    StaffChatMember.room_id == room_id,
                    StaffChatMember.user_id == user.id,
                )
            )
        )
        if r.scalar_one_or_none() is not None:
            can_view = True
    if not can_view:
        raise HTTPException(403, "Нет доступа к этой комнате")

    # Берём всех членов + их юзеров + их тенанты
    r = await db.execute(
        select(StaffChatMember).where(StaffChatMember.room_id == room_id)
    )
    members = list(r.scalars().all())
    user_ids = [m.user_id for m in members]

    users_map: dict[uuid.UUID, User] = {}
    if user_ids:
        r2 = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_map = {u.id: u for u in r2.scalars().all()}

    tenant_ids = {u.tenant_id for u in users_map.values() if u.tenant_id}
    tenants_map: dict[uuid.UUID, Tenant] = {}
    if tenant_ids:
        r3 = await db.execute(select(Tenant).where(Tenant.id.in_(tenant_ids)))
        tenants_map = {t.id: t for t in r3.scalars().all()}

    # Группируем
    groups: dict[str, dict] = {}
    for m in members:
        u = users_map.get(m.user_id)
        if not u:
            continue
        tkey = str(u.tenant_id) if u.tenant_id else "no-tenant"
        if tkey not in groups:
            tenant = tenants_map.get(u.tenant_id) if u.tenant_id else None
            groups[tkey] = {
                "tenant_id": str(u.tenant_id) if u.tenant_id else None,
                "tenant_name": tenant.name if tenant else "(без тенанта)",
                "tenant_slug": tenant.slug if tenant else None,
                "members": [],
            }
        groups[tkey]["members"].append(
            {
                "user_id": str(u.id),
                "full_name": getattr(u, "full_name", None) or u.username,
                "username": u.username,
                "role": u.role.value if hasattr(u.role, "value") else str(u.role),
                "member_role": m.member_role,
                "joined_at": m.joined_at.isoformat() if m.joined_at else None,
            }
        )

    return {
        "room_id": str(room.id),
        "franchise_id": str(room.franchise_id) if room.franchise_id else None,
        "groups": sorted(groups.values(), key=lambda g: (g["tenant_name"] or "")),
        "total_members": len(members),
    }


# ── POST /cross-rooms/{room_id}/add-tenant-users ─────────────────────────────
@router.post("/cross-rooms/{room_id}/add-tenant-users")
async def add_tenant_users(
    room_id: uuid.UUID,
    payload: AddTenantUsers,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Массово добавить членов из указанного тенанта.

    - `user_ids` = "all_active" или None → все активные не-PATIENT юзеры тенанта.
    - `user_ids` = [uuid, ...] → только перечисленные (отфильтрованные по тенанту).
    """
    _ensure_not_patient(user)
    room = await _get_cross_room_or_404(db, room_id)
    await _ensure_can_manage_room(db, user, room)

    # tenant_id должен принадлежать той же франшизе
    if room.franchise_id is None:
        raise HTTPException(400, "Комната не привязана к франшизе")
    r = await db.execute(
        select(Tenant).where(
            and_(
                Tenant.id == payload.tenant_id,
                Tenant.franchise_id == room.franchise_id,
            )
        )
    )
    target_tenant = r.scalar_one_or_none()
    if target_tenant is None:
        raise HTTPException(
            400, "Тенант не принадлежит франшизе этой комнаты"
        )

    # Подбираем юзеров
    if payload.user_ids is None or payload.user_ids == "all_active":
        users_to_add = await _list_active_staff_users(db, [payload.tenant_id])
    else:
        if not payload.user_ids:
            users_to_add = []
        else:
            r2 = await db.execute(
                select(User).where(
                    and_(
                        User.id.in_(payload.user_ids),
                        User.tenant_id == payload.tenant_id,
                        User.is_active == True,  # noqa: E712
                        User.role != UserRole.PATIENT,
                    )
                )
            )
            users_to_add = list(r2.scalars().all())

    # Существующие члены — чтобы не нарушить PK
    r3 = await db.execute(
        select(StaffChatMember.user_id).where(StaffChatMember.room_id == room_id)
    )
    existing_ids = {row[0] for row in r3.all()}

    added = 0
    skipped = 0
    for u in users_to_add:
        if u.id in existing_ids:
            skipped += 1
            continue
        db.add(
            StaffChatMember(
                room_id=room_id, user_id=u.id, member_role="member"
            )
        )
        existing_ids.add(u.id)
        added += 1

    await db.commit()

    return {
        "room_id": str(room_id),
        "tenant_id": str(payload.tenant_id),
        "added": added,
        "skipped_already_member": skipped,
        "total_in_room": len(existing_ids),
    }
