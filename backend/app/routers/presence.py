"""
Роутер присутствия и звонков.
WebSocket для real-time + REST для статусов и настроек.
"""
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
import uuid
import json
import asyncio

from app.database import get_db
from app.core.deps import get_current_user
from app.core.tenant import require_module
from app.models.user import User, UserRole
from app.models.presence import UserPresence, PresenceStatus, CallPermission, NotificationSetting, CallLog

router = APIRouter(prefix="/presence", tags=["presence"])

_mod_telephony = Depends(require_module("telephony_basic", "cross_clinic_audio", "video_calls", "video_conference", "call_recording"))


# ── WebSocket менеджер ────────────────────────────────────────────────────────

class PresenceManager:
    """WebSocket presence с Redis Pub/Sub для масштабирования."""

    def __init__(self):
        self.connections: dict[str, WebSocket] = {}
        self._pubsub_tasks: dict[str, asyncio.Task] = {}

    def _redis(self):
        import redis.asyncio as aioredis
        from app.config import settings
        return aioredis.from_url(settings.redis_url, decode_responses=True)

    

async def _allow_call(db, caller, callee) -> bool:
    """Разрешён ли звонок caller→callee.

    - same tenant — всегда true
    - cross-tenant — только если оба тенанта в одной франшизе и у обоих active модуль cross_clinic_audio
    """
    if not caller or not callee:
        return False
    if caller.tenant_id and callee.tenant_id and caller.tenant_id == callee.tenant_id:
        return True
    # Cross-tenant
    if not caller.tenant_id or not callee.tenant_id:
        return False
    from app.models.tenant import Tenant as _T
    from sqlalchemy import select as _sel
    rows = (await db.execute(_sel(_T).where(_T.id.in_([caller.tenant_id, callee.tenant_id])))).scalars().all()
    if len({r.franchise_id for r in rows if r.franchise_id}) != 1:
        return False  # разные франшизы или одна из них без франшизы
    # Проверим что у обоих включен cross_clinic_audio
    from sqlalchemy import text as _text
    r = await db.execute(_text("""
        SELECT COUNT(*) FROM tenant_module_subscriptions
        WHERE tenant_id IN (:a, :b) AND module_key = 'cross_clinic_audio' AND status = 'active'
    """), {"a": str(caller.tenant_id), "b": str(callee.tenant_id)})
    cnt = r.scalar() or 0
    return cnt >= 2

async def connect(self, ws: WebSocket, user_id: str, tenant_id: str | None):
        await ws.accept()
        self.connections[user_id] = ws
        tid = tenant_id or "__global__"
        r = self._redis()
        await r.hset(f"presence:{tid}", user_id, "online")
        await r.expire(f"presence:{tid}", 86400)
        await r.publish(f"pch:{tid}", json.dumps({"event": "join", "user_id": user_id}))
        await r.aclose()
        if tid not in self._pubsub_tasks or self._pubsub_tasks[tid].done():
            self._pubsub_tasks[tid] = asyncio.create_task(self._listen(tid))

    async def disconnect(self, user_id: str, tenant_id: str | None):
        self.connections.pop(user_id, None)
        tid = tenant_id or "__global__"
        r = self._redis()
        await r.hdel(f"presence:{tid}", user_id)
        await r.publish(f"pch:{tid}", json.dumps({"event": "leave", "user_id": user_id}))
        await r.aclose()

    async def broadcast_to_tenant(self, tenant_id: str | None, message: dict, exclude_user: str | None = None):
        """Публикует через Redis — достигает всех инстансов."""
        tid = tenant_id or "__global__"
        payload = {**message, "_exclude": exclude_user}
        r = self._redis()
        await r.publish(f"pch:{tid}", json.dumps(payload))
        await r.aclose()

    async def send_to_user(self, user_id: str, message: dict) -> bool:
        ws = self.connections.get(user_id)
        if ws:
            try:
                await ws.send_json(message)
                return True
            except Exception:
                self.connections.pop(user_id, None)
        return False

    def is_online(self, user_id: str) -> bool:
        return user_id in self.connections

    async def get_online_set(self, tenant_id: str | None) -> set:
        """Множество online user_id из Redis (для всех инстансов)."""
        tid = tenant_id or "__global__"
        r = self._redis()
        keys = await r.hkeys(f"presence:{tid}")
        await r.aclose()
        return set(keys)

    async def _listen(self, tid: str):
        """Слушает Redis канал тенанта и доставляет сообщения локальным WS."""
        import redis.asyncio as aioredis
        from app.config import settings
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        pubsub = r.pubsub()
        await pubsub.subscribe(f"pch:{tid}")
        try:
            async for msg in pubsub.listen():
                if msg["type"] != "message":
                    continue
                try:
                    data = json.loads(msg["data"])
                    exclude = data.pop("_exclude", None)
                    dead = []
                    for uid, ws in list(self.connections.items()):
                        if uid == exclude:
                            continue
                        try:
                            await ws.send_json(data)
                        except Exception:
                            dead.append(uid)
                    for uid in dead:
                        self.connections.pop(uid, None)
                except Exception:
                    pass
        finally:
            await pubsub.unsubscribe(f"pch:{tid}")
            await r.aclose()
            self._pubsub_tasks.pop(tid, None)


