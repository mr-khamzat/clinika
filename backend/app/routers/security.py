"""
Журнал безопасности — API.

Все эндпоинты доступны только super_admin (require_super_admin).
Префикс /admin/security/...

Эндпоинты:
  GET  /admin/security/audit       — paginated audit-log с фильтрами
  GET  /admin/security/summary     — счётчики/топы/активные impersonation за 24h
  GET  /admin/security/blocked-ips — список ручных блокировок IP
  POST /admin/security/block-ip    — заблокировать IP
  POST /admin/security/unblock-ip  — снять блокировку
  GET  /admin/security/heatmap     — activity heatmap по часам × дням недели
  WS   /admin/security/ws          — realtime push (опционально)
"""
import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_super_admin
from app.database import get_db
from app.models.audit import AuditEntry
from app.models.blocked_ip import BlockedIp
from app.models.tenant import Tenant
from app.models.user import User
from app.services import audit_service, security_service
from app.services.audit_service import AuditAction

router = APIRouter(prefix="/admin/security", tags=["super-admin", "security"])
log = logging.getLogger("security_router")


# ───────────────────────────────────────────────────────────────────────────
# Схемы
# ───────────────────────────────────────────────────────────────────────────


class BlockIpRequest(BaseModel):
    ip: str = Field(..., min_length=3, max_length=45)
    reason: str = Field("", max_length=500)
    ttl_hours: int = Field(24, ge=0, le=24 * 365)  # 0 = бессрочно

    @field_validator("ip")
    @classmethod
    def _normalize_ip(cls, v: str) -> str:
        # Простая нормализация — без CIDR, без префиксов.
        s = v.strip()
        # Можно дополнить ipaddress.ip_address(s) валидатором.
        try:
            import ipaddress
            ipaddress.ip_address(s)
        except Exception:
            raise ValueError("Некорректный IP-адрес")
        return s


class UnblockIpRequest(BaseModel):
    ip: str = Field(..., min_length=3, max_length=45)


# ───────────────────────────────────────────────────────────────────────────
# Сериализаторы
# ───────────────────────────────────────────────────────────────────────────


def _audit_out(e: AuditEntry, *, actor_role: str | None = None, tenant_slug: str | None = None) -> dict:
    return {
        "id":               str(e.id),
        "action":           e.action,
        "actor_id":         str(e.actor_id) if e.actor_id else None,
        "actor_name":       e.actor_name,
        "actor_role":       actor_role,
        "tenant_id":        str(e.tenant_id) if e.tenant_id else None,
        "tenant_slug":      tenant_slug,
        "entity_type":      e.entity_type,
        "entity_id":        str(e.entity_id) if e.entity_id else None,
        "before":           e.before,
        "after":            e.after,
        "comment":          e.comment,
        "ip_address":       e.ip_address,
        "user_agent":       e.user_agent,
        "geo_country":      e.geo_country,
        "geo_country_name": e.geo_country_name,
        "geo_region":       e.geo_region,
        "geo_city":         e.geo_city,
        "geo_lat":          float(e.geo_lat) if e.geo_lat is not None else None,
        "geo_lon":          float(e.geo_lon) if e.geo_lon is not None else None,
        "created_at":       e.created_at.isoformat() if e.created_at else None,
    }


def _blocked_out(b: BlockedIp, *, by_name: str | None = None) -> dict:
    return {
        "id":            str(b.id),
        "ip":            b.ip,
        "reason":        b.reason,
        "blocked_by_id": str(b.blocked_by_id) if b.blocked_by_id else None,
        "blocked_by_name": by_name,
        "blocked_at":    b.blocked_at.isoformat() if b.blocked_at else None,
        "blocked_until": b.blocked_until.isoformat() if b.blocked_until else None,
        "is_active":     bool(b.is_active),
    }


# ───────────────────────────────────────────────────────────────────────────
# GET /admin/security/audit — paginated лента событий
# ───────────────────────────────────────────────────────────────────────────


