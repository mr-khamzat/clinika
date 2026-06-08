"""staff_chat_mentions — парсинг @username + резолв в user IDs (tenant-scope).

Используется из POST /staff-chat/rooms/{id}/messages:
  1. parse_mention_strings(body)  → ['ivanov', 'petrov']
  2. resolve_mentions(db, names, tenant_id=...) → ['<user.id-uuid>', ...]
  3. msg.mentioned_user_ids = result  (JSONB на staff_chat_messages)

TG-нотификация — best-effort, не блокирует commit. Делается через bot
proxy (HTTPS_PROXY env, см. инфраструктуру). Если TG_BOT_TOKEN не задан —
функция тихо возвращает False без ошибки.
"""
from __future__ import annotations

import os
import re
import uuid
import json
import logging
import asyncio
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

log = logging.getLogger(__name__)

# Латиница / цифры / _ / точка, длиной 3-30 символов.
_RE_MENTION = re.compile(r"@([A-Za-z0-9_.]{3,30})")

# Удерживаем ссылки на fire-and-forget задачи: без сильной ссылки GC может
# собрать ещё не выполнившуюся задачу (см. предупреждение в доке asyncio).
_pending_tg_tasks: set[asyncio.Task] = set()


def _spawn_tg_task(coro) -> None:
    """Запускает корутину фоном, удерживая ссылку и логируя исключения."""
    task = asyncio.create_task(coro)
    _pending_tg_tasks.add(task)

    def _on_done(t: asyncio.Task) -> None:
        _pending_tg_tasks.discard(t)
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            log.warning("TG mention notification task failed: %r", exc)

    task.add_done_callback(_on_done)


def parse_mention_strings(text: str) -> list[str]:
    """Извлекает уникальные @username из текста (нижний регистр)."""
    if not text:
        return []
    seen: set[str] = set()
    out: list[str] = []
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
    *,
    chat_id: str,
    sender_name: str,
    room_name: str,
    text_preview: str,
) -> bool:
    """Отправляет TG-нотификацию upmentioned user'у. Best-effort.

    Использует TG_BOT_TOKEN из env. Если HTTPS_PROXY задан — идём через прокси.
    Не падает: при любых ошибках логируется и возвращается False.
    """
    token = os.environ.get("TG_BOT_TOKEN", "").strip()
    if not token or not chat_id:
        return False
    import urllib.parse
    import urllib.request

    proxy_url = os.environ.get("HTTPS_PROXY", "").strip()
    msg = (
        f"\U0001F4AC <b>{sender_name}</b> упомянул вас в "
        f"<b>#{room_name}</b>:\n{text_preview[:200]}"
    )
    data = urllib.parse.urlencode({
        "chat_id": chat_id, "text": msg, "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()

    def _do_send() -> bool:
        try:
            if proxy_url:
                handler = urllib.request.ProxyHandler({
                    "https": proxy_url, "http": proxy_url,
                })
                opener = urllib.request.build_opener(handler)
            else:
                opener = urllib.request.build_opener()
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{token}/sendMessage",
                data=data, method="POST",
            )
            with opener.open(req, timeout=5) as r:
                return bool(json.loads(r.read()).get("ok", False))
        except Exception:
            log.exception("TG mention notification failed")
            return False

    # Чтобы не блокировать event loop — гоним в thread executor.
    return await asyncio.get_event_loop().run_in_executor(None, _do_send)


async def notify_mentions(
    db: AsyncSession,
    *,
    sender: User,
    room,
    mention_ids: list[str],
    text_preview: str,
) -> None:
    """Best-effort: рассылает TG-нотификацию каждому упомянутому user'у,
    у которого есть telegram_id. Не блокирует основной flow."""
    if not mention_ids:
        return
    try:
        ids_uuid = [uuid.UUID(x) for x in mention_ids]
    except (ValueError, TypeError):
        log.warning("notify_mentions: invalid mention_ids: %r", mention_ids)
        return
    users = (await db.execute(
        select(User).where(User.id.in_(ids_uuid))
    )).scalars().all()
    sender_name = (
        getattr(sender, "full_name", None)
        or getattr(sender, "username", None)
        or "Сотрудник"
    )
    room_name = (getattr(room, "name", None) or "канал")
    for u in users:
        if str(u.id) == str(sender.id):
            continue  # не нотифицируем себя
        tg = (getattr(u, "telegram_id", None) or "").strip()
        if not tg:
            continue
        # fire-and-forget (ссылка удерживается в _pending_tg_tasks)
        _spawn_tg_task(send_mention_tg_notification(
            chat_id=tg, sender_name=sender_name,
            room_name=room_name, text_preview=text_preview,
        ))
