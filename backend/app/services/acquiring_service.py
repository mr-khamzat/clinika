"""
Фасад над платёжными адаптерами.

Сервисный слой:
  - init_clinic_payment           — старт оплаты (создаёт ClinicPayment + редирект)
  - update_clinic_payment_status  — обновить статус (после webhook/опроса)
  - refund_clinic_payment         — возврат

Все функции — async, ждут AsyncSession.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.payments_clinic import (
    ClinicPayment,
    ClinicPaymentStatus,
    PaymentGatewayConfig,
)
from app.services.acquiring import get_gateway


# ── Вспомогательное ──────────────────────────────────────────────────────────

async def _get_active_config(
    db: AsyncSession,
    clinic_id: uuid.UUID,
    gateway: str | None = None,
) -> PaymentGatewayConfig | None:
    """Берёт активную конфигурацию шлюза для клиники.

    Если gateway не указан — берёт первый is_active=True.
    """
    q = select(PaymentGatewayConfig).where(
        PaymentGatewayConfig.clinic_id == clinic_id,
        PaymentGatewayConfig.is_active == True,  # noqa: E712
    )
    if gateway:
        q = q.where(PaymentGatewayConfig.gateway == gateway)
    return (await db.execute(q.limit(1))).scalar_one_or_none()


# ── Публичные функции ───────────────────────────────────────────────────────

async def init_clinic_payment(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    clinic_id: uuid.UUID,
    amount: Decimal,
    description: str,
    return_url: str,
    patient_phone: str,
    patient_name: str | None = None,
    appointment_id: uuid.UUID | None = None,
    gateway: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> tuple[ClinicPayment, str]:
    """
    Инициирует платёж пациента через активный шлюз клиники.

    Возвращает (ClinicPayment, payment_url для редиректа).

    Бросает:
      - LookupError       — нет активного шлюза
      - NotImplementedError — адаптер пока заглушка (ловится на уровне роутера → 501)
    """
    cfg = await _get_active_config(db, clinic_id, gateway=gateway)
    if cfg is None:
        raise LookupError(
            "Для клиники не настроен ни один активный шлюз приёма оплаты. "
            "Откройте «Настройки → Онлайн-оплата»."
        )

    # 1) Локально создаём pending-платёж (нужен id для metadata.idempotency_key)
    payment = ClinicPayment(
        tenant_id=tenant_id,
        clinic_id=clinic_id,
        appointment_id=appointment_id,
        patient_phone=patient_phone,
        patient_name=patient_name,
        amount=Decimal(amount),
        gateway=cfg.gateway,
        status=ClinicPaymentStatus.PENDING,
        description=description,
        return_url=return_url,
        payment_metadata=dict(metadata or {}),
    )
    db.add(payment)
    await db.flush()

    # 2) Зовём шлюз
    adapter = get_gateway(cfg.gateway, cfg)
    init_meta = {
        "internal_payment_id": str(payment.id),
        "tenant_id": str(tenant_id),
        "clinic_id": str(clinic_id),
        **(metadata or {}),
    }
    res = await adapter.init_payment(
        amount=Decimal(amount),
        description=description,
        return_url=return_url,
        metadata=init_meta,
    )

    # 3) Записываем gateway_payment_id и raw
    payment.gateway_payment_id = res.payment_id
    new_meta = dict(payment.payment_metadata or {})
    new_meta["gateway_init"] = res.raw
    payment.payment_metadata = new_meta
    payment.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(payment)
    return payment, res.payment_url


async def update_clinic_payment_status(
    db: AsyncSession,
    *,
    payment_id: uuid.UUID,
    status: str,
    paid_at: datetime | None = None,
    raw: dict[str, Any] | None = None,
) -> ClinicPayment | None:
    """Обновляет статус ClinicPayment (после webhook/опроса)."""
    payment = await db.get(ClinicPayment, payment_id)
    if payment is None:
        return None

    payment.status = status
    if status == ClinicPaymentStatus.SUCCEEDED and paid_at is not None:
        payment.paid_at = paid_at
    if status == ClinicPaymentStatus.REFUNDED:
        payment.refunded_at = datetime.utcnow()

    if raw:
        meta = dict(payment.payment_metadata or {})
        webhooks = list(meta.get("webhook_events") or [])
        webhooks.append({"received_at": datetime.utcnow().isoformat(), "raw": raw, "status": status})
        meta["webhook_events"] = webhooks[-20:]   # держим последние 20 событий
        payment.payment_metadata = meta

    payment.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(payment)
    return payment


async def refund_clinic_payment(
    db: AsyncSession,
    *,
    payment_id: uuid.UUID,
    amount: Decimal | None = None,
) -> dict[str, Any]:
    """
    Возврат через шлюз. amount=None — полный возврат.
    Не меняет статус локально — это сделает webhook (или вызывающий после).
    """
    payment = await db.get(ClinicPayment, payment_id)
    if payment is None:
        raise LookupError("Платёж не найден")
    if not payment.gateway_payment_id:
        raise LookupError("У платежа нет gateway_payment_id — возврат невозможен")

    cfg = await _get_active_config(db, payment.clinic_id, gateway=payment.gateway)
    if cfg is None:
        raise LookupError(f"Конфиг шлюза {payment.gateway} не найден для клиники {payment.clinic_id}")

    adapter = get_gateway(payment.gateway, cfg)
    raw = await adapter.refund(payment.gateway_payment_id, amount=amount)
    return {"payment_id": str(payment.id), "raw": raw}
