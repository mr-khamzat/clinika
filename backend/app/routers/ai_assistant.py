"""
AI-ассистент пациенту через Gemini (W6 master plan).

Публичные эндпоинты для PatientCabinet (/p/) — без авторизации, по
patient_phone + tenant_slug:
  POST /api/patient-portal/ai/conversations
  POST /api/patient-portal/ai/conversations/{id}/messages
  GET  /api/patient-portal/ai/conversations/{id}/messages
  POST /api/patient-portal/ai/conversations/{id}/escalate

Менеджерские (require_module ai_assistant + require_manager):
  GET  /api/admin/ai/conversations
  GET  /api/admin/ai/conversations/{id}/messages
  POST /api/admin/ai/conversations/{id}/take

Гейт публичного API: проверяем что у тенанта подключён модуль ai_assistant.
Иначе 402 Payment Required.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_manager, assert_same_tenant, get_tenant_db
from app.core.tenant import require_module
from app.database import get_db
from app.models.ai_assistant import AiConversation, AiMessage
from app.models.commercial import (
    CommercialModule,
    ModuleStatus,
    TenantModuleSubscription,
)
from app.models.tenant import Tenant
from app.models.user import User
from app.services.gemini_service import chat_completion
from app.utils.phone import normalize_phone


log = logging.getLogger("ai_assistant")

# Дефолты — используются если в config_schema модуля нет переопределений
DEFAULT_MODEL = "gemini-2.5-flash"
DEFAULT_MAX_PER_DAY = 50
DEFAULT_HISTORY_LIMIT = 12
DEFAULT_SYSTEM_PROMPT = (
    "Ты — медицинский AI-ассистент клиники. Отвечай на русском, "
    "не ставь диагнозы, при сложных вопросах эскалируй к менеджеру. "
    "Если вопрос требует личных данных или это медицинская ситуация "
    "выходящая за пределы FAQ — заверши ответ маркером [ESCALATE]."
)

router = APIRouter(tags=["ai-assistant"])


# ────────────────────────── Pydantic ──────────────────────────


class StartConversationBody(BaseModel):
    patient_phone: str = Field(..., min_length=4, max_length=30)
    tenant_slug: str = Field(..., min_length=1, max_length=120)


class SendMessageBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)


class ConversationOut(BaseModel):
    id: uuid.UUID
    tenant_id: Optional[uuid.UUID]
    patient_phone: str
    status: str
    created_at: datetime
    last_message_at: Optional[datetime]


class MessageOut(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    role: str
    content: str
    escalated: bool
    created_at: datetime
    model: Optional[str] = None


# ────────────────────── Хелперы ──────────────────────


async def _tenant_by_slug(db: AsyncSession, slug: str) -> Tenant:
    t = (
        await db.execute(
            select(Tenant).where(Tenant.slug == slug, Tenant.is_active == True)
        )
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Клиника не найдена")
    return t


async def _module_config(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Загружаем конфиг модуля ai_assistant (или возвращаем дефолты)."""
    mod = (
        await db.execute(
            select(CommercialModule).where(CommercialModule.key == "ai_assistant")
        )
    ).scalar_one_or_none()
    cfg: dict = {}
    if mod and mod.config_schema:
        try:
            cfg = dict(mod.config_schema)
        except Exception:
            cfg = {}
    return cfg


async def _ensure_module_active(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    """402, если у тенанта нет активной/трайл/grace подписки на ai_assistant."""
    sub = (
        await db.execute(
            select(TenantModuleSubscription).where(
                TenantModuleSubscription.tenant_id == tenant_id,
                TenantModuleSubscription.module_key == "ai_assistant",
                TenantModuleSubscription.status.in_(
                    [ModuleStatus.ACTIVE, ModuleStatus.TRIAL, ModuleStatus.GRACE]
                ),
            )
        )
    ).first()
    if not sub:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "Модуль AI-ассистент не подключён у клиники.",
        )


