"""
Роутер Главы 6, фича 3–4: External Doctor — Direct billing + кабинет.

Эндпоинты:
  POST   /external-doctor/direct-bill
         Создать прямой счёт от visiting/partner doctor пациенту.

  GET    /external-doctor/direct-bills
         Список своих счетов (фильтры status, period).

  GET    /external-doctor/direct-bills/{id}
         Получить счёт по id.

  PATCH  /external-doctor/direct-bills/{id}/status
         Сменить статус (draft → sent → paid → cancelled).
         При status=paid фиксируется paid_at; при cancelled — cancelled_at.

  GET    /external-doctor/direct-bills/{id}/print
         PDF-печать счёта через WeasyPrint.

  GET    /external-doctor/my-stats
         Кабинетная статистика: заработок за период, кол-во приёмов,
         топ клиник, средний чек.

Доступ: только роли visiting_doctor / partner_doctor / super_admin.
Tenant-изоляция и проверка doctor_id для каждой операции.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select, func, desc, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user, require_role, get_tenant_db
from app.models.user import User
from app.models.clinic import Clinic
from app.models.doctor_ai import DirectBill, DirectBillStatus, DirectBillPaymentMethod
from app.models.doctor import Appointment, Doctor

log = logging.getLogger("external_doctor_router")

router = APIRouter(prefix="/external-doctor", tags=["external-doctor"])

_ALLOWED = ("visiting_doctor", "partner_doctor", "super_admin")
_dep_ext = Depends(require_role(*_ALLOWED))


# ─────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────
class ServiceLine(BaseModel):
    name: str
    price: float = Field(ge=0)
    qty: int = Field(default=1, ge=1)


class DirectBillCreate(BaseModel):
    services: list[ServiceLine] = Field(min_length=1)
    discount_pct: float = Field(default=0, ge=0, le=100)
    notes: Optional[str] = None
    payment_method: Optional[str] = None  # cash | card | transfer
    appointment_id: Optional[uuid.UUID] = None
    clinic_id: Optional[uuid.UUID] = None
    patient_phone: Optional[str] = None
    patient_name: Optional[str] = None


class DirectBillStatusUpdate(BaseModel):
    status: str  # draft | sent | paid | cancelled


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _to_dec(x) -> Decimal:
    try:
        return Decimal(str(x))
    except (InvalidOperation, TypeError):
        return Decimal("0")


def _bill_to_dict(b: DirectBill) -> dict:
    return {
        "id": str(b.id),
        "bill_number": b.bill_number,
        "doctor_id": str(b.doctor_id),
        "clinic_id": str(b.clinic_id) if b.clinic_id else None,
        "patient_phone": b.patient_phone,
        "patient_name": b.patient_name,
        "appointment_id": str(b.appointment_id) if b.appointment_id else None,
        "services": b.services or [],
        "subtotal": float(b.subtotal or 0),
        "discount_pct": float(b.discount_pct or 0),
        "discount_amount": float(b.discount_amount or 0),
        "total": float(b.total or 0),
        "status": b.status,
        "payment_method": b.payment_method,
        "notes": b.notes,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "sent_at": b.sent_at.isoformat() if b.sent_at else None,
        "paid_at": b.paid_at.isoformat() if b.paid_at else None,
        "cancelled_at": b.cancelled_at.isoformat() if b.cancelled_at else None,
    }


def _calc_totals(services: list[dict], discount_pct: float) -> tuple[Decimal, Decimal, Decimal]:
    subtotal = Decimal("0")
    for s in services:
        try:
            price = _to_dec(s.get("price"))
            qty = int(s.get("qty", 1) or 1)
        except Exception:
            continue
        subtotal += price * qty
    dpct = _to_dec(discount_pct)
    discount_amount = (subtotal * dpct / Decimal("100")).quantize(Decimal("0.01"))
    total = (subtotal - discount_amount).quantize(Decimal("0.01"))
    return subtotal.quantize(Decimal("0.01")), discount_amount, total


async def _get_bill_or_404(db: AsyncSession, bill_id: uuid.UUID, user: User) -> DirectBill:
    b = (await db.execute(select(DirectBill).where(DirectBill.id == bill_id))).scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Счёт не найден")
    if user.tenant_id and b.tenant_id and b.tenant_id != user.tenant_id:
        raise HTTPException(403, "Чужой тенант")
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role_val != "super_admin" and b.doctor_id != user.id:
        raise HTTPException(403, "Счёт другого врача")
    return b


async def _gen_bill_number(db: AsyncSession, tenant_id: uuid.UUID | None) -> str:
    """Простой счётчик внутри тенанта (на год)."""
    year = datetime.utcnow().year
    q = select(func.count()).select_from(DirectBill).where(
        func.extract("year", DirectBill.created_at) == year
    )
    if tenant_id:
        q = q.where(DirectBill.tenant_id == tenant_id)
    cnt = (await db.execute(q)).scalar() or 0
    return f"DB-{year}-{cnt + 1:05d}"


# ─────────────────────────────────────────────────────────────────────
# Direct bill — CRUD
# ─────────────────────────────────────────────────────────────────────
@router.post("/direct-bill", status_code=201, dependencies=[_dep_ext])
async def create_direct_bill(
    body: DirectBillCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    if body.payment_method and body.payment_method not in (
        DirectBillPaymentMethod.CASH,
        DirectBillPaymentMethod.CARD,
        DirectBillPaymentMethod.TRANSFER,
    ):
        raise HTTPException(400, "Недопустимый payment_method")

    services_data = [s.dict() for s in body.services]
    subtotal, discount_amount, total = _calc_totals(services_data, body.discount_pct or 0)

    appt = None
    appt_clinic_id = None
    patient_phone = body.patient_phone
    patient_name = body.patient_name
    if body.appointment_id:
        appt = (
            await db.execute(select(Appointment).where(Appointment.id == body.appointment_id))
        ).scalar_one_or_none()
        if not appt:
            raise HTTPException(404, "Приём не найден")
        if current_user.tenant_id and appt.tenant_id and appt.tenant_id != current_user.tenant_id:
            raise HTTPException(403, "Чужой тенант (приём)")
        appt_clinic_id = appt.clinic_id
        patient_phone = patient_phone or appt.patient_phone
        patient_name = patient_name or appt.patient_name

    clinic_id = body.clinic_id or appt_clinic_id or current_user.clinic_id

    bill_number = await _gen_bill_number(db, current_user.tenant_id)

    bill = DirectBill(
        tenant_id=current_user.tenant_id,
        doctor_id=current_user.id,
        clinic_id=clinic_id,
        patient_phone=patient_phone,
        patient_name=patient_name,
        appointment_id=body.appointment_id,
        services=services_data,
        subtotal=subtotal,
        discount_pct=_to_dec(body.discount_pct or 0),
        discount_amount=discount_amount,
        total=total,
        status=DirectBillStatus.DRAFT,
        payment_method=body.payment_method,
        notes=body.notes,
        bill_number=bill_number,
    )
    db.add(bill)
    await db.commit()
    await db.refresh(bill)
    return _bill_to_dict(bill)


@router.get("/direct-bills", dependencies=[_dep_ext])
async def list_direct_bills(
    status: Optional[str] = Query(None),
    period_from: Optional[date] = Query(None),
    period_to: Optional[date] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    role_val = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    q = select(DirectBill)
    if role_val != "super_admin":
        q = q.where(DirectBill.doctor_id == current_user.id)
    if current_user.tenant_id:
        q = q.where(DirectBill.tenant_id == current_user.tenant_id)
    if status:
        q = q.where(DirectBill.status == status)
    if period_from:
        q = q.where(DirectBill.created_at >= datetime.combine(period_from, datetime.min.time()))
    if period_to:
        q = q.where(DirectBill.created_at <= datetime.combine(period_to, datetime.max.time()))
    q = q.order_by(desc(DirectBill.created_at)).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return [_bill_to_dict(b) for b in rows]


@router.get("/direct-bills/{bill_id}", dependencies=[_dep_ext])
async def get_direct_bill(
    bill_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    b = await _get_bill_or_404(db, bill_id, current_user)
    return _bill_to_dict(b)


@router.patch("/direct-bills/{bill_id}/status", dependencies=[_dep_ext])
async def change_direct_bill_status(
    bill_id: uuid.UUID,
    body: DirectBillStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    if body.status not in (
        DirectBillStatus.DRAFT,
        DirectBillStatus.SENT,
        DirectBillStatus.PAID,
        DirectBillStatus.CANCELLED,
    ):
        raise HTTPException(400, "Недопустимый статус")
    b = await _get_bill_or_404(db, bill_id, current_user)
    b.status = body.status
    now = datetime.utcnow()
    if body.status == DirectBillStatus.SENT and not b.sent_at:
        b.sent_at = now
    if body.status == DirectBillStatus.PAID and not b.paid_at:
        b.paid_at = now
    if body.status == DirectBillStatus.CANCELLED and not b.cancelled_at:
        b.cancelled_at = now
    b.updated_at = now
    await db.commit()
    await db.refresh(b)
    return _bill_to_dict(b)


# ─────────────────────────────────────────────────────────────────────
# PDF
# ─────────────────────────────────────────────────────────────────────
def _esc(s: object) -> str:
    if s is None:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _fmt_money(x) -> str:
    try:
        v = float(x or 0)
        return f"{v:,.2f}".replace(",", " ").replace(".", ",")
    except Exception:
        return "0,00"


def _bill_html(bill: DirectBill, doctor: User, clinic: Clinic | None) -> str:
    pm_label = {
        "cash": "наличными",
        "card": "картой",
        "transfer": "переводом",
    }.get(bill.payment_method or "", "—")

    services_rows = ""
    for i, s in enumerate(bill.services or [], 1):
        name = _esc(s.get("name", ""))
        price = _fmt_money(s.get("price", 0))
        qty = int(s.get("qty", 1) or 1)
        total = _fmt_money(_to_dec(s.get("price")) * qty)
        services_rows += (
            f"<tr><td>{i}</td><td>{name}</td><td class='r'>{price}</td>"
            f"<td class='r'>{qty}</td><td class='r'>{total}</td></tr>"
        )

    clinic_line = ""
    if clinic:
        clinic_line = f"<div class='muted'>Место оказания услуг: {_esc(clinic.name)}</div>"

    return f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>Счёт {_esc(bill.bill_number)}</title>
<style>
  @page {{ size: A4; margin: 18mm 16mm; }}
  body {{ font-family: 'DejaVu Sans', sans-serif; font-size: 11pt; color: #222; }}
  h1 {{ font-size: 18pt; margin: 0 0 4pt; }}
  .muted {{ color: #666; font-size: 10pt; }}
  .grid {{ display: flex; justify-content: space-between; margin-top: 10pt; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 14pt; }}
  th, td {{ border: 1px solid #ccc; padding: 6pt 8pt; font-size: 10pt; }}
  th {{ background: #f4f4f4; text-align: left; }}
  td.r, th.r {{ text-align: right; }}
  .totals {{ margin-top: 12pt; width: 100%; }}
  .totals td {{ border: none; padding: 3pt 6pt; }}
  .totals td.lbl {{ text-align: right; color: #555; }}
  .totals td.val {{ text-align: right; width: 28%; font-weight: 600; }}
  .sig {{ margin-top: 32pt; }}
  .sig .row {{ display: flex; justify-content: space-between; margin-top: 22pt; }}
  .sig .line {{ border-bottom: 1px solid #999; width: 60%; height: 16pt; }}
</style></head><body>
  <h1>Счёт № {_esc(bill.bill_number)}</h1>
  <div class="muted">от {bill.created_at.strftime('%d.%m.%Y') if bill.created_at else ''}</div>

  <div class="grid">
    <div>
      <div><b>Исполнитель:</b> {_esc(doctor.full_name)}</div>
      <div class="muted">{_esc(doctor.specialization or '')}</div>
      {clinic_line}
    </div>
    <div>
      <div><b>Пациент:</b> {_esc(bill.patient_name or '—')}</div>
      <div class="muted">{_esc(bill.patient_phone or '')}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>№</th><th>Услуга</th><th class="r">Цена</th><th class="r">Кол-во</th><th class="r">Сумма</th></tr>
    </thead>
    <tbody>{services_rows}</tbody>
  </table>

  <table class="totals">
    <tr><td class="lbl">Подытог:</td><td class="val">{_fmt_money(bill.subtotal)} ₽</td></tr>
    <tr><td class="lbl">Скидка ({_fmt_money(bill.discount_pct)} %):</td>
        <td class="val">−{_fmt_money(bill.discount_amount)} ₽</td></tr>
    <tr><td class="lbl"><b>Итого к оплате:</b></td>
        <td class="val" style="font-size:13pt;">{_fmt_money(bill.total)} ₽</td></tr>
    <tr><td class="lbl">Способ оплаты:</td><td class="val">{pm_label}</td></tr>
  </table>

  {f"<div class='muted' style='margin-top:10pt'>{_esc(bill.notes)}</div>" if bill.notes else ""}

  <div class="sig">
    <div class="row"><span>Исполнитель: {_esc(doctor.full_name)}</span><span class="line"></span></div>
    <div class="row"><span>Пациент:</span><span class="line"></span></div>
  </div>

  <div class="muted" style="margin-top:24pt; text-align:right;">
    КлиникСеть · документ сгенерирован {datetime.utcnow().strftime('%d.%m.%Y %H:%M')} UTC
  </div>
</body></html>"""


