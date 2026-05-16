"""chat_workflow_service — операции над тредами: reassign, SLA-breach."""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatThread, ChatMessage
from app.models.user import User


class CrossTenantError(Exception):
    pass


async def reassign_thread(
    db: AsyncSession,
    *,
    thread: ChatThread,
    target_user: User,
    actor: User,
    note: Optional[str] = None,
    reason: str = "manual",  # "manual" | "sla"
) -> ChatThread:
    """Передаёт тред target_user. Кидает CrossTenantError если разные тенанты.

    - Меняет thread.assigned_doctor_id
    - Добавляет запись в reassigned_history
    - Создаёт system-сообщение
    - Сбрасывает SLA-флаги
    """
    if thread.tenant_id != target_user.tenant_id:
        raise CrossTenantError(
            f"target user {target_user.id} not in tenant {thread.tenant_id}"
        )
    old_id = thread.assigned_doctor_id
    thread.assigned_doctor_id = target_user.id
    # history (JSONB — присвоить новый список целиком чтобы SQLAlchemy заметил изменение)
    history = list(thread.reassigned_history or [])
    history.append({
        "at": datetime.utcnow().isoformat(),
        "from_user_id": str(old_id) if old_id else None,
        "to_user_id": str(target_user.id),
        "actor_user_id": str(actor.id),
        "reason": reason,
        "note": note or "",
    })
    thread.reassigned_history = history
    # System message
    sys_msg = ChatMessage(
        thread_id=thread.id,
        sender_type="system",
        sender_id=None,
        body=f"Тред передан → {getattr(target_user, 'full_name', None) or target_user.id}"
             + (f" (заметка: {note})" if note else ""),
    )
    db.add(sys_msg)
    # Сброс SLA
    thread.sla_breached_level = None
    thread.sla_breached_at = None
    return thread
