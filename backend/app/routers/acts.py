from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from app.database import get_db
from app.core.tenant import get_current_tenant
from app.services.acts_service import ActsService
from app.models.billing import Invoice, Subscription
from app.core.deps import get_current_user, get_tenant_db
from app.models.user import User
from sqlalchemy import select
import uuid as _uuid

router = APIRouter(prefix="/acts", tags=["acts"])

# Дополнительный роутер для алиаса /inter-clinic-acts (по требованию ТЗ).
# Реальная реализация — те же handlers с другим prefix.
inter_clinic_router = APIRouter(prefix="/inter-clinic-acts", tags=["acts"])


class GenerateActIn(BaseModel):
    year: int
    month: int


class SignActIn(BaseModel):
    signer_name: str


class PayActIn(BaseModel):
    amount: float


@router.get("/")
async def list_acts(
    act_status: Optional[str] = None,
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    tenant_id = None
    if current_user.role != "super_admin":
        if not tenant:
            raise HTTPException(403)
        tenant_id = str(tenant.id)
    return await ActsService.list_acts(db, tenant_id=tenant_id, act_status=act_status)


@router.post("/generate")
async def generate_act(
    data: GenerateActIn,
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ("super_admin", "reg", "manager"):
        raise HTTPException(403)
    if not tenant:
        raise HTTPException(400, "Tenant required")
    sub_r = await db.execute(
        select(Subscription).where(
            Subscription.tenant_id == tenant.id,
            Subscription.status.in_(["active", "trial"]),
        )
    )
    subscription = sub_r.scalars().first()
    if not subscription:
        raise HTTPException(400, "No active subscription")
    return await ActsService.generate_monthly_act(
        db, str(tenant.id), subscription, data.year, data.month
    )


@router.post("/{act_number}/sign")
async def sign_act(
    act_number: str,
    data: SignActIn,
    request: Request,
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ("super_admin", "reg", "manager"):
        raise HTTPException(403)
    inv_r = await db.execute(select(Invoice).where(Invoice.act_number == act_number))
    invoice = inv_r.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404)
    if tenant and str(invoice.tenant_id) != str(tenant.id) and current_user.role != "super_admin":
        raise HTTPException(403)
    client_ip = request.headers.get("x-real-ip") or request.client.host
    return await ActsService.sign_act(db, invoice, data.signer_name, client_ip)


@router.post("/{act_number}/pay")
async def pay_act(
    act_number: str,
    data: PayActIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "super_admin":
        raise HTTPException(403)
    inv_r = await db.execute(select(Invoice).where(Invoice.act_number == act_number))
    invoice = inv_r.scalar_one_or_none()
    if not invoice:
        raise HTTPException(404)
    return await ActsService.mark_paid(db, invoice, data.amount)


@router.post("/check-overdue")
async def run_overdue_check(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "super_admin":
        raise HTTPException(403)
    overdue = await ActsService.check_overdue(db)
    locks = await ActsService.apply_soft_lock(db)
    return {"overdue_marked": len(overdue), "soft_locks_applied": len(locks)}


# ─── PDF-генерация акта ──────────────────────────────────────────────────────
# Доступно для: super_admin (всегда), а также manager/reg/franchise_owner
# из тенанта-участника акта (исполнитель). Заказчик-получатель тоже может
# скачать PDF своего акта (роль manager+).
async def _resolve_invoice_for_pdf(db: AsyncSession, act_id: str) -> Invoice:
    """Найти инвойс по UUID или по act_number."""
    invoice: Optional[Invoice] = None
    try:
        uid = _uuid.UUID(str(act_id))
        r = await db.execute(select(Invoice).where(Invoice.id == uid))
        invoice = r.scalar_one_or_none()
    except (ValueError, TypeError):
        invoice = None
    if invoice is None:
        r = await db.execute(select(Invoice).where(Invoice.act_number == str(act_id)))
        invoice = r.scalar_one_or_none()
    if invoice is None:
        raise HTTPException(404, "Act not found")
    return invoice


def _can_access_act(invoice: Invoice, tenant, user: User) -> bool:
    """Право видеть/скачивать акт: super_admin / franchise_owner / manager+ из тенанта."""
    if user.role in ("super_admin", "franchise_owner"):
        return True
    if user.role not in ("manager", "reg", "admin"):
        return False
    if tenant and str(invoice.tenant_id) == str(tenant.id):
        return True
    return False


async def _act_pdf_response(db: AsyncSession, act_id: str, tenant, user: User) -> Response:
    invoice = await _resolve_invoice_for_pdf(db, act_id)
    if not _can_access_act(invoice, tenant, user):
        raise HTTPException(403, "Нет доступа к этому акту")
    try:
        pdf_bytes = await ActsService.generate_act_pdf(db, str(invoice.id))
    except Exception as e:
        raise HTTPException(500, f"PDF generation failed: {e}")
    filename = f"act_{invoice.act_number or invoice.invoice_number}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/{act_id}/pdf")
async def get_act_pdf(
    act_id: str,
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    return await _act_pdf_response(db, act_id, tenant, current_user)


@inter_clinic_router.get("/{act_id}/pdf")
async def get_inter_clinic_act_pdf(
    act_id: str,
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    """Алиас для совместимости с фронтом: /inter-clinic-acts/{act_id}/pdf"""
    return await _act_pdf_response(db, act_id, tenant, current_user)


# ─── Электронная подпись (упрощённая, internal) ─────────────────────────────
# Реальная КЭП и отправка в ФНС — отдельная задача (см. TODO в acts_service).
class ElectronicSignIn(BaseModel):
    pass  # Тело пустое — все нужные поля берём из request/user


@router.post("/{act_id}/sign-electronic")
async def sign_act_electronic(
    act_id: str,
    request: Request,
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    """
    Простая внутренняя ЭП: ставит signed_at = now(), фиксирует подписанта.
    TODO: интеграция с КЭП (Криптопро/КонтурСигн), отправка в ФНС.
    """
    if current_user.role not in ("super_admin", "franchise_owner", "reg", "manager"):
        raise HTTPException(403)
    invoice = await _resolve_invoice_for_pdf(db, act_id)
    if not _can_access_act(invoice, tenant, current_user):
        raise HTTPException(403, "Нет доступа к этому акту")
    client_ip = request.headers.get("x-real-ip") or (request.client.host if request.client else None)
    signer_name = current_user.full_name or current_user.username or f"user:{current_user.id}"
    return await ActsService.sign_act_electronic(
        db, invoice, str(current_user.id), signer_name, client_ip
    )


@inter_clinic_router.post("/{act_id}/sign-electronic")
async def sign_inter_clinic_act_electronic(
    act_id: str,
    request: Request,
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    """Алиас для совместимости: /inter-clinic-acts/{act_id}/sign-electronic"""
    return await sign_act_electronic(act_id, request, db, tenant, current_user)
