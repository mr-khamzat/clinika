"""
/accountant/summary — дашборд бухгалтера.

Возвращает ключевые метрики за период:
  - открыта ли смена (current_shift)
  - кэш на руках (cash_start + in - out открытой смены)
  - сегодняшний оборот (cash + card по clinic_payments)
  - акты за месяц (count + сумма по статусам)
  - количество визитов (appointments) за период
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.cash_shift import CashShift, CashShiftEntry, CashShiftStatus
from app.models.payments_clinic import ClinicPayment, ClinicPaymentStatus
from app.models.billing import Invoice
from app.routers.accountant.deps import require_accountant


router = APIRouter(prefix="/summary", tags=["accountant:summary"])


class CashOnHandOut(BaseModel):
    shift_open: bool = False
    shift_id: Optional[str] = None
    cash_start: Decimal = Decimal("0")
    in_total: Decimal = Decimal("0")
    out_total: Decimal = Decimal("0")
    cash_on_hand: Decimal = Decimal("0")


class TodayTurnoverOut(BaseModel):
    online_card: Decimal = Decimal("0")
    refunded: Decimal = Decimal("0")
    payments_count: int = 0


class ActsSummaryOut(BaseModel):
    total: int = 0
    unpaid: int = 0
    unpaid_amount: Decimal = Decimal("0")


class SummaryOut(BaseModel):
    cash_on_hand: CashOnHandOut
    today: TodayTurnoverOut
    acts: ActsSummaryOut


@router.get("", response_model=SummaryOut)
async def summary(
    period_from: Optional[date] = Query(None),
    user: User = Depends(require_accountant),
    db: AsyncSession = Depends(get_db),
):
    clinic_id = user.clinic_id
    tenant_id = user.tenant_id
    today_start = datetime.combine(date.today(), datetime.min.time())
    today_end = today_start + timedelta(days=1)

    # ── 1) Кэш на руках по открытой смене ──
    coh = CashOnHandOut()
    if clinic_id:
        shift = (await db.execute(
            select(CashShift).where(
                and_(
                    CashShift.clinic_id == clinic_id,
                    CashShift.status == CashShiftStatus.OPEN,
                )
            )
        )).scalar_one_or_none()
        if shift:
            in_sum = (await db.execute(
                select(func.coalesce(func.sum(CashShiftEntry.amount), 0))
                .where(
                    and_(
                        CashShiftEntry.shift_id == shift.id,
                        CashShiftEntry.direction == "in",
                    )
                )
            )).scalar() or Decimal("0")
            out_sum = (await db.execute(
                select(func.coalesce(func.sum(CashShiftEntry.amount), 0))
                .where(
                    and_(
                        CashShiftEntry.shift_id == shift.id,
                        CashShiftEntry.direction == "out",
                    )
                )
            )).scalar() or Decimal("0")
            coh = CashOnHandOut(
                shift_open=True,
                shift_id=str(shift.id),
                cash_start=shift.cash_start,
                in_total=Decimal(in_sum),
                out_total=Decimal(out_sum),
                cash_on_hand=shift.cash_start + Decimal(in_sum) - Decimal(out_sum),
            )

    # ── 2) Сегодняшний онлайн-оборот по всему тенанту ──
    # Бухгалтер видит обороты ВСЕХ клиник своей сети, не только своей.
    today = TodayTurnoverOut()
    if tenant_id:
        pay_conds = [
            ClinicPayment.tenant_id == tenant_id,
            ClinicPayment.created_at >= today_start,
            ClinicPayment.created_at < today_end,
        ]
        success_sum = (await db.execute(
            select(func.coalesce(func.sum(ClinicPayment.amount), 0))
            .where(and_(*pay_conds, ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED))
        )).scalar() or Decimal("0")
        refund_sum = (await db.execute(
            select(func.coalesce(func.sum(ClinicPayment.amount), 0))
            .where(and_(*pay_conds, ClinicPayment.status == ClinicPaymentStatus.REFUNDED))
        )).scalar() or Decimal("0")
        count = (await db.execute(
            select(func.count(ClinicPayment.id))
            .where(and_(*pay_conds, ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED))
        )).scalar() or 0
        today = TodayTurnoverOut(
            online_card=Decimal(success_sum),
            refunded=Decimal(refund_sum),
            payments_count=int(count),
        )

    # ── 3) Акты этого месяца + неоплаченные ──
    acts = ActsSummaryOut()
    if tenant_id:
        month_start = datetime.combine(date.today().replace(day=1), datetime.min.time())
        total = (await db.execute(
            select(func.count(Invoice.id))
            .where(
                and_(
                    Invoice.tenant_id == tenant_id,
                    Invoice.act_number.is_not(None),
                    Invoice.created_at >= month_start,
                )
            )
        )).scalar() or 0
        unpaid_q = (await db.execute(
            select(
                func.count(Invoice.id),
                func.coalesce(func.sum(Invoice.amount_total if hasattr(Invoice, "amount_total") else Invoice.amount), 0),
            )
            .where(
                and_(
                    Invoice.tenant_id == tenant_id,
                    Invoice.act_number.is_not(None),
                    Invoice.act_status != "paid",
                )
            )
        )).first()
        unpaid_count = (unpaid_q[0] if unpaid_q else 0) or 0
        unpaid_amount = Decimal(unpaid_q[1] if unpaid_q else 0) or Decimal("0")
        acts = ActsSummaryOut(
            total=int(total),
            unpaid=int(unpaid_count),
            unpaid_amount=unpaid_amount,
        )

    return SummaryOut(cash_on_hand=coh, today=today, acts=acts)
