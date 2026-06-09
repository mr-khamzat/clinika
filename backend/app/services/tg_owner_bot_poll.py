"""Long-polling owner-бота через getUpdates.

Telegram webhook не может достучаться до нашего сервера (Connection timeout),
поэтому переключаемся на pull-модель: бэкенд сам вызывает getUpdates каждые
~5 секунд (long-poll с timeout=20 на стороне Telegram).

State (last update_id) хранится в /opt/clinika/data/tg_owner_offset.txt.

Запускается через APScheduler `interval=5, max_instances=1`.
"""
import json
import logging
import os
import re
import uuid
import mimetypes
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.models.staff_chat import StaffChatFile
from app.services import staff_chat_service as svc


log = logging.getLogger("tg_owner_poll")
OFFSET_FILE = Path("/opt/clinika/data/tg_owner_offset.txt")
STORAGE_ROOT = Path("/opt/clinika/data/staff_chat_files")
FILE_TTL_HOURS = 48
ROOM_MARKER_RE = re.compile(r"room:([0-9a-fA-F-]{36})")


def _proxy_url() -> str:
    return os.environ.get(
        "TELEGRAM_PROXY_URL",
        "http://clinikabot:lT9k2Pq8mNxF5jB3@144.31.89.167:8080",
    )


def _load_offset() -> int:
    try:
        if OFFSET_FILE.exists():
            return int(OFFSET_FILE.read_text().strip() or "0")
    except Exception:
        pass
    return 0


def _save_offset(offset: int) -> None:
    try:
        OFFSET_FILE.parent.mkdir(parents=True, exist_ok=True)
        OFFSET_FILE.write_text(str(offset))
    except Exception as e:
        log.warning(f"failed to save offset: {e}")


async def _download_telegram_file(file_id: str, suggested_name: str = "file") -> Optional[dict]:
    """Скачивает файл с Telegram-серверов через bot/getFile + bot/file/<path>."""
    token = (settings.owner_bot_token or "").strip()
    if not token:
        return None
    proxy = _proxy_url()
    api_get = f"https://api.telegram.org/bot{token}/getFile"
    try:
        async with httpx.AsyncClient(timeout=30, proxy=proxy) as client:
            r = await client.post(api_get, data={"file_id": file_id})
            if r.status_code != 200:
                log.warning(f"getFile failed: {r.status_code} {r.text[:200]}")
                return None
            j = r.json()
            if not j.get("ok"):
                return None
            file_path = j["result"]["file_path"]
            file_size = j["result"].get("file_size") or 0
            file_url = f"https://api.telegram.org/file/bot{token}/{file_path}"
            r2 = await client.get(file_url)
            if r2.status_code != 200:
                log.warning(f"file dl failed: {r2.status_code}")
                return None
            content = r2.content

        base_name = Path(file_path).name
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


