"""
Module Monitoring Router — health-status платных модулей per-tenant.

Endpoints:
  GET  /admin/modules/health           — модули текущего пользователя
  GET  /admin/modules/health/all       — heatmap по всем тенантам (super_admin)
  POST /admin/modules/health/check-now — внеочередная проверка
  GET  /admin/modules/health/{module}  — детали по модулю + audit-история

Авторизация:
  super_admin    — видит всё, может триггерить check для всех
  franchise_owner / manager — только свой tenant_id
  Иные роли — 403.
"""
import logging
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.audit import AuditEntry
from app.models.module_health import ModuleHealthCheck, ModuleHealthStatus
from app.models.user import User, UserRole
from app.services.module_health_service import (
    get_modules_health_all_tenants,
    get_modules_health_for_tenant,
    run_health_checks_all_tenants,
    run_health_checks_for_tenant,
)

log = logging.getLogger("module_monitoring")

router = APIRouter(prefix="/admin/modules", tags=["monitoring"])


def _is_super(user: User) -> bool:
    return user.role == UserRole.SUPER_ADMIN


def _can_view_own(user: User) -> bool:
    return user.role in (UserRole.SUPER_ADMIN, UserRole.FRANCHISE_OWNER,
                         UserRole.MANAGER)


# ─── GET health (для собственного тенанта; super_admin → все) ────────────────

@router.get("/health")
async def get_my_modules_health(
    tenant_id: str | None = Query(None, description="super_admin может фильтровать"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_view_own(current_user):
        raise HTTPException(status_code=403,
                            detail="Доступ только для руководства/super_admin")

    if _is_super(current_user):
        if tenant_id:
            try:
                tid = uuid.UUID(tenant_id)
            except ValueError:
                raise HTTPException(status_code=400,
                                    detail="Неверный tenant_id")
            modules = await get_modules_health_for_tenant(db, tid)
            return {"tenant_id": str(tid), "modules": modules}
        # без явного tenant_id — отдаём heatmap по всем
        rows = await get_modules_health_all_tenants(db)
        return {"all": True, "tenants": rows}

    # franchise_owner / manager — только свой
    if not current_user.tenant_id:
        raise HTTPException(status_code=403,
                            detail="Пользователь не привязан к тенанту")
    modules = await get_modules_health_for_tenant(db, current_user.tenant_id)
    return {"tenant_id": str(current_user.tenant_id), "modules": modules}


# ─── GET heatmap по всем тенантам (только super_admin) ───────────────────────

@router.get("/health/all")
async def get_all_tenants_modules(
    status_filter: str | None = Query(None,
        description="Фильтр: ok|degraded|error|idle|unknown (через запятую)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _is_super(current_user):
        raise HTTPException(status_code=403,
                            detail="Только для super_admin")
    rows = await get_modules_health_all_tenants(db)
    if status_filter:
        wanted = {s.strip() for s in status_filter.split(",") if s.strip()}
        for r in rows:
            r["modules"] = [m for m in r["modules"]
                            if (m.get("health") or {}).get("status") in wanted]
        rows = [r for r in rows if r["modules"]]
    # Top problematic — отсортируем по сумме error+degraded
    def _problem_score(r):
        cnt = 0
        for m in r["modules"]:
            st = (m.get("health") or {}).get("status")
            if st == ModuleHealthStatus.ERROR.value:
                cnt += 2
            elif st == ModuleHealthStatus.DEGRADED.value:
                cnt += 1
        return cnt
    top_problematic = sorted(rows, key=_problem_score, reverse=True)[:10]
    return {
        "tenants": rows,
        "top_problematic": [
            {"tenant_id": r["tenant_id"], "tenant_name": r["tenant_name"],
             "tenant_slug": r["tenant_slug"], "score": _problem_score(r)}
            for r in top_problematic if _problem_score(r) > 0
        ],
    }


# ─── POST trigger check-now ──────────────────────────────────────────────────

@router.post("/health/check-now")
async def trigger_health_check(
    tenant_id: str | None = Query(None,
        description="super_admin: явный tenant_id для одного тенанта"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_view_own(current_user):
        raise HTTPException(status_code=403,
                            detail="Доступ только для руководства/super_admin")

    if _is_super(current_user):
        if tenant_id:
            try:
                tid = uuid.UUID(tenant_id)
            except ValueError:
                raise HTTPException(status_code=400, detail="Неверный tenant_id")
            stats = await run_health_checks_for_tenant(db, tid)
            return {"scope": "tenant", "tenant_id": str(tid), "stats": stats}
        stats = await run_health_checks_all_tenants(db)
        return {"scope": "all", "stats": stats}

    # franchise_owner / manager — только свой тенант
    if not current_user.tenant_id:
        raise HTTPException(status_code=403,
                            detail="Пользователь не привязан к тенанту")
    stats = await run_health_checks_for_tenant(db, current_user.tenant_id)
    return {"scope": "tenant", "tenant_id": str(current_user.tenant_id),
            "stats": stats}


# ─── GET детали по конкретному модулю ────────────────────────────────────────

@router.get("/health/{module_key}")
async def module_details(
    module_key: str,
    tenant_id: str | None = Query(None,
        description="super_admin: явный tenant_id; иначе берётся из user.tenant_id"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_view_own(current_user):
        raise HTTPException(status_code=403,
                            detail="Доступ только для руководства/super_admin")
    if _is_super(current_user) and tenant_id:
        try:
            tid = uuid.UUID(tenant_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Неверный tenant_id")
    else:
        if not current_user.tenant_id:
            raise HTTPException(status_code=403,
                                detail="Пользователь не привязан к тенанту")
        tid = current_user.tenant_id

    check = (await db.execute(
        select(ModuleHealthCheck)
        .where(ModuleHealthCheck.tenant_id == tid)
        .where(ModuleHealthCheck.module_key == module_key)
    )).scalar_one_or_none()

    if not check:
        return {
            "module_key": module_key,
            "tenant_id": str(tid),
            "health": {
                "status": ModuleHealthStatus.UNKNOWN.value,
                "metrics": {},
                "last_check_at": None,
            },
            "audit": [],
        }

    # Последние записи аудита по этому модулю за 24 часа
    cutoff = datetime.utcnow() - timedelta(hours=24)
    audit_rows = (await db.execute(
        select(AuditEntry)
        .where(AuditEntry.tenant_id == tid)
        .where(AuditEntry.created_at >= cutoff)
        .where(AuditEntry.entity_type == module_key)
        .order_by(AuditEntry.created_at.desc())
        .limit(20)
    )).scalars().all()

    return {
        "module_key": module_key,
        "tenant_id": str(tid),
        "health": {
            "status": check.status,
            "last_check_at": check.last_check_at.isoformat()
                              if check.last_check_at else None,
            "last_used_at": check.last_used_at.isoformat()
                             if check.last_used_at else None,
            "last_success_at": check.last_success_at.isoformat()
                                if check.last_success_at else None,
            "last_error_at": check.last_error_at.isoformat()
                              if check.last_error_at else None,
            "last_error_message": check.last_error_message,
            "error_count_24h": check.error_count_24h,
            "metrics": check.metrics or {},
        },
        "audit": [
            {
                "id": str(a.id),
                "action": a.action,
                "created_at": a.created_at.isoformat() if a.created_at else None,
                "actor_id": str(a.actor_id) if a.actor_id else None,
                "actor_name": a.actor_name,
                "comment": a.comment,
                "after": a.after,
            }
            for a in audit_rows
        ],
    }
