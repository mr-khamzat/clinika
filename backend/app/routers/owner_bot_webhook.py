"""
Webhook owner-бота (@stclinika_bot) — двусторонний ответ из Telegram в чат.

Пользователь получает уведомление о новом сообщении в /staff-chat и может
отправить ответ прямо из Telegram, использовав функцию «Reply» (свайп влево
по сообщению или зажатие). Ответ попадёт обратно в тот же чат-комнату.

Принцип работы:
1. При отправке нотификации (см. staff_chat.post_room_message) мы добавляем
   к тексту скрытый маркер вида `room:<UUID>` — он не виден глазом
   (помещён в <i>…</i> снизу), но сохраняется в reply_to_message.
2. Telegram присылает webhook POST → /api/owner-bot/webhook с update.
3. Если update.message.reply_to_message содержит наш маркер — извлекаем
   room_id, проверяем что owner является участником, создаём сообщение
   и бродкастим через WS.

Безопасность:
- OWNER_BOT_WEBHOOK_SECRET (если задан) проверяется через
  X-Telegram-Bot-Api-Secret-Token (Telegram отправляет его в каждом запросе).
- Доверяем только сообщениям от OWNER_TELEGRAM_ID.
"""
import re
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Request, HTTPException, Header
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.services import staff_chat_service as svc
from app.config import settings


log = logging.getLogger("owner_bot_webhook")
router = APIRouter(prefix="/owner-bot", tags=["owner-bot"])

# Маркер в тексте нотификации: room:<uuid>
ROOM_MARKER_RE = re.compile(r"room:([0-9a-fA-F-]{36})")


@router.post("/webhook")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: Optional[str] = Header(None),
):
    # Опциональный secret-токен — Telegram добавляет его в заголовок,
    # если был указан при setWebhook. Защищает от подделки запросов.
    secret = (getattr(settings, "owner_bot_webhook_secret", "") or "").strip()
    if secret and x_telegram_bot_api_secret_token != secret:
        raise HTTPException(403, "invalid webhook secret")

    try:
        update = await request.json()
    except Exception:
        raise HTTPException(400, "bad JSON")

    msg = update.get("message") or update.get("edited_message")
    if not msg:
        return {"ok": True, "skip": "no message"}

    # Принимаем только ответы (reply_to_message) — иначе непонятно куда отвечать
    reply_to = msg.get("reply_to_message")
    if not reply_to:
        return {"ok": True, "skip": "not a reply"}

    # Только от владельца (OWNER_TELEGRAM_ID)
    from_user = msg.get("from") or {}
    from_id = str(from_user.get("id") or "")
    owner_tg = (settings.owner_telegram_id or "").strip()
    if owner_tg and from_id != owner_tg:
        return {"ok": True, "skip": "not from owner"}

    # Ищем маркер room:<uuid> в исходном тексте нотификации
    orig_text = (reply_to.get("text") or "") + " " + (reply_to.get("caption") or "")
    m = ROOM_MARKER_RE.search(orig_text)
    if not m:
        return {"ok": True, "skip": "no room marker"}
    try:
        room_id = uuid.UUID(m.group(1))
    except Exception:
        return {"ok": True, "skip": "bad room_id"}

    body = (msg.get("text") or msg.get("caption") or "").strip()
    if not body:
        return {"ok": True, "skip": "empty body"}

    # Найти отправителя в БД: сначала по telegram_id, fallback на super_admin
    async with AsyncSessionLocal() as db:
        r = await db.execute(select(User).where(User.telegram_id == from_id))
        sender = r.scalar_one_or_none()
        if not sender:
            r = await db.execute(
                select(User).where(User.role == UserRole.SUPER_ADMIN).limit(1)
            )
            sender = r.scalar_one_or_none()
        if not sender:
            return {"ok": False, "error": "owner user not found"}

        # Проверяем что он реально участник комнаты (RBAC)
        if not await svc.is_member(db, room_id, sender.id):
            return {"ok": False, "error": "owner is not a member of this room"}

        room = await svc.get_room(db, room_id)
        if not room:
            return {"ok": False, "error": "room not found"}

        try:
            new_msg = await svc.send_message(db, room, sender, body=body)
            await db.commit()
        except ValueError as e:
            await db.rollback()
            return {"ok": False, "error": str(e)}

    # Бродкаст всем участникам через WS
    try:
        from app.routers.staff_chat import ws_hub
        await ws_hub.broadcast_to_room(
            room_id, {"type": "message:new", "data": svc.serialize_message(new_msg)}
        )
    except Exception as e:
        log.warning(f"WS broadcast failed: {e}")

    return {"ok": True, "message_id": str(new_msg.id)}
