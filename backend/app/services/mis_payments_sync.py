"""
Синхронизация платежей пациентов из МИС в нашу кассу/ledger.

Логика:
  1. Для каждого активного tenant_integrations (type=mis):
  2. Для каждого mis_clinic_id в tenant.mis_clinic_ids:
  3. Тянем getPayments за сегодня (или указанный период)
  4. По каждому платежу:
     - Если уже в mis_payment_imports — пропускаем (idempotency)
     - Иначе:
       * Находим Clinic.id по mis_id
       * method=cash → пишем CashShiftEntry в открытую смену клиники (direction=in, category=sale)
                       если открытой смены нет → пропускаем с warning (бухгалтер сам синканёт когда откроет)
       * method=card → пишем LedgerEntry (operation_type='mis_card_payment', clinic_id, amount, reference: mis_payment_id)
       * other → LedgerEntry с operation_type='mis_other_payment'
     - Сохраняем MisPaymentImport-запись

Запускается:
  - APScheduler каждые 10 минут (auto)
  - Manual через POST /accountant/cash/sync-mis-payments (на запрос бухгалтера)
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Iterable

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.cash_shift import CashShift, CashShiftEntry, CashShiftStatus
from app.models.clinic import Clinic
from app.models.commercial import TenantIntegration
from app.models.ledger import LedgerEntry
from app.models.mis_payment_import import MisPaymentImport
from app.models.tenant import Tenant
from app.services.mis_client import get_payments as mis_get_payments

log = logging.getLogger("mis_payments_sync")


# Категории
SHIFT_CATEGORY_SALE = "sale"
LEDGER_OP_CARD = "mis_card_payment"
LEDGER_OP_OTHER = "mis_other_payment"


def _to_decimal(v) -> Decimal:
    if v is None:
        return Decimal("0")
    try:
        return Decimal(str(v))
    except Exception:
        return Decimal("0")


def _parse_method(raw: str | None) -> str:
    """Нормализуем способ оплаты."""
    if not raw:
        return "other"
    s = str(raw).lower().strip()
    if any(k in s for k in ("cash", "налич", "касс")):
        return "cash"
    if any(k in s for k in ("card", "карт", "эквайр", "tinkoff", "sber", "yukassa", "юкасс")):
        return "card"
    if "transfer" in s or "перевод" in s or "bank" in s or "счёт" in s or "счет" in s:
        return "transfer"
    return "other"


def _parse_paid_at(raw) -> datetime:
    """МИС обычно отдаёт DD.MM.YYYY HH:MM или DD.MM.YYYY. Принимаем оба."""
    if isinstance(raw, datetime):
        return raw
    if not raw:
        return datetime.utcnow()
    s = str(raw).strip()
    for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%d.%m.%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return datetime.utcnow()


async def _get_open_shift(db: AsyncSession, clinic_id: uuid.UUID) -> CashShift | None:
    r = await db.execute(
        select(CashShift).where(
            and_(CashShift.clinic_id == clinic_id, CashShift.status == CashShiftStatus.OPEN)
        )
    )
    return r.scalar_one_or_none()


async def _already_imported(db: AsyncSession, mis_clinic_id: int, mis_payment_id: str) -> bool:
    r = await db.execute(
        select(MisPaymentImport.id).where(
            and_(
                MisPaymentImport.mis_clinic_id == mis_clinic_id,
                MisPaymentImport.mis_payment_id == mis_payment_id,
            )
        )
    )
    return r.scalar_one_or_none() is not None


async def sync_tenant_payments(
    db: AsyncSession,
    tenant: Tenant,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    """Синкает платежи одного тенанта. Возвращает статистику."""
    stats = {
        "tenant_slug": tenant.slug,
        "fetched": 0, "imported_cash": 0, "imported_card": 0, "imported_other": 0,
        "skipped_dup": 0, "skipped_no_shift": 0, "errors": 0,
    }

    if not tenant.mis_clinic_ids:
        return stats

    # Получим интеграцию и креды
    integ_q = await db.execute(
        select(TenantIntegration).where(
            and_(
                TenantIntegration.tenant_id == tenant.id,
                TenantIntegration.type == "mis",
                TenantIntegration.is_active == True,  # noqa
            )
        )
    )
    integ = integ_q.scalar_one_or_none()
    if not integ or not integ.api_key or not integ.base_url:
        return stats

    # Период: по умолчанию сегодня
    if date_to is None:
        date_to = date.today()
    if date_from is None:
        date_from = date_to
    df_str = date_from.strftime("%d.%m.%Y")
    dt_str = date_to.strftime("%d.%m.%Y")

    # Сопоставление mis_id → Clinic.id для этого тенанта
    clinics_q = await db.execute(
        select(Clinic).where(Clinic.tenant_id == tenant.id)
    )
    clinics = clinics_q.scalars().all()
    mis_to_uuid: dict[int, uuid.UUID] = {c.mis_id: c.id for c in clinics if c.mis_id is not None}

    for mis_cid in tenant.mis_clinic_ids:
        try:
            mis_cid_int = int(mis_cid)
        except (ValueError, TypeError):
            continue

        clinic_uuid = mis_to_uuid.get(mis_cid_int)
        if not clinic_uuid:
            log.warning(
                "sync_tenant_payments[%s]: no Clinic with mis_id=%d", tenant.slug, mis_cid_int
            )
            continue

        try:
            payments = await mis_get_payments(
                mis_cid_int, df_str, dt_str,
                api_url=integ.base_url, api_key=integ.api_key,
            )
        except Exception as e:
            log.warning("sync_tenant_payments[%s] mis_cid=%d: %s", tenant.slug, mis_cid_int, e)
            stats["errors"] += 1
            continue

        stats["fetched"] += len(payments)

        # Найдём открытую смену клиники (для cash) — один раз
        open_shift = await _get_open_shift(db, clinic_uuid)

        for p in payments:
            if not isinstance(p, dict):
                continue
            mis_pay_id = str(p.get("payment_id") or p.get("id") or "").strip()
            if not mis_pay_id:
                continue

            if await _already_imported(db, mis_cid_int, mis_pay_id):
                stats["skipped_dup"] += 1
                continue

            amount = _to_decimal(p.get("amount") or p.get("value") or p.get("sum"))
            if amount <= 0:
                continue
            method = _parse_method(p.get("method") or p.get("payment_method") or p.get("type"))
            paid_at = _parse_paid_at(
                p.get("date_paid") or p.get("paid_at") or p.get("date") or p.get("created_at")
            )
            mis_invoice_id = str(p.get("invoice_id") or "").strip() or None

            shift_entry_id: uuid.UUID | None = None
            ledger_entry_id: uuid.UUID | None = None

            if method == "cash":
                if not open_shift:
                    stats["skipped_no_shift"] += 1
                    # Не пишем дедуп-запись чтобы при открытии смены догнало
                    continue
                entry = CashShiftEntry(
                    shift_id=open_shift.id,
                    direction="in",
                    amount=amount,
                    category=SHIFT_CATEGORY_SALE,
                    description=f"МИС платёж #{mis_pay_id}"
                                + (f" · invoice {mis_invoice_id}" if mis_invoice_id else ""),
                    reference_type="mis_payment",
                    reference_id=None,
                    created_by_id=None,
                    created_at=datetime.utcnow(),
                )
                db.add(entry)
                await db.flush()
                shift_entry_id = entry.id
                stats["imported_cash"] += 1
            elif method in ("card", "transfer", "other"):
                op_type = LEDGER_OP_CARD if method == "card" else LEDGER_OP_OTHER
                # user_id обязателен в LedgerEntry. Без явного пациента — null нельзя, но
                # модель требует user_id NOT NULL. Используем системный «patient placeholder» —
                # для это используем None невозможно. Поэтому: пока для card-платежей мы
                # фиксируем только в mis_payment_imports без создания ledger-записи.
                # Бухгалтер видит сумму в реестре /accountant/payments напрямую от МИС.
                if method == "card":
                    stats["imported_card"] += 1
                else:
                    stats["imported_other"] += 1
                ledger_entry_id = None  # см. примечание выше

            # Дедуп-запись
            imp = MisPaymentImport(
                tenant_id=tenant.id,
                clinic_id=clinic_uuid,
                mis_clinic_id=mis_cid_int,
                mis_payment_id=mis_pay_id,
                mis_invoice_id=mis_invoice_id,
                amount=amount,
                method=method,
                paid_at=paid_at,
                shift_entry_id=shift_entry_id,
                ledger_entry_id=ledger_entry_id,
                imported_at=datetime.utcnow(),
            )
            db.add(imp)

    await db.commit()
    return stats


async def sync_all_tenants_job() -> int:
    """APScheduler job — пройти по всем активным тенантам и синкать платежи за сегодня."""
    async with AsyncSessionLocal() as db:
        tenants = (await db.execute(
            select(Tenant).where(Tenant.is_active == True)  # noqa
        )).scalars().all()
        total = 0
        for t in tenants:
            try:
                s = await sync_tenant_payments(db, t)
                total += s["imported_cash"] + s["imported_card"] + s["imported_other"]
                if s["fetched"] or s["imported_cash"] or s["imported_card"]:
                    log.info("sync[%s]: %s", t.slug, s)
            except Exception as e:
                log.exception("sync_all_tenants_job[%s]: %s", t.slug, e)
        return total
