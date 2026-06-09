"""Админский CRUD для feature flags + tenant-override (только super_admin).

Endpoints (prefix=/admin/feature-flags):
  GET    /                            — список флагов + кол-во overrides
  POST   /                            — создать флаг
  PATCH  /{key}                       — изменить стратегию/дефолт/имя
  DELETE /{key}                       — удалить флаг (каскадом сносит overrides)
  GET    /{key}/tenants               — список tenant-overrides
  PUT    /{key}/tenants/{tenant_id}   — задать override (upsert)
  DELETE /{key}/tenants/{tenant_id}   — снять override
"""
from __future__ import annotations

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_super_admin
from app.database import get_db
from app.models.feature_flag import FeatureFlag, RolloutStrategy, TenantFeatureFlag
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.feature_flag import (
    FeatureFlagCreate,
    FeatureFlagResponse,
    FeatureFlagUpdate,
    TenantFeatureFlagResponse,
    TenantFeatureFlagSet,
    validate_rollout_value,
)
from app.services import feature_flag_service as ffs


router = APIRouter(prefix="/admin/feature-flags", tags=["admin-feature-flags"])


# ─── helpers ────────────────────────────────────────────────────────────────


async def _get_flag_by_key(db: AsyncSession, key: str) -> FeatureFlag:
    res = await db.execute(select(FeatureFlag).where(FeatureFlag.key == key))
    flag = res.scalar_one_or_none()
    if flag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Флаг не найден")
    return flag


def _serialize_flag(flag: FeatureFlag, overrides_count: int = 0) -> dict:
    return {
        "id": flag.id,
        "key": flag.key,
        "name": flag.name,
        "description": flag.description,
        "default_enabled": flag.default_enabled,
        "rollout_strategy": flag.rollout_strategy,
        "rollout_value": flag.rollout_value,
        "created_at": flag.created_at,
        "updated_at": flag.updated_at,
        "overrides_count": overrides_count,
    }


# ─── флаги ──────────────────────────────────────────────────────────────────


