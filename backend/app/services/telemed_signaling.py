"""
Telemedicine — WebRTC signaling через Redis Pub/Sub.

Архитектура (схожа с PresenceManager из app/routers/presence.py):
- Каждая сессия = Redis-канал "telemed:{session_id}".
- Любое сообщение, опубликованное в этом канале, доставляется ВСЕМ
  подключённым WS-клиентам этой сессии (на любом инстансе backend),
  кроме отправителя (по полю _from_role).
- Используем Redis потому, что во время видеоприёма доктор и пациент
  могут попасть на разные процессы uvicorn (или поды k8s), а сигналинг
  должен идти через общий брокер.

Поддерживаемые типы сообщений:
- offer / answer / ice                — стандартный WebRTC handshake
- chat_message                        — чат внутри звонка (text/file)
- end                                 — клиент попросил завершить
- presence_join / presence_leave      — служебные (отправляет сервер)
"""
import asyncio
import json
import logging
import uuid
from typing import Optional

from fastapi import WebSocket

logger = logging.getLogger("telemed_signaling")


def _channel(session_id: str | uuid.UUID) -> str:
    return f"telemed:{str(session_id)}"


class TelemedSignalingManager:
    """Менеджер WebSocket-сессий телемедицины с Redis pub/sub.

    Хранит соединения вида connections[session_id][role_id] = WebSocket,
    где role_id — "doctor" или "patient". На сессию допускается один
    подписчик каждой роли; новый коннект той же роли вытеснит предыдущий.
    """

    def __init__(self) -> None:
        # session_id (str) → { role_id (str): WebSocket }
        self.connections: dict[str, dict[str, WebSocket]] = {}
        # session_id (str) → asyncio.Task (Redis listener)
        self._pubsub_tasks: dict[str, asyncio.Task] = {}

    # ── Redis helpers ─────────────────────────────────────────────────

    def _redis(self):
        # Импорт внутри функции — Redis-клиент опционален в тестах.
        import redis.asyncio as aioredis
        from app.config import settings
        return aioredis.from_url(settings.redis_url, decode_responses=True)

    # ── Подключение/отключение ────────────────────────────────────────

    async def connect(
        self,
        ws: WebSocket,
        session_id: str | uuid.UUID,
        role: str,
    ) -> None:
        """Подключить клиента (роль = 'doctor' | 'patient'). WS уже принят."""
        sid = str(session_id)
        bucket = self.connections.setdefault(sid, {})

        # Если был предыдущий клиент той же роли — закрыть его (одна вкладка).
        prev = bucket.get(role)
        if prev is not None and prev is not ws:
            try:
                await prev.close(code=4002)
            except Exception:
                pass

        bucket[role] = ws

        # Запускаем listener Redis для этой сессии (один на процесс).
        if sid not in self._pubsub_tasks or self._pubsub_tasks[sid].done():
            self._pubsub_tasks[sid] = asyncio.create_task(self._listen(sid))

        # Уведомляем другую сторону, что мы здесь.
        await self.publish(sid, {"type": "presence_join", "role": role}, _from_role=role)

    async def disconnect(self, session_id: str | uuid.UUID, role: str) -> None:
        sid = str(session_id)
        bucket = self.connections.get(sid)
        if not bucket:
            return
        bucket.pop(role, None)
        if not bucket:
            self.connections.pop(sid, None)
            task = self._pubsub_tasks.pop(sid, None)
            if task and not task.done():
                task.cancel()
        # Уведомляем оппонента.
        try:
            await self.publish(sid, {"type": "presence_leave", "role": role}, _from_role=role)
        except Exception:
            pass

    # ── Публикация / приём ────────────────────────────────────────────

    async def publish(
        self,
        session_id: str | uuid.UUID,
        message: dict,
        _from_role: Optional[str] = None,
    ) -> None:
        """Опубликовать в Redis-канал сессии.

        _from_role попадает в payload как `_from`, чтобы listener
        не доставлял сообщение обратно отправителю.
        """
        payload = {**message, "_from": _from_role}
        r = self._redis()
        try:
            await r.publish(_channel(session_id), json.dumps(payload, default=str))
        finally:
            try:
                await r.aclose()
            except Exception:
                pass

    async def _listen(self, session_id: str) -> None:
        """Слушает Redis-канал сессии и доставляет сообщения локальным WS."""
        import redis.asyncio as aioredis
        from app.config import settings

        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        pubsub = r.pubsub()
        try:
            await pubsub.subscribe(_channel(session_id))
            async for msg in pubsub.listen():
                if msg.get("type") != "message":
                    continue
                try:
                    data = json.loads(msg["data"])
                except Exception:
                    continue
                exclude = data.pop("_from", None)
                bucket = self.connections.get(session_id, {})
                dead = []
                for role, ws in list(bucket.items()):
                    if role == exclude:
                        continue
                    try:
                        await ws.send_json(data)
                    except Exception as e:
                        logger.warning("telemed ws send failed sid=%s role=%s: %s",
                                       session_id, role, e)
                        dead.append(role)
                for role in dead:
                    bucket.pop(role, None)
                if not bucket:
                    self.connections.pop(session_id, None)
                    break
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("telemed listen sid=%s: %s", session_id, e)
        finally:
            try:
                await pubsub.unsubscribe(_channel(session_id))
            except Exception:
                pass
            try:
                await pubsub.close()
            except Exception:
                pass
            try:
                await r.aclose()
            except Exception:
                pass


# Глобальный менеджер на процесс backend.
telemed_signaling = TelemedSignalingManager()
