"""CRM-карточка пациента: tags/notes/comm_prefs + список suggestions + push history."""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager, require_director_or_owner, get_tenant_db
from app.models.user import User
from app.models.patient_account import PatientAccount
from app.models.patient_session import PatientSession
from app.models.engagement import (
    PatientTag,
    PatientNote,
    PatientCommPrefs,
    EngagementSuggestion,
)

router = APIRouter(prefix="/engagement", tags=["engagement-crm"])


# ===== Patient list для главной таблицы =====

@router.get("/patients")
async def list_patients(
    q: Optional[str] = Query(None, description="поиск по phone/name/email"),
    last_login_from: Optional[str] = Query(None, description="ISO date"),
    last_login_to: Optional[str] = Query(None),
    login_count_min: Optional[int] = Query(None),
    login_count_max: Optional[int] = Query(None),
    birthday_in_next_days: Optional[int] = Query(None, ge=0, le=365),
    has_tag: Optional[str] = Query(None),
    has_appointments_in_tenant: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort: str = Query(
        "last_seen_desc",
        pattern="^(last_seen_desc|last_seen_asc|created_desc|login_count_desc)$",
    ),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Список пациентов с фильтрами для главной таблицы CRM-hub."""
    stmt = select(PatientAccount)
    conds = []
    if q:
        like = f"%{q}%"
        conds.append(
            (PatientAccount.phone.ilike(like))
            | (PatientAccount.name.ilike(like))
            | (PatientAccount.email.ilike(like))
        )
    if last_login_from:
        conds.append(PatientAccount.last_seen_at >= datetime.fromisoformat(last_login_from))
    if last_login_to:
        conds.append(PatientAccount.last_seen_at <= datetime.fromisoformat(last_login_to))
    if login_count_min is not None:
        conds.append(PatientAccount.login_count >= login_count_min)
    if login_count_max is not None:
        conds.append(PatientAccount.login_count <= login_count_max)
    if birthday_in_next_days is not None:
        # int() выше — защита от sql-injection (значение уже валидировано Query.ge/le)
        conds.append(text(
            "(birth_date IS NOT NULL "
            "AND EXTRACT(MONTH FROM birth_date) = EXTRACT(MONTH FROM CURRENT_DATE) "
            f"AND EXTRACT(DAY FROM birth_date) BETWEEN EXTRACT(DAY FROM CURRENT_DATE) "
            f"AND EXTRACT(DAY FROM CURRENT_DATE) + {int(birthday_in_next_days)})"
        ))
    if has_tag:
        tag_pa_q = await db.execute(
            select(PatientTag.patient_id)
            .where(
                PatientTag.tenant_id == current_user.tenant_id,
                PatientTag.tag == has_tag,
            )
            .distinct()
        )
        tag_ids = list(tag_pa_q.scalars().all())
        if not tag_ids:
            return {"items": [], "total": 0}
        conds.append(PatientAccount.id.in_(tag_ids))
    if has_appointments_in_tenant is True:
        appt_pa_q = await db.execute(
            text(
                """
                SELECT DISTINCT pa.id FROM patient_accounts pa
                WHERE EXISTS (
                  SELECT 1 FROM appointments a
                  WHERE a.tenant_id = :tid AND a.patient_phone = pa.phone
                )
                """
            ),
            {"tid": str(current_user.tenant_id)},
        )
        appt_ids = [r[0] for r in appt_pa_q]
        if not appt_ids:
            return {"items": [], "total": 0}
        conds.append(PatientAccount.id.in_(appt_ids))
    if conds:
        stmt = stmt.where(*conds)
    total_q = await db.execute(select(func.count()).select_from(stmt.subquery()))
    total = total_q.scalar() or 0
    sort_map = {
        "last_seen_desc": PatientAccount.last_seen_at.desc(),
        "last_seen_asc": PatientAccount.last_seen_at.asc(),
        "created_desc": PatientAccount.created_at.desc(),
        "login_count_desc": PatientAccount.login_count.desc(),
    }
    stmt = stmt.order_by(sort_map[sort]).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "total": total,
        "items": [
            {
                "id": str(p.id),
                "phone": p.phone,
                "name": p.name,
                "email": p.email,
                "birth_date": p.birth_date.isoformat() if p.birth_date else None,
                "last_seen_at": p.last_seen_at.isoformat() if p.last_seen_at else None,
                "login_count": p.login_count,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "marketing_opt_in": p.marketing_opt_in,
            }
            for p in rows
        ],
    }


@router.get("/patients/{patient_id}")
async def patient_card(
    patient_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Карточка пациента: профиль + теги + заметки + comm_prefs + последние логины + appointments + suggestions."""
    pa = (
        await db.execute(select(PatientAccount).where(PatientAccount.id == patient_id))
    ).scalar_one_or_none()
    if not pa:
        raise HTTPException(404, "patient not found")

    tags = (
        await db.execute(
            select(PatientTag).where(
                PatientTag.patient_id == patient_id,
                PatientTag.tenant_id == current_user.tenant_id,
            )
        )
    ).scalars().all()
    notes = (
        await db.execute(
            select(PatientNote)
            .where(
                PatientNote.patient_id == patient_id,
                PatientNote.tenant_id == current_user.tenant_id,
            )
            .order_by(PatientNote.pinned.desc(), PatientNote.created_at.desc())
            .limit(50)
        )
    ).scalars().all()
    prefs = (
        await db.execute(
            select(PatientCommPrefs).where(PatientCommPrefs.patient_id == patient_id)
        )
    ).scalar_one_or_none()
    # PatientSession линкуется по phone (нет account_id).
    sessions = []
    if pa.phone:
        sessions = (
            await db.execute(
                select(PatientSession)
                .where(PatientSession.phone == pa.phone)
                .order_by(PatientSession.created_at.desc())
                .limit(30)
            )
        ).scalars().all()
    suggestions = (
        await db.execute(
            select(EngagementSuggestion)
            .where(
                EngagementSuggestion.patient_id == patient_id,
                EngagementSuggestion.tenant_id == current_user.tenant_id,
            )
            .order_by(EngagementSuggestion.created_at.desc())
            .limit(30)
        )
    ).scalars().all()

    # Appointments: doctor_name через JOIN doctors. service_name отсутствует
    # в модели Appointment — возвращаем null для совместимости с фронтом.
    appts = []
    if pa.phone:
        appts = (
            await db.execute(
                text(
                    """
                    SELECT a.id, a.created_at, a.status,
                           d.name AS doctor_name,
                           NULL::text AS service_name
                    FROM appointments a
                    LEFT JOIN doctors d ON d.id = a.doctor_id
                    WHERE a.tenant_id = :tid AND a.patient_phone = :ph
                    ORDER BY a.created_at DESC
                    LIMIT 20
                    """
                ),
                {"tid": str(current_user.tenant_id), "ph": pa.phone},
            )
        ).all()

    return {
        "profile": {
            "id": str(pa.id),
            "phone": pa.phone,
            "name": pa.name,
            "email": pa.email,
            "birth_date": pa.birth_date.isoformat() if pa.birth_date else None,
            "last_seen_at": pa.last_seen_at.isoformat() if pa.last_seen_at else None,
            "login_count": pa.login_count,
            "created_at": pa.created_at.isoformat() if pa.created_at else None,
            "marketing_opt_in": pa.marketing_opt_in,
        },
        "tags": [{"id": str(t.id), "tag": t.tag, "color": t.color} for t in tags],
        "notes": [
            {
                "id": str(n.id),
                "body": n.body,
                "pinned": n.pinned,
                "created_at": n.created_at.isoformat(),
            }
            for n in notes
        ],
        "comm_prefs": (
            {
                "promo": prefs.promo,
                "reminders": prefs.reminders,
                "loyalty": prefs.loyalty,
                "news": prefs.news,
                "quiet_hours_from": prefs.quiet_hours_from,
                "quiet_hours_to": prefs.quiet_hours_to,
            }
            if prefs
            else None
        ),
        "recent_logins": [{"created_at": s.created_at.isoformat()} for s in sessions],
        "appointments": [
            {
                "id": str(r[0]),
                "created_at": r[1].isoformat() if r[1] else None,
                "status": r[2],
                "doctor": r[3],
                "service": r[4],
            }
            for r in appts
        ],
        "suggestions": [
            {
                "id": str(s.id),
                "kind": s.kind,
                "status": s.status,
                "created_at": s.created_at.isoformat(),
            }
            for s in suggestions
        ],
    }


# ===== Tags CRUD =====

class TagCreate(BaseModel):
    tag: str = Field(..., max_length=50)
    color: Optional[str] = Field(None, max_length=20)


@router.post("/patients/{patient_id}/tags")
async def add_tag(
    patient_id: uuid.UUID,
    body: TagCreate,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    pt = PatientTag(
        tenant_id=current_user.tenant_id,
        patient_id=patient_id,
        tag=body.tag,
        color=body.color,
        created_by_user_id=current_user.id,
    )
    db.add(pt)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(400, "tag exists")
    return {"id": str(pt.id), "tag": pt.tag, "color": pt.color}


@router.delete("/patients/{patient_id}/tags/{tag_id}")
async def remove_tag(
    patient_id: uuid.UUID,
    tag_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    pt = (
        await db.execute(
            select(PatientTag).where(
                PatientTag.id == tag_id,
                PatientTag.tenant_id == current_user.tenant_id,
                PatientTag.patient_id == patient_id,
            )
        )
    ).scalar_one_or_none()
    if not pt:
        raise HTTPException(404)
    await db.delete(pt)
    await db.commit()
    return {"ok": True}


# ===== Notes CRUD =====

class NoteCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=5000)
    pinned: bool = False


@router.post("/patients/{patient_id}/notes")
async def add_note(
    patient_id: uuid.UUID,
    body: NoteCreate,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    n = PatientNote(
        tenant_id=current_user.tenant_id,
        patient_id=patient_id,
        body=body.body,
        pinned=body.pinned,
        author_user_id=current_user.id,
    )
    db.add(n)
    await db.commit()
    return {
        "id": str(n.id),
        "body": n.body,
        "pinned": n.pinned,
        "created_at": n.created_at.isoformat(),
    }


@router.patch("/patients/{patient_id}/notes/{note_id}")
async def update_note(
    patient_id: uuid.UUID,
    note_id: uuid.UUID,
    body: NoteCreate,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    n = (
        await db.execute(
            select(PatientNote).where(
                PatientNote.id == note_id,
                PatientNote.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not n:
        raise HTTPException(404)
    n.body = body.body
    n.pinned = body.pinned
    n.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": str(n.id), "body": n.body, "pinned": n.pinned}


@router.delete("/patients/{patient_id}/notes/{note_id}")
async def delete_note(
    patient_id: uuid.UUID,
    note_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    n = (
        await db.execute(
            select(PatientNote).where(
                PatientNote.id == note_id,
                PatientNote.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not n:
        raise HTTPException(404)
    await db.delete(n)
    await db.commit()
    return {"ok": True}


# ===== Comm prefs =====

class CommPrefsUpdate(BaseModel):
    promo: Optional[bool] = None
    reminders: Optional[bool] = None
    loyalty: Optional[bool] = None
    news: Optional[bool] = None
    quiet_hours_from: Optional[int] = Field(None, ge=0, le=23)
    quiet_hours_to: Optional[int] = Field(None, ge=0, le=23)


@router.patch("/patients/{patient_id}/comm-prefs")
async def update_prefs(
    patient_id: uuid.UUID,
    body: CommPrefsUpdate,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    prefs = (
        await db.execute(
            select(PatientCommPrefs).where(PatientCommPrefs.patient_id == patient_id)
        )
    ).scalar_one_or_none()
    if not prefs:
        prefs = PatientCommPrefs(
            patient_id=patient_id, tenant_id=current_user.tenant_id
        )
        db.add(prefs)
    for k, v in body.dict(exclude_unset=True).items():
        setattr(prefs, k, v)
    prefs.updated_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


# ===== Suggestions endpoints =====

@router.get("/suggestions")
async def list_suggestions(
    status: str = Query(
        "pending",
        pattern="^(pending|sent|dismissed|postponed|auto_blocked|all)$",
    ),
    kind: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Список pending подсказок для основной вкладки CRM."""
    stmt = select(EngagementSuggestion).where(
        EngagementSuggestion.tenant_id == current_user.tenant_id
    )
    if status != "all":
        stmt = stmt.where(EngagementSuggestion.status == status)
    if kind:
        stmt = stmt.where(EngagementSuggestion.kind == kind)
    stmt = stmt.order_by(EngagementSuggestion.created_at.desc()).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    # Группировка по kind для удобства фронта.
    grouped: dict = {}
    for s in rows:
        grouped.setdefault(s.kind, []).append(
            {
                "id": str(s.id),
                "patient_id": str(s.patient_id),
                "kind": s.kind,
                "status": s.status,
                "template_id": str(s.template_id) if s.template_id else None,
                "meta": s.meta,
                "created_at": s.created_at.isoformat(),
            }
        )
    return {"groups": grouped, "total": len(rows)}


@router.post("/suggestions/{sug_id}/dismiss")
async def dismiss_suggestion(
    sug_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    s = (
        await db.execute(
            select(EngagementSuggestion).where(
                EngagementSuggestion.id == sug_id,
                EngagementSuggestion.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(404)
    s.status = "dismissed"
    s.reviewed_by_user_id = current_user.id
    s.reviewed_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


class PostponeRequest(BaseModel):
    days: int = Field(..., ge=1, le=90)


@router.post("/suggestions/{sug_id}/postpone")
async def postpone_suggestion(
    sug_id: uuid.UUID,
    body: PostponeRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    s = (
        await db.execute(
            select(EngagementSuggestion).where(
                EngagementSuggestion.id == sug_id,
                EngagementSuggestion.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(404)
    s.status = "postponed"
    s.postponed_until = datetime.utcnow() + timedelta(days=body.days)
    s.reviewed_by_user_id = current_user.id
    s.reviewed_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


@router.post("/suggestions/regenerate")
async def regenerate_suggestions(
    current_user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Ручной запуск suggestion_engine для текущего тенанта (для отладки)."""
    from app.services.suggestion_engine import run_engine
    stats = await run_engine(db, current_user.tenant_id)
    return {"stats": stats}