presence_manager = PresenceManager()


# ── Активные звонки (в памяти) ─────────────────────────────────────────────
# Ключ — frozenset({caller_id_str, callee_id_str}). Значение — словарь с
# полями {caller_id, callee_id, call_type, started_at, answered_at}.
# Используется для записи CallLog при call_end/call_reject/call_busy.
_ACTIVE_CALLS: dict = {}


async def _allow_call(db, caller, callee) -> bool:
    """Разрешён ли звонок caller→callee.

    - same tenant — всегда true
    - cross-tenant — только если оба тенанта в одной франшизе и у обоих active модуль cross_clinic_audio
    """
    if not caller or not callee:
        return False
    if caller.tenant_id and callee.tenant_id and caller.tenant_id == callee.tenant_id:
        return True
    if not caller.tenant_id or not callee.tenant_id:
        return False
    from app.models.tenant import Tenant as _T
    from sqlalchemy import select as _sel
    rows = (await db.execute(_sel(_T).where(_T.id.in_([caller.tenant_id, callee.tenant_id])))).scalars().all()
    fids = {r.franchise_id for r in rows if r.franchise_id}
    if len(fids) != 1:
        return False
    from sqlalchemy import text as _text
    r = await db.execute(_text("""
        SELECT COUNT(*) FROM tenant_module_subscriptions
        WHERE tenant_id IN (:a, :b) AND module_key = 'cross_clinic_audio' AND status = 'active'
    """), {"a": str(caller.tenant_id), "b": str(callee.tenant_id)})
    cnt = r.scalar() or 0
    return cnt >= 2


def _call_key(a: str, b: str) -> frozenset:
    return frozenset({str(a), str(b)})


async def _save_call_log(
    db: AsyncSession,
    caller_id: str | uuid.UUID,
    callee_id: str | uuid.UUID,
    outcome: str,
    call_type: str = "audio",
    started_at: datetime | None = None,
    answered_at: datetime | None = None,
    tenant_id: uuid.UUID | None = None,
) -> None:
    """Сохраняет запись CallLog. outcome: answered/missed/rejected/busy."""
    try:
        if isinstance(caller_id, str):
            caller_uuid = uuid.UUID(caller_id)
        else:
            caller_uuid = caller_id
        if isinstance(callee_id, str):
            callee_uuid = uuid.UUID(callee_id)
        else:
            callee_uuid = callee_id

        now = datetime.utcnow()
        s_at = started_at or now
        duration = 0
        if outcome == "answered" and answered_at:
            duration = max(0, int((now - answered_at).total_seconds()))

        log_row = CallLog(
            tenant_id=tenant_id,
            caller_id=caller_uuid,
            callee_id=callee_uuid,
            outcome=outcome,
            call_type=call_type or "audio",
            duration_sec=duration,
            started_at=s_at,
            ended_at=now,
        )
        db.add(log_row)
        await db.commit()
    except Exception:
        # Логирование звонка не должно ломать сигнализацию
        try:
            await db.rollback()
        except Exception:
            pass


# ── REST: статус присутствия ──────────────────────────────────────────────────

