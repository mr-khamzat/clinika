"""
Webhook owner-бота (@stclinika_bot) — двусторонний обмен между Telegram и /staff-chat.

Поддерживается:
- Reply на текстовое уведомление → текстовое сообщение в чат
- Отправка файла (document/photo/video/audio) в Reply → файл скачивается с
  Telegram-серверов и кладётся в /staff-chat как attachment с TTL 48 часов

Принцип room-маркера:
1. При отправке нотификации (см. staff_chat.post_room_message) мы добавляем
   к caption/тексту маркер `room:<UUID>` в <code>.
2. Telegram присылает webhook POST → /api/owner-bot/webhook.
3. Если update.message.reply_to_message содержит маркер → извлекаем room_id,
   проверяем что owner является участником, создаём сообщение
   (текст и/или attachments) и бродкастим через WS.

Безопасность:
- OWNER_BOT_WEBHOOK_SECRET (если задан) проверяется через
  X-Telegram-Bot-Api-Secret-Token (Telegram отправляет его в каждом запросе).
- Доверяем только сообщениям от OWNER_TELEGRAM_ID.
"""
import os
import re
import uuid
import logging
import mimetypes
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Request, HTTPException, Header
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.models.staff_chat import StaffChatFile
from app.services import staff_chat_service as svc
from app.config import settings


log = logging.getLogger("owner_bot_webhook")
router = APIRouter(prefix="/owner-bot", tags=["owner-bot"])

# Маркер в тексте нотификации: room:<uuid>
ROOM_MARKER_RE = re.compile(r"room:([0-9a-fA-F-]{36})")

# Storage для входящих TG-файлов — тот же что и для /staff-chat вложений
STORAGE_ROOT = Path("/opt/clinika/data/staff_chat_files")
FILE_TTL_HOURS = 48


async def _download_telegram_file(file_id: str, suggested_name: str = "file") -> Optional[dict]:
    """Скачивает файл с Telegram-серверов.
    Возвращает dict {storage_path, filename, size, mime} или None при ошибке.

    Последовательность:
    1. getFile → file_path
    2. GET https://api.telegram.org/file/bot{TOKEN}/{file_path} → байты
    3. Сохраняем в /opt/clinika/data/staff_chat_files/<date>/<uuid>_<filename>
    """
    token = (settings.owner_bot_token or "").strip()
    if not token:
        return None
    proxy_url = os.environ.get(
        "TELEGRAM_PROXY_URL",
        "http://clinikabot:lT9k2Pq8mNxF5jB3@144.31.89.167:8080",
    )
    api_get = f"https://api.telegram.org/bot{token}/getFile"
    try:
        async with httpx.AsyncClient(timeout=30, proxy=proxy_url) as client:
            r = await client.post(api_get, data={"file_id": file_id})
            if r.status_code != 200:
                log.warning(f"getFile failed {r.status_code}: {r.text[:200]}")
                return None
            j = r.json()
            if not j.get("ok"):
                log.warning(f"getFile not ok: {j}")
                return None
            file_path = j["result"]["file_path"]
            file_size = j["result"].get("file_size") or 0
            # Скачиваем сам файл
            file_url = f"https://api.telegram.org/file/bot{token}/{file_path}"
            r2 = await client.get(file_url)
            if r2.status_code != 200:
                log.warning(f"file download failed {r2.status_code}")
                return None
            content = r2.content

        # Сохраняем на диск
        base_name = Path(file_path).name
        # Если suggested_name содержит "осмысленное" имя — используем его
        safe_name = suggested_name if suggested_name and "." in suggested_name else base_name
        safe_name = safe_name.replace("/", "_").replace("\\", "_")[:200]
        day_dir = STORAGE_ROOT / datetime.utcnow().strftime("%Y-%m-%d")
        day_dir.mkdir(parents=True, exist_ok=True)
        file_id_uuid = uuid.uuid4()
        storage_path = day_dir / f"{file_id_uuid}_{safe_name}"
        with open(storage_path, "wb") as fh:
            fh.write(content)
        mime = mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
        return {
            "id": file_id_uuid,
            "filename": safe_name,
            "storage_path": str(storage_path),
            "size": len(content) or file_size,
            "mime": mime,
        }
    except Exception as e:
        log.error(f"download tg file error: {e}")
        return None


