"""
Глава 10 — Patient endpoint: список лабораторных результатов пациента.
Аутентификация — patient_session_token (как в patient_subscription).
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.patient_account import PatientAccount
from app.models.patient_session import PatientSession
from app.models.lab import LabOrder, LabResult, LabProvider
from app.services.patient_session_service import restore_session
from app.services import family_service as fs


router = APIRouter(tags=["patient-lab"])


# ── Auth helper (тот же шаблон что в patient_subscription) ──────────────
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


@router.get("/patient/lab-results")
async def list_lab_results(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None, description="alias session_token"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Список анализов пациента с результатами."""
    sess = await _get_session(
        db, request, authorization, x_patient_session, session_token or t
    )
    acc = await _account(db, sess)

    # Только заявки в статусе с результатами или прогрессе
    orders = (await db.execute(
        select(LabOrder).where(LabOrder.patient_id == acc.id).order_by(
            LabOrder.requested_at.desc()
        ).limit(limit)
    )).scalars().all()

    if not orders:
        return {"items": []}

    order_ids = [o.id for o in orders]
    results = (await db.execute(
        select(LabResult).where(LabResult.order_id.in_(order_ids))
    )).scalars().all()
    results_by_order: dict[uuid.UUID, list[LabResult]] = {}
    for r in results:
        results_by_order.setdefault(r.order_id, []).append(r)

    # Имена провайдеров
    provider_ids = list({o.provider_id for o in orders})
    providers = (await db.execute(
        select(LabProvider).where(LabProvider.id.in_(provider_ids))
    )).scalars().all()
    provider_names = {p.id: p.name for p in providers}

    items: list[dict] = []
    for o in orders:
        order_results = results_by_order.get(o.id, [])
        items.append({
            "id": str(o.id),
            "provider_id": str(o.provider_id),
            "provider_name": provider_names.get(o.provider_id, "—"),
            "external_order_id": o.external_order_id,
            "status": o.status,
            "test_codes": o.test_codes or [],
            "requested_at": o.requested_at.isoformat() if o.requested_at else None,
            "results_at": o.results_at.isoformat() if o.results_at else None,
            "results": [
                {
                    "test_code": r.test_code,
                    "test_name": r.test_name,
                    "value": r.value,
                    "unit": r.unit,
                    "reference_range": r.reference_range,
                    "flagged": r.flagged,
                    "result_date": r.result_date.isoformat() if r.result_date else None,
                }
                for r in order_results
            ],
        })

    return {"items": items}
