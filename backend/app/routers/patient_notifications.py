"""
Patient notifications — realtime «звонок в ЛК» через WebSocket.

Используется для Zoom-подобных входящих видеоприёмов: когда врач создаёт
TelemedicineSession, мы мгновенно пушим событие incoming_call всем активным
WS-подключениям пациента (по номеру телефона). Это отдельный канал —
НЕ trogaem /presence/ws (signaling) и НЕ media-поток.

Endpoints:
  WS  /patient/notifications/ws/{phone}?token=<patient_session_token>
                                       или ?token=<patient_token>

События (server → client):
  {type: 'connected'}                    — после accept
  {type: 'ping'} / {type: 'pong'}        — heartbeat
  {type: 'incoming_call', session_id, join_url, doctor_name, expires_at}
  {type: 'call_cancelled', session_id}

Авторизация:
  - Сначала пробуем как patient_session_token (long-lived 1 год).
  - Если не подошёл — как patient_token (90 дней JWT, payload {sub: phone}).
  - Phone из токена должен совпадать с phone в URL (нормализованным).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.services.patient_session_service import restore_session as _restore_session
from app.utils.phone import normalize_phone

logger = logging.getLogger("patient_notifications")

router = APIRouter(prefix="/patient/notifications", tags=["patient-notifications"])


# ── In-memory реестр активных WS пациентов ────────────────────────────────
# Ключ — нормализованный phone, значение — список активных WS-подключений
# (на одно устройство — одна запись; несколько устройств = несколько).
_patient_connections: dict[str, list[WebSocket]] = {}


async def _validate_token(db: AsyncSession, token: str, phone: str) -> bool:
    """
    Проверить, что токен валиден и принадлежит этому phone.
    Поддерживает оба формата: clinika_patient_session и clinika_patient_token.
    """
    phone_n = normalize_phone(phone)

    # 1) patient_session_token (long-lived, 1 год) — основной формат для PWA
    try:
        session = await _restore_session(db, token)
        if session and normalize_phone(session.phone) == phone_n:
            return True
    except Exception as e:
        logger.debug("patient_notifications: session check failed: %s", e)

    # 2) patient_token (90 дней JWT) — выдаётся на /patient/{ref}?t=...
    try:
        from app.core.security import decode_token
        payload = decode_token(token)
        token_phone = payload.get("phone") or payload.get("sub")
        if token_phone and normalize_phone(token_phone) == phone_n:
            return True
    except Exception as e:
        logger.debug("patient_notifications: jwt check failed: %s", e)

    return False


def _register(phone: str, ws: WebSocket) -> None:
    """Добавить WS в реестр под ключом нормализованного phone."""
    phone_n = normalize_phone(phone)
    _patient_connections.setdefault(phone_n, []).append(ws)


def _unregister(phone: str, ws: WebSocket) -> None:
    """Удалить WS из реестра (пустые ключи чистим, чтобы dict не рос)."""
    phone_n = normalize_phone(phone)
    arr = _patient_connections.get(phone_n)
    if not arr:
        return
    try:
        arr.remove(ws)
    except ValueError:
        pass
    if not arr:
        _patient_connections.pop(phone_n, None)


async def notify_patient(phone: str, event: dict) -> int:
    """
    Отправить event JSON всем активным WS-подключениям пациента.
    Возвращает число успешно доставленных сообщений (для логов/метрик).

    Вызывается из POST /telemed/sessions, /telemed/sessions/{id}/cancel-incoming
    и любых других мест, где нужен push в ЛК (например, новое сообщение
    в чате — на будущее).
    """
    phone_n = normalize_phone(phone)
    arr = list(_patient_connections.get(phone_n, []))
    if not arr:
        return 0

    delivered = 0
    dead: list[WebSocket] = []
    for ws in arr:
        try:
            await ws.send_json(event)
            delivered += 1
        except Exception as e:
            logger.debug("notify_patient: send failed: %s", e)
            dead.append(ws)

    # Чистим мёртвые подключения, чтобы dict не разрастался.
    for ws in dead:
        _unregister(phone_n, ws)

    logger.info(
        "notify_patient: phone=%s event=%s delivered=%d/%d",
        phone_n, event.get("type"), delivered, len(arr),
    )
    return delivered


@router.websocket("/ws/{phone}")
async def patient_notifications_ws(
    ws: WebSocket,
    phone: str,
    token: str = Query(..., description="patient_session_token или patient_token"),
):
    """
    WebSocket для realtime push в ЛК пациента (входящие звонки).
    Heartbeat ping раз в 30 сек, чтобы не убить idle-соединение через nginx.
    """
    # Валидация токена ДО accept — иначе клиент думает, что соединение ОК.
    async with AsyncSessionLocal() as db:
        ok = await _validate_token(db, token, phone)
    if not ok:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws.accept()
    _register(phone, ws)
    phone_n = normalize_phone(phone)
    logger.info("patient_notifications: connected phone=%s, total=%d",
                phone_n, len(_patient_connections.get(phone_n, [])))

    try:
        await ws.send_json({"type": "connected"})
    except Exception:
        _unregister(phone, ws)
        return

    # Ping-таск для keepalive (nginx по умолчанию рвёт idle через 60с).
    async def _heartbeat():
        try:
            while True:
                await asyncio.sleep(30)
                await ws.send_json({"type": "ping"})
        except Exception:
            return

    hb_task = asyncio.create_task(_heartbeat())

    try:
        while True:
            # Принимаем pong/любые сообщения — нужно для keepalive со стороны клиента.
            msg = await ws.receive_text()
            try:
                data = json.loads(msg)
                if data.get("type") == "ping":
                    await ws.send_json({"type": "pong"})
            except Exception:
                # Невалидный JSON — игнор, не падаем.
                pass
    except WebSocketDisconnect:
        logger.info("patient_notifications: disconnected phone=%s", phone_n)
    except Exception as e:
        logger.warning("patient_notifications: ws error phone=%s: %s", phone_n, e)
    finally:
        hb_task.cancel()
        _unregister(phone, ws)