def _ser_conv(c: AiConversation) -> dict:
    return {
        "id": c.id,
        "tenant_id": c.tenant_id,
        "patient_phone": c.patient_phone,
        "status": c.status,
        "created_at": c.created_at,
        "last_message_at": c.last_message_at,
    }


def _ser_msg(m: AiMessage) -> dict:
    return {
        "id": m.id,
        "conversation_id": m.conversation_id,
        "role": m.role,
        "content": m.content,
        "escalated": bool(m.escalated),
        "created_at": m.created_at,
        "model": m.model,
    }


async def _count_user_msgs_today(db: AsyncSession, conv_id: uuid.UUID) -> int:
    today_start = datetime.combine(date.today(), datetime.min.time())
    res = await db.execute(
        select(func.count(AiMessage.id)).where(
            AiMessage.conversation_id == conv_id,
            AiMessage.role == "user",
            AiMessage.created_at >= today_start,
        )
    )
    return int(res.scalar_one() or 0)


async def _history_for_llm(
    db: AsyncSession, conv_id: uuid.UUID, limit: int
) -> list[dict]:
    rows = (
        await db.execute(
            select(AiMessage)
            .where(AiMessage.conversation_id == conv_id)
            .order_by(desc(AiMessage.created_at))
            .limit(limit)
        )
    ).scalars().all()
    rows = list(reversed(rows))
    out: list[dict] = []
    for r in rows:
        if r.role in ("user", "assistant"):
            out.append({"role": r.role, "content": r.content})
    return out


async def _create_support_chat_message(
    db: AsyncSession, tenant_id: uuid.UUID, phone: str, text: str
) -> None:
    """Создаём системное сообщение в Support Chat пациента про эскалацию.

    Используем существующую модель PatientChat / PatientChatMessage. Если
    чат уже есть — добавляем туда. Если нет — создаём новый в режиме MANUAL.
    """
    try:
        from app.models.patient_chat import (
            PatientChat,
            PatientChatMessage,
            PatientChatMode,
            PatientChatSender,
        )
    except Exception as e:
        log.warning(f"PatientChat недоступен: {e}")
        return

    chat = (
        await db.execute(
            select(PatientChat)
            .where(
                PatientChat.tenant_id == tenant_id,
                PatientChat.patient_phone == phone,
            )
            .order_by(desc(PatientChat.created_at))
            .limit(1)
        )
    ).scalar_one_or_none()

    if chat is None:
        chat = PatientChat(
            tenant_id=tenant_id,
            patient_phone=phone,
            mode=PatientChatMode.MANUAL,
        )
        db.add(chat)
        await db.flush()
    else:
        # Принудительно переводим в ручной режим — менеджер должен подключиться.
        try:
            chat.mode = PatientChatMode.MANUAL
        except Exception:
            pass

    msg = PatientChatMessage(
        chat_id=chat.id,
        sender=PatientChatSender.ASSISTANT,
        text=f"[AI-ассистент эскалировал диалог] {text[:500]}",
        handed_off=True,
    )
    db.add(msg)


# ────────────────────── Публичные эндпоинты пациента ──────────────────────




# ── Patient session validation (Phase 0 security) ─────────────────────────────
async def _patient_session_or_401(t: str, db: AsyncSession):
    """Проверить patient session token. Возвращает PatientSession или 401."""
    from app.routers.patient import _restore_session as _rs
    sess = await _rs(db, t)
    if not sess:
        raise HTTPException(401, "Session invalid or expired")
    return sess


