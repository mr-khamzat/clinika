"""
Роутер плагинов v2 — коммерческая система фич.
Заменяет старый plugins.py (простой health-check).
"""
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Response
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
from app.services import billing_service

def _set_deprecation_headers(response: Response):
    """Mark all /plugins responses as deprecated (RFC 8594)."""
    response.headers["Deprecation"] = "true"
    response.headers["Sunset"] = "2026-08-01"
    response.headers["Link"] = '</docs#tag/commercial>; rel="successor-version"'
    return None


router = APIRouter(
    prefix="/plugins", tags=["plugins"],
    dependencies=[Depends(_set_deprecation_headers)],
)


def _tid(tenant: Tenant | None, user: User) -> uuid.UUID | None:
    """Определяет tenant_id из тенанта или пользователя."""
    if tenant:
        return tenant.id
    if user.tenant_id:
        return user.tenant_id
    return None


# ── Каталог плагинов ──────────────────────────────────────────────────────────

@router.get("", deprecated=True)
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


@router.get("/features", deprecated=True)
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


@router.post("/features/enable", deprecated=True)
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
        # Дополнительно создаём TenantPluginSubscription для платных фич (Billing v2)
        try:
            await billing_service.enable_plugin(
                db, tid, req.feature_key,
                billing_cycle="monthly",
                trial_days=req.trial_days or 0,
            )
            await db.commit()
        except Exception:
            await db.rollback()  # billing_service — дополнительный слой, не блокирует
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/features/disable", deprecated=True)
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


@router.get("/features/{feature_key}/check", deprecated=True)
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

@router.get("/billing-events", deprecated=True)
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

