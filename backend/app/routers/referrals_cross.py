"""
Cross-clinic referrals — направление пациента из одной клиники сети в другую
внутри одной франшизы (xref01).

Жизненный цикл (cross_clinic_status):
    pending_target_accept  — отправлено, клиника-получатель ещё не подтвердила
    accepted               — клиника-получатель приняла, ждёт пациента
    rejected               — клиника-получатель отклонила
    completed              — услуга оказана, можно генерировать счёт
    canceled               — отменено отправителем (для будущего)

Логика разделена от обычного ReferralStatus, чтобы не ломать существующий
QR-флоу. В Referral заполняются target_tenant_id, referred_by_tenant_id и
cross_clinic_status — этого достаточно для всех ролей.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User
from app.models.tenant import Tenant
from app.models.clinic import Clinic
from app.models.referral import Referral, ReferralStatus
from app.models.inter_clinic_invoice import InterClinicInvoice, ICIStatus, ICIType


router = APIRouter(prefix="/referrals-cross", tags=["referrals-cross"])


# ── Pydantic схемы ─────────────────────────────────────────────────────────
class FranchiseClinicOut(BaseModel):
    tenant_id: uuid.UUID
    name: str
    slug: str
    is_head_clinic: bool


class SendReferralIn(BaseModel):
    patient_phone: str
    target_tenant_id: uuid.UUID
    service_id: Optional[uuid.UUID] = None
    doctor_id: Optional[uuid.UUID] = None
    patient_name: Optional[str] = None
    note: Optional[str] = None


class RejectIn(BaseModel):
    note: str


class CompleteIn(BaseModel):
    amount: Optional[Decimal] = None   # сумма авто-счёта (если задана)
    description: Optional[str] = None


class CrossReferralOut(BaseModel):
    id: uuid.UUID
    patient_phone: str
    patient_name: Optional[str]
    service_id: Optional[uuid.UUID]
    target_tenant_id: Optional[uuid.UUID]
    referred_by_tenant_id: Optional[uuid.UUID]
    cross_clinic_status: Optional[str]
    cross_clinic_note: Optional[str]
    inter_clinic_invoice_id: Optional[uuid.UUID]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Хелперы ────────────────────────────────────────────────────────────────
async def _current_tenant(db: AsyncSession, user: User) -> Tenant:
    """Текущий тенант пользователя. 400 если у юзера нет tenant_id."""
    if not user.tenant_id:
        raise HTTPException(400, "У текущего пользователя не задан tenant_id")
    t = (await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Тенант не найден")
    return t


async def _first_clinic_of_tenant(db: AsyncSession, tenant_id: uuid.UUID) -> Optional[Clinic]:
    """Первая клиника тенанта — для заполнения NOT NULL поля to_clinic_id."""
    return (
        await db.execute(select(Clinic).where(Clinic.tenant_id == tenant_id).limit(1))
    ).scalar_one_or_none()


async def _get_referral_or_404(db: AsyncSession, ref_id: uuid.UUID) -> Referral:
    r = (await db.execute(select(Referral).where(Referral.id == ref_id))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Направление не найдено")
    return r


# ── 1. Список клиник той же франшизы (для UI выбора target) ───────────────
@router.get("/franchise-clinics", response_model=List[FranchiseClinicOut])
async def list_franchise_clinics(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    me = await _current_tenant(db, user)
    if not me.franchise_id:
        # Тенант не во франшизе — единственная клиника, направлять некуда
        return []
    rows = (
        await db.execute(
            select(Tenant)
            .where(
                and_(
                    Tenant.franchise_id == me.franchise_id,
                    Tenant.id != me.id,
                    Tenant.is_active == True,  # noqa: E712
                )
            )
            .order_by(Tenant.is_head_clinic.desc(), Tenant.name.asc())
        )
    ).scalars().all()
    return [
        FranchiseClinicOut(
            tenant_id=t.id,
            name=t.name,
            slug=t.slug,
            is_head_clinic=bool(t.is_head_clinic),
        )
        for t in rows
    ]


# ── 2. Отправка направления в другую клинику ──────────────────────────────
@router.post("/send", response_model=CrossReferralOut)
async def send_cross_referral(
    body: SendReferralIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    me = await _current_tenant(db, user)
    if body.target_tenant_id == me.id:
        raise HTTPException(400, "Нельзя направить пациента в собственную клинику")

    target = (
        await db.execute(select(Tenant).where(Tenant.id == body.target_tenant_id))
    ).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Клиника-получатель не найдена")
    if target.franchise_id != me.franchise_id or not me.franchise_id:
        raise HTTPException(403, "Клиника-получатель не входит в вашу франшизу")
    if not target.is_active:
        raise HTTPException(400, "Клиника-получатель деактивирована")

    # Для NOT NULL ограничения to_clinic_id берём первую клинику target тенанта.
    # from_clinic_id опционально (nullable) — берём первую клинику своего тенанта.
    to_clinic = await _first_clinic_of_tenant(db, target.id)
    if not to_clinic:
        raise HTTPException(400, "У клиники-получателя не настроена ни одна clinic-запись")
    from_clinic = await _first_clinic_of_tenant(db, me.id)

    ref = Referral(
        tenant_id=me.id,                 # пока остаётся за отправителем; accept переключит
        from_clinic_id=from_clinic.id if from_clinic else None,
        to_clinic_id=to_clinic.id,
        service_id=body.service_id,
        referral_type="doctor" if body.doctor_id else "service",
        target_doctor_id=body.doctor_id,
        patient_phone=body.patient_phone,
        patient_name=body.patient_name,
        created_by_admin_id=user.id,
        status=ReferralStatus.CREATED,
        target_tenant_id=target.id,
        referred_by_tenant_id=me.id,
        cross_clinic_status="pending_target_accept",
        cross_clinic_note=body.note,
    )
    db.add(ref)
    await db.commit()
    await db.refresh(ref)
    return ref


# ── 3. Исходящие направления (которые я отправил) ──────────────────────────
@router.get("/outgoing", response_model=List[CrossReferralOut])
async def list_outgoing(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    me = await _current_tenant(db, user)
    rows = (
        await db.execute(
            select(Referral)
            .where(Referral.referred_by_tenant_id == me.id)
            .where(Referral.cross_clinic_status.is_not(None))
            .order_by(Referral.created_at.desc())
            .limit(500)
        )
    ).scalars().all()
    return rows


# ── 4. Входящие направления (которые ко мне пришли, ждут accept) ──────────
@router.get("/incoming", response_model=List[CrossReferralOut])
async def list_incoming(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    me = await _current_tenant(db, user)
    rows = (
        await db.execute(
            select(Referral)
            .where(Referral.target_tenant_id == me.id)
            .where(Referral.cross_clinic_status == "pending_target_accept")
            .order_by(Referral.created_at.desc())
            .limit(500)
        )
    ).scalars().all()
    return rows


# ── 5. Accept — target принимает направление ───────────────────────────────
@router.post("/{ref_id}/accept", response_model=CrossReferralOut)
async def accept_cross_referral(
    ref_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    me = await _current_tenant(db, user)
    ref = await _get_referral_or_404(db, ref_id)
    if ref.target_tenant_id != me.id:
        raise HTTPException(403, "Это направление адресовано не вам")
    if ref.cross_clinic_status != "pending_target_accept":
        raise HTTPException(409, f"Направление уже в статусе {ref.cross_clinic_status}")

    ref.cross_clinic_status = "accepted"
    # Переключаем владение тенантом — пациент теперь работает с target-клиникой,
    # но журнал referred_by_tenant_id остаётся для статистики/счетов.
    ref.tenant_id = me.id
    await db.commit()
    await db.refresh(ref)
    return ref


# ── 6. Reject — target отказывает (с причиной) ─────────────────────────────
@router.post("/{ref_id}/reject", response_model=CrossReferralOut)
async def reject_cross_referral(
    ref_id: uuid.UUID,
    body: RejectIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    me = await _current_tenant(db, user)
    ref = await _get_referral_or_404(db, ref_id)
    if ref.target_tenant_id != me.id:
        raise HTTPException(403, "Это направление адресовано не вам")
    if ref.cross_clinic_status not in ("pending_target_accept", "accepted"):
        raise HTTPException(409, f"Нельзя отклонить из статуса {ref.cross_clinic_status}")

    ref.cross_clinic_status = "rejected"
    # Добавим причину, не затирая предыдущую заметку
    prev = (ref.cross_clinic_note or "").strip()
    suffix = f"[Отказ {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}] {body.note}"
    ref.cross_clinic_note = f"{prev}\n{suffix}" if prev else suffix
    await db.commit()
    await db.refresh(ref)
    return ref


# ── 7. Complete — услуга оказана, опционально генерим InterClinicInvoice ──
@router.post("/{ref_id}/complete", response_model=CrossReferralOut)
async def complete_cross_referral(
    ref_id: uuid.UUID,
    body: CompleteIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    me = await _current_tenant(db, user)
    ref = await _get_referral_or_404(db, ref_id)
    if ref.target_tenant_id != me.id:
        raise HTTPException(403, "Это направление адресовано не вам")
    if ref.cross_clinic_status not in ("accepted", "pending_target_accept"):
        raise HTTPException(409, f"Нельзя завершить из статуса {ref.cross_clinic_status}")

    ref.cross_clinic_status = "completed"

    # Авто-счёт между клиниками (если сумма передана) — issuer=target (мы получили
    # пациента и оказали услугу), recipient=referred_by (клиника-отправитель
    # получит компенсацию через списание/перечисление по договору франшизы).
    # Партиальный UNIQUE на referral_id защищает от дубликатов.
    if body.amount is not None and body.amount > 0 and not ref.inter_clinic_invoice_id:
        inv = InterClinicInvoice(
            invoice_number=f"XREF-{datetime.utcnow().strftime('%Y%m%d')}-{str(ref.id)[:8]}",
            issuer_tenant_id=me.id,
            recipient_tenant_id=ref.referred_by_tenant_id,
            amount=body.amount,
            description=body.description or f"Cross-clinic referral {ref.id}",
            invoice_type=ICIType.REFERRAL_BONUS,
            status=ICIStatus.PENDING_APPROVAL,
            referral_id=ref.id,
            created_by_id=user.id,
        )
        db.add(inv)
        await db.flush()
        ref.inter_clinic_invoice_id = inv.id

    await db.commit()
    await db.refresh(ref)
    return ref
