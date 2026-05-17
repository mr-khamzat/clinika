"""
Платформенные объявления (super_admin → всем сотрудникам всех тенантов).
Объявления подмешиваются в /notifications/recent — категория «announcements».

  POST   /admin/announcements              — создать (super_admin)
  GET    /admin/announcements              — список (super_admin)
  DELETE /admin/announcements/{id}         — отозвать (super_admin)
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.platform_announcement import PlatformAnnouncement
from app.models.user import User, UserRole

router = APIRouter(prefix="/admin/announcements", tags=["announcements"])


def _require_super(user: User):
    if user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Только super_admin")


class AnnouncementCreate(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    severity: str = Field("info", pattern="^(info|warning|critical)$")
    expires_at: Optional[datetime] = None


def _to_dict(a: PlatformAnnouncement) -> dict:
    return {
        "id": str(a.id),
        "message": a.message,
        "severity": a.severity,
        "created_at": a.created_at.isoformat(),
        "expires_at": a.expires_at.isoformat() if a.expires_at else None,
        "revoked": a.revoked,
    }


@router.post("", status_code=201)
async def create_announcement(
    body: AnnouncementCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_super(user)
    ann = PlatformAnnouncement(
        message=body.message.strip(),
        severity=body.severity,
        created_by_id=user.id,
        expires_at=body.expires_at,
    )
    db.add(ann)
    await db.commit()
    await db.refresh(ann)
    return _to_dict(ann)


@router.get("")
async def list_announcements(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    include_revoked: bool = False,
):
    _require_super(user)
    q = select(PlatformAnnouncement).order_by(PlatformAnnouncement.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    items = [a for a in rows if include_revoked or not a.revoked]
    return [_to_dict(a) for a in items[:200]]


@router.delete("/{announcement_id}", status_code=204)
async def revoke_announcement(
    announcement_id: uuid.UUID = Path(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_super(user)
    ann = await db.get(PlatformAnnouncement, announcement_id)
    if not ann:
        raise HTTPException(404, "Объявление не найдено")
    ann.revoked = True
    await db.commit()
    return None
