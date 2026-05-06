"""
Сервис плагинов.
Управляет включением/выключением фич, биллинговыми событиями, видимостью клиник.
"""
import uuid
import warnings
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.models.plugin import (
    PluginCatalog, PluginFeature, TenantPluginFeature, BillingEvent, ClinicVisibility
)


# ── Чтение ────────────────────────────────────────────────────────────────────

async def get_all_plugins(db: AsyncSession) -> list[PluginCatalog]:
    warnings.warn(
        "plugin_service is deprecated, use commercial_service via /commercial endpoints. Старая plugin_*-система будет удалена. См. BACKLOG.md",
        DeprecationWarning, stacklevel=2,
    )
    r = await db.execute(
        select(PluginCatalog)
        .where(PluginCatalog.is_active == True)
        .order_by(PluginCatalog.sort_order)
    )
    return r.scalars().all()


async def get_tenant_features_map(tenant_id: uuid.UUID, db: AsyncSession) -> dict[str, TenantPluginFeature]:
    """Возвращает словарь feature_key → TenantPluginFeature для тенанта."""
    warnings.warn(
        "plugin_service is deprecated, use commercial_service via /commercial endpoints. Старая plugin_*-система будет удалена. См. BACKLOG.md",
        DeprecationWarning, stacklevel=2,
    )
    r = await db.execute(
        select(TenantPluginFeature)
        .where(TenantPluginFeature.tenant_id == tenant_id)
    )
    return {tpf.feature_key: tpf for tpf in r.scalars().all()}


