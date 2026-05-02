from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from app.database import get_db
from app.core.tenant import get_current_tenant
from app.services.acts_service import ActsService
from app.models.billing import Invoice, Subscription
from app.core.deps import get_current_user
from app.models.user import User
from sqlalchemy import select

router = APIRouter(prefix="/acts", tags=["acts"])


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
    db: AsyncSession = Depends(get_db),
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
    db: AsyncSession = Depends(get_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ("super_admin", "admin", "manager"):
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
    db: AsyncSession = Depends(get_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ("super_admin", "admin", "manager"):
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
