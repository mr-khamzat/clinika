from typing import List, Optional
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from app.models.billing import Invoice, Subscription
from app.models.tenant import Tenant, TenantBranding
import uuid


ACT_OVERDUE_DAYS = 14
SOFT_LOCK_DAYS = 21


class ActsService:
    @staticmethod
    def _generate_act_number(tenant_slug: str, year: int, month: int, seq: int) -> str:
        return f"ACT-{year}-{month:02d}-{tenant_slug.upper()[:6]}-{seq:04d}"

    @staticmethod
    async def _get_next_seq(db: AsyncSession, year: int, month: int) -> int:
        prefix = f"ACT-{year}-{month:02d}-"
        result = await db.execute(
            select(func.count()).select_from(Invoice).where(
                Invoice.act_number.like(f"{prefix}%")
            )
        )
        return (result.scalar() or 0) + 1

    @staticmethod
    async def generate_monthly_act(
        db: AsyncSession,
        tenant_id: str,
        subscription: Subscription,
        year: int,
        month: int,
    ) -> Invoice:
        result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = result.scalar_one_or_none()
        if not tenant:
            raise ValueError(f"Tenant {tenant_id} not found")

        branding_r = await db.execute(
            select(TenantBranding).where(TenantBranding.tenant_id == tenant_id)
        )
        branding = branding_r.scalar_one_or_none()

        seq = await ActsService._get_next_seq(db, year, month)
        act_number = ActsService._generate_act_number(tenant.slug, year, month, seq)

        base_amount = subscription.amount_per_period or Decimal("0")
        line_items = [
            {
                "service": f"Подписка {subscription.plan} — {month:02d}/{year}",
                "qty": 1,
                "unit_price": float(base_amount),
                "amount": float(base_amount),
            }
        ]
        subtotal = base_amount
        tax_rate = Decimal("0")
        tax_amount = subtotal * tax_rate / 100
        total = subtotal + tax_amount

        from_date = datetime(year, month, 1)
        import calendar
        last_day = calendar.monthrange(year, month)[1]
        to_date = datetime(year, month, last_day)
        due_date = to_date + timedelta(days=10)

        inv_num = f"INV-{year}-{month:02d}-{tenant.slug.upper()[:6]}"

        existing = await db.execute(
            select(Invoice).where(Invoice.invoice_number == inv_num)
        )
        if existing.scalar_one_or_none():
            raise ValueError(f"Act {inv_num} already exists for {year}-{month:02d}")

        invoice = Invoice(
            id=uuid.uuid4(),
            subscription_id=subscription.id,
            tenant_id=tenant_id,
            invoice_number=inv_num,
            act_number=act_number,
            act_status="generated",
            act_type="subscription",
            status="sent",
            amount=float(total),
            subtotal=float(subtotal),
            tax_rate=float(tax_rate),
            tax_amount=float(tax_amount),
            total=float(total),
            period_start=from_date,
            period_end=to_date,
            due_date=due_date,
            line_items=line_items,
            act_line_items=line_items,
            legal_entity_name=branding.brand_name if branding else tenant.name,
            notes=f"Акт оказанных услуг за {month:02d}/{year}",
        )
        db.add(invoice)
        await db.commit()
        await db.refresh(invoice)
        return invoice

    @staticmethod
    async def sign_act(
        db: AsyncSession,
        invoice: Invoice,
        signer_name: str,
        signer_ip: str,
    ) -> Invoice:
        if invoice.act_status not in ("generated", "sent"):
            raise ValueError(f"Cannot sign act in status {invoice.act_status}")
        invoice.act_status = "signed"
        invoice.signed_at = datetime.utcnow()
        invoice.signer_name = signer_name
        invoice.signer_ip = signer_ip
        invoice.status = "sent"
        await db.commit()
        await db.refresh(invoice)
        return invoice

    @staticmethod
    async def mark_paid(db: AsyncSession, invoice: Invoice, amount: float) -> Invoice:
        invoice.act_status = "paid"
        invoice.status = "paid"
        invoice.paid_at = datetime.utcnow()
        invoice.paid_amount = amount
        await db.commit()
        await db.refresh(invoice)
        return invoice

    @staticmethod
    async def check_overdue(db: AsyncSession) -> List[Invoice]:
        now = datetime.utcnow()
        result = await db.execute(
            select(Invoice).where(
                and_(
                    Invoice.act_status.in_(["generated", "sent", "signed"]),
                    Invoice.due_date < now,
                    Invoice.overdue_notified_at.is_(None),
                )
            )
        )
        invoices = result.scalars().all()
        for inv in invoices:
            inv.act_status = "overdue"
            inv.status = "overdue"
            inv.overdue_notified_at = now
        await db.commit()
        return invoices

    @staticmethod
    async def apply_soft_lock(db: AsyncSession) -> List[Invoice]:
        now = datetime.utcnow()
        cutoff = now - timedelta(days=SOFT_LOCK_DAYS)
        result = await db.execute(
            select(Invoice).where(
                and_(
                    Invoice.act_status == "overdue",
                    Invoice.due_date < cutoff,
                    Invoice.soft_lock_applied_at.is_(None),
                )
            )
        )
        invoices = result.scalars().all()
        for inv in invoices:
            inv.soft_lock_applied_at = now
        await db.commit()
        return invoices

    @staticmethod
    async def list_acts(
        db: AsyncSession,
        tenant_id: Optional[str] = None,
        act_status: Optional[str] = None,
        limit: int = 50,
    ) -> List[Invoice]:
        q = select(Invoice).where(Invoice.act_number.isnot(None))
        if tenant_id:
            q = q.where(Invoice.tenant_id == tenant_id)
        if act_status:
            q = q.where(Invoice.act_status == act_status)
        q = q.order_by(Invoice.created_at.desc()).limit(limit)
        result = await db.execute(q)
        return result.scalars().all()
