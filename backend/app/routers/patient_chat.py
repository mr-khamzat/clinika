"""
Чат пациента (вариант D — гибрид AI + регистратура).

DEPRECATED (см. находку #40): используйте чат-движок ChatThread
(app/routers/patient_chat_threads.py + app/routers/clinic_chat.py поверх
модели app/models/chat.py и сервиса app/services/chat_service.py).

Почему этот движок — ЛЕГАСИ, а ChatThread — актуальный:
* ChatThread — это «Глава 9» (async-треды пациент↔клиника). Он шире
  используется фронтом: ~13 модулей (sections/PatientChatSection.jsx
  «премиум-чат пациента (Глава 9)», sections/ClinicChatSection.jsx,
  components/chat/* — ThreadListItem/ReassignModal/PatientCardSidebar/
  NewThreadModal/MessageBubble/SlotOfferBubble, components/AdminSupportPanel.jsx,
  api/chatSlots.js, components/patient/PatientChatHub.jsx) и развивается
  (SLA-эскалация, reassign-история, pin/цвет-метки, реакции, индикатор
  «печатает…», бронь слотов, drag-drop). Сам docstring patient_chat_threads.py
  явно помечает /patient/chat как legacy.
* Этот движок (PatientChat / /patient/chat) — старый «AI-ассистент + админ».
  Фронт зовёт его лишь из устаревшего SupportTab в pages/PatientCabinet.jsx
  (см. комментарий «Аналог SupportTab, но через /patient/chat — AI-ассистент
  + админ») и его клона PatientCabinetPreview.jsx, плюс админ-вкладка
  sections/PatientChatsSection.jsx (/admin/patient-chats). Новые кабинеты
  (PatientChatHub → PatientChatSection) уже используют ChatThread.

ВНИМАНИЕ: роуты, таблицы (patient_chats / patient_chat_messages) и данные НЕ
удаляются здесь намеренно — движок ещё вызывается живым фронтом, а вынос
требует миграции данных. Это отдельная задача (см. план миграции ниже).

──────────────────────────────────────────────────────────────────────────
ПЛАН МИГРАЦИИ (отдельной задачей, не входит в эту правку):
  1. Перевести устаревший SupportTab в pages/PatientCabinet.jsx (и клон
     PatientCabinetPreview.jsx) на ChatThread (PatientChatSection / threads),
     либо полностью заменить SupportTab на PatientChatHub. AI-ассистент
     (chat_with_ai из patient_chat_ai) при необходимости подключить как
     отдельный сегмент внутри тредового UI, а не как параллельный движок.
  2. Перевести админ-вкладку sections/PatientChatsSection.jsx
     (/admin/patient-chats) на тредовую админку (clinic_chat / chat_admin).
  3. Data-миграция: перенести историю из patient_chats/patient_chat_messages
     в chat_threads/chat_messages (маппинг PatientChat→ChatThread,
     PatientChatMessage→ChatMessage; сопоставить sender/mode). Идемпотентно,
     в maintenance-окне, с бэкапом и проверкой ПДн (телефон/ФИО).
  4. После полного перехода фронта и переноса данных — удалить роуты этого
     модуля, его include_router в app/main.py (строка ~1612) и, отдельной
     alembic-миграцией, таблицы patient_chats/patient_chat_messages.

Пациентские эндпоинты (защита через session_token из patient_session_service):
* GET  /patient/chat?t=<session_token>
* GET  /patient/chat/{chat_id}/messages?t=<session_token>
* POST /patient/chat/send?t=<session_token>          {chat_id?, text}
* POST /patient/chat/{chat_id}/manual?t=<session_token>

Админские эндпоинты (require_manager):
* GET  /admin/patient-chats
* GET  /admin/patient-chats/{chat_id}/messages
* POST /admin/patient-chats/{chat_id}/reply           {text}
* POST /admin/patient-chats/{chat_id}/toggle-mode
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager, get_tenant_db, assert_same_tenant, _is_super_admin
from app.models.user import User
from app.models.patient_chat import (
    PatientChat,
    PatientChatMessage,
    PatientChatMode,
    PatientChatSender,
)
from app.models.patient_session import PatientSession
from app.services.patient_session_service import restore_session
from app.services.patient_chat_ai import chat_with_ai, DAILY_AI_LIMIT
from app.utils.phone import normalize_phone


# ────────────────────────────────────────────────────────────────────────────
# Pydantic-схемы
# ────────────────────────────────────────────────────────────────────────────

class SendBody(BaseModel):
    chat_id: Optional[str] = None
    text: str


class ManualBody(BaseModel):
    pass


class AdminReplyBody(BaseModel):
    text: str


# ────────────────────────────────────────────────────────────────────────────
# Хелперы
# ────────────────────────────────────────────────────────────────────────────

def _serialize_message(m: PatientChatMessage) -> dict:
    return {
        "id": str(m.id),
        "chat_id": str(m.chat_id),
        "sender": m.sender.value if hasattr(m.sender, "value") else str(m.sender),
        "text": m.text,
        "is_cached": bool(m.is_cached),
        "handed_off": bool(m.handed_off),
        "source": getattr(m, "source", None),
        "admin_user_id": str(m.admin_user_id) if m.admin_user_id else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _serialize_chat(c: PatientChat) -> dict:
    return {
        "id": str(c.id),
        "tenant_id": str(c.tenant_id) if c.tenant_id else None,
        "patient_phone": c.patient_phone,
        "patient_name": c.patient_name,
        "mode": c.mode.value if hasattr(c.mode, "value") else str(c.mode),
        "title": c.title,
        "ai_messages_today": int(c.ai_messages_today or 0),
        "ai_messages_reset_date": c.ai_messages_reset_date.isoformat() if c.ai_messages_reset_date else None,
        "ai_daily_limit": DAILY_AI_LIMIT,
        "unread_admin": int(c.unread_admin or 0),
        "last_message_at": c.last_message_at.isoformat() if c.last_message_at else None,
        "last_message_preview": c.last_message_preview,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


async def _require_session(db: AsyncSession, session_token: str) -> PatientSession:
    if not session_token:
        raise HTTPException(401, "session token required")
    sess = await restore_session(db, session_token)
    if not sess:
        raise HTTPException(401, "session invalid or expired")
    return sess


async def _get_or_create_chat(
    db: AsyncSession, phone: str, tenant_id, name: Optional[str] = None
) -> PatientChat:
    """Найти ветку чата по (phone, tenant) или создать новую."""
    phone_n = normalize_phone(phone)
    # Находка #7: строгий фильтр по tenant_id всегда (NULL==NULL включительно),
    # чтобы не подобрать чужую ветку при tenant_id=NULL.
    q = select(PatientChat).where(
        PatientChat.patient_phone == phone_n,
        PatientChat.tenant_id == tenant_id,
    )
    chat = (await db.execute(q.order_by(desc(PatientChat.created_at)).limit(1))).scalar_one_or_none()
    if chat:
        return chat

    chat = PatientChat(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        patient_phone=phone_n,
        patient_name=name,
        mode=PatientChatMode.AI,
    )
    db.add(chat)
    await db.flush()
    return chat


def _update_chat_meta(chat: PatientChat, last_text: str) -> None:
    """Обновить метаданные ветки после нового сообщения."""
    preview = (last_text or "")[:300]
    chat.last_message_at = datetime.utcnow()
    chat.last_message_preview = preview
    chat.updated_at = datetime.utcnow()


async def _notify_admin_new_message(db: AsyncSession, chat: PatientChat) -> None:
    """Уведомить администратора о новом сообщении пациента (manual ветка / handoff).

    TODO: интеграция с push_service или Telegram-ботом. Сейчас просто инкрементируем
    counter, который подсветится в админ-секции.
    """
    chat.unread_admin = (chat.unread_admin or 0) + 1


# ────────────────────────────────────────────────────────────────────────────
# Patient endpoints
# ────────────────────────────────────────────────────────────────────────────

router = APIRouter(tags=["patient-chat"])


@router.get("/patient/chat")
async def list_patient_chats(
    t: str = Query("", description="patient_session_token"),
    db: AsyncSession = Depends(get_db),
):
    """Список чатов пациента (обычно один на тенант)."""
    sess = await _require_session(db, t)
    phone_n = normalize_phone(sess.phone)
    # Находка #7: тенант пациентской сессии накладывается ВСЕГДА (строгое
    # равенство, в т.ч. NULL==NULL), чтобы не утекали чаты чужих тенантов.
    q = select(PatientChat).where(
        PatientChat.patient_phone == phone_n,
        PatientChat.tenant_id == sess.tenant_id,
    )
    chats = (await db.execute(q.order_by(desc(PatientChat.updated_at)))).scalars().all()
    return {"chats": [_serialize_chat(c) for c in chats]}


@router.get("/patient/chat/{chat_id}/messages")
async def get_patient_chat_messages(
    chat_id: str,
    t: str = Query("", description="patient_session_token"),
    db: AsyncSession = Depends(get_db),
):
    """История сообщений (limit 100)."""
    sess = await _require_session(db, t)
    try:
        cid = uuid.UUID(chat_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "chat not found")
    chat = await db.get(PatientChat, cid)
    if not chat:
        raise HTTPException(404, "chat not found")
    if normalize_phone(chat.patient_phone) != normalize_phone(sess.phone):
        raise HTTPException(403, "forbidden")
    # Находка #7: строгое fail-closed сравнение тенанта пациентской сессии
    # с чатом (без super_admin-исключения и без пропуска NULL).
    if sess.tenant_id != chat.tenant_id:
        raise HTTPException(403, "forbidden")

    msgs = (await db.execute(
        select(PatientChatMessage)
        .where(PatientChatMessage.chat_id == cid)
        .order_by(PatientChatMessage.created_at.asc())
        .limit(100)
    )).scalars().all()

    # Помечаем сообщения админа как прочитанные пациентом
    for m in msgs:
        if m.sender == PatientChatSender.ADMIN and not m.is_read_by_patient:
            m.is_read_by_patient = True
    await db.commit()

    return {
        "chat": _serialize_chat(chat),
        "messages": [_serialize_message(m) for m in msgs],
    }


@router.post("/patient/chat/send")
async def patient_send_message(
    body: SendBody,
    t: str = Query("", description="patient_session_token"),
    db: AsyncSession = Depends(get_db),
):
    """Отправить сообщение пациента. Возвращает массив новых сообщений.

    Если mode=ai и не превышен лимит — сразу дёргает AI и сохраняет ответ.
    """
    sess = await _require_session(db, t)
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "empty text")
    if len(text) > 4000:
        raise HTTPException(400, "too long")

    phone_n = normalize_phone(sess.phone)
    tenant_id = sess.tenant_id

    # 1) Найти/создать чат
    if body.chat_id:
        try:
            cid = uuid.UUID(body.chat_id)
        except (ValueError, TypeError):
            raise HTTPException(404, "chat not found")
        chat = await db.get(PatientChat, cid)
        if not chat:
            raise HTTPException(404, "chat not found")
        if normalize_phone(chat.patient_phone) != phone_n:
            raise HTTPException(403, "forbidden")
        # Находка #7: строгая tenant-изоляция пациентской сессии.
        if sess.tenant_id != chat.tenant_id:
            raise HTTPException(403, "forbidden")
    else:
        chat = await _get_or_create_chat(db, phone_n, tenant_id)

    # 2) Сохраняем сообщение пациента
    msg_patient = PatientChatMessage(
        id=uuid.uuid4(),
        chat_id=chat.id,
        sender=PatientChatSender.PATIENT,
        text=text,
    )
    db.add(msg_patient)
    _update_chat_meta(chat, text)

    # Если ветка уже manual — увеличиваем unread для админа, AI не дёргаем
    if chat.mode == PatientChatMode.MANUAL:
        await _notify_admin_new_message(db, chat)
        await db.commit()
        await db.refresh(chat)
        return {
            "chat": _serialize_chat(chat),
            "new_messages": [_serialize_message(msg_patient)],
        }

    # 3) Режим AI — пробуем получить ответ
    result = await chat_with_ai(db, chat, text)

    new_msgs = [msg_patient]

    # Лимит исчерпан → переключаем в manual + системное сообщение
    if result["limit_exceeded"]:
        chat.mode = PatientChatMode.MANUAL
        sys_msg = PatientChatMessage(
            id=uuid.uuid4(),
            chat_id=chat.id,
            sender=PatientChatSender.ASSISTANT,
            text="Лимит автоответов на сегодня исчерпан. Ваш вопрос отправлен администратору — мы ответим в ближайшее время.",
            handed_off=True,
        )
        db.add(sys_msg)
        _update_chat_meta(chat, sys_msg.text)
        await _notify_admin_new_message(db, chat)
        new_msgs.append(sys_msg)
        await db.commit()
        await db.refresh(chat)
        return {"chat": _serialize_chat(chat), "new_messages": [_serialize_message(m) for m in new_msgs]}

    # AI не настроен в админке → fallback на manual
    if result["ai_unavailable"]:
        chat.mode = PatientChatMode.MANUAL
        sys_msg = PatientChatMessage(
            id=uuid.uuid4(),
            chat_id=chat.id,
            sender=PatientChatSender.ASSISTANT,
            text="Ваш вопрос принят. Администратор клиники ответит вам в ближайшее время.",
            handed_off=True,
        )
        db.add(sys_msg)
        _update_chat_meta(chat, sys_msg.text)
        await _notify_admin_new_message(db, chat)
        new_msgs.append(sys_msg)
        await db.commit()
        await db.refresh(chat)
        return {"chat": _serialize_chat(chat), "new_messages": [_serialize_message(m) for m in new_msgs]}

    # AI ответил
    answer_text = result.get("answer") or ""
    handoff = bool(result.get("handoff"))
    msg_ai = PatientChatMessage(
        id=uuid.uuid4(),
        chat_id=chat.id,
        sender=PatientChatSender.ASSISTANT,
        text=answer_text,
        is_cached=bool(result.get("is_cached")),
        handed_off=handoff,
        tokens_in=result.get("tokens_in"),
        tokens_out=result.get("tokens_out"),
        source=result.get("source") or "llm",
    )
    db.add(msg_ai)
    _update_chat_meta(chat, answer_text)
    new_msgs.append(msg_ai)

    if handoff:
        chat.mode = PatientChatMode.MANUAL
        await _notify_admin_new_message(db, chat)

    await db.commit()
    await db.refresh(chat)
    return {"chat": _serialize_chat(chat), "new_messages": [_serialize_message(m) for m in new_msgs]}


@router.post("/patient/chat/{chat_id}/manual")
async def patient_request_manual(
    chat_id: str,
    t: str = Query("", description="patient_session_token"),
    db: AsyncSession = Depends(get_db),
):
    """Пациент явно просит человека → mode=manual, AI больше не отвечает."""
    sess = await _require_session(db, t)
    try:
        cid = uuid.UUID(chat_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "chat not found")
    chat = await db.get(PatientChat, cid)
    if not chat:
        raise HTTPException(404, "chat not found")
    if normalize_phone(chat.patient_phone) != normalize_phone(sess.phone):
        raise HTTPException(403, "forbidden")
    # Находка #7: строгая tenant-изоляция пациентской сессии.
    if sess.tenant_id != chat.tenant_id:
        raise HTTPException(403, "forbidden")

    chat.mode = PatientChatMode.MANUAL
    sys_msg = PatientChatMessage(
        id=uuid.uuid4(),
        chat_id=chat.id,
        sender=PatientChatSender.ASSISTANT,
        text="Передал ваш вопрос администратору клиники. Ответ придёт в этом чате.",
        handed_off=True,
    )
    db.add(sys_msg)
    _update_chat_meta(chat, sys_msg.text)
    await _notify_admin_new_message(db, chat)
    await db.commit()
    await db.refresh(chat)
    return {"chat": _serialize_chat(chat), "new_messages": [_serialize_message(sys_msg)]}


# ────────────────────────────────────────────────────────────────────────────
# Admin endpoints
# ────────────────────────────────────────────────────────────────────────────

@router.get("/admin/patient-chats")
async def admin_list_chats(
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Список чатов клиники (тенанта пользователя). Сортировка: свежие сверху."""
    q = select(PatientChat)
    # Находка #7: фильтр по tenant_id накладывается ВСЕГДА для тенантного
    # пользователя; пропуск (все тенанты) — только для super_admin по роли.
    if not _is_super_admin(user):
        q = q.where(PatientChat.tenant_id == user.tenant_id)
    q = q.order_by(desc(PatientChat.last_message_at), desc(PatientChat.updated_at)).limit(500)
    chats = (await db.execute(q)).scalars().all()
    return {
        "chats": [_serialize_chat(c) for c in chats],
        "total_unread": sum(int(c.unread_admin or 0) for c in chats),
    }


