"""
Глава 8 — Расходник пациента за год.

Источники данных:
  1) clinic_payments (статус=succeeded) — реальные оплаты пациента
  2) appointments (status=completed, price>0) — фолбэк если ClinicPayment нет
  3) services / Service.category — категории
  4) clinics.name — название клиники

Возвращаем агрегированный отчёт + список приёмов для PDF.
"""
import logging
import uuid
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import select, and_, extract, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.doctor import Appointment, AppointmentStatus, Doctor
from app.models.clinic import Clinic
from app.models.service import Service
from app.models.payments_clinic import ClinicPayment
from app.models.loyalty_ext import LoyaltyAccountExt, LoyaltyEvent
from app.utils.phone import normalize_phone

logger = logging.getLogger(__name__)


async def compute_spending_summary(
    db: AsyncSession,
    patient_phone: str,
    year: int,
    tenant_id: uuid.UUID | None = None,
) -> dict:
    """Сводка трат пациента за год."""
    phone_n = normalize_phone(patient_phone)

    # ── Список приёмов ─────────────────────────────────────────────────
    q = select(Appointment).where(
        and_(
            Appointment.patient_phone == phone_n,
            extract("year", Appointment.appointment_date) == year,
            Appointment.status == AppointmentStatus.COMPLETED,
        )
    )
    if tenant_id:
        q = q.where(Appointment.tenant_id == tenant_id)
    appts = (await db.execute(q.order_by(Appointment.appointment_date.asc()))).scalars().all()

    # Загружаем clinics и doctors одной выборкой
    clinic_ids = {a.clinic_id for a in appts if a.clinic_id}
    doctor_ids = {a.doctor_id for a in appts if a.doctor_id}
    clinics_map: dict[uuid.UUID, Clinic] = {}
    if clinic_ids:
        r = await db.execute(select(Clinic).where(Clinic.id.in_(clinic_ids)))
        clinics_map = {c.id: c for c in r.scalars().all()}
    doctors_map: dict[uuid.UUID, Doctor] = {}
    if doctor_ids:
        r = await db.execute(select(Doctor).where(Doctor.id.in_(doctor_ids)))
        doctors_map = {d.id: d for d in r.scalars().all()}

    # ── Оплаты (clinic_payments) ───────────────────────────────────────
    pq = select(ClinicPayment).where(
        and_(
            ClinicPayment.patient_phone == phone_n,
            extract("year", ClinicPayment.created_at) == year,
            ClinicPayment.status == "succeeded",
        )
    )
    if tenant_id:
        pq = pq.where(ClinicPayment.tenant_id == tenant_id)
    payments = (await db.execute(pq)).scalars().all()
    # карта: appointment_id → сумма (если несколько — суммируем)
    pay_by_appt: dict[uuid.UUID, Decimal] = defaultdict(lambda: Decimal("0"))
    for p in payments:
        if p.appointment_id:
            pay_by_appt[p.appointment_id] += (p.amount or Decimal("0"))

    # ── Раскладка ──────────────────────────────────────────────────────
    total = Decimal("0")
    by_category: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    by_clinic: dict[uuid.UUID, dict] = {}
    by_month: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    appointments_list: list[dict] = []

    for a in appts:
        # Сумма приёма: payment > appointment.price > 0
        amt = pay_by_appt.get(a.id)
        if not amt:
            amt = Decimal(str(a.price)) if a.price else Decimal("0")
        total += amt

        clinic = clinics_map.get(a.clinic_id)
        doctor = doctors_map.get(a.doctor_id)
        clinic_name = clinic.name if clinic else "—"

        # Категория — из специальности врача или 'Услуги'
        category = (doctor.specialty if doctor and doctor.specialty else "Услуги")
        by_category[category] += amt

        if a.clinic_id:
            slot = by_clinic.setdefault(a.clinic_id, {
                "clinic_id": str(a.clinic_id),
                "name": clinic_name,
                "amount": Decimal("0"),
                "appointments": 0,
            })
            slot["amount"] += amt
            slot["appointments"] += 1

        month_key = f"{a.appointment_date.year:04d}-{a.appointment_date.month:02d}"
        by_month[month_key] += amt

        appointments_list.append({
            "id": str(a.id),
            "date": a.appointment_date.isoformat(),
            "start_time": a.start_time.strftime("%H:%M") if a.start_time else None,
            "clinic_id": str(a.clinic_id) if a.clinic_id else None,
            "clinic_name": clinic_name,
            "doctor_name": doctor.full_name if doctor else None,
            "doctor_specialty": doctor.specialty if doctor else None,
            "category": category,
            "amount": float(amt),
            "status": str(a.status).split(".")[-1].lower() if a.status else None,
        })

    # ── Лояльность за год ──────────────────────────────────────────────
    loyalty_earned = 0
    saved_with_loyalty = Decimal("0")
    if tenant_id:
        acc_r = await db.execute(
            select(LoyaltyAccountExt).where(
                and_(
                    LoyaltyAccountExt.tenant_id == tenant_id,
                    LoyaltyAccountExt.patient_phone == phone_n,
                )
            )
        )
        acc = acc_r.scalar_one_or_none()
        if acc:
            ev_r = await db.execute(
                select(LoyaltyEvent).where(
                    and_(
                        LoyaltyEvent.account_id == acc.id,
                        extract("year", LoyaltyEvent.created_at) == year,
                    )
                )
            )
            evs = ev_r.scalars().all()
            loyalty_earned = sum(e.delta for e in evs if e.delta > 0)
            # Списания на награды — потенциальная экономия
            saved_with_loyalty = abs(sum(e.delta for e in evs if e.delta < 0 and e.reason == "reward_claimed"))

    # Сортируем by_clinic по сумме
    by_clinic_list = sorted(
        [
            {"clinic_id": s["clinic_id"], "name": s["name"],
             "amount": float(s["amount"]), "appointments": s["appointments"]}
            for s in by_clinic.values()
        ],
        key=lambda x: x["amount"], reverse=True,
    )
    by_month_list = sorted(
        [{"month": k, "amount": float(v)} for k, v in by_month.items()],
        key=lambda x: x["month"],
    )

    return {
        "year": year,
        "total_spent": float(total),
        "appointments_count": len(appts),
        "by_category": {k: float(v) for k, v in by_category.items()},
        "by_clinic": by_clinic_list,
        "by_month": by_month_list,
        "loyalty_earned_this_year": int(loyalty_earned),
        "saved_with_loyalty": int(saved_with_loyalty),
        "appointments": appointments_list,
    }


