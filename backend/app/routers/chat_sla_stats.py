"""
SLA-cветометки (Intercom-style queue) — дашборд аналитики по open-thread'ам.

GET /clinic/chat/sla/dashboard — возвращает {red, yellow, green, total_open}
для всех клиник, к которым у пользователя есть доступ.

Пороги:
  red    — без ответа >15 мин (просрочен)
  yellow — без ответа 5..15 мин (требует внимания)
  green  — без ответа <5 мин (свежий)
"""
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.chat import ChatThread


router = APIRouter(prefix="/clinic/chat/sla", tags=["chat-sla"])


@router.get("/dashboard")
async def sla_dashboard(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Текущее состояние SLA по всем открытым thread'ам clinic-scope."""
    from app.routers.clinic_chat import _user_clinic_ids, _ensure_clinic_role

    _ensure_clinic_role(user)
    allowed = await _user_clinic_ids(db, user)
    if not allowed:
        return {"red": 0, "yellow": 0, "green": 0, "total_open": 0}

    rows = (await db.execute(
        select(ChatThread).where(
            ChatThread.clinic_id.in_(allowed),
            ChatThread.status == "open",
        )
    )).scalars().all()

    now = datetime.utcnow()
    red = yellow = green = 0
    for t in rows:
        if not t.last_inbound_message_at:
            continue
        delta = (now - t.last_inbound_message_at).total_seconds()
        if delta > 900:
            red += 1
        elif delta >= 300:
            yellow += 1
        else:
            green += 1
    return {
        "red": red,
        "yellow": yellow,
        "green": green,
        "total_open": len(rows),
    }