@router.get("/admin/patient-chats/{chat_id}/messages")
async def admin_get_messages(
    chat_id: str,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """История сообщений + сброс unread_admin."""
    try:
        cid = uuid.UUID(chat_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "chat not found")
    chat = await db.get(PatientChat, cid)
    if not chat:
        raise HTTPException(404, "chat not found")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, chat)

    msgs = (await db.execute(
        select(PatientChatMessage)
        .where(PatientChatMessage.chat_id == cid)
        .order_by(PatientChatMessage.created_at.asc())
        .limit(500)
    )).scalars().all()

    chat.unread_admin = 0
    await db.commit()
    await db.refresh(chat)

    return {
        "chat": _serialize_chat(chat),
        "messages": [_serialize_message(m) for m in msgs],
    }


@router.post("/admin/patient-chats/{chat_id}/reply")
async def admin_reply(
    chat_id: str,
    body: AdminReplyBody,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Ответ администратора. mode → manual (навсегда для этой ветки)."""
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "empty text")
    if len(text) > 4000:
        raise HTTPException(400, "too long")
    try:
        cid = uuid.UUID(chat_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "chat not found")
    chat = await db.get(PatientChat, cid)
    if not chat:
        raise HTTPException(404, "chat not found")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, chat)

    chat.mode = PatientChatMode.MANUAL
    msg = PatientChatMessage(
        id=uuid.uuid4(),
        chat_id=chat.id,
        sender=PatientChatSender.ADMIN,
        text=text,
        admin_user_id=user.id,
    )
    db.add(msg)
    _update_chat_meta(chat, text)
    chat.unread_admin = 0
    await db.commit()
    await db.refresh(chat)

    return {"chat": _serialize_chat(chat), "message": _serialize_message(msg)}


@router.post("/admin/patient-chats/{chat_id}/toggle-mode")
async def admin_toggle_mode(
    chat_id: str,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Переключить mode AI ↔ MANUAL (вернуть AI-ассистента в строй)."""
    try:
        cid = uuid.UUID(chat_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "chat not found")
    chat = await db.get(PatientChat, cid)
    if not chat:
        raise HTTPException(404, "chat not found")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, chat)

    chat.mode = (
        PatientChatMode.AI if chat.mode == PatientChatMode.MANUAL else PatientChatMode.MANUAL
    )
    chat.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(chat)
    return {"chat": _serialize_chat(chat)}
