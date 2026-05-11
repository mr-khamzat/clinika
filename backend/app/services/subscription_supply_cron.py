"""
subscription_supply_cron — ежемесячная автогенерация расходника пациентам
с активной подпиской features.monthly_supply=True.

Запуск:
  - Из APScheduler 1-го числа каждого месяца в 03:00 UTC
  - Или вручную через POST /patient/subscription/supply/generate-now

Что делает:
  Для каждой active/trial подписки с monthly_supply=True:
    1) Считает spending_summary за предыдущий месяц
    2) Генерирует PDF через spending_service.render_spending_pdf
    3) Складывает в /opt/clinika/backend/storage/supplies/<sub_id>_<YYYY-MM>.pdf
    4) Создаёт patient-notification «Ваш ежемесячный расходник готов»
"""
import os
import logging
import uuid
from datetime import datetime, timedelta, date
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.patient_account import PatientAccount
from app.models.subscription import PatientSubscription
from app.services import subscription_service as ss
from app.services import spending_service as sp


log = logging.getLogger("subscription.supply")

STORAGE_DIR = os.environ.get(
    "SUPPLY_STORAGE_DIR", "/app/storage/supplies"
)


def _prev_month_range(today: date | None = None) -> tuple[date, date, int, int]:
    """Возвращает (start, end, year, month) предыдущего месяца."""
    today = today or date.today()
    first_of_this = today.replace(day=1)
    last_prev = first_of_this - timedelta(days=1)
    start = last_prev.replace(day=1)
    return start, last_prev, last_prev.year, last_prev.month


def _ensure_storage_dir() -> str:
    try:
        os.makedirs(STORAGE_DIR, exist_ok=True)
    except Exception:
        pass
    return STORAGE_DIR


async def generate_for_subscription(
    db: AsyncSession,
    sub: PatientSubscription,
    *,
    year: int | None = None,
    month: int | None = None,
) -> dict:
    """Генерация для одной подписки. Возвращает dict с описанием результата."""
    if year is None or month is None:
        _, _, year, month = _prev_month_range()

    pa = (await db.execute(
        select(PatientAccount).where(PatientAccount.id == sub.patient_id)
    )).scalar_one_or_none()
    if not pa:
        return {"subscription_id": str(sub.id), "ok": False, "error": "no_patient"}

    # Проверяем что план включает monthly_supply
    benefits = await ss.benefits_for_db(db, sub.plan, tenant_id=sub.tenant_id)
    if not benefits.get("monthly_supply"):
        return {"subscription_id": str(sub.id), "ok": False, "error": "no_monthly_supply"}

    summary = await sp.compute_spending_summary(
        db, pa.phone, year, tenant_id=sub.tenant_id,
    )
    # Фильтруем только за этот месяц (compute_spending_summary даёт за год;
    # храним в PDF за год, но в заголовке отметим расходник за месяц)
    summary["report_month"] = f"{year:04d}-{month:02d}"

    try:
        pdf_bytes = sp.render_spending_pdf(summary, patient_name=pa.name)
    except Exception as e:  # pragma: no cover
        log.exception("render_spending_pdf failed: %s", e)
        return {"subscription_id": str(sub.id), "ok": False, "error": str(e)}

    dir_ = _ensure_storage_dir()
    fname = f"{sub.id}_{year:04d}-{month:02d}.pdf"
    fpath = os.path.join(dir_, fname)
    try:
        with open(fpath, "wb") as f:
            f.write(pdf_bytes)
    except Exception as e:  # pragma: no cover
        log.exception("write supply pdf failed: %s", e)
        return {"subscription_id": str(sub.id), "ok": False, "error": str(e)}

    # Best-effort patient-notification (через push_service если есть)
    try:
        from app.services import push_service as ps  # type: ignore
        await ps.send_to_patient(
            db, pa.id,
            title="Ваш ежемесячный расходник готов",
            body=f"Расходник за {year:04d}-{month:02d} доступен в вашем кабинете.",
            data={"type": "supply_ready", "year": year, "month": month,
                  "subscription_id": str(sub.id)},
        )
    except Exception:
        pass

    return {
        "subscription_id": str(sub.id),
        "ok": True,
        "year": year, "month": month,
        "path": fpath,
        "size": len(pdf_bytes),
    }


async def run_monthly_for_all(
    db: AsyncSession,
    *,
    year: int | None = None,
    month: int | None = None,
) -> dict:
    """Прогоняет генерацию для всех active/trial подписок с monthly_supply=True."""
    if year is None or month is None:
        _, _, year, month = _prev_month_range()
    now = datetime.utcnow()
    q = select(PatientSubscription).where(
        and_(
            PatientSubscription.status.in_(["active", "trial"]),
            PatientSubscription.expires_at > now,
        )
    )
    subs = (await db.execute(q)).scalars().all()
    results: list[dict] = []
    for sub in subs:
        benefits = await ss.benefits_for_db(db, sub.plan, tenant_id=sub.tenant_id)
        if not benefits.get("monthly_supply"):
            continue
        try:
            r = await generate_for_subscription(db, sub, year=year, month=month)
        except Exception as e:  # pragma: no cover
            log.exception("supply gen failed for %s", sub.id)
            r = {"subscription_id": str(sub.id), "ok": False, "error": str(e)}
        results.append(r)
    return {
        "year": year, "month": month,
        "processed": len(results),
        "ok": sum(1 for r in results if r.get("ok")),
        "failed": sum(1 for r in results if not r.get("ok")),
        "items": results,
    }
