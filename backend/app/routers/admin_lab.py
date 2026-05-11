"""
Глава 10 — Admin endpoints для лабораторий (manager/franchise_owner).
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.user import User, UserRole
from app.models.lab import LabProvider
from app.services import lab_service


router = APIRouter(prefix="/admin/lab", tags=["admin-lab"])

_REQUIRE_MANAGER = Depends(require_role(
    UserRole.MANAGER, UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN,
))


# ── Schemas ─────────────────────────────────────────────────────────────
class ProviderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider_type: str = Field(default="generic_http", max_length=40)
    api_url: Optional[str] = Field(default=None, max_length=300)
    api_key: Optional[str] = Field(default=None, max_length=500)
    default_clinic_id: Optional[uuid.UUID] = None
    active: bool = True


class ProviderPatch(BaseModel):
    name: Optional[str] = None
    provider_type: Optional[str] = None
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    default_clinic_id: Optional[uuid.UUID] = None
    active: Optional[bool] = None


def _serialize_provider(p: LabProvider) -> dict:
    return {
        "id": str(p.id),
        "tenant_id": str(p.tenant_id),
        "name": p.name,
        "provider_type": p.provider_type,
        "api_url": p.api_url,
        "api_key_masked": lab_service.mask_api_key(p.api_key_encrypted),
        "has_api_key": bool(p.api_key_encrypted),
        "default_clinic_id": str(p.default_clinic_id) if p.default_clinic_id else None,
        "active": p.active,
        "last_sync_at": p.last_sync_at.isoformat() if p.last_sync_at else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


# ── Endpoints ───────────────────────────────────────────────────────────
@router.get("/providers")
async def list_providers(
    user: User = _REQUIRE_MANAGER,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.tenant_id:
        raise HTTPException(403, "User has no tenant")
    q = select(LabProvider).where(LabProvider.tenant_id == current_user.tenant_id).order_by(
        LabProvider.created_at.desc()
    )
    rows = (await db.execute(q)).scalars().all()
    return {"items": [_serialize_provider(p) for p in rows]}


@router.post("/providers", status_code=201)
async def create_provider(
    payload: ProviderIn,
    user: User = _REQUIRE_MANAGER,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.tenant_id:
        raise HTTPException(403, "User has no tenant")
    p = LabProvider(
        tenant_id=current_user.tenant_id,
        name=payload.name.strip(),
        provider_type=payload.provider_type or "generic_http",
        api_url=payload.api_url,
        api_key_encrypted=lab_service.encrypt_api_key(payload.api_key),
        default_clinic_id=payload.default_clinic_id,
        active=payload.active,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _serialize_provider(p)


@router.patch("/providers/{provider_id}")
async def update_provider(
    provider_id: uuid.UUID,
    payload: ProviderPatch,
    user: User = _REQUIRE_MANAGER,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = (await db.execute(
        select(LabProvider).where(LabProvider.id == provider_id)
    )).scalar_one_or_none()
    if not p or p.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Provider not found")

    data = payload.model_dump(exclude_unset=True)
    if "api_key" in data:
        new_key = data.pop("api_key")
        if new_key:
            p.api_key_encrypted = lab_service.encrypt_api_key(new_key)
    for k, v in data.items():
        setattr(p, k, v)
    p.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(p)
    return _serialize_provider(p)


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: uuid.UUID,
    user: User = _REQUIRE_MANAGER,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = (await db.execute(
        select(LabProvider).where(LabProvider.id == provider_id)
    )).scalar_one_or_none()
    if not p or p.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Provider not found")
    await db.delete(p)
    await db.commit()
    return None


@router.post("/providers/{provider_id}/test-connection")
async def test_connection(
    provider_id: uuid.UUID,
    user: User = _REQUIRE_MANAGER,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = (await db.execute(
        select(LabProvider).where(LabProvider.id == provider_id)
    )).scalar_one_or_none()
    if not p or p.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Provider not found")
    result = await lab_service.test_provider_connection(p)
    if result.get("ok"):
        p.last_sync_at = datetime.utcnow()
        await db.commit()
    return result