async def _process_update(update: dict) -> None:
    # 1) callback_query (нажатие inline-кнопки) → админ-бот
    if "callback_query" in update:
        try:
            from app.services.tg_admin_bot import handle_callback
            handled = await handle_callback(update["callback_query"])
            if handled:
                return
        except Exception as e:
            log.warning(f"admin callback failed: {e}")
            return

    msg = update.get("message") or update.get("edited_message")
    if not msg:
        return

    # 2) Команды /start, /help, /admin, /menu → админ-бот
    try:
        from app.services.tg_admin_bot import handle_command
        if await handle_command(msg):
            return
    except Exception as e:
        log.warning(f"admin command failed: {e}")

    reply_to = msg.get("reply_to_message")
    if not reply_to:
        return

    from_user = msg.get("from") or {}
    from_id = str(from_user.get("id") or "")
    owner_tg = (settings.owner_telegram_id or "").strip()
    if owner_tg and from_id != owner_tg:
        return

    orig_text = (reply_to.get("text") or "") + " " + (reply_to.get("caption") or "")
    m = ROOM_MARKER_RE.search(orig_text)
    if not m:
        return
    try:
        room_id = uuid.UUID(m.group(1))
    except Exception:
        return

    body = (msg.get("text") or msg.get("caption") or "").strip()

    attachments_to_save: list[dict] = []
    if msg.get("document"):
        d = msg["document"]
        attachments_to_save.append({
            "file_id": d["file_id"],
            "filename": d.get("file_name") or "document",
        })
    elif msg.get("photo"):
        p = msg["photo"][-1]
        attachments_to_save.append({
            "file_id": p["file_id"],
            "filename": f"photo_{p['file_id'][-8:]}.jpg",
        })
    elif msg.get("video"):
        v = msg["video"]
        attachments_to_save.append({
            "file_id": v["file_id"],
            "filename": v.get("file_name") or f"video_{v['file_id'][-8:]}.mp4",
        })
    elif msg.get("audio"):
        a = msg["audio"]
        attachments_to_save.append({
            "file_id": a["file_id"],
            "filename": a.get("file_name") or f"audio_{a['file_id'][-8:]}.mp3",
        })
    elif msg.get("voice"):
        vo = msg["voice"]
        attachments_to_save.append({
            "file_id": vo["file_id"],
            "filename": f"voice_{vo['file_id'][-8:]}.ogg",
        })

    if not body and not attachments_to_save:
        return

    async with AsyncSessionLocal() as db:
        r = await db.execute(select(User).where(User.telegram_id == from_id))
        sender = r.scalar_one_or_none()
        if not sender:
            r = await db.execute(
                select(User).where(User.role == UserRole.SUPER_ADMIN).limit(1)
            )
            sender = r.scalar_one_or_none()
        if not sender:
            return

        if not await svc.is_member(db, room_id, sender.id):
            log.warning(f"tg poll: owner not member of room {room_id}")
            return

        room = await svc.get_room(db, room_id)
        if not room:
            return

    # Скачиваем файлы вне транзакции
    saved: list[dict] = []
    for att in attachments_to_save:
        meta = await _download_telegram_file(att["file_id"], att["filename"])
        if meta:
            saved.append(meta)

    async with AsyncSessionLocal() as db:
        atts: list[dict] = []
        for meta in saved:
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
            atts.append({
                "id": str(meta["id"]),
                "filename": meta["filename"],
                "mime": meta["mime"],
                "size": meta["size"],
                "url": f"/staff-chat/files/{meta['id']}/download",
            })

        if not body and atts:
            body = "📎 файл из Telegram"

        try:
            new_msg = await svc.send_message(
                db, room, sender, body=body, attachments=atts or None,
            )
            await db.commit()
            log.info(f"tg poll: created msg {new_msg.id} in room {room_id} ({len(atts)} files)")
        except ValueError as e:
            await db.rollback()
            log.warning(f"send_message failed: {e}")
            return

    try:
        from app.routers.staff_chat import ws_hub
        await ws_hub.broadcast_to_room(
            room_id, {"type": "message:new", "data": svc.serialize_message(new_msg)}
        )
    except Exception as e:
        log.warning(f"WS broadcast failed: {e}")


async def tg_owner_bot_poll_job() -> None:
    """Один цикл long-poll: getUpdates → обработать каждый update."""
    token = (settings.owner_bot_token or "").strip()
    if not token:
        return
    offset = _load_offset()
    proxy = _proxy_url()
    url = f"https://api.telegram.org/bot{token}/getUpdates"
    params = {"timeout": 20, "allowed_updates": json.dumps(["message", "edited_message", "callback_query"])}
    if offset:
        params["offset"] = offset
    try:
        async with httpx.AsyncClient(timeout=30, proxy=proxy) as client:
            r = await client.get(url, params=params)
            if r.status_code != 200:
                log.warning(f"getUpdates {r.status_code}: {r.text[:200]}")
                return
            j = r.json()
            if not j.get("ok"):
                return
            updates = j.get("result") or []
            if not updates:
                return
            log.info(f"tg poll: got {len(updates)} updates")
            for upd in updates:
                try:
                    await _process_update(upd)
                except Exception as e:
                    log.error(f"process_update error: {e}")
                offset = max(offset, int(upd.get("update_id", 0)) + 1)
            _save_offset(offset)
    except Exception as e:
        log.warning(f"tg poll error: {e}")