async def get_features_with_status(tenant_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """
    Возвращает все фичи из каталога с текущим статусом для тенанта.
    Бесплатные фичи — всегда доступны (is_available=True).
    Платные — только если явно включены.
    """
    warnings.warn(
        "plugin_service is deprecated, use commercial_service via /commercial endpoints. Старая plugin_*-система будет удалена. См. BACKLOG.md",
        DeprecationWarning, stacklevel=2,
    )
    plugins_r = await db.execute(
        select(PluginCatalog)
        .where(PluginCatalog.is_active == True)
        .order_by(PluginCatalog.sort_order)
    )
    plugins = plugins_r.scalars().all()

    tenant_map = await get_tenant_features_map(tenant_id, db)

    result = []
    for plugin in plugins:
        features_r = await db.execute(
            select(PluginFeature)
            .where(PluginFeature.plugin_id == plugin.id)
            .order_by(PluginFeature.sort_order)
        )
        features = features_r.scalars().all()

        plugin_features = []
        for f in features:
            tpf = tenant_map.get(f.key)
            # Бесплатная → всегда доступна
            is_available = not f.is_paid or (tpf is not None and tpf.enabled)
            on_trial = tpf is not None and tpf.trial_ends_at is not None and tpf.trial_ends_at > datetime.utcnow()
            status = "inactive"
            if not f.is_paid:
                status = "active"
            elif tpf and tpf.enabled:
                status = "trial" if on_trial else "active"

            plugin_features.append({
                "key": f.key,
                "name": f.name,
                "description": f.description,
                "is_paid": f.is_paid,
                "price_monthly": float(f.price_monthly),
                "feature_type": f.feature_type,
                "status": status,
                "is_available": is_available,
                "value": tpf.value if tpf else f.default_value,
                "trial_ends_at": tpf.trial_ends_at.isoformat() if (tpf and tpf.trial_ends_at) else None,
            })

        result.append({
            "key": plugin.key,
            "name": plugin.name,
            "description": plugin.description,
            "icon": plugin.icon,
            "category": plugin.category,
            "features": plugin_features,
        })

    return result


async def has_feature(tenant_id: uuid.UUID, feature_key: str, db: AsyncSession) -> bool:
    """Проверяет доступность фичи для тенанта."""
    warnings.warn(
        "plugin_service is deprecated, use commercial_service via /commercial endpoints. Старая plugin_*-система будет удалена. См. BACKLOG.md",
        DeprecationWarning, stacklevel=2,
    )
    # Сначала проверяем в каталоге — может быть бесплатной
    feat_r = await db.execute(select(PluginFeature).where(PluginFeature.key == feature_key))
    feat = feat_r.scalar_one_or_none()
    if feat is None:
        return False
    if not feat.is_paid:
        return True  # бесплатная = всегда доступна
    # Платная — проверяем включена ли для тенанта
    tpf_r = await db.execute(
        select(TenantPluginFeature).where(
            TenantPluginFeature.tenant_id == tenant_id,
            TenantPluginFeature.feature_key == feature_key,
            TenantPluginFeature.enabled == True,
        )
    )
    return tpf_r.scalar_one_or_none() is not None


# ── Включение/Выключение ──────────────────────────────────────────────────────

async def enable_feature(
    tenant_id: uuid.UUID,
    feature_key: str,
    db: AsyncSession,
    trial_days: int | None = None,
) -> dict:
    """Включает фичу для тенанта. Создаёт billing_event."""
    warnings.warn(
        "plugin_service is deprecated, use commercial_service via /commercial endpoints. Старая plugin_*-система будет удалена. См. BACKLOG.md",
        DeprecationWarning, stacklevel=2,
    )
    feat_r = await db.execute(select(PluginFeature).where(PluginFeature.key == feature_key))
    feat = feat_r.scalar_one_or_none()
    if feat is None:
        raise ValueError(f"Фича {feature_key} не найдена")

    # Upsert TenantPluginFeature
    tpf_r = await db.execute(
        select(TenantPluginFeature).where(
            TenantPluginFeature.tenant_id == tenant_id,
            TenantPluginFeature.feature_key == feature_key,
        )
    )
    tpf = tpf_r.scalar_one_or_none()
    trial_ends = None
    if trial_days:
        trial_ends = datetime.utcnow() + timedelta(days=trial_days)

    if tpf:
        tpf.enabled = True
        tpf.enabled_at = datetime.utcnow()
        tpf.disabled_at = None
        if trial_ends:
            tpf.trial_ends_at = trial_ends
    else:
        tpf = TenantPluginFeature(
            tenant_id=tenant_id,
            feature_key=feature_key,
            enabled=True,
            trial_ends_at=trial_ends,
        )
        db.add(tpf)

    # Billing event
    event_type = "trial_started" if trial_days else "enabled"
    be = BillingEvent(
        tenant_id=tenant_id,
        feature_key=feature_key,
        event_type=event_type,
        amount=feat.price_monthly if not trial_days else Decimal("0"),
        meta={"trial_days": trial_days} if trial_days else None,
    )
    db.add(be)
    await db.commit()

    return {
        "feature_key": feature_key,
        "enabled": True,
        "trial_ends_at": trial_ends.isoformat() if trial_ends else None,
        "amount_charged": float(feat.price_monthly) if not trial_days else 0,
    }


async def disable_feature(tenant_id: uuid.UUID, feature_key: str, db: AsyncSession) -> dict:
    """Отключает фичу для тенанта."""
    warnings.warn(
        "plugin_service is deprecated, use commercial_service via /commercial endpoints. Старая plugin_*-система будет удалена. См. BACKLOG.md",
        DeprecationWarning, stacklevel=2,
    )
    feat_r = await db.execute(select(PluginFeature).where(PluginFeature.key == feature_key))
    feat = feat_r.scalar_one_or_none()
    if feat is None:
        raise ValueError(f"Фича {feature_key} не найдена")
    if not feat.is_paid:
        raise ValueError("Бесплатную фичу нельзя отключить")

    tpf_r = await db.execute(
        select(TenantPluginFeature).where(
            TenantPluginFeature.tenant_id == tenant_id,
            TenantPluginFeature.feature_key == feature_key,
        )
    )
    tpf = tpf_r.scalar_one_or_none()
    if tpf:
        tpf.enabled = False
        tpf.disabled_at = datetime.utcnow()

    be = BillingEvent(
        tenant_id=tenant_id, feature_key=feature_key,
        event_type="disabled", amount=Decimal("0"),
    )
    db.add(be)
    await db.commit()
    return {"feature_key": feature_key, "enabled": False}


async def get_billing_events(tenant_id: uuid.UUID, db: AsyncSession, limit: int = 50) -> list[dict]:
    warnings.warn(
        "plugin_service is deprecated, use commercial_service via /commercial endpoints. Старая plugin_*-система будет удалена. См. BACKLOG.md",
        DeprecationWarning, stacklevel=2,
    )
    r = await db.execute(
        select(BillingEvent)
        .where(BillingEvent.tenant_id == tenant_id)
        .order_by(BillingEvent.created_at.desc())
        .limit(limit)
    )
    return [
        {
            "id": str(e.id),
            "feature_key": e.feature_key,
            "event_type": e.event_type,
            "amount": float(e.amount),
            "meta": e.meta,
            "created_at": e.created_at.isoformat(),
        }
        for e in r.scalars().all()
    ]


# ── Видимость клиник ──────────────────────────────────────────────────────────

async def get_visibility_matrix(tenant_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    warnings.warn(
        "plugin_service is deprecated, use commercial_service via /commercial endpoints. Старая plugin_*-система будет удалена. См. BACKLOG.md",
        DeprecationWarning, stacklevel=2,
    )
    r = await db.execute(
        select(ClinicVisibility).where(ClinicVisibility.tenant_id == tenant_id)
    )
    return [
        {
            "from_clinic_id": str(v.from_clinic_id),
            "to_clinic_id": str(v.to_clinic_id),
            "allow_admin": v.allow_admin,
            "allow_doctor": v.allow_doctor,
            "allow_manager": v.allow_manager,
        }
        for v in r.scalars().all()
    ]


async def upsert_visibility(
    tenant_id: uuid.UUID,
    from_clinic_id: uuid.UUID,
    to_clinic_id: uuid.UUID,
    allow_admin: bool,
    allow_doctor: bool,
    allow_manager: bool,
    db: AsyncSession,
) -> dict:
    warnings.warn(
        "plugin_service is deprecated, use commercial_service via /commercial endpoints. Старая plugin_*-система будет удалена. См. BACKLOG.md",
        DeprecationWarning, stacklevel=2,
    )
    r = await db.execute(
        select(ClinicVisibility).where(
            ClinicVisibility.tenant_id == tenant_id,
            ClinicVisibility.from_clinic_id == from_clinic_id,
            ClinicVisibility.to_clinic_id == to_clinic_id,
        )
    )
    cv = r.scalar_one_or_none()
    if cv:
        cv.allow_admin = allow_admin
        cv.allow_doctor = allow_doctor
        cv.allow_manager = allow_manager
    else:
        cv = ClinicVisibility(
            tenant_id=tenant_id,
            from_clinic_id=from_clinic_id,
            to_clinic_id=to_clinic_id,
            allow_admin=allow_admin,
            allow_doctor=allow_doctor,
            allow_manager=allow_manager,
        )
        db.add(cv)
    await db.commit()
    return {"from_clinic_id": str(from_clinic_id), "to_clinic_id": str(to_clinic_id)}


async def get_p2p_settings(tenant_id: uuid.UUID, db: AsyncSession) -> dict:
    """P2P настройки: включены ли звонки глобально, какие клиники участвуют."""
    warnings.warn(
        "plugin_service is deprecated, use commercial_service via /commercial endpoints. Старая plugin_*-система будет удалена. См. BACKLOG.md",
        DeprecationWarning, stacklevel=2,
    )
    calls_on = await has_feature(tenant_id, "internal_calls", db)
    cross = await has_feature(tenant_id, "cross_clinic_calls", db)
    # Клиники с доступом к P2P — все у которых есть хоть одно visibility правило
    r = await db.execute(
        select(ClinicVisibility.from_clinic_id)
        .where(ClinicVisibility.tenant_id == tenant_id)
        .distinct()
    )
    clinic_ids = [str(row[0]) for row in r.fetchall()]
    return {
        "internal_calls_enabled": calls_on,
        "cross_clinic_enabled": cross,
        "p2p_clinic_ids": clinic_ids,
    }
