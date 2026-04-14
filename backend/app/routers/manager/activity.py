# ===== БЛОК: Журнал активности =====
# Просмотр лога событий системы.
# /manager/activity/

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User
from app.models.activity_log import ActivityLog

router = APIRouter(tags=["manager:activity"])


@router.get("/activity/", response_model=list[dict])
async def get_activity_log(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if current_user.tenant_id is not None:
        filters.append(ActivityLog.tenant_id == current_user.tenant_id)
    if date_from:
        try:
            filters.append(ActivityLog.created_at >= datetime.fromisoformat(date_from))
        except Exception:
            pass
    if date_to:
        try:
            filters.append(ActivityLog.created_at <= datetime.fromisoformat(date_to + "T23:59:59"))
        except Exception:
            pass
    where = and_(*filters) if filters else True
    offset = (page - 1) * limit

    q = await db.execute(
        select(ActivityLog).where(where)
        .order_by(ActivityLog.created_at.desc())
        .offset(offset).limit(limit)
    )
    return [
        {
            "id": str(r.id), "user_id": str(r.user_id) if r.user_id else None,
            "user_name": r.user_name, "action": r.action,
            "entity_type": r.entity_type,
            "entity_id": str(r.entity_id) if r.entity_id else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in q.scalars().all()
    ]