@router.get("/audit")
async def list_audit(
    since: Optional[datetime] = Query(None, description="Нижняя граница (UTC ISO)"),
    until: Optional[datetime] = Query(None, description="Верхняя граница (UTC ISO)"),
    action_filter: Optional[list[str]] = Query(None, alias="action"),
    actor_id: Optional[uuid.UUID] = Query(None),
    entity_type: Optional[str] = Query(None),
    tenant_id: Optional[uuid.UUID] = Query(None),
    search: Optional[str] = Query(None, description="Подстрока в actor_name / ip / comment"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Paginated security-журнал. Видит все тенанты."""
    if since is None:
        since = datetime.utcnow() - timedelta(days=7)
    filters = [AuditEntry.created_at >= since]
    if until is not None:
        filters.append(AuditEntry.created_at <= until)
    if action_filter:
        filters.append(AuditEntry.action.in_(action_filter))
    if actor_id:
        filters.append(AuditEntry.actor_id == actor_id)
    if entity_type:
        filters.append(AuditEntry.entity_type == entity_type)
    if tenant_id:
        filters.append(AuditEntry.tenant_id == tenant_id)
    if search:
        s = f"%{search}%"
        filters.append(or_(
            AuditEntry.actor_name.ilike(s),
            AuditEntry.ip_address.ilike(s),
            AuditEntry.comment.ilike(s),
        ))

    # total
    total = (
        await db.execute(select(func.count(AuditEntry.id)).where(and_(*filters)))
    ).scalar() or 0

    rows = (
        await db.execute(
            select(AuditEntry)
            .where(and_(*filters))
            .order_by(AuditEntry.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    # Подгружаем актеров и тенанты батчем — для роли и slug
    actor_ids = {r.actor_id for r in rows if r.actor_id}
    actor_role_map: dict[uuid.UUID, str] = {}
    if actor_ids:
        users = (
            await db.execute(select(User.id, User.role).where(User.id.in_(actor_ids)))
        ).all()
        for uid, role in users:
            actor_role_map[uid] = role.value if hasattr(role, "value") else str(role)

    tenant_ids = {r.tenant_id for r in rows if r.tenant_id}
    tenant_slug_map: dict[uuid.UUID, str] = {}
    if tenant_ids:
        ts = (
            await db.execute(select(Tenant.id, Tenant.slug).where(Tenant.id.in_(tenant_ids)))
        ).all()
        for tid, slug in ts:
            tenant_slug_map[tid] = slug

    items = [
        _audit_out(
            r,
            actor_role=actor_role_map.get(r.actor_id) if r.actor_id else None,
            tenant_slug=tenant_slug_map.get(r.tenant_id) if r.tenant_id else None,
        )
        for r in rows
    ]
    return {
        "total": int(total),
        "page": page,
        "page_size": page_size,
        "items": items,
    }


# ───────────────────────────────────────────────────────────────────────────
# GET /admin/security/summary — общая сводка
# ───────────────────────────────────────────────────────────────────────────


@router.get("/summary")
async def security_summary(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Сводка по событиям безопасности за 24 часа."""
    return await security_service.get_summary(db)


# ───────────────────────────────────────────────────────────────────────────
# GET /admin/security/heatmap — activity по часу × дню недели за 7 дней
# ───────────────────────────────────────────────────────────────────────────


@router.get("/heatmap")
async def security_heatmap(
    days: int = Query(7, ge=1, le=30),
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Heatmap: число security-событий по hour × day_of_week."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    attack_actions = [
        AuditAction.AUTH_LOGIN_FAILED,
        AuditAction.AUTH_BRUTE_FORCE_DETECTED,
        AuditAction.PERMISSION_DENIED,
        AuditAction.WEBHOOK_SIGNATURE_INVALID,
        AuditAction.REGION_VIOLATION,
        AuditAction.SHORT_CODE_BRUTE_FORCE_DETECTED,
    ]
    rows = (
        await db.execute(
            select(
                # 0=воскресенье в Postgres dow → нормализуем к 0=понедельник
                func.extract("dow", AuditEntry.created_at).label("dow"),
                func.extract("hour", AuditEntry.created_at).label("hour"),
                func.count(AuditEntry.id).label("cnt"),
            )
            .where(
                AuditEntry.created_at >= cutoff,
                AuditEntry.action.in_(attack_actions),
            )
            .group_by("dow", "hour")
        )
    ).all()

    # Грид 7 × 24. Индекс 0 = понедельник, 6 = воскресенье.
    grid = [[0 for _ in range(24)] for _ in range(7)]
    for dow, hour, cnt in rows:
        # postgres dow: 0=sunday, 1=monday, ... 6=saturday
        d_idx = (int(dow) + 6) % 7
        h_idx = int(hour)
        grid[d_idx][h_idx] = int(cnt)

    return {
        "days": days,
        "grid": grid,
        "labels_days": ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
    }


# ───────────────────────────────────────────────────────────────────────────
# Blocked IPs
# ───────────────────────────────────────────────────────────────────────────


@router.get("/blocked-ips")
async def list_blocked_ips(
    include_inactive: bool = Query(False),
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    q = select(BlockedIp).order_by(BlockedIp.blocked_at.desc())
    if not include_inactive:
        q = q.where(BlockedIp.is_active.is_(True))
    rows = (await db.execute(q)).scalars().all()

    # Имена админов
    by_ids = {r.blocked_by_id for r in rows if r.blocked_by_id}
    by_map: dict[uuid.UUID, str] = {}
    if by_ids:
        users = (
            await db.execute(select(User.id, User.full_name).where(User.id.in_(by_ids)))
        ).all()
        for uid, name in users:
            by_map[uid] = name

    return {
        "total": len(rows),
        "items": [
            _blocked_out(r, by_name=by_map.get(r.blocked_by_id) if r.blocked_by_id else None)
            for r in rows
        ],
    }


@router.post("/block-ip")
async def block_ip(
    body: BlockIpRequest,
    request: Request,
    current: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Заблокировать IP. ttl_hours=0 — бессрочно."""
    # Если уже есть активная — продлим/обновим.
    existing = (
        await db.execute(
            select(BlockedIp).where(
                BlockedIp.ip == body.ip,
                BlockedIp.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()

    until = None
    if body.ttl_hours and body.ttl_hours > 0:
        until = datetime.utcnow() + timedelta(hours=body.ttl_hours)

    if existing:
        existing.reason = body.reason or existing.reason
        existing.blocked_until = until
        existing.blocked_by_id = current.id
        existing.blocked_at = datetime.utcnow()
        rec = existing
    else:
        rec = BlockedIp(
            ip=body.ip,
            reason=body.reason or None,
            blocked_by_id=current.id,
            blocked_until=until,
            is_active=True,
        )
        db.add(rec)

    # Audit-запись
    await audit_service.write_safe(
        db,
        AuditAction.IP_BLOCKED,
        actor_id=current.id,
        actor_name=current.full_name or current.username,
        comment=body.reason or None,
        after={
            "ip": body.ip,
            "ttl_hours": body.ttl_hours,
            "blocked_until": until.isoformat() if until else None,
        },
        request=request,
    )
    await db.commit()

    # Инвалидируем кеш middleware через app.state (избегаем циклического импорта).
    try:
        mw = getattr(request.app.state, "block_ip_mw", None)
        if mw is not None:
            mw.invalidate()
    except Exception:
        pass

    return {"ok": True, "id": str(rec.id), "ip": rec.ip,
            "blocked_until": rec.blocked_until.isoformat() if rec.blocked_until else None}


@router.post("/unblock-ip")
async def unblock_ip(
    body: UnblockIpRequest,
    request: Request,
    current: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Снять блокировку с IP (soft — is_active=false, запись остаётся)."""
    rows = (
        await db.execute(
            select(BlockedIp).where(
                BlockedIp.ip == body.ip,
                BlockedIp.is_active.is_(True),
            )
        )
    ).scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="IP не заблокирован")
    for r in rows:
        r.is_active = False

    await audit_service.write_safe(
        db,
        AuditAction.IP_UNBLOCKED,
        actor_id=current.id,
        actor_name=current.full_name or current.username,
        after={"ip": body.ip, "records_deactivated": len(rows)},
        request=request,
    )
    await db.commit()

    try:
        from app.main import block_ip_middleware  # type: ignore
        block_ip_middleware.invalidate()
    except Exception:
        pass

    return {"ok": True, "ip": body.ip, "deactivated": len(rows)}