# ── PDF ─────────────────────────────────────────────────────────────────────
def render_spending_pdf(summary: dict, patient_name: str | None) -> bytes:
    """Сгенерировать PDF расходника через WeasyPrint."""
    from weasyprint import HTML  # ленивый импорт

    name = patient_name or "Пациент"
    year = summary["year"]

    def fmt_money(v):
        try:
            return f"{int(round(float(v))):,}".replace(",", " ") + " ₽"
        except Exception:
            return f"{v} ₽"

    cats_html = "".join(
        f"<tr><td>{k}</td><td style='text-align:right'>{fmt_money(v)}</td></tr>"
        for k, v in summary["by_category"].items()
    )
    clinics_html = "".join(
        f"<tr><td>{c['name']}</td><td style='text-align:center'>{c['appointments']}</td>"
        f"<td style='text-align:right'>{fmt_money(c['amount'])}</td></tr>"
        for c in summary["by_clinic"]
    )
    appts_html = "".join(
        f"<tr><td>{a['date']}</td><td>{a.get('clinic_name','—')}</td>"
        f"<td>{a.get('doctor_name','—') or '—'}</td>"
        f"<td>{a.get('category','—')}</td>"
        f"<td style='text-align:right'>{fmt_money(a['amount'])}</td></tr>"
        for a in summary.get("appointments", [])
    )

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page {{ size: A4; margin: 18mm; }}
  body {{ font-family: 'DejaVu Sans', Arial, sans-serif; font-size: 11pt; color: #1c1f24; }}
  h1 {{ font-size: 22pt; margin: 0 0 4mm 0; }}
  h2 {{ font-size: 14pt; margin: 10mm 0 3mm 0; border-bottom: 1px solid #ccc; padding-bottom: 2mm; }}
  .sub {{ color: #666; font-size: 10pt; margin-bottom: 6mm; }}
  .total-card {{
    background: #f7f7fa; border: 1px solid #e3e3e8; border-radius: 6px;
    padding: 5mm 6mm; margin: 4mm 0 6mm 0;
  }}
  .total-card .v {{ font-size: 24pt; font-weight: bold; color: #1a73e8; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 10pt; }}
  th, td {{ padding: 2mm 3mm; border-bottom: 1px solid #eee; text-align: left; }}
  th {{ background: #f0f0f5; font-weight: 600; }}
  .footer {{
    position: fixed; bottom: -10mm; left: 0; right: 0;
    text-align: center; font-size: 9pt; color: #888;
  }}
</style></head>
<body>
  <h1>Расходник пациента за {year} год</h1>
  <div class="sub">{name}</div>

  <div class="total-card">
    <div>Всего потрачено:</div>
    <div class="v">{fmt_money(summary['total_spent'])}</div>
    <div style="margin-top:2mm; font-size:10pt; color:#555;">
      Приёмов: {summary['appointments_count']} ·
      Баллов лояльности заработано: {summary['loyalty_earned_this_year']} ·
      Сэкономлено наградами: {summary['saved_with_loyalty']}
    </div>
  </div>

  <h2>По категориям</h2>
  <table>
    <thead><tr><th>Категория</th><th style="text-align:right">Сумма</th></tr></thead>
    <tbody>{cats_html or '<tr><td colspan="2" style="text-align:center;color:#888">Нет данных</td></tr>'}</tbody>
  </table>

  <h2>По клиникам</h2>
  <table>
    <thead><tr><th>Клиника</th><th style="text-align:center">Приёмов</th><th style="text-align:right">Сумма</th></tr></thead>
    <tbody>{clinics_html or '<tr><td colspan="3" style="text-align:center;color:#888">Нет данных</td></tr>'}</tbody>
  </table>

  <h2>Список приёмов</h2>
  <table>
    <thead>
      <tr><th>Дата</th><th>Клиника</th><th>Врач</th><th>Категория</th><th style="text-align:right">Сумма</th></tr>
    </thead>
    <tbody>{appts_html or '<tr><td colspan="5" style="text-align:center;color:#888">Нет приёмов</td></tr>'}</tbody>
  </table>

  <div class="footer">Документ сформирован системой КлиникСеть · {datetime.utcnow().strftime('%d.%m.%Y')}</div>
</body></html>"""

    pdf_bytes = HTML(string=html).write_pdf()
    return pdf_bytes
