# ===== БЛОК: Сервис записи активности =====
# Центральная функция логирования действий пользователей.
# Вызывается из любого роутера — не делает commit сам.

import uuid
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.activity_log import ActivityLog


async def log_activity(
    db: AsyncSession,
    user,
    action: str,
    entity_type: Optional[str] = None,
    entity_id=None,
):
    """Записать событие в журнал активности. Commit — на вызывающей стороне."""
    log = ActivityLog(
        user_id=user.id if user else None,
        user_name=user.full_name if user else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id if isinstance(entity_id, uuid.UUID) or entity_id is None else uuid.UUID(str(entity_id)),
    )
    db.add(log)
