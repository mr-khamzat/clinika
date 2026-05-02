"""
Reviews plugin — отзывы пациентов о врачах.

Публичные (без auth):
  POST /reviews                    — оставить отзыв
  GET  /reviews/doctor/{id}        — рейтинг врача (approved only)

Защищённые (manager/supervisor):
  GET  /reviews/moderate           — список для модерации
  PATCH /reviews/{id}/approve
  PATCH /reviews/{id}/reject
  DELETE /reviews/{id}
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.review import Review, ReviewStatus
from app.core.deps import require_manager

router = APIRouter(prefix="/reviews", tags=["reviews"])
_mgr = Depends(require_manager)


class ReviewCreate(BaseModel):
    doctor_id:      uuid.UUID
    appointment_id: Optional[uuid.UUID] = None
    clinic_id:      Optional[uuid.UUID] = None
    tenant_id:      Optional[uuid.UUID] = None
    patient_name:   Optional[str]       = Field(None, max_length=200)
    patient_phone:  Optional[str]       = Field(None, max_length=20)
    rating:         int                 = Field(..., ge=1, le=5)
    comment:        Optional[str]       = Field(None, max_length=2000)
    is_anonymous:   bool                = False


def _out(r: Review) -> dict:
    return {
        "id":             str(r.id),
        "doctor_id":      str(r.doctor_id) if r.doctor_id else None,
        "clinic_id":      str(r.clinic_id) if r.clinic_id else None,
        "appointment_id": str(r.appointment_id) if r.appointment_id else None,
        "patient_name":   None if r.is_anonymous else r.patient_name,
        "patient_phone":  None if r.is_anonymous else r.patient_phone,
        "rating":         r.rating,
        "comment":        r.comment,
        "status":         r.status,
        "is_anonymous":   r.is_anonymous,
        "created_at":     r.created_at.isoformat() if r.created_at else None,
        "moderated_at":   r.moderated_at.isoformat() if r.moderated_at else None,
    }


@router.post("", status_code=201)
async def submit_review(
    body: ReviewCreate,
    db: AsyncSession = Depends(get_db),
):
    if body.appointment_id:
        existing = (await db.execute(
            select(Review).where(Review.appointment_id == body.appointment_id)
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(409, "Отзыв для этой записи уже существует")

    r = Review(
        tenant_id      = body.tenant_id,
        appointment_id = body.appointment_id,
        doctor_id      = body.doctor_id,
        clinic_id      = body.clinic_id,
        patient_name   = body.patient_name,
        patient_phone  = body.patient_phone,
        rating         = body.rating,
        comment        = body.comment,
        is_anonymous   = body.is_anonymous,
        status         = ReviewStatus.PENDING,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return _out(r)


@router.get("/doctor/{doctor_id}")
async def doctor_rating(
    doctor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    q = await db.execute(
        select(
            func.avg(Review.rating).label("avg"),
            func.count(Review.id).label("count"),
        ).where(
            Review.doctor_id == doctor_id,
            Review.status    == ReviewStatus.APPROVED,
        )
    )
    row = q.one()
    reviews_q = await db.execute(
        select(Review).where(
            Review.doctor_id == doctor_id,
            Review.status    == ReviewStatus.APPROVED,
        ).order_by(Review.created_at.desc()).limit(10)
    )
    reviews = reviews_q.scalars().all()
    return {
        "doctor_id":  str(doctor_id),
        "avg_rating": round(float(row.avg), 1) if row.avg else None,
        "total":      row.count,
        "reviews":    [_out(r) for r in reviews],
    }


@router.get("/moderate", dependencies=[_mgr])
async def list_reviews(
    status: Optional[str]       = Query(None),
    doctor_id: Optional[uuid.UUID] = Query(None),
    limit: int                  = Query(50, le=200),
    offset: int                 = Query(0, ge=0),
    current_user                = Depends(require_manager),
    db: AsyncSession            = Depends(get_db),
):
    filters = []
    if current_user.tenant_id:
        filters.append(Review.tenant_id == current_user.tenant_id)
    if status:
        filters.append(Review.status == status)
    if doctor_id:
        filters.append(Review.doctor_id == doctor_id)

    total = (await db.execute(select(func.count(Review.id)).where(*filters))).scalar() or 0
    rows  = (await db.execute(
        select(Review).where(*filters).order_by(Review.created_at.desc()).limit(limit).offset(offset)
    )).scalars().all()
    return {"total": total, "items": [_out(r) for r in rows]}


@router.patch("/{review_id}/approve", dependencies=[_mgr])
async def approve_review(
    review_id: uuid.UUID,
    current_user = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(Review, review_id)
    if not r:
        raise HTTPException(404, "Отзыв не найден")
    r.status = ReviewStatus.APPROVED
    r.moderator_id = current_user.id
    r.moderated_at = datetime.utcnow()
    await db.commit()
    return _out(r)


@router.patch("/{review_id}/reject", dependencies=[_mgr])
async def reject_review(
    review_id: uuid.UUID,
    current_user = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(Review, review_id)
    if not r:
        raise HTTPException(404, "Отзыв не найден")
    r.status = ReviewStatus.REJECTED
    r.moderator_id = current_user.id
    r.moderated_at = datetime.utcnow()
    await db.commit()
    return _out(r)


@router.delete("/{review_id}", status_code=204, dependencies=[_mgr])
async def delete_review(
    review_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(Review, review_id)
    if not r:
        raise HTTPException(404, "Отзыв не найден")
    await db.delete(r)
    await db.commit()
