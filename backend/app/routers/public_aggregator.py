"""
Глава 10 — Public endpoint для агрегаторов (DocDoc, ProDoctorov, ...).

Авторизация — через header `X-Agg-API-Key` с plaintext-ключом, выданным при
создании партнёрства. Backend хэширует и ищет активное партнёрство.

Также имеется webhook /webhooks/lab-results/{provider_type} для лабораторий.
"""
import uuid
from datetime import date as _date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.aggregator import AggregatorPartnership, AggregatorLead
from app.models.lab import LabOrder, LabProvider
from app.services import aggregator_service
from app.services import lab_service


router = APIRouter(tags=["public-aggregator"])


# ── Schemas ─────────────────────────────────────────────────────────────
class AggregatorLeadIn(BaseModel):
    partner_name: str = Field(..., max_length=80)
    patient_phone: str = Field(..., max_length=20)
    patient_full_name: Optional[str] = Field(default=None, max_length=120)
    clinic_id: Optional[uuid.UUID] = None
    service: Optional[str] = Field(default=None, max_length=200)
    desired_date: Optional[_date] = None


# ── Endpoints ───────────────────────────────────────────────────────────
@router.post("/public/aggregator/leads", status_code=201)
async def submit_aggregator_lead(
    payload: AggregatorLeadIn,
    x_agg_api_key: str = Header(..., alias="X-Agg-API-Key"),
    db: AsyncSession = Depends(get_db),
):
    """Принять лид от агрегатора. Auth по X-Agg-API-Key."""
    if not x_agg_api_key:
        raise HTTPException(401, "Missing X-Agg-API-Key header")

    partnership = await aggregator_service.find_active_partnership(db, x_agg_api_key)
    if not partnership:
        raise HTTPException(401, "Invalid or inactive API key")

    # Если payload.partner_name отличается от partnership.partner_name — не блокер,
    # но логируем.
    lead = AggregatorLead(
        partnership_id=partnership.id,
        patient_phone=payload.patient_phone.strip(),
        patient_full_name=payload.patient_full_name,
        clinic_id=payload.clinic_id,
        service_requested=payload.service,
        desired_date=payload.desired_date,
        status="received",
    )
    db.add(lead)
    await db.commit()
    await db.refresh(lead)
    return {
        "ok": True,
        "lead_id": str(lead.id),
        "status": lead.status,
        "received_at": lead.created_at.isoformat(),
    }


# ── Webhook от лабораторного провайдера ─────────────────────────────────
@router.post("/webhooks/lab-results/{provider_type}")
async def lab_results_webhook(
    provider_type: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Принимает результаты от лабораторного провайдера.
    Payload (универсальный):
      {
        "external_order_id": "LAB-XXXXX...",
        "results": [
          {"test_code", "test_name", "value", "unit", "reference_range",
           "flagged", "result_date"}
        ]
      }
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    normalized = lab_service.normalize_webhook_payload(provider_type, payload)
    external_id = normalized.get("external_order_id")
    if not external_id:
        raise HTTPException(400, "Missing external_order_id")
    results_list = normalized.get("results") or []
    if not isinstance(results_list, list):
        raise HTTPException(400, "Field 'results' must be a list")

    # Найдём заявку по external_order_id + по provider_type через join
    order = (await db.execute(
        select(LabOrder).join(
            LabProvider, LabProvider.id == LabOrder.provider_id
        ).where(
            LabOrder.external_order_id == external_id,
            LabProvider.provider_type == provider_type,
        )
    )).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Lab order not found for this external_order_id")

    inserted = await lab_service.apply_webhook_results(db, order, results_list)
    await db.commit()
    return {
        "ok": True,
        "order_id": str(order.id),
        "status": order.status,
        "inserted_results": inserted,
    }
