"""
Сервис межклиничных счетов.
Логика создания, отправки и оплаты счетов между клиниками.
"""
import uuid
from datetime import datetime, date, timedelta
from decimal import Decimal
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inter_clinic_invoice import InterClinicInvoice, ICIStatus, ICIType


async def _next_ici_number(db: AsyncSession) -> str:
    year = datetime.utcnow().year
    count_result = await db.execute(
        select(func.count()).select_from(InterClinicInvoice)
        .where(func.extract('year', InterClinicInvoice.created_at) == year)
    )
    seq = (count_result.scalar() or 0) + 1
    return f"IC-{year}-{seq:05d}"


async def create_inter_clinic_invoice(
    db: AsyncSession,
    *,
    issuer_clinic_id: uuid.UUID | None,
    issuer_tenant_id: uuid.UUID | None,
    recipient_clinic_id: uuid.UUID | None,
    recipient_tenant_id: uuid.UUID | None,
    amount: float,
    description: str | None = None,
    invoice_type: str = ICIType.MANUAL,
    referral_id: uuid.UUID | None = None,
    due_date: date | None = None,
    notes: str | None = None,
    created_by_id: uuid.UUID | None = None,
    auto_send: bool = True,
) -> InterClinicInvoice:
    inv = InterClinicInvoice(
        invoice_number=await _next_ici_number(db),
        issuer_clinic_id=issuer_clinic_id,
        issuer_tenant_id=issuer_tenant_id,
        recipient_clinic_id=recipient_clinic_id,
        recipient_tenant_id=recipient_tenant_id,
        amount=Decimal(str(amount)),
        description=description,
        invoice_type=invoice_type,
        status=ICIStatus.SENT if auto_send else ICIStatus.DRAFT,
        referral_id=referral_id,
        due_date=due_date or (date.today() + timedelta(days=30)),
        notes=notes,
        created_by_id=created_by_id,
    )
    db.add(inv)
    await db.flush()
    return inv


async def mark_sent(db: AsyncSession, invoice_id: uuid.UUID) -> InterClinicInvoice | None:
    r = await db.execute(select(InterClinicInvoice).where(InterClinicInvoice.id == invoice_id))
    inv = r.scalar_one_or_none()
    if inv and inv.status == ICIStatus.DRAFT:
        inv.status = ICIStatus.SENT
        await db.flush()
    return inv


async def mark_paid(db: AsyncSession, invoice_id: uuid.UUID, paid_by_id: uuid.UUID | None = None) -> InterClinicInvoice | None:
    r = await db.execute(select(InterClinicInvoice).where(InterClinicInvoice.id == invoice_id))
    inv = r.scalar_one_or_none()
    if inv and inv.status in (ICIStatus.SENT, ICIStatus.DRAFT):
        inv.status = ICIStatus.PAID
        inv.paid_at = datetime.utcnow()
        await db.flush()
    return inv


async def mark_cancelled(db: AsyncSession, invoice_id: uuid.UUID) -> InterClinicInvoice | None:
    r = await db.execute(select(InterClinicInvoice).where(InterClinicInvoice.id == invoice_id))
    inv = r.scalar_one_or_none()
    if inv and inv.status not in (ICIStatus.PAID, ICIStatus.CANCELLED):
        inv.status = ICIStatus.CANCELLED
        await db.flush()
    return inv


async def list_incoming(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[InterClinicInvoice]:
    """Входящие счета — тенант является получателем (должен оплатить)."""
    q = select(InterClinicInvoice).where(InterClinicInvoice.recipient_tenant_id == tenant_id)
    if status:
        q = q.where(InterClinicInvoice.status == status)
    q = q.order_by(InterClinicInvoice.created_at.desc()).limit(limit).offset(offset)
    r = await db.execute(q)
    return r.scalars().all()


async def list_outgoing(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[InterClinicInvoice]:
    """Исходящие счета — тенант является выставителем (должен получить оплату)."""
    q = select(InterClinicInvoice).where(InterClinicInvoice.issuer_tenant_id == tenant_id)
    if status:
        q = q.where(InterClinicInvoice.status == status)
    q = q.order_by(InterClinicInvoice.created_at.desc()).limit(limit).offset(offset)
    r = await db.execute(q)
    return r.scalars().all()


async def list_all_for_tenant(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    status: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[InterClinicInvoice]:
    """Все счета тенанта (для руководителя): входящие + исходящие."""
    from sqlalchemy import or_
    q = select(InterClinicInvoice).where(
        or_(
            InterClinicInvoice.issuer_tenant_id == tenant_id,
            InterClinicInvoice.recipient_tenant_id == tenant_id,
        )
    )
    if status:
        q = q.where(InterClinicInvoice.status == status)
    q = q.order_by(InterClinicInvoice.created_at.desc()).limit(limit).offset(offset)
    r = await db.execute(q)
    return r.scalars().all()


async def list_all_platform(
    db: AsyncSession,
    status: str | None = None,
    tenant_id: uuid.UUID | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[InterClinicInvoice]:
    """Все счета на платформе — для super_admin."""
    from sqlalchemy import or_
    q = select(InterClinicInvoice)
    if tenant_id:
        q = q.where(
            or_(
                InterClinicInvoice.issuer_tenant_id == tenant_id,
                InterClinicInvoice.recipient_tenant_id == tenant_id,
            )
        )
    if status:
        q = q.where(InterClinicInvoice.status == status)
    q = q.order_by(InterClinicInvoice.created_at.desc()).limit(limit).offset(offset)
    r = await db.execute(q)
    return r.scalars().all()


async def auto_create_from_referral(
    db: AsyncSession,
    *,
    referral_id: uuid.UUID,
    from_clinic_id: uuid.UUID,
    from_tenant_id: uuid.UUID | None,
    to_clinic_id: uuid.UUID,
    to_tenant_id: uuid.UUID | None,
    bonus_amount: float,
    service_name: str | None = None,
    created_by_id: uuid.UUID | None = None,
) -> InterClinicInvoice | None:
    """Автоматически создаёт счёт при подтверждении направления.
    Выставитель = from_clinic (отправил пациента, получает бонус).
    Получатель = to_clinic (принял пациента, должен оплатить).
    """
    if not from_clinic_id or not to_clinic_id:
        return None
    if from_clinic_id == to_clinic_id:
        return None
    if bonus_amount <= 0:
        return None

    desc = f"Реферальный бонус за направление пациента"
    if service_name:
        desc += f" (услуга: {service_name})"

    return await create_inter_clinic_invoice(
        db,
        issuer_clinic_id=from_clinic_id,
        issuer_tenant_id=from_tenant_id,
        recipient_clinic_id=to_clinic_id,
        recipient_tenant_id=to_tenant_id,
        amount=bonus_amount,
        description=desc,
        invoice_type=ICIType.REFERRAL_BONUS,
        referral_id=referral_id,
        created_by_id=created_by_id,
        auto_send=True,
    )
