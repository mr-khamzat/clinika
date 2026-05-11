"""
Админ-роутер «Регламент-конструктор» (Глава 7).

Префикс: /admin/regulations
Доступ: franchise_owner (только в своём tenant) + super_admin (везде).

Эндпоинты:
  GET     /admin/regulations                                 — list + фильтры
  POST    /admin/regulations                                 — создать + draft v1
  GET     /admin/regulations/{id}                            — детали + версии
  PATCH   /admin/regulations/{id}                            — метаданные
  DELETE  /admin/regulations/{id}                            — soft-delete (archived)
  POST    /admin/regulations/{id}/versions                   — новая draft версия
  POST    /admin/regulations/{id}/versions/{vid}/publish     — публикация
  POST    /admin/regulations/{id}/assignments                — точечные назначения
  DELETE  /admin/regulations/assignments/{aid}               — снять назначение
  GET     /admin/regulations/{id}/completions                — кто прочитал
  POST    /admin/regulations/ai-generate                     — AI-черновик
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.regulation import (
    Regulation,
    RegulationAssignment,
    RegulationCompletion,
    RegulationStatus,
    RegulationVersion,
    ALLOWED_STATUSES,
)
from app.models.user import User, UserRole
from app.services.regulation_ai_service import generate_regulation
from app.services.regulation_service import (
    assignment_to_dict,
    can_manage_regulations,
    completion_to_dict,
    count_target_audience,
    create_initial_version,
    create_new_version,
    is_super_admin,
    normalize_steps,
    publish_version,
    regulation_to_dict,
    version_to_dict,
)

log = logging.getLogger("admin_regulations_router")

router = APIRouter(prefix="/admin/regulations", tags=["admin-regulations"])


# ─────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────
class StepBody(BaseModel):
    order: Optional[int] = None
    type: str
    content: str
    required: bool = False


class CreateRegulationBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    description: Optional[str] = None
    category: Optional[str] = Field(default=None, max_length=80)
    assigned_roles: Optional[list[str]] = None
    initial_steps: Optional[list[dict]] = None


class UpdateRegulationBody(BaseModel):
    title: Optional[str] = Field(default=None, max_length=300)
    description: Optional[str] = None
    category: Optional[str] = Field(default=None, max_length=80)
    assigned_roles: Optional[list[str]] = None
    status: Optional[str] = None  # draft|published|archived


class NewVersionBody(BaseModel):
    content: list[dict] = Field(default_factory=list)
    changelog: Optional[str] = None


class AssignmentBody(BaseModel):
    user_ids: Optional[list[uuid.UUID]] = None
    clinic_ids: Optional[list[uuid.UUID]] = None


class AiGenerateBody(BaseModel):
    topic: str = Field(..., min_length=1, max_length=300)
    role: str = Field(..., min_length=1, max_length=40)
    language: str = "ru"
    existing_steps: Optional[list[dict]] = None


# ─────────────────────────────────────────────────────────────────────
# Guard
# ─────────────────────────────────────────────────────────────────────
async def _require_manage(
    user: User = Depends(get_current_user),
) -> User:
    if not can_manage_regulations(user):
        raise HTTPException(
            status_code=403,
            detail="Доступ только для владельца франшизы или super_admin",
        )
    return user


def _filter_tenant(query, user: User, model=Regulation):
    """Применяет tenant-фильтр (super_admin — без ограничения)."""
    if is_super_admin(user):
        return query
    if not user.tenant_id:
        # У франчайз-owner без тенанта — пусто
        return query.where(model.tenant_id == uuid.UUID(int=0))
    return query.where(model.tenant_id == user.tenant_id)


async def _get_reg_for_manage(
    db: AsyncSession, reg_id: uuid.UUID, user: User
) -> Regulation:
    reg = (
        await db.execute(select(Regulation).where(Regulation.id == reg_id))
    ).scalar_one_or_none()
    if not reg:
        raise HTTPException(status_code=404, detail="Регламент не найден")
    if not is_super_admin(user) and reg.tenant_id != user.tenant_id:
        raise HTTPException(status_code=403, detail="Чужой тенант")
    return reg


# ─────────────────────────────────────────────────────────────────────
# AI generator
# ─────────────────────────────────────────────────────────────────────
@router.post("/ai-generate")
async def ai_generate(
    body: AiGenerateBody,
    current_user: User = Depends(_require_manage),
):
    """AI-черновик регламента (НЕ сохраняется — фронт показывает в редакторе)."""
    return await generate_regulation(
        topic=body.topic,
        role=body.role,
        language=body.language or "ru",
        existing_steps=body.existing_steps,
    )


# ─────────────────────────────────────────────────────────────────────
# Assignment delete (нужно до /{id}, чтобы не конфликтовал путь)
# ─────────────────────────────────────────────────────────────────────
@router.delete("/assignments/{assignment_id}", status_code=204)
async def delete_assignment(
    assignment_id: uuid.UUID,
    current_user: User = Depends(_require_manage),
    db: AsyncSession = Depends(get_db),
):
    """Снять точечное назначение."""
    a = (
        await db.execute(
            select(RegulationAssignment).where(
                RegulationAssignment.id == assignment_id
            )
        )
    ).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Назначение не найдено")
    # Проверка tenant через регламент
    reg = (
        await db.execute(select(Regulation).where(Regulation.id == a.regulation_id))
    ).scalar_one_or_none()
    if reg and not is_super_admin(current_user) and reg.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Чужой тенант")
    await db.delete(a)
    await db.commit()
    return None


# ─────────────────────────────────────────────────────────────────────
# List + filters
# ─────────────────────────────────────────────────────────────────────
@router.get("")
async def list_regulations(
    status_filter: Optional[str] = Query(None, alias="status"),
    category: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(_require_manage),
    db: AsyncSession = Depends(get_db),
):
    """Список регламентов с фильтрами и пагинацией."""
    base = select(Regulation)
    base = _filter_tenant(base, current_user)
    if status_filter:
        base = base.where(Regulation.status == status_filter)
    if category:
        base = base.where(Regulation.category == category)
    if q:
        like = f"%{q.strip()}%"
        base = base.where(
            or_(Regulation.title.ilike(like), Regulation.description.ilike(like))
        )

    # total count
    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar() or 0

    rows = (
        await db.execute(
            base.order_by(desc(Regulation.updated_at)).offset(offset).limit(limit)
        )
    ).scalars().all()

    # Подтягиваем current_version для краткой инфы
    cur_ids = [r.current_version_id for r in rows if r.current_version_id]
    versions_map: dict[uuid.UUID, RegulationVersion] = {}
    if cur_ids:
        vs = (
            await db.execute(
                select(RegulationVersion).where(RegulationVersion.id.in_(cur_ids))
            )
        ).scalars().all()
        versions_map = {v.id: v for v in vs}

    items = []
    for r in rows:
        v = versions_map.get(r.current_version_id) if r.current_version_id else None
        items.append(regulation_to_dict(r, current_version=v))

    return {"total": int(total), "limit": limit, "offset": offset, "items": items}


# ─────────────────────────────────────────────────────────────────────
# Create
# ─────────────────────────────────────────────────────────────────────
@router.post("", status_code=201)
async def create_regulation(
    body: CreateRegulationBody,
    current_user: User = Depends(_require_manage),
    db: AsyncSession = Depends(get_db),
):
    """Создать регламент + первую draft версию."""
    if not is_super_admin(current_user) and not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Пользователь без tenant_id")

    reg = Regulation(
        tenant_id=current_user.tenant_id,
        title=body.title.strip(),
        description=(body.description or None),
        category=(body.category or None),
        assigned_roles=body.assigned_roles or [],
        status=RegulationStatus.DRAFT,
        created_by_user_id=current_user.id,
    )
    db.add(reg)
    await db.flush()
    version = await create_initial_version(db, regulation=reg, steps=body.initial_steps or [])
    await db.commit()
    await db.refresh(reg)
    await db.refresh(version)
    return regulation_to_dict(reg, current_version=None, versions=[version])


# ─────────────────────────────────────────────────────────────────────
# Detail
# ─────────────────────────────────────────────────────────────────────
@router.get("/{regulation_id}")
async def get_regulation(
    regulation_id: uuid.UUID,
    current_user: User = Depends(_require_manage),
    db: AsyncSession = Depends(get_db),
):
    reg = await _get_reg_for_manage(db, regulation_id, current_user)
    versions = (
        await db.execute(
            select(RegulationVersion)
            .where(RegulationVersion.regulation_id == reg.id)
            .order_by(desc(RegulationVersion.version_number))
        )
    ).scalars().all()
    current_version = next((v for v in versions if v.id == reg.current_version_id), None)
    # Назначения
    assignments = (
        await db.execute(
            select(RegulationAssignment).where(
                RegulationAssignment.regulation_id == reg.id
            )
        )
    ).scalars().all()
    out = regulation_to_dict(reg, current_version=current_version, versions=versions)
    out["assignments"] = [assignment_to_dict(a) for a in assignments]
    return out


# ─────────────────────────────────────────────────────────────────────
# Update meta
# ─────────────────────────────────────────────────────────────────────
@router.patch("/{regulation_id}")
async def update_regulation(
    regulation_id: uuid.UUID,
    body: UpdateRegulationBody,
    current_user: User = Depends(_require_manage),
    db: AsyncSession = Depends(get_db),
):
    reg = await _get_reg_for_manage(db, regulation_id, current_user)
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(status_code=422, detail="title не может быть пустым")
        reg.title = title
    if body.description is not None:
        reg.description = body.description or None
    if body.category is not None:
        reg.category = body.category or None
    if body.assigned_roles is not None:
        reg.assigned_roles = body.assigned_roles or []
    if body.status is not None:
        if body.status not in ALLOWED_STATUSES:
            raise HTTPException(status_code=422, detail="Недопустимый статус")
        reg.status = body.status
    reg.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(reg)
    return regulation_to_dict(reg)


# ─────────────────────────────────────────────────────────────────────
# Soft delete (status=archived)
# ─────────────────────────────────────────────────────────────────────
@router.delete("/{regulation_id}", status_code=204)
async def archive_regulation(
    regulation_id: uuid.UUID,
    current_user: User = Depends(_require_manage),
    db: AsyncSession = Depends(get_db),
):
    reg = await _get_reg_for_manage(db, regulation_id, current_user)
    reg.status = RegulationStatus.ARCHIVED
    reg.updated_at = datetime.utcnow()
    await db.commit()
    return None


# ─────────────────────────────────────────────────────────────────────
# New version
# ─────────────────────────────────────────────────────────────────────
@router.post("/{regulation_id}/versions", status_code=201)
async def new_version(
    regulation_id: uuid.UUID,
    body: NewVersionBody,
    current_user: User = Depends(_require_manage),
    db: AsyncSession = Depends(get_db),
):
    reg = await _get_reg_for_manage(db, regulation_id, current_user)
    v = await create_new_version(
        db,
        regulation_id=reg.id,
        content=body.content or [],
        changelog=body.changelog,
    )
    await db.commit()
    await db.refresh(v)
    return version_to_dict(v)


# ─────────────────────────────────────────────────────────────────────
# Publish version
# ─────────────────────────────────────────────────────────────────────
@router.post("/{regulation_id}/versions/{version_id}/publish")
async def publish(
    regulation_id: uuid.UUID,
    version_id: uuid.UUID,
    current_user: User = Depends(_require_manage),
    db: AsyncSession = Depends(get_db),
):
    reg = await _get_reg_for_manage(db, regulation_id, current_user)
    v = (
        await db.execute(
            select(RegulationVersion).where(RegulationVersion.id == version_id)
        )
    ).scalar_one_or_none()
    if not v or v.regulation_id != reg.id:
        raise HTTPException(status_code=404, detail="Версия не найдена")
    if not v.content:
        raise HTTPException(
            status_code=422, detail="Нельзя опубликовать пустой регламент"
        )
    reg, v = await publish_version(db, regulation=reg, version=v, user=current_user)
    await db.commit()
    await db.refresh(reg)
    await db.refresh(v)
    return {"regulation": regulation_to_dict(reg, current_version=v), "version": version_to_dict(v)}


# ─────────────────────────────────────────────────────────────────────
# Assignments
# ─────────────────────────────────────────────────────────────────────
@router.post("/{regulation_id}/assignments", status_code=201)
async def add_assignments(
    regulation_id: uuid.UUID,
    body: AssignmentBody,
    current_user: User = Depends(_require_manage),
    db: AsyncSession = Depends(get_db),
):
    reg = await _get_reg_for_manage(db, regulation_id, current_user)
    user_ids = body.user_ids or []
    clinic_ids = body.clinic_ids or []

    if not user_ids and not clinic_ids:
        # «На всех» — single запись с NULL/NULL
        a = RegulationAssignment(
            regulation_id=reg.id,
            user_id=None,
            clinic_id=None,
            assigned_by_user_id=current_user.id,
        )
        db.add(a)
        await db.commit()
        await db.refresh(a)
        return [assignment_to_dict(a)]

    created: list[RegulationAssignment] = []
    for uid in user_ids:
        a = RegulationAssignment(
            regulation_id=reg.id,
            user_id=uid,
            clinic_id=None,
            assigned_by_user_id=current_user.id,
        )
        db.add(a)
        created.append(a)
    for cid in clinic_ids:
        a = RegulationAssignment(
            regulation_id=reg.id,
            user_id=None,
            clinic_id=cid,
            assigned_by_user_id=current_user.id,
        )
        db.add(a)
        created.append(a)
    await db.commit()
    for a in created:
        await db.refresh(a)
    return [assignment_to_dict(a) for a in created]


# ─────────────────────────────────────────────────────────────────────
# Completions stats
# ─────────────────────────────────────────────────────────────────────
@router.get("/{regulation_id}/completions")
async def list_completions(
    regulation_id: uuid.UUID,
    version_id: Optional[uuid.UUID] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(_require_manage),
    db: AsyncSession = Depends(get_db),
):
    """Список тех, кто прочитал/подписал + общая статистика покрытия."""
    reg = await _get_reg_for_manage(db, regulation_id, current_user)

    q = select(RegulationCompletion).where(RegulationCompletion.regulation_id == reg.id)
    if version_id:
        q = q.where(RegulationCompletion.version_id == version_id)
    q = q.order_by(desc(RegulationCompletion.completed_at)).offset(offset).limit(limit)
    rows = (await db.execute(q)).scalars().all()

    # ФИО юзеров одним запросом
    user_ids = list({c.user_id for c in rows if c.user_id})
    users_map: dict[uuid.UUID, User] = {}
    if user_ids:
        users = (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        users_map = {u.id: u for u in users}

    items: list[dict] = []
    for c in rows:
        d = completion_to_dict(c)
        u = users_map.get(c.user_id)
        d["user_full_name"] = u.full_name if u else None
        d["user_role"] = (u.role.value if u and hasattr(u.role, "value") else None)
        items.append(d)

    # Статистика покрытия по current_version
    target_version_id = version_id or reg.current_version_id
    covered = 0
    if target_version_id:
        covered = (
            await db.execute(
                select(func.count(func.distinct(RegulationCompletion.user_id))).where(
                    RegulationCompletion.regulation_id == reg.id,
                    RegulationCompletion.version_id == target_version_id,
                )
            )
        ).scalar() or 0
    total_audience = await count_target_audience(db, regulation=reg)
    pct = (
        round(int(covered) * 100.0 / total_audience, 1) if total_audience else 0.0
    )

    return {
        "items": items,
        "stats": {
            "covered_users": int(covered),
            "total_audience": int(total_audience),
            "coverage_pct": pct,
            "version_id": str(target_version_id) if target_version_id else None,
        },
    }
