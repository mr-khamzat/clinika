"""
Аудит-журнал — API.
Этап 8 SaaS-трансформации.

Эндпоинты:
  GET /audit/log                         — все события (manager)
  GET /audit/log/{entity_type}/{id}      — история конкретной сущности
  GET /audit/log/actor/{user_id}         — действия конкретного актора
  GET /audit/actions                     — список известных типов действий
"""
import uuid
from typing import Optional
from datetime import datetime, date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.core.tenant import require_feature
from app.models.audit import AuditEntry

router = APIRouter(prefix="/audit", tags=["audit"])

_feat = Depends(require_feature("audit_log"))
_mgr  = Depends(require_manager)


def _entry_out(e: AuditEntry) -> dict:
    return {
        "id":               str(e.id),
        "action":           e.action,
        "entity_type":      e.entity_type,
        "entity_id":        str(e.entity_id) if e.entity_id else None,
        "actor_id":         str(e.actor_id) if e.actor_id else None,
        "actor_name":       e.actor_name,
        "before":           e.before,
        "after":             e.after,
        "comment":          e.comment,
        "ip_address":       e.ip_address,
        # Гео-IP (могут быть None если mmdb отсутствует или приватный IP)
        "geo_country":      e.geo_country,
        "geo_country_name": e.geo_country_name,
        "geo_region":       e.geo_region,
        "geo_city":         e.geo_city,
        "geo_lat":          float(e.geo_lat) if e.geo_lat is not None else None,
        "geo_lon":          float(e.geo_lon) if e.geo_lon is not None else None,
        "created_at":       e.created_at.isoformat(),
    }


@router.get("/log", dependencies=[_feat, _mgr])
async def get_audit_log(
    action: Optional[str]  = Query(None, description="Фильтр по типу действия"),
    entity_type: Optional[str] = Query(None),
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Общий журнал аудита с фильтрацией."""
    d_from = datetime.utcnow() - timedelta(days=days)
    filters = [AuditEntry.created_at >= d_from]
    if action:
        filters.append(AuditEntry.action == action)
    if entity_type:
        filters.append(AuditEntry.entity_type == entity_type)

    q = await db.execute(
        select(AuditEntry)
        .where(and_(*filters))
        .order_by(AuditEntry.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    entries = q.scalars().all()

    # Общий count для пагинации
    count_q = await db.execute(
        select(AuditEntry.id).where(and_(*filters))
    )
    total = len(count_q.scalars().all())

    return {
        "total":   total,
        "limit":   limit,
        "offset":  offset,
        "items":   [_entry_out(e) for e in entries],
    }


@router.get("/log/{entity_type}/{entity_id}", dependencies=[_feat, _mgr])
async def get_entity_history(
    entity_type: str,
    entity_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """История изменений конкретной сущности."""
    q = await db.execute(
        select(AuditEntry)
        .where(
            AuditEntry.entity_type == entity_type,
            AuditEntry.entity_id   == entity_id,
        )
        .order_by(AuditEntry.created_at.desc())
        .limit(limit)
    )
    return [_entry_out(e) for e in q.scalars().all()]


@router.get("/log/actor/{actor_id}", dependencies=[_feat, _mgr])
async def get_actor_history(
    actor_id: uuid.UUID,
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Все действия конкретного пользователя."""
    d_from = datetime.utcnow() - timedelta(days=days)
    q = await db.execute(
        select(AuditEntry)
        .where(
            AuditEntry.actor_id   == actor_id,
            AuditEntry.created_at >= d_from,
        )
        .order_by(AuditEntry.created_at.desc())
        .limit(limit)
    )
    return [_entry_out(e) for e in q.scalars().all()]


@router.get("/actions", dependencies=[_feat, _mgr])
async def list_audit_actions():
    """Список всех известных типов действий."""
    from app.services.audit_service import AuditAction
    actions = [v for k, v in vars(AuditAction).items() if not k.startswith("_")]
    return sorted(actions)

@router.get("/feed", dependencies=[_mgr])
async def get_audit_feed(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Объединённый журнал: audit_log + activity_log, сортировка по времени."""
    from datetime import timedelta
    from app.models.audit import AuditEntry
    from app.models.activity_log import ActivityLog
    from sqlalchemy import text

    d_from = (datetime.utcnow() - timedelta(days=days)).isoformat()

    # audit_log
    aq = await db.execute(
        select(AuditEntry)
        .where(AuditEntry.created_at >= datetime.utcnow() - timedelta(days=days))
        .order_by(AuditEntry.created_at.desc())
        .limit(limit)
    )
    audit_entries = [
        {
            "source": "audit",
            "id": str(e.id),
            "action": e.action,
            "actor_name": e.actor_name,
            "entity_type": e.entity_type,
            "entity_id": str(e.entity_id) if e.entity_id else None,
            "before": e.before,
            "after": e.after,
            "ip_address": e.ip_address,
            "geo_country":      e.geo_country,
            "geo_country_name": e.geo_country_name,
            "geo_region":       e.geo_region,
            "geo_city":         e.geo_city,
            "geo_lat":          float(e.geo_lat) if e.geo_lat is not None else None,
            "geo_lon":          float(e.geo_lon) if e.geo_lon is not None else None,
            "comment": e.comment,
            "created_at": e.created_at.isoformat(),
        }
        for e in aq.scalars().all()
    ]

    # activity_log
    lq = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.created_at >= datetime.utcnow() - timedelta(days=days))
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    )
    activity_entries = [
        {
            "source": "activity",
            "id": str(e.id),
            "action": e.action,
            "actor_name": e.user_name,
            "entity_type": e.entity_type,
            "entity_id": str(e.entity_id) if e.entity_id else None,
            "before": None,
            "after": None,
            "ip_address": None,
            "geo_country":      None,
            "geo_country_name": None,
            "geo_region":       None,
            "geo_city":         None,
            "geo_lat":          None,
            "geo_lon":          None,
            "comment": None,
            "created_at": e.created_at.isoformat(),
        }
        for e in lq.scalars().all()
    ]

    # Merge & sort
    all_entries = sorted(
        audit_entries + activity_entries,
        key=lambda x: x["created_at"],
        reverse=True
    )[:limit]

    return {"total": len(all_entries), "items": all_entries}

