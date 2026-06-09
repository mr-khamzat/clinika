"""
Глава 8 — Расходник пациента за год.
  GET  /patient/spending-summary?year=YYYY
  GET  /patient/spending-summary/export.pdf?year=YYYY
"""
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.patient_session import PatientSession
from app.services.patient_session_service import restore_session
from app.services.spending_service import compute_spending_summary, render_spending_pdf
from app.services import family_service as fs


router = APIRouter(prefix="/patient/spending-summary", tags=["patient-spending"])


async def _get_session(
    db: AsyncSession,
    request: Request,
    authorization: Optional[str],
    x_patient_session: Optional[str],
    session_token: Optional[str],
    t: Optional[str] = None,
) -> PatientSession:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
    token = token or x_patient_session or session_token or t or request.cookies.get("clinika_patient_session")
    if not token:
        raise HTTPException(401, "Patient session required")
    sess = await restore_session(db, token)
    if not sess:
        raise HTTPException(401, "Session invalid or expired")
    return sess


def _validate_year(year: int) -> int:
    now = date.today().year
    if year < 2000 or year > now + 1:
        raise HTTPException(422, "Invalid year")
    return year


@router.get("")
async def spending_summary(
    request: Request,
    year: int = Query(default=None),
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
    t: Optional[str] = Query(default=None),
):
    if year is None:
        year = date.today().year
    _validate_year(year)
    sess = await _get_session(db, request, authorization, x_patient_session, session_token, t)
    summary = await compute_spending_summary(db, sess.phone, year, sess.tenant_id)
    return summary


@router.get("/export.pdf")
async def spending_summary_pdf(
    request: Request,
    year: int = Query(default=None),
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_patient_session: Optional[str] = Header(default=None),
    session_token: Optional[str] = Query(default=None),
    t: Optional[str] = Query(default=None),
):
    if year is None:
        year = date.today().year
    _validate_year(year)
    sess = await _get_session(db, request, authorization, x_patient_session, session_token, t)

    # [#18] Изоляция: имя берём из аккаунта в рамках тенанта сессии.
    pa = await fs.get_account_by_phone(db, sess.phone, tenant_id=sess.tenant_id)
    patient_name = pa.name if pa else None

    summary = await compute_spending_summary(db, sess.phone, year, sess.tenant_id)
    try:
        pdf_bytes = render_spending_pdf(summary, patient_name)
    except Exception as e:
        raise HTTPException(500, f"PDF rendering failed: {e}")

    filename = f"spending_{year}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
