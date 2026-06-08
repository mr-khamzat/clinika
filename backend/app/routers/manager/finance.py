# ===== БЛОК: Финансы менеджера (3 таба) =====
# /manager/finance/platform   — счета от платформы (FranchiseInvoice → клиника)
# /manager/finance/cross-clinic — InterClinicInvoice (входящие + исходящие)
# /manager/finance/bonuses    — агрегация бонусов сотрудников
# /manager/finance/invoices/{id}/mark-paid — пометить счёт оплаченным
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager, get_tenant_db
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.franchise import Franchise
from app.models.franchise_invoice import FranchiseInvoice, InvoiceStatus
from app.models.inter_clinic_invoice import InterClinicInvoice, ICIStatus
from app.models.bonus import Bonus, BonusStatus
from app.models.clinic import Clinic

router = APIRouter(tags=["manager:finance"])


def _fr_invoice_out(inv: FranchiseInvoice) -> dict:
    """Сериализация FranchiseInvoice."""
    is_overdue = bool(
        inv.status == InvoiceStatus.PENDING
        and inv.due_date
        and inv.due_date < datetime.utcnow()
    )
    return {
        "id": str(inv.id),
        "number": inv.number,
        "franchise_id": str(inv.franchise_id),
        "period_start": inv.period_start.isoformat() if inv.period_start else None,
        "period_end": inv.period_end.isoformat() if inv.period_end else None,
        "bonuses_count": inv.bonuses_count,
        "total_amount": float(inv.total_amount or 0),
        "status": inv.status,
        "is_overdue": is_overdue,
        "due_date": inv.due_date.isoformat() if inv.due_date else None,
        "paid_at": inv.paid_at.isoformat() if inv.paid_at else None,
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
    }