class UpdatePresenceRequest(BaseModel):
    status: PresenceStatus
    status_text: Optional[str] = None


@router.get("/status")
async def get_my_presence(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Мой текущий статус присутствия."""
    p = (await db.execute(
        select(UserPresence).where(UserPresence.user_id == current_user.id)
    )).scalar_one_or_none()
    if not p:
        return {"status": "offline", "status_text": None}
    return {
        "status": p.status,
        "status_text": p.status_text,
        "last_seen_at": p.last_seen_at.isoformat(),
    }


@router.put("/status")
async def update_my_presence(
    body: UpdatePresenceRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Обновить свой статус присутствия."""
    p = (await db.execute(
        select(UserPresence).where(UserPresence.user_id == current_user.id)
    )).scalar_one_or_none()

    now = datetime.utcnow()
    if p:
        p.status = body.status
        p.status_text = body.status_text
        p.last_seen_at = now
    else:
        p = UserPresence(
            user_id=current_user.id,
            status=body.status,
            status_text=body.status_text,
            last_seen_at=now,
        )
        db.add(p)
    await db.commit()

    # Broadcast обновление всем в тенанте
    tenant_id_str = str(current_user.tenant_id) if current_user.tenant_id else None
    await presence_manager.broadcast_to_tenant(
        tenant_id_str,
        {
            "type": "presence_update",
            "user_id": str(current_user.id),
            "status": body.status,
            "status_text": body.status_text,
        },
        exclude_user=str(current_user.id),
    )

    return {"ok": True, "status": body.status}


@router.get("/users")
async def get_all_presence(
    clinic_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Статус присутствия всех видимых пользователей.
    Врач видит только свою клинику, менеджер — всех.
    """
    from app.models.user import User as UserModel
    from sqlalchemy import and_

    q = select(UserModel, UserPresence).outerjoin(
        UserPresence, UserPresence.user_id == UserModel.id
    )

    # Тенант-фильтр
    if current_user.tenant_id:
        q = q.where(UserModel.tenant_id == current_user.tenant_id)

    # Исключаем роли, которые не участвуют в звонках по умолчанию (см. call_rules_service)
    from app.services.call_rules_service import EXCLUDED_ROLES
    q = q.where(UserModel.role.not_in([r.value for r in EXCLUDED_ROLES]))

    # Врач видит только свою клинику
    if current_user.role == UserRole.REG and current_user.clinic_id:
        q = q.where(UserModel.clinic_id == current_user.clinic_id)
    elif clinic_id:
        try:
            q = q.where(UserModel.clinic_id == uuid.UUID(clinic_id))
        except ValueError:
            pass

    rows = (await db.execute(q)).all()

    # Авто-offline если не было активности 5 мин
    cutoff = datetime.utcnow() - timedelta(minutes=5)

    result = []
    for user, presence in rows:
        if user.id == current_user.id:
            continue  # себя не показываем (фронт знает)

        # WebSocket онлайн?
        ws_online = presence_manager.is_online(str(user.id))
        status = "offline"
        status_text = None
        last_seen = None

        if presence:
            last_seen = presence.last_seen_at
            if ws_online and presence.last_seen_at > cutoff:
                status = presence.status
                status_text = presence.status_text
            else:
                status = "offline"

        result.append({
            "user_id": str(user.id),
            "full_name": user.full_name,
            "role": user.role,
            "clinic_id": str(user.clinic_id) if user.clinic_id else None,
            "status": status,
            "status_text": status_text,
            "last_seen_at": last_seen.isoformat() if last_seen else None,
            "ws_online": ws_online,
        })

    return {"users": result}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@router.websocket("/ws/{user_id}")
async def presence_ws(
    ws: WebSocket,
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    WebSocket для real-time присутствия и сигнализации звонков.
    Протокол:
      CLIENT → SERVER: {"type": "heartbeat"} | {"type": "call_invite", "callee_id": "...", "call_type": "audio"}
      SERVER → CLIENT: {"type": "presence_update", ...} | {"type": "call_invite", ...} | {"type": "call_response", ...}

    Авторизация: JWT-токен в query (?token=...) или в заголовке Sec-WebSocket-Protocol.
    Декодируем его и проверяем что sub == user_id из URL.
    """
    # Простая авторизация по user_id
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        await ws.close(code=4001)
        return

    # ── Шаг 1: извлекаем JWT-токен ─────────────────────────────────────────────
    token = ws.query_params.get("token")
    if not token:
        # fallback: subprotocol (Sec-WebSocket-Protocol)
        subprotos = ws.headers.get("sec-websocket-protocol", "")
        if subprotos:
            token = subprotos.split(",")[0].strip() or None

    if not token:
        await ws.accept()
        await ws.close(code=4001)
        return

    # ── Шаг 2: декодируем и валидируем токен ──────────────────────────────────
    from app.core.security import decode_token
    try:
        payload = decode_token(token)
    except Exception:
        payload = None
    if not payload:
        await ws.accept()
        await ws.close(code=4001)
        return
    token_sub = str(payload.get("sub") or "")
    if token_sub != user_id:
        # JWT валиден, но user из URL не совпадает с владельцем токена
        await ws.accept()
        await ws.close(code=4001)
        return

    user = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if not user:
        await ws.accept()
        await ws.close(code=4004)
        return

    tenant_id_str = str(user.tenant_id) if user.tenant_id else None

    # Подключаем
    await presence_manager.connect(ws, user_id, tenant_id_str)

    # Обновляем статус → online
    p = (await db.execute(select(UserPresence).where(UserPresence.user_id == uid))).scalar_one_or_none()
    if p:
        if p.status == PresenceStatus.OFFLINE:
            p.status = PresenceStatus.ONLINE
        p.last_seen_at = datetime.utcnow()
    else:
        p = UserPresence(user_id=uid, status=PresenceStatus.ONLINE)
        db.add(p)
    await db.commit()

    await presence_manager.broadcast_to_tenant(
        tenant_id_str,
        {"type": "presence_update", "user_id": user_id, "status": "online"},
        exclude_user=user_id,
    )

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type")

            if msg_type == "heartbeat":
                # Обновляем last_seen
                await db.execute(
                    update(UserPresence)
                    .where(UserPresence.user_id == uid)
                    .values(last_seen_at=datetime.utcnow())
                )
                await db.commit()
                await ws.send_json({"type": "pong"})

            elif msg_type == "call_invite":
                # Инициация звонка
                callee_id = data.get("callee_id")
                call_type = data.get("call_type", "audio")

                if not callee_id:
                    await ws.send_json({"type": "error", "msg": "callee_id required"})
                    continue

                # Cross-tenant guard: callee должен быть в одном тенанте с caller
                try:
                    callee_uuid = uuid.UUID(callee_id)
                except (ValueError, TypeError):
                    await ws.send_json({"type": "error", "msg": "bad callee_id"})
                    continue
                callee_user = (await db.execute(
                    select(User).where(User.id == callee_uuid)
                )).scalar_one_or_none()
                if not callee_user or not await _allow_call(db, user, callee_user):
                    await ws.send_json({
                        "type": "call_failed",
                        "reason": "cross_tenant",
                        "callee_id": callee_id,
                    })
                    continue

                # Проверяем статус вызываемого
                callee_presence = (await db.execute(
                    select(UserPresence).where(UserPresence.user_id == callee_uuid)
                )).scalar_one_or_none()

                callee_ws_online = presence_manager.is_online(callee_id)

                if not callee_ws_online:
                    await ws.send_json({
                        "type": "call_failed",
                        "reason": "offline",
                        "callee_id": callee_id,
                    })
                    # Лог: попытка дозвона до offline → missed
                    await _save_call_log(
                        db, user_id, callee_id,
                        outcome="missed", call_type=call_type,
                        tenant_id=user.tenant_id,
                    )
                    continue

                if callee_presence and callee_presence.status == PresenceStatus.BUSY:
                    await ws.send_json({
                        "type": "call_failed",
                        "reason": "busy",
                        "callee_id": callee_id,
                        "status_text": callee_presence.status_text,
                    })
                    await _save_call_log(
                        db, user_id, callee_id,
                        outcome="busy", call_type=call_type,
                        tenant_id=user.tenant_id,
                    )
                    continue

                if callee_presence and callee_presence.status == PresenceStatus.AWAY:
                    await ws.send_json({
                        "type": "call_failed",
                        "reason": "away",
                        "callee_id": callee_id,
                        "status_text": callee_presence.status_text or "Не на месте",
                    })
                    await _save_call_log(
                        db, user_id, callee_id,
                        outcome="missed", call_type=call_type,
                        tenant_id=user.tenant_id,
                    )
                    continue

                # Отправляем вызов
                delivered = await presence_manager.send_to_user(callee_id, {
                    "type": "call_invite",
                    "caller_id": user_id,
                    "caller_name": user.full_name,
                    "call_type": call_type,
                    "sdp_offer": data.get("sdp_offer"),
                })

                if not delivered:
                    await ws.send_json({
                        "type": "call_failed",
                        "reason": "offline",
                        "callee_id": callee_id,
                    })
                    await _save_call_log(
                        db, user_id, callee_id,
                        outcome="missed", call_type=call_type,
                        tenant_id=user.tenant_id,
                    )
                else:
                    await ws.send_json({
                        "type": "call_ringing",
                        "callee_id": callee_id,
                    })
                    # Регистрируем звонок как «ringing» — в памяти ждём ответа.
                    _ACTIVE_CALLS[_call_key(user_id, callee_id)] = {
                        "caller_id": user_id,
                        "callee_id": callee_id,
                        "call_type": call_type,
                        "started_at": datetime.utcnow(),
                        "answered_at": None,
                        "tenant_id": user.tenant_id,
                    }

            elif msg_type in ("call_accept", "call_reject", "call_end", "call_busy"):
                # Ответ на звонок — пересылаем инициатору
                target_id = data.get("caller_id") or data.get("target_id")
                # Cross-tenant guard
                if target_id:
                    try:
                        target_uuid = uuid.UUID(target_id)
                    except (ValueError, TypeError):
                        target_uuid = None
                    if target_uuid:
                        target_user = (await db.execute(
                            select(User).where(User.id == target_uuid)
                        )).scalar_one_or_none()
                        if not target_user or not await _allow_call(db, user, target_user):
                            await ws.send_json({
                                "type": "call_failed",
                                "reason": "cross_tenant",
                                "target_id": target_id,
                            })
                            continue
                    else:
                        target_id = None
                if target_id:
                    await presence_manager.send_to_user(target_id, {
                        **data,
                        "from_id": user_id,
                    })
                # Если accepted → оба BUSY
                if msg_type == "call_accept":
                    await db.execute(
                        update(UserPresence)
                        .where(UserPresence.user_id.in_([uid, uuid.UUID(target_id)]))
                        .values(status=PresenceStatus.BUSY)
                    )
                    await db.commit()
                    # Отмечаем время ответа в активном звонке
                    if target_id:
                        key = _call_key(user_id, target_id)
                        info = _ACTIVE_CALLS.get(key)
                        if info:
                            info["answered_at"] = datetime.utcnow()
                elif msg_type in ("call_end", "call_reject", "call_busy"):
                    # Возврат в ONLINE
                    await db.execute(
                        update(UserPresence)
                        .where(UserPresence.user_id.in_([uid, uuid.UUID(target_id)] if target_id else [uid]))
                        .values(status=PresenceStatus.ONLINE)
                    )
                    await db.commit()
                    # Лог: финализируем CallLog по активному звонку
                    if target_id:
                        key = _call_key(user_id, target_id)
                        info = _ACTIVE_CALLS.pop(key, None)
                        if info:
                            if info.get("answered_at"):
                                outcome = "answered"
                            elif msg_type == "call_reject":
                                outcome = "rejected"
                            elif msg_type == "call_busy":
                                outcome = "busy"
                            else:
                                outcome = "missed"
                            await _save_call_log(
                                db,
                                info["caller_id"],
                                info["callee_id"],
                                outcome=outcome,
                                call_type=info.get("call_type", "audio"),
                                started_at=info.get("started_at"),
                                answered_at=info.get("answered_at"),
                                tenant_id=info.get("tenant_id"),
                            )

            elif msg_type == "ice_candidate":
                # WebRTC ICE candidate relay
                target_id = data.get("target_id")
                if target_id:
                    # Cross-tenant guard
                    try:
                        ice_target_uuid = uuid.UUID(target_id)
                    except (ValueError, TypeError):
                        ice_target_uuid = None
                    if ice_target_uuid:
                        ice_target_user = (await db.execute(
                            select(User).where(User.id == ice_target_uuid)
                        )).scalar_one_or_none()
                        if ice_target_user and ice_target_user.tenant_id == user.tenant_id:
                            await presence_manager.send_to_user(target_id, {
                                "type": "ice_candidate",
                                "candidate": data.get("candidate"),
                                "from_id": user_id,
                            })

    except WebSocketDisconnect:
        pass
    finally:
        await presence_manager.disconnect(user_id, tenant_id_str)
        # → offline
        await db.execute(
            update(UserPresence)
            .where(UserPresence.user_id == uid)
            .values(status=PresenceStatus.OFFLINE, last_seen_at=datetime.utcnow())
        )
        await db.commit()
        await presence_manager.broadcast_to_tenant(
            tenant_id_str,
            {"type": "presence_update", "user_id": user_id, "status": "offline"},
        )


# ── Настройки звонков (матрица ролей) ────────────────────────────────────────

class UpsertCallPermissionRequest(BaseModel):
    from_role: str
    to_role: str
    can_call: bool = True
    can_video: bool = False
    same_clinic_only: bool = False


@router.get("/call-permissions")
async def get_call_permissions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Матрица разрешений на звонки."""
    perms = (await db.execute(
        select(CallPermission).where(
            CallPermission.tenant_id == current_user.tenant_id
        )
    )).scalars().all()

    return {
        "permissions": [
            {
                "id": str(p.id),
                "from_role": p.from_role,
                "to_role": p.to_role,
                "can_call": p.can_call,
                "can_video": p.can_video,
                "same_clinic_only": p.same_clinic_only,
            }
            for p in perms
        ]
    }


@router.post("/call-permissions", dependencies=[_mod_telephony])
async def upsert_call_permission(
    body: UpsertCallPermissionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Установить/обновить разрешение на звонок."""
    if current_user.role not in (UserRole.MANAGER, UserRole.SUPER_ADMIN):
        raise HTTPException(403, "Только менеджер")

    existing = (await db.execute(
        select(CallPermission).where(
            CallPermission.tenant_id == current_user.tenant_id,
            CallPermission.from_role == body.from_role,
            CallPermission.to_role == body.to_role,
        )
    )).scalar_one_or_none()

    if existing:
        existing.can_call = body.can_call
        existing.can_video = body.can_video
        existing.same_clinic_only = body.same_clinic_only
    else:
        perm = CallPermission(
            tenant_id=current_user.tenant_id,
            from_role=body.from_role,
            to_role=body.to_role,
            can_call=body.can_call,
            can_video=body.can_video,
            same_clinic_only=body.same_clinic_only,
        )
        db.add(perm)

    await db.commit()
    return {"ok": True}


# ── Настройки уведомлений ─────────────────────────────────────────────────────

# Все события системы
NOTIFICATION_EVENTS = {
    "referral_created": "Новое направление создано",
    "referral_confirmed": "Направление подтверждено",
    "referral_paid": "Бонус выплачен",
    "referral_cancelled": "Направление отменено",
    "appointment_created": "Запись к врачу создана",
    "appointment_confirmed": "Запись подтверждена клиникой",
    "appointment_cancelled": "Запись отменена",
    "appointment_reminder": "Напоминание о записи (за 24ч)",
    "new_user_registered": "Новый сотрудник зарегистрирован",
    "patient_arrived": "Пациент прибыл (МИС webhook)",
    "ledger_adjusted": "Ручная корректировка реестра",
    "billing_invoice": "Новый счёт выставлен",
}


@router.get("/notification-settings")
async def get_notification_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Настройки уведомлений per-role для тенанта."""
    settings = (await db.execute(
        select(NotificationSetting).where(
            NotificationSetting.tenant_id == current_user.tenant_id
        )
    )).scalars().all()

    by_role = {s.role: s for s in settings}
    roles = ["reg", "manager", "partner_doctor"]

    result = []
    for role in roles:
        s = by_role.get(role)
        result.append({
            "role": role,
            "events": s.events if s else {},
            "channels": s.channels if s else {"sms": False, "telegram": True},
        })

    return {
        "settings": result,
        "available_events": NOTIFICATION_EVENTS,
    }


class UpsertNotificationSettingRequest(BaseModel):
    role: str
    events: dict  # {event_key: bool}
    channels: dict  # {channel: bool}


@router.post("/notification-settings")
async def upsert_notification_setting(
    body: UpsertNotificationSettingRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Сохранить настройки уведомлений для роли."""
    if current_user.role not in (UserRole.MANAGER, UserRole.SUPER_ADMIN):
        raise HTTPException(403, "Только менеджер")

    existing = (await db.execute(
        select(NotificationSetting).where(
            NotificationSetting.tenant_id == current_user.tenant_id,
            NotificationSetting.role == body.role,
        )
    )).scalar_one_or_none()

    if existing:
        existing.events = body.events
        existing.channels = body.channels
    else:
        ns = NotificationSetting(
            tenant_id=current_user.tenant_id,
            role=body.role,
            events=body.events,
            channels=body.channels,
        )
        db.add(ns)

    await db.commit()
    return {"ok": True}


@router.get("/ice-config")
async def ice_config(
    current_user: User = Depends(get_current_user),
):
    """
    Возвращает iceServers для WebRTC: STUN + TURN с time-limited credentials.
    Пароль валиден turn_ttl секунд (default 1ч), генерится через HMAC-SHA1
    от static-auth-secret coturn — стандарт RFC TURN REST API.
    """
    import hmac, hashlib, base64, time
    from app.config import settings

    servers = [
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "stun:stun1.l.google.com:19302"},
    ]

    if settings.turn_host and settings.turn_secret:
        ttl = settings.turn_ttl
        username = f"{int(time.time()) + ttl}:{current_user.id}"
        h = hmac.new(settings.turn_secret.encode(), username.encode(), hashlib.sha1)
        credential = base64.b64encode(h.digest()).decode()
        turn_url_udp = f"turn:{settings.turn_host}:{settings.turn_port}?transport=udp"
        turn_url_tcp = f"turn:{settings.turn_host}:{settings.turn_port}?transport=tcp"
        servers.append({"urls": [turn_url_udp, turn_url_tcp], "username": username, "credential": credential})

    return {"iceServers": servers, "ttl": settings.turn_ttl if settings.turn_secret else 0}


@router.get("/can-call")
async def can_call(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Проверяет доступность аудио и видео звонков для тенанта."""
    from app.models.commercial import TenantModuleSubscription, ModuleStatus
    if not current_user.tenant_id:
        return {"enabled": False, "audio": False, "video": False}

    async def _sub(key: str):
        return (await db.execute(
            select(TenantModuleSubscription).where(
                TenantModuleSubscription.tenant_id == current_user.tenant_id,
                TenantModuleSubscription.module_key == key,
                TenantModuleSubscription.status.in_([ModuleStatus.ACTIVE, ModuleStatus.TRIAL, ModuleStatus.GRACE]),
            )
        )).scalar_one_or_none()

    audio_sub = await _sub("telephony_basic")
    video_sub = await _sub("video_calls")
    audio = audio_sub is not None
    video = video_sub is not None

    in_grace = False
    grace_until = None
    for sub in (audio_sub, video_sub):
        if sub and sub.status == ModuleStatus.GRACE and sub.grace_until:
            if not grace_until or sub.grace_until < grace_until:
                grace_until = sub.grace_until
            in_grace = True

    return {
        "enabled": audio or video,
        "audio": audio,
        "video": video,
        "in_grace": in_grace,
        "grace_until": grace_until.isoformat() if grace_until else None,
    }


@router.get("/can-call-target/{target_user_id}")
async def can_call_target(
    target_user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает {allow_audio, allow_video} для пары current_user → target по правилам."""
    from app.services.call_rules_service import check_can_call
    try:
        tid = uuid.UUID(target_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    target = (await db.execute(select(User).where(User.id == tid))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    return await check_can_call(current_user, target, db)
