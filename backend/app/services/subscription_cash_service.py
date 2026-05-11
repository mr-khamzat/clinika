"""
subscription_cash_service — наличная активация подписки пациента менеджером.

  1) menager/franchise_owner/reg в кабинете клиники активирует подписку
     пациенту за наличные;
  2) сумма проверяется ± 5% от effective_plan.price_monthly * months
     (превышение/недобор флагуется, но не блокирует);
  3) создаётся PatientSubscription со status='active';
  4) пишется запись в billing_ledger (entry_type='subscription_cash');
  5) создаётся PatientSubscriptionHistory event='activated_by_cash';
  6) генерируется PDF-квитанция (WeasyPrint, fallback PDFKit/plain);
  7) триггерится приветственное уведомление (best-effort).
"""
import io
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.billing_ledger import BillingLedger
from app.models.patient_account import PatientAccount
from app.models.subscription import PatientSubscription, PatientSubscriptionHistory
from app.models.tenant import Tenant
from app.models.user import User

from app.services import subscription_service as ss
from app.services.subscription_module_service import health_plus_module_active


# ── Бизнес-проверки ─────────────────────────────────────────────────────────
async def can_activate_for_patient(
    db: AsyncSession, tenant_id: uuid.UUID, patient_id: uuid.UUID
) -> tuple[bool, str]:
    """Можно ли активировать пациенту наличную подписку.
    Запрещаем если у пациента уже есть active/trial любого плана."""
    sub = await ss.get_active_subscription(db, patient_id)
    if sub:
        return False, (
            f"У пациента уже есть активная подписка plan={sub.plan} "
            f"до {sub.expires_at.isoformat() if sub.expires_at else '?'}"
        )
    return True, ""


def _months_to_days(months: int) -> int:
    return {1: 30, 3: 90, 6: 180, 12: 365}.get(int(months), 30 * int(months))


async def activate_cash(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    clinic_id: uuid.UUID | None,
    patient: PatientAccount,
    plan_key: str,
    months: int,
    amount_received: Decimal,
    received_by: User,
    note: str | None = None,
) -> tuple[PatientSubscription, BillingLedger, dict]:
    """Создаёт подписку + ledger-запись + history. Возвращает (sub, ledger_entry, info).
    info: {amount_expected, discrepancy_pct, flagged}.
    """
    if not await health_plus_module_active(db, tenant_id):
        raise ValueError("Модуль Здоровье+ не подключён у клиники")

    ok, reason = await can_activate_for_patient(db, tenant_id, patient.id)
    if not ok:
        raise ValueError(reason)

    meta = await ss.plan_meta_db(db, plan_key, tenant_id=tenant_id)
    if not meta:
        raise ValueError(f"Unknown plan: {plan_key}")

    price_monthly: Decimal = Decimal(str(meta.get("price_monthly") or 0))
    amount_expected: Decimal = (price_monthly * Decimal(str(months))).quantize(Decimal("0.01"))
    amount_received = Decimal(str(amount_received)).quantize(Decimal("0.01"))
    diff_abs = abs(amount_received - amount_expected)
    if amount_expected > 0:
        diff_pct = float((diff_abs / amount_expected) * Decimal("100"))
    else:
        diff_pct = 0.0
    flagged = diff_pct > 5.0

    now = datetime.utcnow()
    days = _months_to_days(months)
    expires = now + timedelta(days=days)

    sub = PatientSubscription(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        patient_id=patient.id,
        plan=plan_key,
        status="active",
        started_at=now,
        expires_at=expires,
        auto_renew=False,
        price_monthly=price_monthly,
        payment_method="cash",
    )
    db.add(sub)
    await db.flush()

    db.add(PatientSubscriptionHistory(
        subscription_id=sub.id,
        event="activated_by_cash",
        amount=amount_received,
        note=(
            f"manager={received_by.id} months={months} "
            f"expected={amount_expected} received={amount_received} "
            + (f"note={note}" if note else "")
        ),
    ))

    # ── billing_ledger ─────────────────────────────────────────────────────
    ledger = BillingLedger(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        clinic_id=clinic_id,
        entry_type="subscription_cash",
        direction="credit",
        amount=amount_received,
        currency="RUB",
        reference_id=sub.id,
        reference_type="patient_subscription",
        description=(
            f"Наличная активация подписки {plan_key} "
            f"для пациента {patient.name or patient.phone} на {months} мес"
        ),
        meta={
            "plan_key": plan_key,
            "months": int(months),
            "amount_expected": float(amount_expected),
            "amount_received": float(amount_received),
            "discrepancy_pct": round(diff_pct, 2),
            "flagged": flagged,
            "received_by_user_id": str(received_by.id),
            "payment_method": "cash",
            "patient_id": str(patient.id),
            "subscription_id": str(sub.id),
            "note": note,
        },
        is_split=False,
    )
    db.add(ledger)
    await db.flush()

    return sub, ledger, {
        "amount_expected": float(amount_expected),
        "amount_received": float(amount_received),
        "discrepancy_pct": round(diff_pct, 2),
        "flagged": flagged,
        "months": int(months),
        "expires_at": expires.isoformat(),
    }


