"""
Глава 9 — Сервис асинхронного чата пациент↔клиника.

Лимиты:
  - без активной подписки: пациент может отправить максимум 3 сообщения
    за последние 30 дней (суммарно по всем своим тредам);
  - с подпиской (health_plus / family_plus / pro): безлимит.
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional, Iterable

from sqlalchemy import select, and_, or_, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatThread, ChatMessage
from app.services import subscription_service as subs_service


PATIENT_MONTHLY_FREE_LIMIT = 3


def serialize_thread(t: ChatThread, last_msg: ChatMessage | None = None) -> dict:
    return {
        "id": str(t.id),
        "tenant_id": str(t.tenant_id) if t.tenant_id else None,
        "clinic_id": str(t.clinic_id),
        "patient_id": str(t.patient_id),
        "subject": t.subject,
        "status": t.status,
        "assigned_doctor_id": str(t.assigned_doctor_id) if t.assigned_doctor_id else None,
        "last_message_at": t.last_message_at.isoformat() if t.last_message_at else None,
        "unread_for_patient": int(t.unread_for_patient or 0),
        "unread_for_clinic": int(t.unread_for_clinic or 0),
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        "last_message_preview": (last_msg.body[:140] if last_msg else None),
        "last_message_sender": (last_msg.sender_type if last_msg else None),
    }


def serialize_message(m: ChatMessage) -> dict:
    return {
        "id": str(m.id),
        "thread_id": str(m.thread_id),
        "sender_type": m.sender_type,
        "sender_id": str(m.sender_id) if m.sender_id else None,
        "body": m.body,
        "attachments": m.attachments or [],
        "read_at": m.read_at.isoformat() if m.read_at else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


async def list_patient_threads(
    db: AsyncSession, patient_id: uuid.UUID
) -> list[ChatThread]:
    r = await db.execute(
        select(ChatThread)
        .where(ChatThread.patient_id == patient_id)
        .order_by(ChatThread.last_message_at.desc().nullslast(),
                  ChatThread.created_at.desc())
    )
    return list(r.scalars().all())


async def list_clinic_threads(
    db: AsyncSession,
    clinic_ids: Iterable[uuid.UUID],
    status: str | None = None,
) -> list[ChatThread]:
    q = select(ChatThread).where(ChatThread.clinic_id.in_(list(clinic_ids)))
    if status:
        q = q.where(ChatThread.status == status)
    q = q.order_by(ChatThread.last_message_at.desc().nullslast(),
                   ChatThread.created_at.desc())
    r = await db.execute(q)
    return list(r.scalars().all())


async def get_thread(db: AsyncSession, thread_id: uuid.UUID) -> ChatThread | None:
    r = await db.execute(select(ChatThread).where(ChatThread.id == thread_id))
    return r.scalar_one_or_none()


async def list_messages(
    db: AsyncSession, thread_id: uuid.UUID,
    limit: int = 100, before_id: uuid.UUID | None = None,
) -> list[ChatMessage]:
    q = select(ChatMessage).where(ChatMessage.thread_id == thread_id)
    if before_id:
        # пагинация курсором по created_at старше before_id
        sub = (await db.execute(
            select(ChatMessage.created_at).where(ChatMessage.id == before_id)
        )).scalar_one_or_none()
        if sub:
            q = q.where(ChatMessage.created_at < sub)
    q = q.order_by(ChatMessage.created_at.asc()).limit(limit)
    r = await db.execute(q)
    return list(r.scalars().all())


async def last_message(db: AsyncSession, thread_id: uuid.UUID) -> ChatMessage | None:
    r = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(1)
    )
    return r.scalar_one_or_none()


async def count_patient_messages_last_30d(
    db: AsyncSession, patient_id: uuid.UUID
) -> int:
    """Сколько сообщений пациент отправил за последние 30 дней."""
    since = datetime.utcnow() - timedelta(days=30)
    r = await db.execute(
        select(func.count(ChatMessage.id))
        .join(ChatThread, ChatThread.id == ChatMessage.thread_id)
        .where(
            ChatThread.patient_id == patient_id,
            ChatMessage.sender_type == "patient",
            ChatMessage.created_at >= since,
        )
    )
    return int(r.scalar() or 0)


async def check_patient_can_send(
    db: AsyncSession, patient_id: uuid.UUID
) -> tuple[bool, int, int | None]:
    """
    Возвращает (allowed, used_in_period, monthly_limit_or_None_if_unlimited).
    """
    has_active = await subs_service.has_active_plan(
        db, patient_id, plans=["health_plus", "family_plus", "pro"]
    )
    used = await count_patient_messages_last_30d(db, patient_id)
    if has_active:
        return True, used, None
    return used < PATIENT_MONTHLY_FREE_LIMIT, used, PATIENT_MONTHLY_FREE_LIMIT


async def create_thread(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    clinic_id: uuid.UUID,
    patient_id: uuid.UUID,
    subject: str | None,
    initial_body: str,
) -> tuple[ChatThread, ChatMessage]:
    now = datetime.utcnow()
    th = ChatThread(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        clinic_id=clinic_id,
        patient_id=patient_id,
        subject=subject,
        status="open",
        last_message_at=now,
        unread_for_patient=0,
        unread_for_clinic=1,
    )
    db.add(th)
    await db.flush()
    msg = ChatMessage(
        id=uuid.uuid4(),
        thread_id=th.id,
        sender_type="patient",
        sender_id=patient_id,
        body=initial_body,
        attachments=None,
    )
    db.add(msg)
    await db.flush()
    return th, msg


async def add_patient_message(
    db: AsyncSession, thread: ChatThread, patient_id: uuid.UUID,
    body: str, attachments: list | None = None,
) -> ChatMessage:
    msg = ChatMessage(
        id=uuid.uuid4(),
        thread_id=thread.id,
        sender_type="patient",
        sender_id=patient_id,
        body=body,
        attachments=attachments,
    )
    db.add(msg)
    thread.last_message_at = datetime.utcnow()
    thread.unread_for_clinic = int(thread.unread_for_clinic or 0) + 1
    thread.updated_at = datetime.utcnow()
    if thread.status == "closed":
        # повторное обращение пациента — переоткрываем
        thread.status = "open"
    await db.flush()
    return msg


async def add_staff_message(
    db: AsyncSession, thread: ChatThread, user_id: uuid.UUID,
    sender_type: str, body: str, attachments: list | None = None,
) -> ChatMessage:
    if sender_type not in ("doctor", "reg", "manager", "system"):
        raise ValueError(f"Invalid sender_type {sender_type}")
    msg = ChatMessage(
        id=uuid.uuid4(),
        thread_id=thread.id,
        sender_type=sender_type,
        sender_id=user_id,
        body=body,
        attachments=attachments,
    )
    db.add(msg)
    thread.last_message_at = datetime.utcnow()
    thread.unread_for_patient = int(thread.unread_for_patient or 0) + 1
    thread.updated_at = datetime.utcnow()
    await db.flush()
    return msg


async def mark_read_for_patient(db: AsyncSession, thread: ChatThread) -> None:
    now = datetime.utcnow()
    await db.execute(
        update(ChatMessage)
        .where(
            ChatMessage.thread_id == thread.id,
            ChatMessage.read_at.is_(None),
            ChatMessage.sender_type != "patient",
        )
        .values(read_at=now)
    )
    thread.unread_for_patient = 0
    thread.updated_at = now


async def mark_read_for_clinic(db: AsyncSession, thread: ChatThread) -> None:
    now = datetime.utcnow()
    await db.execute(
        update(ChatMessage)
        .where(
            ChatMessage.thread_id == thread.id,
            ChatMessage.read_at.is_(None),
            ChatMessage.sender_type == "patient",
        )
        .values(read_at=now)
    )
    thread.unread_for_clinic = 0
    thread.updated_at = now
