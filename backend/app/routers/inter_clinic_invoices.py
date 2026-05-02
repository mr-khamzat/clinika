"""
Роутер межклиничных счетов.
  GET  /clinic-invoices/incoming          — входящие счета тенанта (manager+)
  GET  /clinic-invoices/outgoing          — исходящие счета тенанта (manager+)
  GET  /clinic-invoices/all              — все счета тенанта (supervisor+)
  POST /clinic-invoices                  — создать вручную (manager+)
  PATCH /clinic-invoices/{id}/send       — отправить (manager+)
  PATCH /clinic-invoices/{id}/pay        — отметить оплаченным (manager+)
  PATCH /clinic-invoices/{id}/cancel     — отменить (manager+)
  GET  /admin/clinic-invoices            — все счета платформы (super_admin)
"""
import uuid
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.clinic import Clinic
from app.models.tenant import Tenant
from app.models.inter_clinic_invoice import InterClinicInvoice, ICIStatus
import app.services.inter_clinic_invoice_service as ici_svc

router = APIRouter(tags=["inter_clinic_invoices"])

MANAGER_ROLES = {UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.SUPER_ADMIN}
SUPERVISOR_ROLES = {UserRole.SUPERVISOR, UserRole.SUPER_ADMIN}


def _require_manager(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in MANAGER_ROLES:
        raise HTTPException(403, "Требуется роль менеджера или выше")
    return current_user


def _require_supervisor(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in SUPERVISOR_ROLES:
        raise HTTPException(403, "Требуется роль руководителя или выше")
    return current_user


def _ici_out(inv: InterClinicInvoice, issuer_name: str | None = None, recipient_name: str | None = None) -> dict:
    return {
        "id": str(inv.id),
        "invoice_number": inv.invoice_number,
        "issuer_clinic_id": str(inv.issuer_clinic_id) if inv.issuer_clinic_id else None,
        "issuer_tenant_id": str(inv.issuer_tenant_id) if inv.issuer_tenant_id else None,
        "issuer_name": issuer_name,
        "recipient_clinic_id": str(inv.recipient_clinic_id) if inv.recipient_clinic_id else None,
        "recipient_tenant_id": str(inv.recipient_tenant_id) if inv.recipient_tenant_id else None,
        "recipient_name": recipient_name,
        "amount": float(inv.amount),
        "description": inv.description,
        "invoice_type": inv.invoice_type,
        "status": inv.status,
        "referral_id": str(inv.referral_id) if inv.referral_id else None,
        "due_date": inv.due_date.isoformat() if inv.due_date else None,
        "paid_at": inv.paid_at.isoformat() if inv.paid_at else None,
        "notes": inv.notes,
        "created_at": inv.created_at.isoformat(),
    }


async def _enrich(db: AsyncSession, invoices: list[InterClinicInvoice]) -> list[dict]:
    """Добавляет имена клиник к списку счетов."""
    clinic_ids = set()
    for inv in invoices:
        if inv.issuer_clinic_id:
            clinic_ids.add(inv.issuer_clinic_id)
        if inv.recipient_clinic_id:
            clinic_ids.add(inv.recipient_clinic_id)
    names: dict[uuid.UUID, str] = {}
    if clinic_ids:
        rows = await db.execute(select(Clinic).where(Clinic.id.in_(list(clinic_ids))))
        for c in rows.scalars().all():
            names[c.id] = c.name
    result = []
    for inv in invoices:
        result.append(_ici_out(
            inv,
            issuer_name=names.get(inv.issuer_clinic_id) if inv.issuer_clinic_id else None,
            recipient_name=names.get(inv.recipient_clinic_id) if inv.recipient_clinic_id else None,
        ))
    return result


# ── Входящие счета (тенант = плательщик) ─────────────────────────────────────
@router.get("/clinic-invoices/incoming")
async def incoming_invoices(
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.tenant_id:
        return []
    invs = await ici_svc.list_incoming(db, current_user.tenant_id, status=status, limit=limit, offset=offset)
    return await _enrich(db, invs)


# ── Исходящие счета (тенант = получатель оплаты) ─────────────────────────────
@router.get("/clinic-invoices/outgoing")
async def outgoing_invoices(
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.tenant_id:
        return []
    invs = await ici_svc.list_outgoing(db, current_user.tenant_id, status=status, limit=limit, offset=offset)
    return await _enrich(db, invs)


# ── Все счета тенанта (для руководителя) ─────────────────────────────────────
@router.get("/clinic-invoices/all")
async def all_clinic_invoices(
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(_require_supervisor),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == UserRole.SUPER_ADMIN:
        invs = await ici_svc.list_all_platform(db, status=status, limit=limit, offset=offset)
    else:
        if not current_user.tenant_id:
            return []
        invs = await ici_svc.list_all_for_tenant(db, current_user.tenant_id, status=status, limit=limit, offset=offset)
    return await _enrich(db, invs)


# ── Создать межклиничный счёт вручную ─────────────────────────────────────────
class CreateICIRequest(BaseModel):
    recipient_clinic_id: uuid.UUID
    amount: float
    description: str | None = None
    due_date: date | None = None
    notes: str | None = None


@router.post("/clinic-invoices", status_code=201)
async def create_clinic_invoice(
    body: CreateICIRequest,
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    # Получаем клинику выставителя (первая клиника тенанта пользователя)
    issuer_clinic = None
    if current_user.clinic_id:
        r = await db.execute(select(Clinic).where(Clinic.id == current_user.clinic_id))
        issuer_clinic = r.scalar_one_or_none()

    # Клиника получателя и её тенант
    r2 = await db.execute(select(Clinic).where(Clinic.id == body.recipient_clinic_id))
    recipient_clinic = r2.scalar_one_or_none()
    if not recipient_clinic:
        raise HTTPException(404, "Клиника получателя не найдена")

    inv = await ici_svc.create_inter_clinic_invoice(
        db,
        issuer_clinic_id=issuer_clinic.id if issuer_clinic else None,
        issuer_tenant_id=current_user.tenant_id,
        recipient_clinic_id=recipient_clinic.id,
        recipient_tenant_id=recipient_clinic.tenant_id,
        amount=body.amount,
        description=body.description,
        due_date=body.due_date,
        notes=body.notes,
        created_by_id=current_user.id,
        auto_send=True,
    )
    await db.commit()
    return _ici_out(inv,
        issuer_name=issuer_clinic.name if issuer_clinic else None,
        recipient_name=recipient_clinic.name,
    )


# ── Статусные переходы ────────────────────────────────────────────────────────
@router.patch("/clinic-invoices/{invoice_id}/send")
async def send_clinic_invoice(
    invoice_id: uuid.UUID,
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    inv = await ici_svc.mark_sent(db, invoice_id)
    if not inv:
        raise HTTPException(404, "Счёт не найден или уже отправлен")
    # IDOR: только выставитель может отправить
    if current_user.role != UserRole.SUPER_ADMIN:
        if str(inv.issuer_tenant_id) != str(current_user.tenant_id):
            raise HTTPException(403, "Нет доступа")
    await db.commit()
    return _ici_out(inv)


@router.patch("/clinic-invoices/{invoice_id}/pay")
async def pay_clinic_invoice(
    invoice_id: uuid.UUID,
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(select(InterClinicInvoice).where(InterClinicInvoice.id == invoice_id))
    inv = r.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Счёт не найден")
    # IDOR: только получатель (плательщик) или super_admin может подтвердить оплату
    if current_user.role != UserRole.SUPER_ADMIN:
        if str(inv.recipient_tenant_id) != str(current_user.tenant_id) and \
           str(inv.issuer_tenant_id) != str(current_user.tenant_id):
            raise HTTPException(403, "Нет доступа")
    inv = await ici_svc.mark_paid(db, invoice_id, paid_by_id=current_user.id)
    await db.commit()
    return _ici_out(inv)


@router.patch("/clinic-invoices/{invoice_id}/cancel")
async def cancel_clinic_invoice(
    invoice_id: uuid.UUID,
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(select(InterClinicInvoice).where(InterClinicInvoice.id == invoice_id))
    inv = r.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Счёт не найден")
    if current_user.role != UserRole.SUPER_ADMIN:
        if str(inv.issuer_tenant_id) != str(current_user.tenant_id):
            raise HTTPException(403, "Нет доступа")
    inv = await ici_svc.mark_cancelled(db, invoice_id)
    if not inv:
        raise HTTPException(409, "Счёт нельзя отменить в текущем статусе")
    await db.commit()
    return _ici_out(inv)


# ── Super admin: все счета платформы ─────────────────────────────────────────
@router.get("/admin/clinic-invoices")
async def admin_all_clinic_invoices(
    status: Optional[str] = Query(None),
    tenant_id: Optional[uuid.UUID] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Только super_admin")
    invs = await ici_svc.list_all_platform(db, status=status, tenant_id=tenant_id, limit=limit, offset=offset)
    return await _enrich(db, invs)