# ── Платформе (FranchiseInvoice от платформы → текущей клинике) ─────────────
@router.get("/finance/platform")
async def list_platform_invoices(
    status: Optional[str] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Счета от платформы текущему тенанту (через franchise_id тенанта).
    super_admin без tenant_id видит все счета платформы.
    """
    q = select(FranchiseInvoice)

    if current_user.tenant_id:
        # Находим franchise_id тенанта.
        tenant_q = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
        tenant = tenant_q.scalar_one_or_none()
        if not tenant or not tenant.franchise_id:
            return []
        q = q.where(FranchiseInvoice.franchise_id == tenant.franchise_id)

    if status:
        q = q.where(FranchiseInvoice.status == status)

    q = q.order_by(FranchiseInvoice.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return [_fr_invoice_out(inv) for inv in rows]


# ── Клиникам сети (InterClinicInvoice) ───────────────────────────────────────
@router.get("/finance/cross-clinic")
async def list_cross_clinic_invoices(
    status: Optional[str] = Query(None),
    direction: Optional[str] = Query(None, pattern=r"^(incoming|outgoing)?$"),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Межклиничные счета: incoming (плательщик), outgoing (получатель), либо оба."""
    if not current_user.tenant_id:
        # super_admin без tenant_id — список всех счетов платформы.
        q = select(InterClinicInvoice)
    else:
        if direction == "incoming":
            q = select(InterClinicInvoice).where(InterClinicInvoice.recipient_tenant_id == current_user.tenant_id)
        elif direction == "outgoing":
            q = select(InterClinicInvoice).where(InterClinicInvoice.issuer_tenant_id == current_user.tenant_id)
        else:
            q = select(InterClinicInvoice).where(
                or_(
                    InterClinicInvoice.issuer_tenant_id == current_user.tenant_id,
                    InterClinicInvoice.recipient_tenant_id == current_user.tenant_id,
                )
            )
    if status:
        q = q.where(InterClinicInvoice.status == status)
    q = q.order_by(InterClinicInvoice.created_at.desc())
    invs = (await db.execute(q)).scalars().all()

    # Подгружаем имена клиник.
    clinic_ids = set()
    for inv in invs:
        if inv.issuer_clinic_id:
            clinic_ids.add(inv.issuer_clinic_id)
        if inv.recipient_clinic_id:
            clinic_ids.add(inv.recipient_clinic_id)
    names: dict = {}
    if clinic_ids:
        rows = await db.execute(select(Clinic).where(Clinic.id.in_(list(clinic_ids))))
        for c in rows.scalars().all():
            names[c.id] = c.name

    # Сводка по тотальным.
    incoming_total = 0.0
    outgoing_total = 0.0
    incoming_unpaid = 0.0
    outgoing_unpaid = 0.0

    out = []
    for inv in invs:
        is_incoming = (str(inv.recipient_tenant_id) == str(current_user.tenant_id)) if current_user.tenant_id else False
        is_outgoing = (str(inv.issuer_tenant_id) == str(current_user.tenant_id)) if current_user.tenant_id else False
        amount = float(inv.amount or 0)
        if is_incoming:
            incoming_total += amount
            if inv.status not in (ICIStatus.PAID, ICIStatus.CANCELLED):
                incoming_unpaid += amount
        if is_outgoing:
            outgoing_total += amount
            if inv.status not in (ICIStatus.PAID, ICIStatus.CANCELLED):
                outgoing_unpaid += amount
        out.append({
            "id": str(inv.id),
            "invoice_number": inv.invoice_number,
            "amount": amount,
            "status": inv.status,
            "invoice_type": inv.invoice_type,
            "issuer_clinic_id": str(inv.issuer_clinic_id) if inv.issuer_clinic_id else None,
            "issuer_name": names.get(inv.issuer_clinic_id) if inv.issuer_clinic_id else None,
            "recipient_clinic_id": str(inv.recipient_clinic_id) if inv.recipient_clinic_id else None,
            "recipient_name": names.get(inv.recipient_clinic_id) if inv.recipient_clinic_id else None,
            "issuer_tenant_id": str(inv.issuer_tenant_id) if inv.issuer_tenant_id else None,
            "recipient_tenant_id": str(inv.recipient_tenant_id) if inv.recipient_tenant_id else None,
            "referral_id": str(inv.referral_id) if inv.referral_id else None,
            "due_date": inv.due_date.isoformat() if inv.due_date else None,
            "paid_at": inv.paid_at.isoformat() if inv.paid_at else None,
            "created_at": inv.created_at.isoformat(),
            "description": inv.description,
            "is_incoming": is_incoming,
            "is_outgoing": is_outgoing,
        })

    return {
        "items": out,
        "summary": {
            "incoming_total": incoming_total,
            "outgoing_total": outgoing_total,
            "incoming_unpaid": incoming_unpaid,
            "outgoing_unpaid": outgoing_unpaid,
            "net_balance": outgoing_total - incoming_total,
        },
    }


# ── Сотрудникам (агрегация Bonus) ────────────────────────────────────────────
@router.get("/finance/bonuses")
async def list_bonus_aggregation(
    status: Optional[str] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Агрегация бонусов по сотрудникам — для таба «Сотрудникам».

    RLS defense-in-depth (#1, Часть B): через get_tenant_db сессия несёт
    app.tenant_id менеджера — User/Bonus уже изолированы на уровне БД,
    что совпадает с ручным фильтром Bonus.tenant_id == current_user.tenant_id.
    super_admin (по роли) → пустой контекст → видит все (как и было).
    """
    from app.models.user import User as UserModel
    q = (
        select(
            UserModel.id,
            UserModel.full_name,
            UserModel.role,
            func.coalesce(func.sum(Bonus.amount), 0).label("total_amount"),
            func.count(Bonus.id).label("bonus_count"),
            func.coalesce(
                func.sum(
                    func.cast(
                        Bonus.status == BonusStatus.PENDING, type_=__import__("sqlalchemy").Integer
                    ) * Bonus.amount
                ),
                0,
            ).label("pending_amount"),
            func.coalesce(
                func.sum(
                    func.cast(
                        Bonus.status == BonusStatus.PAID, type_=__import__("sqlalchemy").Integer
                    ) * Bonus.amount
                ),
                0,
            ).label("paid_amount"),
        )
        .join(Bonus, Bonus.admin_id == UserModel.id)
        .group_by(UserModel.id, UserModel.full_name, UserModel.role)
    )
    if current_user.tenant_id:
        q = q.where(Bonus.tenant_id == current_user.tenant_id)
    if current_user.clinic_id is not None:
        # bonuses через admin_id → ограничим админами своей клиники
        from sqlalchemy import select as _sel_fin
        admin_ids_subq = _sel_fin(User.id).where(User.clinic_id == current_user.clinic_id)
        q = q.where(Bonus.admin_id.in_(admin_ids_subq))
    if status:
        q = q.where(Bonus.status == status)
    q = q.order_by(func.coalesce(func.sum(Bonus.amount), 0).desc())
    rows = (await db.execute(q)).all()
    return [
        {
            "user_id": str(r.id),
            "full_name": r.full_name,
            "role": getattr(r.role, "value", r.role) if r.role else None,
            "total_amount": float(r.total_amount or 0),
            "pending_amount": float(r.pending_amount or 0),
            "paid_amount": float(r.paid_amount or 0),
            "bonus_count": int(r.bonus_count or 0),
        }
        for r in rows
    ]


# ── Пометить счёт оплаченным (FranchiseInvoice или InterClinicInvoice) ───────
@router.post("/finance/invoices/{invoice_id}/mark-paid")
async def mark_invoice_paid(
    invoice_id: uuid.UUID,
    invoice_kind: str = Query(..., pattern=r"^(franchise|cross_clinic)$"),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Пометить счёт оплаченным.
    invoice_kind=franchise — FranchiseInvoice (от платформы тенанту).
    invoice_kind=cross_clinic — InterClinicInvoice (между клиниками).
    """
    if invoice_kind == "franchise":
        r = await db.execute(select(FranchiseInvoice).where(FranchiseInvoice.id == invoice_id))
        inv = r.scalar_one_or_none()
        if not inv:
            raise HTTPException(404, "Счёт не найден")
        # Проверяем доступ: владелец тенанта в этой франшизе или super_admin.
        if current_user.role != UserRole.SUPER_ADMIN:
            if not current_user.tenant_id:
                raise HTTPException(403, "Нет доступа")
            tenant_q = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
            tenant = tenant_q.scalar_one_or_none()
            if not tenant or tenant.franchise_id != inv.franchise_id:
                raise HTTPException(403, "Нет доступа к этому счёту")
        if inv.status == InvoiceStatus.PAID:
            return _fr_invoice_out(inv)
        inv.status = InvoiceStatus.PAID
        inv.paid_at = datetime.utcnow()
        await db.commit()
        await db.refresh(inv)
        # Аудит.
        try:
            from app.services import audit_service
            await audit_service.write_safe(
                db,
                "franchise_invoice.paid",
                actor_id=current_user.id,
                tenant_id=current_user.tenant_id,
                entity_type="franchise_invoice",
                entity_id=inv.id,
                after={"amount": float(inv.total_amount), "number": inv.number},
            )
        except Exception:
            pass
        return _fr_invoice_out(inv)

    # cross_clinic
    r = await db.execute(select(InterClinicInvoice).where(InterClinicInvoice.id == invoice_id))
    inv = r.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Счёт не найден")
    if current_user.role != UserRole.SUPER_ADMIN:
        if str(inv.recipient_tenant_id) != str(current_user.tenant_id) and \
           str(inv.issuer_tenant_id) != str(current_user.tenant_id):
            raise HTTPException(403, "Нет доступа к этому счёту")
    if inv.status == ICIStatus.PAID:
        return {"id": str(inv.id), "status": inv.status, "paid_at": inv.paid_at.isoformat() if inv.paid_at else None}
    inv.status = ICIStatus.PAID
    inv.paid_at = datetime.utcnow()
    await db.commit()
    await db.refresh(inv)
    try:
        from app.services import audit_service
        await audit_service.write_safe(
            db,
            "inter_clinic_invoice.paid",
            actor_id=current_user.id,
            tenant_id=current_user.tenant_id,
            entity_type="inter_clinic_invoice",
            entity_id=inv.id,
            after={"amount": float(inv.amount), "number": inv.invoice_number},
        )
    except Exception:
        pass
    return {"id": str(inv.id), "status": inv.status, "paid_at": inv.paid_at.isoformat() if inv.paid_at else None}


# ─────────────────────────────────────────────────────────────────────────────
# BillingLedger — журнал биллинг-операций франшизы (append-only)
# GET /manager/billing/ledger?from=&to=&type=&clinic_id=&page=&limit=
# Возвращает: {items, page, total, totals: {gross, net, by_type}}
#
# Доступ: manager / franchise_owner / super_admin (require_manager уже допускает всё).
# Фильтрация по tenant_id текущего пользователя (super_admin без tenant_id видит всё).
# ─────────────────────────────────────────────────────────────────────────────
from app.models.billing_ledger import BillingLedger, Direction as _LedgerDirection


@router.get("/billing/ledger")
async def list_billing_ledger(
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    type: Optional[str] = Query(None, description="Фильтр по entry_type"),
    clinic_id: Optional[uuid.UUID] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Журнал биллинг-операций франшизы.

    - Фильтры: даты (from/to ISO), тип операции (entry_type), клиника.
    - Пагинация: page (1-based) + limit (max 500).
    - Тоталы считаются по ВСЕЙ выборке (после фильтров), не по странице.
    """
    filters = []
    # Тенантная изоляция — super_admin без tenant_id видит весь платформенный лог.
    if current_user.tenant_id is not None:
        filters.append(BillingLedger.tenant_id == current_user.tenant_id)

    # Даты (ISO 8601, время опционально).
    if from_date:
        try:
            filters.append(BillingLedger.created_at >= datetime.fromisoformat(from_date))
        except ValueError:
            raise HTTPException(400, "Некорректный формат 'from' (ISO 8601)")
    if to_date:
        try:
            # Если передана только дата — берём до 23:59:59 включительно.
            dt = datetime.fromisoformat(to_date)
            if len(to_date) <= 10:
                dt = dt.replace(hour=23, minute=59, second=59)
            filters.append(BillingLedger.created_at <= dt)
        except ValueError:
            raise HTTPException(400, "Некорректный формат 'to' (ISO 8601)")
    if type:
        filters.append(BillingLedger.entry_type == type)
    if clinic_id:
        filters.append(BillingLedger.clinic_id == clinic_id)

    where = and_(*filters) if filters else True

    # Тоталы (total count + gross/net/by_type) по всей выборке.
    total_q = await db.execute(select(func.count(BillingLedger.id)).where(where))
    total = int(total_q.scalar() or 0)

    # gross: сумма всех direction=credit (поступления платформе/тенанту).
    # net = credit - debit.
    gross_q = await db.execute(
        select(func.coalesce(func.sum(BillingLedger.amount), 0))
        .where(and_(where, BillingLedger.direction == _LedgerDirection.CREDIT))
    )
    gross = float(gross_q.scalar() or 0)

    debit_q = await db.execute(
        select(func.coalesce(func.sum(BillingLedger.amount), 0))
        .where(and_(where, BillingLedger.direction == _LedgerDirection.DEBIT))
    )
    debit = float(debit_q.scalar() or 0)
    net = gross - debit

    by_type_q = await db.execute(
        select(
            BillingLedger.entry_type,
            BillingLedger.direction,
            func.coalesce(func.sum(BillingLedger.amount), 0).label("sum"),
            func.count(BillingLedger.id).label("cnt"),
        )
        .where(where)
        .group_by(BillingLedger.entry_type, BillingLedger.direction)
    )
    by_type: dict = {}
    for row in by_type_q.all():
        bucket = by_type.setdefault(row.entry_type, {"credit": 0.0, "debit": 0.0, "count": 0})
        bucket[row.direction] = float(row.sum or 0)
        bucket["count"] += int(row.cnt or 0)

    # Страница записей.
    offset = (page - 1) * limit
    rows_q = await db.execute(
        select(BillingLedger)
        .where(where)
        .order_by(BillingLedger.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = rows_q.scalars().all()

    # Подгрузка названий клиник одной выборкой.
    clinic_ids = {r.clinic_id for r in rows if r.clinic_id}
    clinic_names: dict = {}
    if clinic_ids:
        cn = await db.execute(select(Clinic).where(Clinic.id.in_(list(clinic_ids))))
        for c in cn.scalars().all():
            clinic_names[c.id] = c.name

    items = []
    for r in rows:
        meta = r.meta or {}
        items.append({
            "id": str(r.id),
            "tenant_id": str(r.tenant_id) if r.tenant_id else None,
            "clinic_id": str(r.clinic_id) if r.clinic_id else None,
            "clinic_name": clinic_names.get(r.clinic_id) if r.clinic_id else None,
            "entry_type": r.entry_type,
            "direction": r.direction,
            "amount": float(r.amount or 0),
            # signed amount для удобства фронта: credit = +, debit = -.
            "signed_amount": (
                float(r.amount or 0)
                if r.direction == _LedgerDirection.CREDIT
                else -float(r.amount or 0)
            ),
            "currency": r.currency,
            "reference_id": str(r.reference_id) if r.reference_id else None,
            "reference_type": r.reference_type,
            "description": r.description,
            # patient_name / receipt_url достаём из meta если положили при создании.
            "patient_name": meta.get("patient_name"),
            "receipt_url": meta.get("receipt_url"),
            "is_split": bool(r.is_split),
            "split_parent_id": str(r.split_parent_id) if r.split_parent_id else None,
            "split_actor": r.split_actor,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {
        "items": items,
        "page": page,
        "limit": limit,
        "total": total,
        "totals": {
            "gross": gross,
            "debit": debit,
            "net": net,
            "by_type": by_type,
        },
    }
