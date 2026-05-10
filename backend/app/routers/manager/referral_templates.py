# ===== БЛОК: Manager Referral Templates (Глава 4) =====
# CRUD-эндпоинты шаблонов направлений + POST /use для применения.
#
# Доступ:
#   manager / franchise_owner / super_admin — могут CRUD в скоупе тенанта.
#   manager привязанный к клинике — может создавать только шаблоны
#     этой клиники или tenant-уровня (clinic_id NULL).
#
# Все действия пишутся в audit_log.

import uuid
from datetime import datetime
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_manager
from app.database import get_db
from app.models.referral_template import ReferralTemplate
from app.models.user import User, UserRole
from app.routers.manager.clinics_access import resolve_clinic_filter_ids
from app.services import audit_service

router = APIRouter(tags=["manager:referral-templates"])


# ── Pydantic ───────────────────────────────────────────────────────────────
class TemplateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    clinic_id: Optional[uuid.UUID] = None
    payload: dict[str, Any] = Field(default_factory=dict)


class TemplatePatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    clinic_id: Optional[uuid.UUID] = None
    payload: Optional[dict[str, Any]] = None


def _serialize(t: ReferralTemplate) -> dict:
    return {
        "id": str(t.id),
        "tenant_id": str(t.tenant_id),
        "clinic_id": str(t.clinic_id) if t.clinic_id else None,
        "name": t.name,
        "description": t.description,
        "payload": t.payload or {},
        "usage_count": int(t.usage_count or 0),
        "created_by_user_id": str(t.created_by_user_id) if t.created_by_user_id else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


async def _check_clinic_scope(
    db: AsyncSession, user: User, clinic_id: Optional[uuid.UUID]
) -> None:
    """clinic_id=None разрешён всем. Иначе проверяем что user имеет доступ."""
    if clinic_id is None:
        return
    accessible = await resolve_clinic_filter_ids(db, user, clinic_id)
    if not accessible or clinic_id not in accessible:
        raise HTTPException(status_code=403, detail="Нет доступа к этой клинике")


# ── GET /manager/referral-templates ────────────────────────────────────────
@router.get("/referral-templates")
async def list_templates(
    clinic_id: Optional[uuid.UUID] = Query(None, description="Фильтр по клинике"),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Возвращает массив шаблонов:
      • clinic_id NULL          — общие на тенант (всегда видны);
      • clinic_id указан        — шаблоны этой клиники + tenant-уровня.
      • clinic_id не передан    — все шаблоны в скоупе пользователя.
    """
    if current_user.tenant_id is None:
        return []

    filters = [ReferralTemplate.tenant_id == current_user.tenant_id]
    if clinic_id is not None:
        await _check_clinic_scope(db, current_user, clinic_id)
        filters.append(or_(
            ReferralTemplate.clinic_id == clinic_id,
            ReferralTemplate.clinic_id.is_(None),
        ))
    else:
        # Если manager привязан к клинике (и не super_admin/owner) —
        # отдаём только его клинику + tenant-level.
        accessible = await resolve_clinic_filter_ids(db, current_user, None)
        if accessible is not None and len(accessible) > 0:
            filters.append(or_(
                ReferralTemplate.clinic_id.in_(accessible),
                ReferralTemplate.clinic_id.is_(None),
            ))

    rows = (await db.execute(
        select(ReferralTemplate)
        .where(and_(*filters))
        .order_by(ReferralTemplate.usage_count.desc(), ReferralTemplate.name.asc())
    )).scalars().all()
    return [_serialize(t) for t in rows]


# ── POST /manager/referral-templates ───────────────────────────────────────
@router.post("/referral-templates", status_code=201)
async def create_template(
    body: TemplateIn,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    if current_user.tenant_id is None:
        raise HTTPException(status_code=400, detail="Тенант не определён")
    await _check_clinic_scope(db, current_user, body.clinic_id)

    t = ReferralTemplate(
        tenant_id=current_user.tenant_id,
        clinic_id=body.clinic_id,
        name=body.name,
        description=body.description,
        payload=body.payload or {},
        created_by_user_id=current_user.id,
    )
    db.add(t)
    await db.flush()

    try:
        await audit_service.write_safe(
            db, "referral_template.created",
            actor_id=current_user.id, actor_name=current_user.full_name,
            entity_type="referral_template", entity_id=t.id,
            after={"name": t.name, "clinic_id": str(t.clinic_id) if t.clinic_id else None},
        )
    except Exception:
        pass

    await db.commit()
    await db.refresh(t)
    return _serialize(t)


# ── PATCH /manager/referral-templates/{id} ─────────────────────────────────
@router.patch("/referral-templates/{tpl_id}")
async def update_template(
    tpl_id: uuid.UUID,
    body: TemplatePatch,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    t = (await db.execute(
        select(ReferralTemplate).where(ReferralTemplate.id == tpl_id)
    )).scalar_one_or_none()
    if t is None or t.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    await _check_clinic_scope(db, current_user, t.clinic_id)

    changes: dict[str, Any] = {}
    if body.name is not None:
        t.name = body.name; changes["name"] = body.name
    if body.description is not None:
        t.description = body.description; changes["description"] = body.description
    if body.clinic_id is not None or "clinic_id" in body.model_fields_set:
        await _check_clinic_scope(db, current_user, body.clinic_id)
        t.clinic_id = body.clinic_id
        changes["clinic_id"] = str(body.clinic_id) if body.clinic_id else None
    if body.payload is not None:
        t.payload = body.payload; changes["payload"] = body.payload
    t.updated_at = datetime.utcnow()

    try:
        await audit_service.write_safe(
            db, "referral_template.updated",
            actor_id=current_user.id, actor_name=current_user.full_name,
            entity_type="referral_template", entity_id=t.id,
            after=changes,
        )
    except Exception:
        pass

    await db.commit()
    await db.refresh(t)
    return _serialize(t)


# ── DELETE /manager/referral-templates/{id} ────────────────────────────────
@router.delete("/referral-templates/{tpl_id}", status_code=204)
async def delete_template(
    tpl_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    t = (await db.execute(
        select(ReferralTemplate).where(ReferralTemplate.id == tpl_id)
    )).scalar_one_or_none()
    if t is None or t.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    await _check_clinic_scope(db, current_user, t.clinic_id)

    await db.delete(t)

    try:
        await audit_service.write_safe(
            db, "referral_template.deleted",
            actor_id=current_user.id, actor_name=current_user.full_name,
            entity_type="referral_template", entity_id=tpl_id,
            before={"name": t.name},
        )
    except Exception:
        pass

    await db.commit()
    return None


# ── POST /manager/referral-templates/{id}/use ──────────────────────────────
@router.post("/referral-templates/{tpl_id}/use")
async def use_template(
    tpl_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Возвращает payload шаблона + инкрементит usage_count.
    Фронт подставляет payload в форму создания направления.
    """
    t = (await db.execute(
        select(ReferralTemplate).where(ReferralTemplate.id == tpl_id)
    )).scalar_one_or_none()
    if t is None or t.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    await _check_clinic_scope(db, current_user, t.clinic_id)

    t.usage_count = int(t.usage_count or 0) + 1
    t.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(t)
    return {
        "id": str(t.id),
        "payload": t.payload or {},
        "usage_count": t.usage_count,
    }
