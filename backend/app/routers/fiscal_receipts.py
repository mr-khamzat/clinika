"""
Endpoints для 54-ФЗ (модуль fiscal_54fz_pro).

Маршруты:
  GET  /clinics/{cid}/receipts        — список чеков (manager+)
  GET  /receipts/{id}/qr              — QR-ссылка проверки чека
  POST /clinics/{cid}/ofd/pull        — принудительный pull (manager+)
  GET  /clinics/{cid}/ofd-config      — текущий конфиг ОФД (manager+)
  PUT  /clinics/{cid}/ofd-config      — обновить (manager+)
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_manager
from app.core.tenant import get_current_tenant, require_module
from app.database import get_db
from app.models.payments_clinic import FiscalReceipt, OFDConfig
from app.models.tenant import Tenant
from app.services.fiscal import list_registered as list_providers
from app.services.fiscal_service import pull_clinic_receipts


router = APIRouter(tags=["fiscal_receipts"])

_fis_module = Depends(require_module("fiscal_54fz_pro"))


# ── Pydantic ─────────────────────────────────────────────────────────────────

class OFDConfigBody(BaseModel):
    provider: str
    inn: str = Field(..., max_length=20)
    api_key: Optional[str] = None
    is_active: bool = True
    config: dict[str, Any] = Field(default_factory=dict)


# ── Сериализация ─────────────────────────────────────────────────────────────

def _serialize_receipt(r: FiscalReceipt) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "clinic_id": str(r.clinic_id),
        "payment_id": str(r.payment_id) if r.payment_id else None,
        "appointment_id": str(r.appointment_id) if r.appointment_id else None,
        "inn": r.inn,
        "operation_type": r.operation_type,
        "total_sum": float(r.total_sum or 0),
        "qr_code": r.qr_code,
        "fiscal_doc_number": r.fiscal_doc_number,
        "fiscal_storage_number": r.fiscal_storage_number,
        "fiscal_sign": r.fiscal_sign,
        "receipt_at": r.receipt_at.isoformat() if r.receipt_at else None,
        "received_at": r.received_at.isoformat() if r.received_at else None,
        "ofd_provider": r.ofd_provider,
    }


def _serialize_ofd_config(c: OFDConfig) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "clinic_id": str(c.clinic_id),
        "provider": c.provider,
        "inn": c.inn,
        "api_key_present": bool(c.api_key),
        "is_active": c.is_active,
        "last_pulled_at": c.last_pulled_at.isoformat() if c.last_pulled_at else None,
        "config": c.config or {},
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


# ── 1) Список чеков ──────────────────────────────────────────────────────────

@router.get("/clinics/{clinic_id}/receipts", dependencies=[Depends(require_manager), _fis_module])
async def list_receipts(
    clinic_id: uuid.UUID = Path(...),
    date_from: Optional[datetime] = Query(None, alias="from"),
    date_to: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(100, ge=1, le=500),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    if tenant is None:
        return []
    q = select(FiscalReceipt).where(
        FiscalReceipt.tenant_id == tenant.id,
        FiscalReceipt.clinic_id == clinic_id,
    )
    if date_from:
        q = q.where(FiscalReceipt.receipt_at >= date_from)
    if date_to:
        q = q.where(FiscalReceipt.receipt_at <= date_to)
    q = q.order_by(FiscalReceipt.receipt_at.desc().nullslast()).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return [_serialize_receipt(r) for r in rows]


# ── 2) QR одного чека ────────────────────────────────────────────────────────

@router.get("/receipts/{receipt_id}/qr", dependencies=[_fis_module])
async def get_receipt_qr(
    receipt_id: uuid.UUID = Path(...),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(FiscalReceipt, receipt_id)
    if not r or (tenant and r.tenant_id != tenant.id):
        raise HTTPException(status_code=404, detail="Чек не найден")
    return {"id": str(r.id), "qr_code": r.qr_code}


# ── 3) Принудительный pull ───────────────────────────────────────────────────

@router.post("/clinics/{clinic_id}/ofd/pull", dependencies=[Depends(require_manager), _fis_module])
async def force_pull(
    clinic_id: uuid.UUID = Path(...),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    if tenant is None:
        raise HTTPException(status_code=403, detail="Тенант не определён")
    try:
        return await pull_clinic_receipts(db, clinic_id=clinic_id)
    except LookupError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotImplementedError as e:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=f"ОФД-провайдер пока не реализован: {e}",
        )


# ── 4) Конфиг ОФД ────────────────────────────────────────────────────────────

@router.get("/clinics/{clinic_id}/ofd-config", dependencies=[Depends(require_manager)])
async def get_ofd_config(
    clinic_id: uuid.UUID = Path(...),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    if tenant is None:
        return {"config": None, "available_providers": list_providers()}
    cfg = (await db.execute(
        select(OFDConfig).where(
            OFDConfig.tenant_id == tenant.id,
            OFDConfig.clinic_id == clinic_id,
        )
    )).scalar_one_or_none()
    return {
        "config": _serialize_ofd_config(cfg) if cfg else None,
        "available_providers": list_providers(),
    }


@router.put("/clinics/{clinic_id}/ofd-config", dependencies=[Depends(require_manager), _fis_module])
async def upsert_ofd_config(
    body: OFDConfigBody,
    clinic_id: uuid.UUID = Path(...),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    if tenant is None:
        raise HTTPException(status_code=403, detail="Тенант не определён")
    if body.provider not in list_providers():
        raise HTTPException(
            status_code=400,
            detail=f"Провайдер '{body.provider}' неизвестен. Доступны: {', '.join(list_providers())}",
        )

    cfg = (await db.execute(
        select(OFDConfig).where(
            and_(OFDConfig.tenant_id == tenant.id, OFDConfig.clinic_id == clinic_id)
        )
    )).scalar_one_or_none()

    if cfg is None:
        if not body.api_key:
            raise HTTPException(status_code=400, detail="api_key обязателен при создании")
        cfg = OFDConfig(
            tenant_id=tenant.id,
            clinic_id=clinic_id,
            provider=body.provider,
            inn=body.inn,
            api_key=body.api_key,    # TODO: Fernet.encrypt
            is_active=body.is_active,
            config=body.config or {},
        )
        db.add(cfg)
    else:
        cfg.provider = body.provider
        cfg.inn = body.inn
        if body.api_key:
            cfg.api_key = body.api_key   # TODO: Fernet.encrypt
        cfg.is_active = body.is_active
        cfg.config = body.config or cfg.config or {}
        cfg.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(cfg)
    return _serialize_ofd_config(cfg)
