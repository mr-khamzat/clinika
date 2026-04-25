"""
Роутер модулей: /modules/*
Возвращает доступные фичи для текущего тенанта.
Используется фронтендом для скрытия/показа разделов интерфейса.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional

from app.core.deps import get_current_user
from app.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.tenant import get_tenant_license
from app.models.tenant import TenantLicense
from app.modules import get_features_for_ui, has_feature, get_enabled_features
from app.modules.features import PLANS, PLAN_FEATURES, FEATURE_LABELS

router = APIRouter(prefix="/modules", tags=["modules"])


class FeatureItem(BaseModel):
    name: str
    label: str
    enabled: bool
    min_plan: str


class PlanInfo(BaseModel):
    name: str
    features: list[str]


@router.get("/features", response_model=list[FeatureItem])
async def list_features(
    license: TenantLicense | None = Depends(get_tenant_license),
    _=Depends(get_current_user),
):
    """
    Список всех фич с флагом enabled для текущего тенанта.
    Фронтенд использует для условного рендеринга разделов.
    """
    return get_features_for_ui(license)


@router.get("/features/{name}")
async def check_feature(
    name: str,
    license: TenantLicense | None = Depends(get_tenant_license),
    _=Depends(get_current_user),
):
    """Проверить доступность одной фичи."""
    enabled = has_feature(license, name)
    label = FEATURE_LABELS.get(name)
    if label is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Фича {name} не найдена")
    return {"name": name, "label": label, "enabled": enabled}


@router.get("/active-keys")
async def get_active_module_keys(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Активные коммерческие модули тенанта (для фильтрации меню фронтенда)."""
    if not current_user.tenant_id:
        return []
    try:
        from sqlalchemy import select as _sel
        from app.models.commercial import TenantModuleSubscription as _TMS
        rows = (await db.execute(
            _sel(_TMS.module_key).where(
                _TMS.tenant_id == current_user.tenant_id,
                _TMS.status.in_(["active", "trial"]),
            )
        )).scalars().all()
        return list(rows)
    except Exception:
        return []


@router.get("/plans", response_model=list[PlanInfo])
async def list_plans(_=Depends(get_current_user)):
    """Каталог всех тарифных планов и их фич."""
    return [
        PlanInfo(name=plan, features=sorted(PLAN_FEATURES[plan]))
        for plan in PLANS
    ]
