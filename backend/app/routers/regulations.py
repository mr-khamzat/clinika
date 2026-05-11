"""
Публичный роутер «Регламент-конструктор» (Глава 7).

Префикс: /regulations
Эндпоинты:
  GET  /regulations/my-assigned       — список доступных пользователю
  GET  /regulations/{id}              — детали + published content
  POST /regulations/{id}/complete     — е-подпись (прочитал и подтверждаю)

Доступ: любой аутентифицированный пользователь (кроме роли patient).
Tenant-изоляция — по user.tenant_id.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.regulation import (
    Regulation,
    RegulationVersion,
    RegulationCompletion,
    RegulationStatus,
)
from app.models.user import User
from app.services.regulation_service import (
    can_read_regulations,
    is_super_admin,
    list_assigned_for_user,
    regulation_to_dict,
    user_has_access_to_regulation,
    version_to_dict,
    completion_to_dict,
)

log = logging.getLogger("regulations_router")

router = APIRouter(prefix="/regulations", tags=["regulations"])


# ─────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────
class CompleteBody(BaseModel):
    signature_text: Optional[str] = Field(default=None, max_length=200)
    checkboxes_state: Optional[dict] = None


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
async def _get_regulation_or_404(
    db: AsyncSession, reg_id: uuid.UUID
) -> Regulation:
    reg = (
        await db.execute(select(Regulation).where(Regulation.id == reg_id))
    ).scalar_one_or_none()
    if not reg:
        raise HTTPException(status_code=404, detail="Регламент не найден")
    return reg


async def _get_version_or_none(
    db: AsyncSession, version_id: uuid.UUID | None
) -> RegulationVersion | None:
    if not version_id:
        return None
    return (
        await db.execute(
            select(RegulationVersion).where(RegulationVersion.id == version_id)
        )
    ).scalar_one_or_none()


# ─────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────
@router.get("/my-assigned")
async def my_assigned(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список регламентов, доступных текущему пользователю."""
    if not can_read_regulations(current_user):
        raise HTTPException(status_code=403, detail="Пациентам регламенты недоступны")
    return await list_assigned_for_user(db, user=current_user)


@router.get("/{regulation_id}")
async def regulation_detail(
    regulation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Детали регламента + текущая опубликованная версия."""
    if not can_read_regulations(current_user):
        raise HTTPException(status_code=403, detail="Пациентам регламенты недоступны")
    reg = await _get_regulation_or_404(db, regulation_id)
    if not await user_has_access_to_regulation(db, user=current_user, reg=reg):
        raise HTTPException(status_code=403, detail="Нет доступа к этому регламенту")

    current_version = await _get_version_or_none(db, reg.current_version_id)
    out = regulation_to_dict(reg, current_version=current_version)

    # Информация о подписи текущим юзером
    completed = None
    if current_version:
        c = (
            await db.execute(
                select(RegulationCompletion).where(
                    RegulationCompletion.regulation_id == reg.id,
                    RegulationCompletion.version_id == current_version.id,
                    RegulationCompletion.user_id == current_user.id,
                )
            )
        ).scalar_one_or_none()
        if c:
            completed = completion_to_dict(c)
    out["my_completion"] = completed
    return out


@router.post("/{regulation_id}/complete", status_code=201)
async def complete_regulation(
    regulation_id: uuid.UUID,
    body: CompleteBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Е-подпись регламента (текущая опубликованная версия)."""
    if not can_read_regulations(current_user):
        raise HTTPException(status_code=403, detail="Пациентам регламенты недоступны")
    reg = await _get_regulation_or_404(db, regulation_id)
    if not await user_has_access_to_regulation(db, user=current_user, reg=reg):
        raise HTTPException(status_code=403, detail="Нет доступа к этому регламенту")
    if reg.status != RegulationStatus.PUBLISHED or not reg.current_version_id:
        raise HTTPException(
            status_code=400,
            detail="Регламент не опубликован — нечего подписывать",
        )
    version = await _get_version_or_none(db, reg.current_version_id)
    if not version:
        raise HTTPException(status_code=500, detail="Текущая версия не найдена")

    # Идемпотентность: повторная подпись той же версии не дублирует запись
    existing = (
        await db.execute(
            select(RegulationCompletion).where(
                RegulationCompletion.regulation_id == reg.id,
                RegulationCompletion.version_id == version.id,
                RegulationCompletion.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return completion_to_dict(existing)

    # Проверка required-чекбоксов
    cb_state = body.checkboxes_state or {}
    if isinstance(version.content, list):
        for step in version.content:
            if not isinstance(step, dict):
                continue
            if step.get("type") == "checkbox" and step.get("required"):
                key = f"step{step.get('order')}"
                if not bool(cb_state.get(key)):
                    raise HTTPException(
                        status_code=422,
                        detail=f"Обязательный чекбокс не отмечен: {step.get('content','')}",
                    )

    comp = RegulationCompletion(
        regulation_id=reg.id,
        version_id=version.id,
        user_id=current_user.id,
        signature_text=(body.signature_text or current_user.full_name or "")[:200] or None,
        checkboxes_state=cb_state or None,
        completed_at=datetime.utcnow(),
    )
    db.add(comp)
    await db.commit()
    await db.refresh(comp)
    return completion_to_dict(comp)