# ── PDF-квитанция ───────────────────────────────────────────────────────────
RECEIPT_HTML_TEMPLATE = """
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'DejaVu Sans', Arial, sans-serif; font-size: 12pt; color: #222; }
  .head { border-bottom: 2px solid #047857; padding-bottom: 8px; margin-bottom: 16px; }
  .head h1 { margin: 0; font-size: 18pt; color: #047857; }
  .head .sub { color: #555; font-size: 10pt; margin-top: 4px; }
  .row { display: flex; justify-content: space-between; margin: 6px 0; }
  .row .l { color: #555; }
  .row .r { font-weight: bold; }
  .box { border: 1px solid #e5e7eb; padding: 12px; border-radius: 8px; margin: 12px 0; }
  .amount-final { font-size: 22pt; color: #047857; font-weight: bold; margin: 16px 0; text-align: center; }
  .footer { color: #777; font-size: 9pt; margin-top: 24px; border-top: 1px solid #eee; padding-top: 8px; }
  .flag { color: #b91c1c; font-weight: bold; }
</style>
</head>
<body>
  <div class="head">
    <h1>{{clinic_name}}</h1>
    <div class="sub">{{clinic_addr}}</div>
    <div class="sub">ИНН {{tenant_inn}}</div>
  </div>

  <h2>Квитанция №{{receipt_no}}</h2>
  <div class="row"><span class="l">Дата:</span><span class="r">{{date_str}}</span></div>
  <div class="row"><span class="l">Пациент:</span><span class="r">{{patient_name}}</span></div>
  <div class="row"><span class="l">Телефон:</span><span class="r">{{patient_phone}}</span></div>

  <div class="box">
    <div class="row"><span class="l">Тариф:</span><span class="r">{{plan_title}}</span></div>
    <div class="row"><span class="l">Период:</span><span class="r">{{months}} мес.</span></div>
    <div class="row"><span class="l">Действителен до:</span><span class="r">{{expires_at}}</span></div>
    <div class="row"><span class="l">Стоимость по тарифу:</span><span class="r">{{amount_expected}} ₽</span></div>
    <div class="row"><span class="l">Получено наличными:</span><span class="r">{{amount_received}} ₽</span></div>
    {{flag_block}}
  </div>

  <div class="amount-final">К оплате принято: {{amount_received}} ₽</div>

  <div class="row"><span class="l">Принял:</span><span class="r">{{cashier_name}}</span></div>
  <div class="row"><span class="l">Подпись:</span><span class="r">___________________</span></div>

  <div class="footer">
    Платформа КлиникСеть. Квитанция сформирована автоматически.
    Подписка активирована в системе под номером {{subscription_id}}.
  </div>
</body>
</html>
"""


