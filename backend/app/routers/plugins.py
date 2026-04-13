"""
Роутер плагинов v2 — коммерческая система фич.
Заменяет старый plugins.py (простой health-check).
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.core.deps import get_current_user, require_manager
from app.core.tenant import get_current_tenant
from app.models.user import User
from app.models.tenant import Tenant
from app.models.clinic import Clinic
from app.services import plugin_service

router = APIRouter(prefix="/plugins", tags=["plugins"])


def _tid(tenant: Tenant | None, user: User) -> uuid.UUID | None:
    """Определяет tenant_id из тенанта или пользователя."""
    if tenant:
        return tenant.id
    if user.tenant_id:
        return user.tenant_id
    return None


# ── Каталог плагинов ──────────────────────────────────────────────────────────

@router.get("")
async def list_plugins(
    current_user: User = Depends(get_current_user),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Все плагины с фичами и статусом для текущего тенанта."""
    tid = _tid(tenant, current_user)
    if tid is None:
        plugins = await plugin_service.get_all_plugins(db)
        return [{"key": p.key, "name": p.name, "icon": p.icon, "features": []} for p in plugins]
    return await plugin_service.get_features_with_status(tid, db)


@router.get("/features")
async def list_features(
    current_user: User = Depends(get_current_user),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Плоский список всех фич с текущим статусом тенанта."""
    tid = _tid(tenant, current_user)
    if not tid:
        raise HTTPException(status_code=400, detail="Тенант не определён")
    data = await plugin_service.get_features_with_status(tid, db)
    # Возвращаем плоский список
    features = []
    for plugin in data:
        for f in plugin["features"]:
            f["plugin_key"] = plugin["key"]
            f["plugin_name"] = plugin["name"]
            features.append(f)
    return features


# ── Управление фичами ─────────────────────────────────────────────────────────

class FeatureToggleRequest(BaseModel):
    feature_key: str
    trial_days: Optional[int] = None  # 14 для trial


@router.post("/features/enable")
async def enable_feature(
    req: FeatureToggleRequest,
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Включить фичу для тенанта (опционально на trial период)."""
    tid = _tid(tenant, current_user)
    if not tid:
        raise HTTPException(status_code=400, detail="Тенант не определён")
    try:
        result = await plugin_service.enable_feature(tid, req.feature_key, db, req.trial_days)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/features/disable")
async def disable_feature(
    req: FeatureToggleRequest,
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Отключить платную фичу для тенанта."""
    tid = _tid(tenant, current_user)
    if not tid:
        raise HTTPException(status_code=400, detail="Тенант не определён")
    try:
        return await plugin_service.disable_feature(tid, req.feature_key, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/features/{feature_key}/check")
async def check_feature(
    feature_key: str,
    current_user: User = Depends(get_current_user),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Проверить доступность конкретной фичи для текущего тенанта."""
    tid = _tid(tenant, current_user)
    if not tid:
        return {"feature_key": feature_key, "available": True}
    ok = await plugin_service.has_feature(tid, feature_key, db)
    return {"feature_key": feature_key, "available": ok}


# ── Биллинговые события ───────────────────────────────────────────────────────

@router.get("/billing-events")
async def billing_events(
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """История биллинговых событий тенанта."""
    tid = _tid(tenant, current_user)
    if not tid:
        return []
    return await plugin_service.get_billing_events(tid, db)


# ── Интеграции ────────────────────────────────────────────────────────────────

@router.get("/integrations")
async def get_integrations(
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Статус интеграций для всех клиник тенанта."""
    from app.plugins.registry import plugin_registry
    tid = _tid(tenant, current_user)
    q = select(Clinic).where(Clinic.is_active == True)
    if tid:
        q = q.where(Clinic.tenant_id == tid)
    clinics_r = await db.execute(q)
    clinics = clinics_r.scalars().all()

    # Статус глобальных плагинов
    plugin_statuses = {}
    for p in plugin_registry.all():
        plugin_statuses[p.name] = {
            "enabled": await p.is_enabled(),
            "name": p.display_name,
        }

    return {
        "clinics": [{"id": str(c.id), "name": c.name, "address": c.address} for c in clinics],
        "plugins": plugin_statuses,
    }


# ── P2P Звонки ────────────────────────────────────────────────────────────────

class P2PSettingsRequest(BaseModel):
    internal_calls_enabled: bool
    p2p_clinic_ids: list[str] = []


@router.get("/p2p/settings")
async def get_p2p_settings(
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    tid = _tid(tenant, current_user)
    if not tid:
        return {"internal_calls_enabled": False, "cross_clinic_enabled": False, "p2p_clinic_ids": []}
    return await plugin_service.get_p2p_settings(tid, db)


@router.post("/p2p/settings")
async def save_p2p_settings(
    req: P2PSettingsRequest,
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Сохраняет P2P настройки. Если включены звонки — активирует фичу."""
    tid = _tid(tenant, current_user)
    if not tid:
        raise HTTPException(status_code=400, detail="Тенант не определён")
    if req.internal_calls_enabled:
        await plugin_service.enable_feature(tid, "internal_calls", db)
    return {"saved": True, "internal_calls_enabled": req.internal_calls_enabled}


# ── Матрица видимости клиник ──────────────────────────────────────────────────

@router.get("/visibility")
async def get_visibility(
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Матрица видимости клиник для тенанта."""
    tid = _tid(tenant, current_user)
    q = select(Clinic).where(Clinic.is_active == True)
    if tid:
        q = q.where(Clinic.tenant_id == tid)
    clinics_r = await db.execute(q)
    clinics = clinics_r.scalars().all()
    matrix = await plugin_service.get_visibility_matrix(tid, db) if tid else []
    return {
        "clinics": [{"id": str(c.id), "name": c.name} for c in clinics],
        "matrix": matrix,
    }


class VisibilityUpdateRequest(BaseModel):
    from_clinic_id: uuid.UUID
    to_clinic_id: uuid.UUID
    allow_admin: bool = False
    allow_doctor: bool = False
    allow_manager: bool = False


@router.post("/visibility")
async def update_visibility(
    req: VisibilityUpdateRequest,
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Обновить ячейку матрицы видимости."""
    tid = _tid(tenant, current_user)
    if not tid:
        raise HTTPException(status_code=400, detail="Тенант не определён")
    return await plugin_service.upsert_visibility(
        tid, req.from_clinic_id, req.to_clinic_id,
        req.allow_admin, req.allow_doctor, req.allow_manager, db,
    )


# ── Health check (совместимость со старым API) ────────────────────────────────

@router.get("/{name}/health")
async def plugin_health(name: str, _=Depends(require_manager)):
    from app.plugins.registry import plugin_registry
    plugin = plugin_registry.get(name)
    if plugin is None:
        return {"name": name, "ok": False, "detail": "Плагин не найден"}
    result = await plugin.health_check()
    return {"name": name, "ok": result.get("ok", False), "detail": result.get("detail", "")}