@router.post("/webhook")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: Optional[str] = Header(None),
):
    # Опциональный secret-токен
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

    reply_to = msg.get("reply_to_message")
    if not reply_to:
        return {"ok": True, "skip": "not a reply"}

    from_user = msg.get("from") or {}
    from_id = str(from_user.get("id") or "")
    owner_tg = (settings.owner_telegram_id or "").strip()
    if owner_tg and from_id != owner_tg:
        return {"ok": True, "skip": "not from owner"}

    # Маркер room:<uuid> ищем в text+caption original notification (наш bot caption под документом)
    orig_text = (reply_to.get("text") or "") + " " + (reply_to.get("caption") or "")
    m = ROOM_MARKER_RE.search(orig_text)
    if not m:
        return {"ok": True, "skip": "no room marker"}
    try:
        room_id = uuid.UUID(m.group(1))
    except Exception:
        return {"ok": True, "skip": "bad room_id"}

    # Текст: либо обычный text, либо caption под медиа
    body = (msg.get("text") or msg.get("caption") or "").strip()

    # Файлы: document / photo / video / audio / voice
    attachments_to_save: list[dict] = []  # raw (file_id, filename, mime hint)
    if msg.get("document"):
        d = msg["document"]
        attachments_to_save.append({
            "file_id": d["file_id"],
            "filename": d.get("file_name") or "document",
            "size_hint": d.get("file_size"),
        })
    elif msg.get("photo"):
        # photo — массив размеров, берём самый большой (последний)
        p = msg["photo"][-1]
        attachments_to_save.append({
            "file_id": p["file_id"],
            "filename": f"photo_{p['file_id'][-8:]}.jpg",
            "size_hint": p.get("file_size"),
        })
    elif msg.get("video"):
        v = msg["video"]
        attachments_to_save.append({
            "file_id": v["file_id"],
            "filename": v.get("file_name") or f"video_{v['file_id'][-8:]}.mp4",
            "size_hint": v.get("file_size"),
        })
    elif msg.get("audio"):
        a = msg["audio"]
        attachments_to_save.append({
            "file_id": a["file_id"],
            "filename": a.get("file_name") or f"audio_{a['file_id'][-8:]}.mp3",
            "size_hint": a.get("file_size"),
        })
    elif msg.get("voice"):
        vo = msg["voice"]
        attachments_to_save.append({
            "file_id": vo["file_id"],
            "filename": f"voice_{vo['file_id'][-8:]}.ogg",
            "size_hint": vo.get("file_size"),
        })

    if not body and not attachments_to_save:
        return {"ok": True, "skip": "empty body and no attachments"}

    # Найти отправителя в БД
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

        if not await svc.is_member(db, room_id, sender.id):
            return {"ok": False, "error": "owner is not a member of this room"}

        room = await svc.get_room(db, room_id)
        if not room:
            return {"ok": False, "error": "room not found"}

        # Скачиваем файлы с Telegram (вне БД-транзакции — может занять секунды)
    saved_files_meta: list[dict] = []
    for att in attachments_to_save:
        meta = await _download_telegram_file(att["file_id"], att["filename"])
        if not meta:
            continue
        saved_files_meta.append(meta)

    # Создаём DB-записи файлов и сообщение
    async with AsyncSessionLocal() as db:
        attachments_for_msg: list[dict] = []
        for meta in saved_files_meta:
            f = StaffChatFile(
                id=meta["id"],
                room_id=room_id,
                uploaded_by_id=sender.id,
                filename=meta["filename"],
                mime=meta["mime"],
                size_bytes=meta["size"],
                storage_path=meta["storage_path"],
                expires_at=datetime.utcnow() + timedelta(hours=FILE_TTL_HOURS),
            )
            db.add(f)
            attachments_for_msg.append({
                "id": str(meta["id"]),
                "filename": meta["filename"],
                "mime": meta["mime"],
                "size": meta["size"],
                "url": f"/api/staff-chat/files/{meta['id']}/download",
            })

        # Если body пустое и есть файлы — добавим placeholder, чтобы сообщение не было совсем пустым
        if not body and attachments_for_msg:
            body = "📎 файл из Telegram"

        try:
            new_msg = await svc.send_message(
                db, room, sender,
                body=body,
                attachments=attachments_for_msg if attachments_for_msg else None,
            )
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

    return {
        "ok": True,
        "message_id": str(new_msg.id),
        "attachments_received": len(attachments_for_msg),
    }