@router.get("/direct-bills/{bill_id}/print", dependencies=[_dep_ext])
async def print_direct_bill(
    bill_id: uuid.UUID,
    inline: bool = Query(True),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    b = await _get_bill_or_404(db, bill_id, current_user)
    doctor = (await db.execute(select(User).where(User.id == b.doctor_id))).scalar_one_or_none() or current_user
    clinic = None
    if b.clinic_id:
        clinic = (await db.execute(select(Clinic).where(Clinic.id == b.clinic_id))).scalar_one_or_none()

    html = _bill_html(b, doctor, clinic)
    try:
        from weasyprint import HTML  # type: ignore
    except Exception as e:
        raise HTTPException(500, f"PDF-движок недоступен: {e}")
    pdf = HTML(string=html).write_pdf()
    disp = "inline" if inline else "attachment"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disp}; filename="bill-{b.bill_number or b.id}.pdf"'
        },
    )


# ─────────────────────────────────────────────────────────────────────
# Кабинет статистика
# ─────────────────────────────────────────────────────────────────────
@router.get("/my-stats", dependencies=[_dep_ext])
async def my_stats(
    period_from: Optional[date] = Query(None),
    period_to: Optional[date] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """
    Кабинетная статистика external-доктора:
      - earnings (сумма paid bills)
      - bills_total / paid_count
      - average_check
      - appointments_count (за период)
      - top_clinics: [{clinic_id, clinic_name, count, sum}]
    """
    now = datetime.utcnow()
    if not period_from:
        period_from = (now - timedelta(days=30)).date()
    if not period_to:
        period_to = now.date()
    pf = datetime.combine(period_from, datetime.min.time())
    pt = datetime.combine(period_to, datetime.max.time())

    base = [DirectBill.doctor_id == current_user.id]
    if current_user.tenant_id:
        base.append(DirectBill.tenant_id == current_user.tenant_id)

    # Сумма paid
    paid_sum_q = (
        select(func.coalesce(func.sum(DirectBill.total), 0))
        .where(and_(*base, DirectBill.status == DirectBillStatus.PAID))
        .where(DirectBill.paid_at >= pf, DirectBill.paid_at <= pt)
    )
    earnings = float((await db.execute(paid_sum_q)).scalar() or 0)

    # Кол-во оплаченных счетов
    paid_cnt_q = (
        select(func.count())
        .select_from(DirectBill)
        .where(and_(*base, DirectBill.status == DirectBillStatus.PAID))
        .where(DirectBill.paid_at >= pf, DirectBill.paid_at <= pt)
    )
    paid_count = int((await db.execute(paid_cnt_q)).scalar() or 0)

    # Всего счетов за период
    all_cnt_q = (
        select(func.count())
        .select_from(DirectBill)
        .where(and_(*base))
        .where(DirectBill.created_at >= pf, DirectBill.created_at <= pt)
    )
    bills_total = int((await db.execute(all_cnt_q)).scalar() or 0)

    average_check = (earnings / paid_count) if paid_count > 0 else 0.0

    # Кол-во приёмов (через Appointment.doctor_id → Doctor.user_id)
    appointments_count = 0
    try:
        appt_count_q = (
            select(func.count())
            .select_from(Appointment)
            .join(Doctor, Appointment.doctor_id == Doctor.id)
            .where(Doctor.user_id == current_user.id)
            .where(
                Appointment.appointment_date >= period_from,
                Appointment.appointment_date <= period_to,
            )
        )
        appointments_count = int((await db.execute(appt_count_q)).scalar() or 0)
    except Exception as e:
        log.warning("appointments_count query failed: %s", e)

    # Топ клиник
    top_q = (
        select(
            DirectBill.clinic_id,
            func.count().label("cnt"),
            func.coalesce(func.sum(DirectBill.total), 0).label("amt"),
        )
        .where(and_(*base, DirectBill.status == DirectBillStatus.PAID))
        .where(DirectBill.paid_at >= pf, DirectBill.paid_at <= pt)
        .group_by(DirectBill.clinic_id)
        .order_by(desc("amt"))
        .limit(5)
    )
    top_rows = (await db.execute(top_q)).all()
    clinic_ids = [r.clinic_id for r in top_rows if r.clinic_id]
    clinic_names = {}
    if clinic_ids:
        cls = (await db.execute(select(Clinic).where(Clinic.id.in_(clinic_ids)))).scalars().all()
        clinic_names = {c.id: c.name for c in cls}
    top_clinics = [
        {
            "clinic_id": str(r.clinic_id) if r.clinic_id else None,
            "clinic_name": clinic_names.get(r.clinic_id) or "—",
            "count": int(r.cnt),
            "sum": float(r.amt or 0),
        }
        for r in top_rows
    ]

    return {
        "period_from": period_from.isoformat(),
        "period_to": period_to.isoformat(),
        "earnings": round(earnings, 2),
        "paid_count": paid_count,
        "bills_total": bills_total,
        "average_check": round(average_check, 2),
        "appointments_count": appointments_count,
        "top_clinics": top_clinics,
    }
