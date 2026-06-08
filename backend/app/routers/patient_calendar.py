"""
Глава 9 — Календарь пациента.

  GET  /patient/calendar/upcoming             — auth: patient_session
  POST /patient/calendar/issue-token          — auth: patient_session
  GET  /patient/calendar/tokens               — auth: patient_session
  POST /patient/calendar/tokens/{id}/revoke   — auth: patient_session
  GET  /patient/calendar/feed.ics?token=...   — БЕЗ auth (только token-based)
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.patient_account import PatientAccount
from app.models.patient_session import PatientSession
from app.models.calendar import PatientCalendarToken
from app.services import family_service as fs
from app.services import calendar_service as cls
from app.services.patient_session_service import restore_session


router = APIRouter(tags=["patient-calendar"])


# ── Auth helper ────────────────────────────────────────────────────────────
async def _get_session(
    db: AsyncSession,
    request: Request,
    authorization: Optional[str] = None,
    x_patient_session: Optional[str] = None,
    session_token: Optional[str] = None,
) -> PatientSession:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
    token = token or x_patient_session or session_token
    if not token:
        token = request.cookies.get("clinika_patient_session")
    if not token:
        raise HTTPException(401, "Patient session required")
    sess = await restore_session(db, token)
    if not sess:
        raise HTTPException(401, "Session invalid or expired")
    return sess


async def _account(db: AsyncSession, sess: PatientSession) -> PatientAccount:
    # [#18] Изоляция: ищем/создаём аккаунт в рамках тенанта сессии.
    acc = await fs.get_account_by_phone(db, sess.phone, tenant_id=sess.tenant_id)
    if not acc:
        acc, _ = await fs.get_or_create_account_by_phone(
            db, sess.phone, tenant_id=sess.tenant_id
        )
        await db.commit()
    return acc


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/patient/calendar/upcoming")
async def upcoming(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    weeks_ahead: int = Query(4, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    rows = await cls.upcoming_appointments(db, sess.phone, weeks_ahead=weeks_ahead)
    return {"appointments": cls.serialize_upcoming(rows)}


@router.post("/patient/calendar/issue-token", status_code=201)
async def issue_token(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    tok = await cls.issue_token(db, acc.id)
    await db.commit()
    return {
        "id": str(tok.id),
        "token": tok.token,
        "created_at": tok.created_at.isoformat() if tok.created_at else None,
        "feed_url": f"/patient/calendar/feed.ics?token={tok.token}",
    }


@router.get("/patient/calendar/tokens")
async def list_tokens(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    r = await db.execute(
        select(PatientCalendarToken)
        .where(PatientCalendarToken.patient_id == acc.id)
        .order_by(PatientCalendarToken.created_at.desc())
    )
    rows = list(r.scalars().all())
    return {
        "tokens": [
            {
                "id": str(t.id),
                "token": t.token,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "revoked_at": t.revoked_at.isoformat() if t.revoked_at else None,
                "feed_url": f"/patient/calendar/feed.ics?token={t.token}",
            }
            for t in rows
        ]
    }


@router.post("/patient/calendar/tokens/{token_id}/revoke")
async def revoke_token(
    token_id: uuid.UUID,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    r = await db.execute(
        select(PatientCalendarToken).where(PatientCalendarToken.id == token_id)
    )
    tok = r.scalar_one_or_none()
    if not tok or tok.patient_id != acc.id:
        raise HTTPException(404, "Token not found")
    await cls.revoke_token(db, tok)
    await db.commit()
    return {"id": str(tok.id), "revoked_at": tok.revoked_at.isoformat()}


@router.get("/patient/calendar/feed.ics", response_class=Response)
async def calendar_feed(
    token: str = Query(..., min_length=8, max_length=128),
    weeks_ahead: int = Query(4, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
):
    """iCal-feed без auth (только token-based). Подписка для Google/Apple Calendar."""
    tok = await cls.get_token_record(db, token)
    if not tok:
        raise HTTPException(404, "Token invalid or revoked")
    r = await db.execute(
        select(PatientAccount).where(PatientAccount.id == tok.patient_id)
    )
    acc = r.scalar_one_or_none()
    if not acc:
        raise HTTPException(404, "Patient not found")
    rows = await cls.upcoming_appointments(db, acc.phone, weeks_ahead=weeks_ahead)
    body = cls.build_ics(rows)
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'inline; filename="clinikaset-appointments.ics"',
            "Cache-Control": "no-store, max-age=0",
        },
    )
