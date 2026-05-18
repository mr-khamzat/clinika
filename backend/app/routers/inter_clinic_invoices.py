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

MANAGER_ROLES = {UserRole.MANAGER, UserRole.SUPER_ADMIN}
SUPERVISOR_ROLES = {UserRole.SUPER_ADMIN}
# Кто может согласовать (approve/reject) счёт за бонусы. Бухгалтер — НЕТ.
APPROVER_ROLES = {
    UserRole.MANAGER,
    UserRole.FRANCHISE_OWNER,
    UserRole.DIRECTOR,
    UserRole.DEPUTY_DIRECTOR,
    UserRole.SUPER_ADMIN,
}
# Кто может оплатить согласованный счёт. Бухгалтер — основной актор.
PAYER_ROLES = {
    UserRole.ACCOUNTANT,
    UserRole.MANAGER,
    UserRole.FRANCHISE_OWNER,
    UserRole.DIRECTOR,
    UserRole.SUPER_ADMIN,
}


def _require_manager(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in MANAGER_ROLES:
        raise HTTPException(403, "Требуется роль менеджера или выше")
    return current_user


def _require_approver(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in APPROVER_ROLES:
        raise HTTPException(403, "Согласование доступно только руководителю клиники или выше")
    return current_user


def _require_payer(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in PAYER_ROLES:
        raise HTTPException(403, "Только бухгалтер/руководитель может отметить оплату")
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
        # Подпись согласовавшего (Phase: approval workflow)
        "approved_by_id": str(inv.approved_by_id) if getattr(inv, "approved_by_id", None) else None,
        "approved_at": inv.approved_at.isoformat() if getattr(inv, "approved_at", None) else None,
        "approved_by_name": getattr(inv, "approved_by_name", None),
        "approved_by_role": getattr(inv, "approved_by_role", None),
        "rejected_at": inv.rejected_at.isoformat() if getattr(inv, "rejected_at", None) else None,
        "rejection_reason": getattr(inv, "rejection_reason", None),
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

    # Уведомление админу при крупных счетах (>100k) — graceful
    try:
        if float(body.amount or 0) > 100_000:
            from app.services import alert_service
            await alert_service.notify_big_invoice(
                invoice_number=str(getattr(inv, "number", inv.id))[:64],
                amount=float(body.amount),
                issuer=(issuer_clinic.name if issuer_clinic else "—"),
                recipient=recipient_clinic.name,
                overdue=False,
            )
    except Exception:
        pass

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


@router.patch("/clinic-invoices/{invoice_id}/approve")
async def approve_clinic_invoice(
    invoice_id: uuid.UUID,
    current_user: User = Depends(_require_approver),
    db: AsyncSession = Depends(get_db),
):
    """Согласовать счёт. Право — у руководителя клиники-плательщика.
    Снэпшотим ФИО согласовавшего в approved_by_name (для подписи)."""
    r = await db.execute(select(InterClinicInvoice).where(InterClinicInvoice.id == invoice_id))
    inv = r.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Счёт не найден")
    if current_user.role != UserRole.SUPER_ADMIN:
        if str(inv.recipient_tenant_id) != str(current_user.tenant_id):
            raise HTTPException(403, "Согласовывать может только клиника-плательщик")
    if inv.status not in (ICIStatus.PENDING_APPROVAL, ICIStatus.SENT):
        raise HTTPException(409, f"Нельзя согласовать счёт в статусе {inv.status}")
    role_label = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
    inv = await ici_svc.mark_approved(
        db, invoice_id,
        approver_id=current_user.id,
        approver_name=current_user.full_name or current_user.username or "—",
        approver_role=role_label,
    )
    await db.commit()
    return _ici_out(inv)


@router.patch("/clinic-invoices/{invoice_id}/reject")
async def reject_clinic_invoice(
    invoice_id: uuid.UUID,
    body: dict | None = None,
    current_user: User = Depends(_require_approver),
    db: AsyncSession = Depends(get_db),
):
    """Отклонить счёт с указанием причины. Body: { reason?: str }."""
    r = await db.execute(select(InterClinicInvoice).where(InterClinicInvoice.id == invoice_id))
    inv = r.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Счёт не найден")
    if current_user.role != UserRole.SUPER_ADMIN:
        if str(inv.recipient_tenant_id) != str(current_user.tenant_id):
            raise HTTPException(403, "Отклонять может только клиника-плательщик")
    if inv.status not in (ICIStatus.PENDING_APPROVAL, ICIStatus.SENT):
        raise HTTPException(409, f"Нельзя отклонить счёт в статусе {inv.status}")
    reason = (body or {}).get("reason") if isinstance(body, dict) else None
    inv = await ici_svc.mark_rejected(db, invoice_id, reason=reason)
    await db.commit()
    return _ici_out(inv)


@router.patch("/clinic-invoices/{invoice_id}/pay")
async def pay_clinic_invoice(
    invoice_id: uuid.UUID,
    current_user: User = Depends(_require_payer),
    db: AsyncSession = Depends(get_db),
):
    """Отметить счёт оплаченным. Требует, чтобы был согласован руководителем
    (status='approved'). Legacy 'sent'/'draft' принимаем для обратной совместимости."""
    r = await db.execute(select(InterClinicInvoice).where(InterClinicInvoice.id == invoice_id))
    inv = r.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Счёт не найден")
    if current_user.role != UserRole.SUPER_ADMIN:
        if str(inv.recipient_tenant_id) != str(current_user.tenant_id) and \
           str(inv.issuer_tenant_id) != str(current_user.tenant_id):
            raise HTTPException(403, "Нет доступа")
    if inv.status not in (ICIStatus.APPROVED, ICIStatus.SENT, ICIStatus.DRAFT):
        raise HTTPException(409, f"Счёт нельзя оплатить из статуса {inv.status} — нужно сначала согласование")
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


# ── Загрузка печати (stamp) тенанта ──────────────────────────────────────────
import os, shutil
from fastapi import UploadFile, File

STAMP_DIR = "/app/uploads/stamps"

@router.post("/stamp/upload")
async def upload_stamp(
    file: UploadFile = File(...),
    current_user: User = Depends(_require_supervisor),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.tenant_id:
        raise HTTPException(400, "Тенант не определён")
    if file.content_type not in ("image/png", "image/jpeg", "image/jpg"):
        raise HTTPException(400, "Только PNG или JPEG")
    os.makedirs(STAMP_DIR, exist_ok=True)
    ext = "png" if "png" in (file.content_type or "") else "jpg"
    filename = f"{current_user.tenant_id}.{ext}"
    path = f"{STAMP_DIR}/{filename}"
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    stamp_url = f"/uploads/stamps/{filename}"
    from app.models.tenant import Tenant
    r = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    tenant = r.scalar_one_or_none()
    if tenant:
        tenant.stamp_url = stamp_url
        await db.commit()
    return {"ok": True, "stamp_url": stamp_url}


# ── Получить данные акта (для печати) ─────────────────────────────────────────
@router.get("/clinic-invoices/{invoice_id}/act")
async def get_invoice_act(
    invoice_id: uuid.UUID,
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(select(InterClinicInvoice).where(InterClinicInvoice.id == invoice_id))
    inv = r.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Счёт не найден")
    if current_user.role != UserRole.SUPER_ADMIN:
        if str(inv.issuer_tenant_id) != str(current_user.tenant_id) and \
           str(inv.recipient_tenant_id) != str(current_user.tenant_id):
            raise HTTPException(403, "Нет доступа")

    from app.models.tenant import Tenant
    from app.models.clinic import Clinic

    # Реквизиты выставителя
    issuer_tenant, recipient_tenant = None, None
    issuer_clinic, recipient_clinic = None, None

    if inv.issuer_tenant_id:
        rt = await db.execute(select(Tenant).where(Tenant.id == inv.issuer_tenant_id))
        issuer_tenant = rt.scalar_one_or_none()
    if inv.recipient_tenant_id:
        rt = await db.execute(select(Tenant).where(Tenant.id == inv.recipient_tenant_id))
        recipient_tenant = rt.scalar_one_or_none()
    if inv.issuer_clinic_id:
        rc = await db.execute(select(Clinic).where(Clinic.id == inv.issuer_clinic_id))
        issuer_clinic = rc.scalar_one_or_none()
    if inv.recipient_clinic_id:
        rc = await db.execute(select(Clinic).where(Clinic.id == inv.recipient_clinic_id))
        recipient_clinic = rc.scalar_one_or_none()

    def tenant_req(t):
        if not t:
            return {}
        return {
            "name": t.legal_name or t.name,
            "inn": t.legal_inn,
            "kpp": t.legal_kpp,
            "ogrn": t.legal_ogrn,
            "address": t.legal_address,
            "phone": t.legal_phone,
            "email": t.legal_email,
            "bank_name": t.legal_bank_name,
            "bank_account": t.legal_bank_account,
            "bank_bik": t.legal_bank_bik,
            "bank_corr": t.legal_bank_corr,
            "signer_name": t.legal_signer_name,
            "signer_pos": t.legal_signer_pos,
            "stamp_url": t.stamp_url,
        }

    return {
        "invoice": _ici_out(inv,
            issuer_name=issuer_clinic.name if issuer_clinic else (issuer_tenant.name if issuer_tenant else None),
            recipient_name=recipient_clinic.name if recipient_clinic else (recipient_tenant.name if recipient_tenant else None),
        ),
        "issuer": tenant_req(issuer_tenant),
        "recipient": tenant_req(recipient_tenant),
    }


# ── Обновить реквизиты тенанта ────────────────────────────────────────────────
from pydantic import BaseModel as PB
class RequisitesBody(PB):
    legal_kpp: str | None = None
    legal_ogrn: str | None = None
    legal_phone: str | None = None
    legal_email: str | None = None
    legal_bank_name: str | None = None
    legal_bank_account: str | None = None
    legal_bank_bik: str | None = None
    legal_bank_corr: str | None = None
    legal_signer_name: str | None = None
    legal_signer_pos: str | None = None

@router.patch("/requisites")
async def update_requisites(
    body: RequisitesBody,
    current_user: User = Depends(_require_supervisor),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.tenant_id:
        raise HTTPException(400, "Тенант не определён")
    from app.models.tenant import Tenant
    r = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    tenant = r.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404)
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(tenant, field, val)
    await db.commit()
    return {"ok": True}


# ── Статические файлы печатей ─────────────────────────────────────────────────
from fastapi.responses import FileResponse

@router.get("/stamps/{filename}")
async def get_stamp(filename: str, current_user: User = Depends(_require_manager)):
    # Phase 0: защита от path traversal — только базовое имя без слэшей и .. 
    import re as _re
    if not _re.match(r"^[A-Za-z0-9_\-\.]+$", filename) or ".." in filename:
        raise HTTPException(400, "Неверное имя файла")
    safe_name = os.path.basename(filename)
    path = os.path.realpath(os.path.join(STAMP_DIR, safe_name))
    # Финальная защита: убедиться что path внутри STAMP_DIR
    if not path.startswith(os.path.realpath(STAMP_DIR) + os.sep):
        raise HTTPException(400, "Path traversal")
    if not os.path.exists(path):
        raise HTTPException(404, "Печать не найдена")
    return FileResponse(path)


# ── Получить реквизиты текущего тенанта ───────────────────────────────────────
@router.get('/requisites')
async def get_requisites(
    current_user: User = Depends(_require_supervisor),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.tenant_id:
        raise HTTPException(400, 'Тенант не определён')
    from app.models.tenant import Tenant
    r = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    t = r.scalar_one_or_none()
    if not t:
        raise HTTPException(404)
    return {
        'legal_name': t.legal_name, 'legal_inn': t.legal_inn,
        'legal_kpp': t.legal_kpp, 'legal_ogrn': t.legal_ogrn,
        'legal_address': t.legal_address, 'legal_phone': t.legal_phone,
        'legal_email': t.legal_email, 'legal_bank_name': t.legal_bank_name,
        'legal_bank_account': t.legal_bank_account, 'legal_bank_bik': t.legal_bank_bik,
        'legal_bank_corr': t.legal_bank_corr, 'legal_signer_name': t.legal_signer_name,
        'legal_signer_pos': t.legal_signer_pos, 'stamp_url': t.stamp_url,
    }
