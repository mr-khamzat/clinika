"""
/accountant/payments — реестр платежей пациентов.

Tenant-wide по умолчанию. Опциональный clinic_id-фильтр сужает до конкретной клиники.
Бухгалтер видит ВСЕ обороты внутри своего тенанта (все клиники сети).
"""
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.payments_clinic import ClinicPayment
from app.routers.accountant.deps import require_accountant


router = APIRouter(prefix="/payments", tags=["accountant:payments"])


class PaymentOut(BaseModel):
    id: str
    clinic_id: Optional[str] = None
    patient_phone: str
    patient_name: Optional[str]
    amount: Decimal
    gateway: str
    status: str
    created_at: datetime


@router.get("", response_model=list[PaymentOut])
async def list_payments(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    clinic_id: Optional[uuid.UUID] = Query(None, description="Сузить до одной клиники тенанта"),
    limit: int = Query(100, le=500),
    user: User = Depends(require_accountant),
    db: AsyncSession = Depends(get_db),
):
    if date_from is None:
        date_from = date.today() - timedelta(days=30)
    if date_to is None:
        date_to = date.today() + timedelta(days=1)

    conds = [
        ClinicPayment.tenant_id == user.tenant_id,
        ClinicPayment.created_at >= datetime.combine(date_from, datetime.min.time()),
        ClinicPayment.created_at < datetime.combine(date_to, datetime.min.time()),
    ]
    if clinic_id:
        conds.append(ClinicPayment.clinic_id == clinic_id)
    if status_filter:
        conds.append(ClinicPayment.status == status_filter)

    rows = (await db.execute(
        select(ClinicPayment)
        .where(and_(*conds))
        .order_by(desc(ClinicPayment.created_at))
        .limit(limit)
    )).scalars().all()

    return [
        PaymentOut(
            id=str(r.id),
            clinic_id=str(r.clinic_id) if r.clinic_id else None,
            patient_phone=r.patient_phone,
            patient_name=r.patient_name,
            amount=r.amount,
            gateway=r.gateway,
            status=r.status,
            created_at=r.created_at,
        ) for r in rows
    ]
