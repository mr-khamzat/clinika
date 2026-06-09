"""chat_sla_job — фоновое задание: SLA-эскалация + автозакрытие."""
from __future__ import annotations
import logging
import uuid as _uuid
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatThread, ChatMessage
from app.models.tenant import Tenant
from app.models.user import User
from app.services.chat_workflow_service import reassign_thread

log = logging.getLogger(__name__)

DEFAULT_SETTINGS = {
    "chat_sla_enabled": False,
    "chat_sla_minutes_reg": 15,
    "chat_sla_minutes_manager": 30,
    "chat_sla_minutes_owner": 60,
    "chat_autoclose_days": 7,
}

ROLE_PRIORITY = {"reg": 1, "manager": 2, "owner": 3}


def _resolve_level(mins: float, settings: dict) -> Optional[str]:
    """Возвращает 'reg'/'manager'/'owner' или None в зависимости от mins."""
    if mins >= settings.get("chat_sla_minutes_owner", 60):
        return "owner"
    if mins >= settings.get("chat_sla_minutes_manager", 30):
        return "manager"
    if mins >= settings.get("chat_sla_minutes_reg", 15):
        return "reg"
    return None


async def _find_free_user_of_role(
    db: AsyncSession, tenant_id, role_target: str
) -> Optional[User]:
    """Находит user'а нужной роли с минимальным числом open тредов в тенанте."""
    role_map = {"reg": "reg", "manager": "manager", "owner": "franchise_owner"}
    role = role_map.get(role_target, role_target)
    q = (
        select(User, func.count(ChatThread.id).label("load"))
        .outerjoin(ChatThread, (ChatThread.assigned_doctor_id == User.id)
                              & (ChatThread.status == "open"))
        .where(User.tenant_id == tenant_id, User.role == role)
        .group_by(User.id)
        .order_by("load")
        .limit(1)
    )
    r = await db.execute(q)
    row = r.first()
    return row[0] if row else None


def _system_actor(thread: ChatThread):
    """Возвращает SimpleNamespace-обёртку для использования в качестве actor
    в reassign_thread (SLA-эскалация без реального user'а).
    """
    return SimpleNamespace(
        id=_uuid.UUID("00000000-0000-0000-0000-000000000000"),
        tenant_id=thread.tenant_id,
        role="system",
        full_name="SLA-bot",
    )


async def _check_thread_sla(
    db: AsyncSession, thread: ChatThread, settings: dict
) -> Optional[str]:
    """Проверяет один тред. Возвращает новый sla_breached_level или None."""
    if not settings.get("chat_sla_enabled"):
        return None
    if thread.status != "open" or not thread.last_inbound_message_at:
        return None
    mins = (datetime.utcnow() - thread.last_inbound_message_at).total_seconds() / 60
    target_level = _resolve_level(mins, settings)
    if not target_level:
        return None
    current = thread.sla_breached_level
    if current and ROLE_PRIORITY.get(target_level, 0) <= ROLE_PRIORITY.get(current, 0):
        return None  # уже на этом или более высоком уровне
    target_user = await _find_free_user_of_role(db, thread.tenant_id, target_level)
    if not target_user:
        log.warning("SLA escalation: no user of role %s in tenant %s",
                    target_level, thread.tenant_id)
        return None
    actor = _system_actor(thread)
    try:
        await reassign_thread(
            db, thread=thread, target_user=target_user, actor=actor,
            note=f"SLA: {target_level} ({int(mins)} мин без ответа)",
            reason="sla",
        )
        thread.sla_breached_level = target_level
        thread.sla_breached_at = datetime.utcnow()
    except Exception as e:
        log.exception("Reassign failed in SLA: %s", e)
        return None
    return target_level


def _should_autoclose(thread: ChatThread, days: int) -> bool:
    if thread.status != "open" or not thread.last_message_at:
        return False
    lm = thread.last_message_at
    # Нормализуем: если БД вернула tz-aware (TIMESTAMPTZ), отрезаем tz для сравнения с utcnow().
    if lm.tzinfo is not None:
        lm = lm.replace(tzinfo=None)
    return (datetime.utcnow() - lm) >= timedelta(days=days)


async def chat_sla_checker_job() -> None:
    """Запускается раз в минуту через apscheduler. Использует
    AsyncSessionLocal (стандартный паттерн в проекте).
    """
    from app.database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            # 1) Загружаем все open треды с last_inbound_message_at not null
            q = select(ChatThread).where(
                ChatThread.status == "open",
                ChatThread.last_inbound_message_at.is_not(None),
            ).limit(500)  # safety cap
            threads = (await db.execute(q)).scalars().all()
            if not threads:
                return
            # 2) Группируем по tenant_id, читаем settings раз
            from collections import defaultdict
            by_tenant: dict = defaultdict(list)
            for t in threads:
                by_tenant[t.tenant_id].append(t)
            for tenant_id, tlist in by_tenant.items():
                tenant = (await db.execute(
                    select(Tenant).where(Tenant.id == tenant_id)
                )).scalar_one_or_none()
                # tenant.settings может отсутствовать как атрибут (если миграция wf02 не применилась)
                tenant_settings = getattr(tenant, "settings", None) if tenant else None
                settings = tenant_settings or {}
                merged = {**DEFAULT_SETTINGS, **settings}
                for thr in tlist:
                    await _check_thread_sla(db, thr, merged)
                    if _should_autoclose(thr, merged.get("chat_autoclose_days", 7)):
                        thr.status = "closed"
                        db.add(ChatMessage(
                            thread_id=thr.id, sender_type="system", sender_id=None,
                            body=f"Тред автоматически закрыт после {merged.get('chat_autoclose_days', 7)} дней неактивности",
                        ))
            await db.commit()
    except Exception as e:
        log.exception("chat_sla_checker_job failed: %s", e)