def render_receipt_pdf(ctx: dict) -> bytes:
    """Рендерит PDF-квитанцию. При недоступности WeasyPrint возвращает простой
    plaintext-PDF через reportlab. Если и его нет — отдаёт HTML-байты."""
    html = RECEIPT_HTML_TEMPLATE
    for k, v in ctx.items():
        html = html.replace("{{" + k + "}}", str(v))
    flag_block = ""
    if ctx.get("flagged"):
        flag_block = (
            f'<div class="flag">Внимание: расхождение {ctx.get("discrepancy_pct", 0)}% '
            f'между принятой суммой и стоимостью по тарифу.</div>'
        )
    html = html.replace("{{flag_block}}", flag_block)

    try:
        from weasyprint import HTML  # type: ignore
        return HTML(string=html).write_pdf()  # type: ignore
    except Exception:
        pass

    try:
        from reportlab.pdfgen import canvas  # type: ignore
        buf = io.BytesIO()
        c = canvas.Canvas(buf)
        y = 800
        lines = [
            f"Квитанция №{ctx.get('receipt_no')}",
            f"Клиника: {ctx.get('clinic_name')}",
            f"Дата: {ctx.get('date_str')}",
            f"Пациент: {ctx.get('patient_name')} / {ctx.get('patient_phone')}",
            f"Тариф: {ctx.get('plan_title')}, {ctx.get('months')} мес.",
            f"Действителен до: {ctx.get('expires_at')}",
            f"Ожидаемая сумма: {ctx.get('amount_expected')} RUB",
            f"Получено наличными: {ctx.get('amount_received')} RUB",
            f"Принял: {ctx.get('cashier_name')}",
            f"Подписка: {ctx.get('subscription_id')}",
        ]
        if ctx.get("flagged"):
            lines.append(f"FLAG: discrepancy_pct={ctx.get('discrepancy_pct', 0)}%")
        for ln in lines:
            c.drawString(40, y, ln)
            y -= 18
        c.showPage()
        c.save()
        return buf.getvalue()
    except Exception:
        return html.encode("utf-8")


# ── История и статистика ────────────────────────────────────────────────────
async def list_history(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    clinic_id: uuid.UUID | None = None,
    limit: int = 200,
) -> list[dict]:
    q = select(BillingLedger).where(
        and_(
            BillingLedger.tenant_id == tenant_id,
            BillingLedger.entry_type == "subscription_cash",
        )
    )
    if date_from:
        q = q.where(BillingLedger.created_at >= date_from)
    if date_to:
        q = q.where(BillingLedger.created_at <= date_to)
    if clinic_id:
        q = q.where(BillingLedger.clinic_id == clinic_id)
    q = q.order_by(BillingLedger.created_at.desc()).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return [
        {
            "id": str(r.id),
            "subscription_id": str(r.reference_id) if r.reference_id else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "amount": float(r.amount),
            "clinic_id": str(r.clinic_id) if r.clinic_id else None,
            "meta": r.meta or {},
            "description": r.description,
        }
        for r in rows
    ]


async def stats(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    period_days: int = 30,
) -> dict:
    since = datetime.utcnow() - timedelta(days=period_days)
    q = select(
        func.count(BillingLedger.id),
        func.coalesce(func.sum(BillingLedger.amount), 0),
    ).where(
        and_(
            BillingLedger.tenant_id == tenant_id,
            BillingLedger.entry_type == "subscription_cash",
            BillingLedger.created_at >= since,
        )
    )
    cnt, total = (await db.execute(q)).one()
    avg = float(total) / int(cnt) if cnt else 0.0
    return {
        "period_days": period_days,
        "count": int(cnt or 0),
        "revenue": float(total or 0),
        "average_check": round(avg, 2),
    }