@router.get("/", response_model=List[FeatureFlagResponse])
async def list_flags(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Все флаги платформы + сколько тенантов имеют override (enabled=true)."""
    flags_res = await db.execute(select(FeatureFlag).order_by(FeatureFlag.key))
    flags: list[FeatureFlag] = list(flags_res.scalars().all())

    counts_res = await db.execute(
        select(
            TenantFeatureFlag.feature_flag_id,
            func.count(TenantFeatureFlag.id),
        )
        .where(TenantFeatureFlag.enabled.is_(True))
        .group_by(TenantFeatureFlag.feature_flag_id)
    )
    counts: dict[uuid.UUID, int] = {row[0]: int(row[1]) for row in counts_res.all()}

    return [_serialize_flag(f, counts.get(f.id, 0)) for f in flags]


@router.post(
    "/", response_model=FeatureFlagResponse, status_code=status.HTTP_201_CREATED
)
async def create_flag(
    body: FeatureFlagCreate,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    # Уникальность по ключу.
    existing = await db.execute(
        select(FeatureFlag).where(FeatureFlag.key == body.key)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Флаг с таким ключом уже существует"
        )

    try:
        normalized_value = body.normalized_rollout_value()
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))

    from datetime import datetime as _dt
    flag = FeatureFlag(
        id=uuid.uuid4(),
        key=body.key,
        name=body.name,
        description=body.description,
        default_enabled=body.default_enabled,
        rollout_strategy=body.rollout_strategy,
        rollout_value=normalized_value,
        created_at=_dt.utcnow(),
        updated_at=_dt.utcnow(),
    )
    db.add(flag)
    await db.commit()
    await db.refresh(flag)
    await ffs.invalidate_flag_cache(flag.key)
    return _serialize_flag(flag, 0)


@router.patch("/{key}", response_model=FeatureFlagResponse)
async def update_flag(
    key: str,
    body: FeatureFlagUpdate,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    flag = await _get_flag_by_key(db, key)

    if body.name is not None:
        flag.name = body.name
    if body.description is not None:
        flag.description = body.description
    if body.default_enabled is not None:
        flag.default_enabled = body.default_enabled

    # Стратегия + значение валидируем парой: финальные значения должны быть согласованы.
    new_strategy = body.rollout_strategy if body.rollout_strategy is not None else flag.rollout_strategy
    if body.rollout_value is not None:
        new_value = body.rollout_value
    else:
        new_value = flag.rollout_value
    if isinstance(new_strategy, str):
        new_strategy = RolloutStrategy(new_strategy)
    try:
        normalized = validate_rollout_value(new_strategy, new_value)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))

    flag.rollout_strategy = new_strategy
    flag.rollout_value = normalized

    await db.commit()
    await db.refresh(flag)
    await ffs.invalidate_flag_cache(flag.key)

    # Считаем overrides для красивого отображения в UI.
    cnt_res = await db.execute(
        select(func.count(TenantFeatureFlag.id)).where(
            TenantFeatureFlag.feature_flag_id == flag.id,
            TenantFeatureFlag.enabled.is_(True),
        )
    )
    overrides_count = int(cnt_res.scalar() or 0)
    return _serialize_flag(flag, overrides_count)


@router.delete("/{key}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flag(
    key: str,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    flag = await _get_flag_by_key(db, key)
    await db.delete(flag)
    await db.commit()
    await ffs.invalidate_flag_cache(key)
    return None


# ─── overrides ──────────────────────────────────────────────────────────────


@router.get("/{key}/tenants", response_model=List[TenantFeatureFlagResponse])
async def list_overrides(
    key: str,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    flag = await _get_flag_by_key(db, key)

    rows = await db.execute(
        select(TenantFeatureFlag, Tenant.name, Tenant.slug)
        .join(Tenant, Tenant.id == TenantFeatureFlag.tenant_id)
        .where(TenantFeatureFlag.feature_flag_id == flag.id)
        .order_by(Tenant.name)
    )

    out: list[dict] = []
    for tff, t_name, t_slug in rows.all():
        out.append(
            {
                "id": tff.id,
                "tenant_id": tff.tenant_id,
                "feature_flag_id": tff.feature_flag_id,
                "enabled": tff.enabled,
                "variant": tff.variant,
                "created_at": tff.created_at,
                "updated_at": tff.updated_at,
                "tenant_name": t_name,
                "tenant_slug": t_slug,
            }
        )
    return out


@router.put(
    "/{key}/tenants/{tenant_id}", response_model=TenantFeatureFlagResponse
)
async def set_override(
    key: str,
    tenant_id: uuid.UUID,
    body: TenantFeatureFlagSet,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    flag = await _get_flag_by_key(db, key)

    # Проверяем существование тенанта явно — даём 404 а не FK-ошибку.
    tenant_res = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_res.scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Тенант не найден")

    res = await db.execute(
        select(TenantFeatureFlag).where(
            TenantFeatureFlag.feature_flag_id == flag.id,
            TenantFeatureFlag.tenant_id == tenant_id,
        )
    )
    row = res.scalar_one_or_none()
    if row is None:
        row = TenantFeatureFlag(
            tenant_id=tenant_id,
            feature_flag_id=flag.id,
            enabled=body.enabled,
            variant=body.variant,
        )
        db.add(row)
    else:
        row.enabled = body.enabled
        row.variant = body.variant

    await db.commit()
    await db.refresh(row)
    await ffs.invalidate_override_cache(flag.id, tenant_id)

    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "feature_flag_id": row.feature_flag_id,
        "enabled": row.enabled,
        "variant": row.variant,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "tenant_name": tenant.name,
        "tenant_slug": tenant.slug,
    }


@router.delete(
    "/{key}/tenants/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_override(
    key: str,
    tenant_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    flag = await _get_flag_by_key(db, key)
    await db.execute(
        delete(TenantFeatureFlag).where(
            TenantFeatureFlag.feature_flag_id == flag.id,
            TenantFeatureFlag.tenant_id == tenant_id,
        )
    )
    await db.commit()
    await ffs.invalidate_override_cache(flag.id, tenant_id)
    return None