@router.post("/patient-portal/ai/conversations")
async def start_conversation(
    body: StartConversationBody,
    t: str = Query(..., description="patient session token"),
    db: AsyncSession = Depends(get_db),
):
    """Создать или вернуть существующую активную беседу для пациента."""
    sess = await _patient_session_or_401(t, db)
    tenant = await _tenant_by_slug(db, body.tenant_slug.strip())
    await _ensure_module_active(db, tenant.id)

    phone = normalize_phone(body.patient_phone)
    # Безопасность: phone в body должен совпадать с phone в session
    if normalize_phone(sess.phone) != phone:
        raise HTTPException(403, "Phone mismatch with session")

    # Существующий active-диалог?
    existing = (
        await db.execute(
            select(AiConversation)
            .where(
                AiConversation.tenant_id == tenant.id,
                AiConversation.patient_phone == phone,
                AiConversation.status == "active",
            )
            .order_by(desc(AiConversation.created_at))
            .limit(1)
        )
    ).scalar_one_or_none()

    if existing:
        return _ser_conv(existing)

    conv = AiConversation(
        tenant_id=tenant.id,
        patient_phone=phone,
        status="active",
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return _ser_conv(conv)


@router.post("/patient-portal/ai/conversations/{conv_id}/messages")
async def send_message(
    conv_id: uuid.UUID,
    body: SendMessageBody,
    t: str = Query(..., description="patient session token"),
    db: AsyncSession = Depends(get_db),
):
    """Отправить сообщение пациента, получить ответ AI."""
    sess = await _patient_session_or_401(t, db)
    conv = (
        await db.execute(select(AiConversation).where(AiConversation.id == conv_id))
    ).scalar_one_or_none()
    # Безопасность: conv.patient_phone должен совпадать с session
    from app.utils.phone import normalize_phone as _np
    if conv and _np(conv.patient_phone) != _np(sess.phone):
        raise HTTPException(403, "Conversation belongs to other patient")
    if not conv:
        raise HTTPException(404, "Диалог не найден")
    if conv.tenant_id is None:
        raise HTTPException(400, "Диалог без тенанта")

    await _ensure_module_active(db, conv.tenant_id)

    if conv.status not in ("active", "escalated"):
        raise HTTPException(400, "Диалог закрыт")

    cfg = await _module_config(db, conv.tenant_id)
    max_per_day = int(cfg.get("max_messages_per_day") or DEFAULT_MAX_PER_DAY)
    model = str(cfg.get("model") or DEFAULT_MODEL)
    system_prompt = str(cfg.get("system_prompt") or DEFAULT_SYSTEM_PROMPT)

    # Дневной лимит
    used = await _count_user_msgs_today(db, conv.id)
    if used >= max_per_day:
        raise HTTPException(
            429,
            f"Дневной лимит сообщений ({max_per_day}) исчерпан. Попробуйте завтра.",
        )

    # 1. Сохраняем user-сообщение
    user_msg = AiMessage(
        conversation_id=conv.id,
        role="user",
        content=body.text.strip(),
    )
    db.add(user_msg)
    await db.flush()

    # 2. Готовим историю + system prompt
    history = await _history_for_llm(db, conv.id, DEFAULT_HISTORY_LIMIT)

    # 3. Зовём Gemini
    result = await chat_completion(history, system=system_prompt, model=model)

    answer_text = result.get("text") or "Извините, не получилось ответить."
    escalated = bool(result.get("escalate"))

    asst_msg = AiMessage(
        conversation_id=conv.id,
        role="assistant",
        content=answer_text,
        tokens_in=result.get("tokens_in"),
        tokens_out=result.get("tokens_out"),
        latency_ms=result.get("latency_ms"),
        model=result.get("model"),
        escalated=escalated,
    )
    db.add(asst_msg)

    conv.last_message_at = datetime.utcnow()
    conv.updated_at = datetime.utcnow()
    if escalated:
        conv.status = "escalated"
        # Создаём сообщение в Support Chat
        try:
            await _create_support_chat_message(
                db, conv.tenant_id, conv.patient_phone, body.text
            )
        except Exception as e:
            log.warning(f"create_support_chat_message failed: {e}")

    await db.commit()

    return {
        "text": answer_text,
        "escalated": escalated,
        "conversation_id": str(conv.id),
    }


@router.get("/patient-portal/ai/conversations/{conv_id}/messages")
async def list_messages_public(
    conv_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """История сообщений (для рендера чата на /p/)."""
    sess = await _patient_session_or_401(t, db)
    conv = (
        await db.execute(select(AiConversation).where(AiConversation.id == conv_id))
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(404, "Диалог не найден")
    if conv.tenant_id:
        await _ensure_module_active(db, conv.tenant_id)

    rows = (
        await db.execute(
            select(AiMessage)
            .where(AiMessage.conversation_id == conv.id)
            .order_by(AiMessage.created_at)
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    return {
        "conversation": _ser_conv(conv),
        "messages": [_ser_msg(m) for m in rows],
    }


@router.post("/patient-portal/ai/conversations/{conv_id}/escalate")
async def escalate_public(
    conv_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Пациент вручную просит перевести на менеджера."""
    sess = await _patient_session_or_401(t, db)
    conv = (
        await db.execute(select(AiConversation).where(AiConversation.id == conv_id))
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(404, "Диалог не найден")
    if conv.tenant_id is None:
        raise HTTPException(400, "Диалог без тенанта")

    await _ensure_module_active(db, conv.tenant_id)

    conv.status = "escalated"
    conv.updated_at = datetime.utcnow()
    db.add(
        AiMessage(
            conversation_id=conv.id,
            role="system",
            content="Пациент попросил перевести на менеджера.",
            escalated=True,
        )
    )
    try:
        await _create_support_chat_message(
            db,
            conv.tenant_id,
            conv.patient_phone,
            "Пациент попросил перевести на менеджера",
        )
    except Exception as e:
        log.warning(f"escalate: support chat failed: {e}")

    await db.commit()
    return {"ok": True, "status": conv.status}


# ────────────────────── Менеджерские эндпоинты ──────────────────────

admin_router = APIRouter(
    tags=["ai-assistant-admin"],
    dependencies=[Depends(require_module("ai_assistant"))],
)


@admin_router.get("/admin/ai/conversations")
async def list_conversations(
    status_filter: Optional[str] = Query(None, alias="status"),
    phone: Optional[str] = None,
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Список диалогов тенанта с фильтрами."""
    if not user.tenant_id:
        return {"items": [], "total": 0}

    since = datetime.utcnow() - timedelta(days=days)
    q = select(AiConversation).where(
        AiConversation.tenant_id == user.tenant_id,
        AiConversation.created_at >= since,
    )
    if status_filter:
        q = q.where(AiConversation.status == status_filter)
    if phone:
        q = q.where(AiConversation.patient_phone == normalize_phone(phone))

    total = (
        await db.execute(select(func.count()).select_from(q.subquery()))
    ).scalar_one()
    rows = (
        await db.execute(q.order_by(desc(AiConversation.created_at)).offset(offset).limit(limit))
    ).scalars().all()
    return {"items": [_ser_conv(c) for c in rows], "total": int(total or 0)}


@admin_router.get("/admin/ai/conversations/{conv_id}/messages")
async def list_messages_admin(
    conv_id: uuid.UUID,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Полная история диалога (для менеджера)."""
    conv = (
        await db.execute(select(AiConversation).where(AiConversation.id == conv_id))
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(404, "Диалог не найден")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, conv, status=403)

    rows = (
        await db.execute(
            select(AiMessage)
            .where(AiMessage.conversation_id == conv.id)
            .order_by(AiMessage.created_at)
        )
    ).scalars().all()
    return {
        "conversation": _ser_conv(conv),
        "messages": [_ser_msg(m) for m in rows],
    }


@admin_router.post("/admin/ai/conversations/{conv_id}/take")
async def take_conversation(
    conv_id: uuid.UUID,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Менеджер берёт диалог в работу: status='escalated' → создание в Support Chat."""
    conv = (
        await db.execute(select(AiConversation).where(AiConversation.id == conv_id))
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(404, "Диалог не найден")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, conv, status=403)

    conv.status = "escalated"
    conv.updated_at = datetime.utcnow()
    if conv.tenant_id:
        try:
            await _create_support_chat_message(
                db,
                conv.tenant_id,
                conv.patient_phone,
                f"Менеджер {user.username or user.email or user.id} взял диалог в работу.",
            )
        except Exception as e:
            log.warning(f"take: support chat failed: {e}")

    await db.commit()
    return {"ok": True, "status": conv.status}