@router.get("/integrations", deprecated=True)
async def get_integrations(
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Статус интеграций для всех клиник тенанта."""
    from app.plugins.registry import plugin_registry
    tid = _tid(tenant, current_user)
    q = select(Clinic).where(Clinic.is_active == True)
    if current_user.tenant_id is not None:
        q = q.where(Clinic.tenant_id == current_user.tenant_id)
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


@router.get("/p2p/settings", deprecated=True)
async def get_p2p_settings(
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    tid = _tid(tenant, current_user)
    if not tid:
        return {"internal_calls_enabled": False, "cross_clinic_enabled": False, "p2p_clinic_ids": []}
    return await plugin_service.get_p2p_settings(tid, db)


@router.post("/p2p/settings", deprecated=True)
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
        # Проверяем что платный плагин p2p_calls активен (HTTP 402 если нет)
        await billing_service.assert_plugin_active(db, tid, "p2p_calls")
        await plugin_service.enable_feature(tid, "internal_calls", db)
    return {"saved": True, "internal_calls_enabled": req.internal_calls_enabled}


# ── Матрица видимости клиник ──────────────────────────────────────────────────

@router.get("/visibility", deprecated=True)
async def get_visibility(
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Матрица видимости клиник для тенанта."""
    tid = _tid(tenant, current_user)
    q = select(Clinic).where(Clinic.is_active == True)
    if current_user.tenant_id is not None:
        q = q.where(Clinic.tenant_id == current_user.tenant_id)
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


@router.post("/visibility", deprecated=True)
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

@router.get("/{name}/health", deprecated=True)
async def plugin_health(name: str, _=Depends(require_manager)):
    from app.plugins.registry import plugin_registry
    plugin = plugin_registry.get(name)
    if plugin is None:
        return {"name": name, "ok": False, "detail": "Плагин не найден"}
    result = await plugin.health_check()
    return {"name": name, "ok": result.get("ok", False), "detail": result.get("detail", "")}


# ── Биллинг плагинов (plugin-level trial/paid tracking) ──────────────────────

class PluginTrialRequest(BaseModel):
    trial_days: int = 14  # длина триала в днях
    price_monthly: float | None = None  # переопределить цену


@router.post("/{slug}/trial", deprecated=True)
async def start_plugin_trial(
    slug: str,
    req: PluginTrialRequest,
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Начать триал плагина целиком для тенанта."""
    from datetime import timedelta
    from sqlalchemy import select
    from app.models.tenant import TenantPlugin
    from app.models.plugin import PluginCatalog, BillingEvent

    tid = _tid(tenant, current_user)
    if not tid:
        raise HTTPException(status_code=400, detail='Тенант не определён')

    # Проверяем, что плагин существует в каталоге
    cat = await db.execute(select(PluginCatalog).where(PluginCatalog.key == slug))
    catalog = cat.scalar_one_or_none()
    if not catalog:
        raise HTTPException(status_code=404, detail='Плагин не найден в каталоге')

    trial_ends = datetime.utcnow() + timedelta(days=req.trial_days)

    # Upsert TenantPlugin
    existing = await db.execute(
        select(TenantPlugin).where(TenantPlugin.tenant_id == tid, TenantPlugin.plugin == slug)
    )
    tp = existing.scalar_one_or_none()
    if tp:
        tp.enabled = True
        tp.trial_until = trial_ends
        tp.updated_at = datetime.utcnow()
        if req.price_monthly is not None:
            tp.price_monthly = req.price_monthly
    else:
        tp = TenantPlugin(
            tenant_id=tid, plugin=slug, enabled=True,
            trial_until=trial_ends,
            price_monthly=req.price_monthly,
        )
        db.add(tp)

    # Billing event
    event = BillingEvent(
        tenant_id=tid,
        feature_key=slug,
        event_type='trial_started',
        amount=0,
        meta={'trial_days': req.trial_days, 'trial_ends': trial_ends.isoformat()},
    )
    db.add(event)
    await db.commit()
    return {
        'plugin': slug, 'status': 'trial',
        'trial_until': trial_ends.isoformat(),
        'trial_days': req.trial_days,
    }


@router.get("/{slug}/billing", deprecated=True)
async def get_plugin_billing(
    slug: str,
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Статус биллинга плагина для тенанта."""
    from sqlalchemy import select
    from app.models.tenant import TenantPlugin

    tid = _tid(tenant, current_user)
    if not tid:
        return {'plugin': slug, 'status': 'unknown'}

    existing = await db.execute(
        select(TenantPlugin).where(TenantPlugin.tenant_id == tid, TenantPlugin.plugin == slug)
    )
    tp = existing.scalar_one_or_none()
    if not tp:
        return {'plugin': slug, 'status': 'inactive', 'enabled': False}

    now = datetime.utcnow()
    if tp.trial_until and tp.trial_until > now:
        status = 'trial'
        days_left = (tp.trial_until - now).days
    elif tp.paid_until and tp.paid_until > now:
        status = 'paid'
        days_left = (tp.paid_until - now).days
    elif not tp.enabled:
        status = 'inactive'
        days_left = None
    else:
        status = 'active'
        days_left = None

    return {
        'plugin': slug, 'status': status,
        'enabled': tp.enabled,
        'trial_until': tp.trial_until.isoformat() if tp.trial_until else None,
        'paid_until': tp.paid_until.isoformat() if tp.paid_until else None,
        'price_monthly': float(tp.price_monthly) if tp.price_monthly else None,
        'days_left': days_left,
    }


@router.get("/billing/summary", deprecated=True)
async def plugin_billing_summary(
    current_user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Список всех плагинов с биллинговым статусом — для PlatformSection."""
    from sqlalchemy import select
    from app.models.tenant import TenantPlugin

    tid = _tid(tenant, current_user)
    if not tid:
        return []

    result = await db.execute(
        select(TenantPlugin).where(TenantPlugin.tenant_id == tid)
    )
    plugins = result.scalars().all()
    now = datetime.utcnow()
    out = []
    for tp in plugins:
        if tp.trial_until and tp.trial_until > now:
            status = 'trial'
            days_left = (tp.trial_until - now).days
        elif tp.paid_until and tp.paid_until > now:
            status = 'paid'
            days_left = (tp.paid_until - now).days
        elif not tp.enabled:
            status = 'inactive'
            days_left = None
        else:
            status = 'active'
            days_left = None
        out.append({
            'plugin': tp.plugin, 'status': status,
            'enabled': tp.enabled,
            'trial_until': tp.trial_until.isoformat() if tp.trial_until else None,
            'paid_until': tp.paid_until.isoformat() if tp.paid_until else None,
            'price_monthly': float(tp.price_monthly) if tp.price_monthly else None,
            'days_left': days_left,
        })
    return out
