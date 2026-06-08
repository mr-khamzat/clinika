"""
Фасад над платёжными адаптерами.

Сервисный слой:
  - init_clinic_payment           — старт оплаты (создаёт ClinicPayment + редирект)
  - update_clinic_payment_status  — обновить статус (после webhook/опроса)
  - refund_clinic_payment         — возврат

Все функции — async, ждут AsyncSession.
"""
from __future__ import annotations

import logging
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

log = logging.getLogger("acquiring_service")

# Терминальные статусы: после них «откат» в нетерминальный (поздний/повторный
# webhook с pending) запрещён — иначе выручка (_sum_revenue по SUCCEEDED) поедет.
_TERMINAL_STATUSES = frozenset({
    ClinicPaymentStatus.SUCCEEDED,
    ClinicPaymentStatus.REFUNDED,
})

# Допуск при сверке сумм (копейки округляются до 0.01).
_AMOUNT_EPS = Decimal("0.01")


# ── Вспомогательное ──────────────────────────────────────────────────────────


def _quantize(value: Decimal) -> Decimal:
    return Decimal(value).quantize(_AMOUNT_EPS)


async def _confirm_via_adapter(
    db: AsyncSession,
    payment: ClinicPayment,
    gateway_payment_id: str | None,
) -> tuple[bool, Decimal | None]:
    """Авторитетная сверка статуса платежа через adapter.get_status.

    Возвращает (verified, authoritative_amount):
      - verified=True  — шлюз подтвердил статус succeeded (можно доверять);
      - verified=False — шлюз-заглушка/недоступен/нет get_status; статус
        succeeded можно ставить ТОЛЬКО при совпадении суммы webhook'а
        (осознанный компромисс для шлюзов без реального get_status).
    authoritative_amount — сумма из ответа шлюза (если удалось извлечь).
    """
    gw_pid = gateway_payment_id or payment.gateway_payment_id
    if not gw_pid:
        return False, None

    cfg = await _get_active_config(db, payment.clinic_id, gateway=payment.gateway)
    try:
        adapter = get_gateway(payment.gateway, cfg)
        result = await adapter.get_status(str(gw_pid))
    except NotImplementedError:
        # Шлюз-заглушка (tinkoff/sber/...) — get_status ещё не реализован.
        return False, None
    except Exception as e:  # noqa: BLE001 — сеть/конфиг/KeyError/LookupError
        # Не доверяем и не падаем — деградируем; решение о succeeded примет
        # сверка суммы выше по стеку (verified=False).
        log.warning(
            "confirm_via_adapter(payment_id=%s) get_status failed: %s",
            payment.id, e,
        )
        return False, None

    authoritative_amount: Decimal | None = getattr(result, "amount", None)
    if authoritative_amount is None:
        amount_val = (result.raw.get("amount") or {}).get("value") if result.raw else None
        if amount_val is not None:
            try:
                authoritative_amount = Decimal(str(amount_val))
            except (ValueError, ArithmeticError):
                authoritative_amount = None

    verified = result.status == ClinicPaymentStatus.SUCCEEDED
    return verified, authoritative_amount


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
    webhook_amount: Decimal | None = None,
    gateway_payment_id: str | None = None,
) -> ClinicPayment | None:
    """Обновляет статус ClinicPayment (после webhook/опроса).

    Защита от доверия непроверенному webhook (находка #16):
      1) Машина переходов: терминальный статус (succeeded/refunded) НЕ
         перезаписывается поздним нетерминальным (pending/cancelled) — событие
         только дозаписывается в аудит. REFUNDED допустим только из SUCCEEDED.
      2) Переход в SUCCEEDED обусловлен:
         - сверкой суммы: webhook_amount (если передан) должен совпасть с
           payment.amount с точностью до копейки; иначе — пометка
           amount_mismatch и статус НЕ ставится в succeeded;
         - авторитетной сверкой через adapter.get_status; если шлюз не
           подтвердил (заглушка/недоступен), succeeded ставится только при
           совпадении суммы (verified=False, осознанный компромисс).

    Все принятые события всегда пишутся в payment_metadata.webhook_events (аудит),
    даже если статус решено не менять.
    """
    payment = await db.get(ClinicPayment, payment_id)
    if payment is None:
        return None

    current = payment.status
    requested = status
    decision: str = requested          # к чему в итоге придём
    note: str | None = None            # отметка причины для аудита

    is_terminal_now = current in _TERMINAL_STATUSES
    is_requested_terminal = requested in _TERMINAL_STATUSES

    if requested == current:
        # Идемпотентный повтор — статус не трогаем, событие зальём в аудит.
        decision = current
        note = "duplicate"
    elif is_terminal_now and not is_requested_terminal:
        # Поздний/повторный webhook с откатом в нетерминальный — запрещено.
        decision = current
        note = "downgrade_blocked"
    elif requested == ClinicPaymentStatus.REFUNDED:
        # REFUNDED допустим только из SUCCEEDED.
        if current == ClinicPaymentStatus.SUCCEEDED:
            decision = ClinicPaymentStatus.REFUNDED
        else:
            decision = current
            note = "refund_without_success_blocked"
    elif requested == ClinicPaymentStatus.SUCCEEDED:
        # Самый чувствительный переход: сверяем сумму и подтверждаем через шлюз.
        expected = _quantize(payment.amount or Decimal("0"))
        amount_ok = True
        if webhook_amount is not None:
            amount_ok = _quantize(webhook_amount) == expected

        verified, authoritative_amount = await _confirm_via_adapter(
            db, payment, gateway_payment_id
        )
        if authoritative_amount is not None:
            # Авторитетная сумма из шлюза тоже обязана совпасть.
            amount_ok = amount_ok and (_quantize(authoritative_amount) == expected)

        if not amount_ok:
            decision = current
            note = "amount_mismatch"
            log.warning(
                "payment_id=%s succeeded ОТКЛОНЁН: amount_mismatch "
                "(expected=%s webhook=%s authoritative=%s verified=%s)",
                payment.id, expected, webhook_amount, authoritative_amount, verified,
            )
        elif not verified:
            # Шлюз не подтвердил (заглушка/недоступен), но сумма совпала —
            # осознанный компромисс: ставим succeeded, но помечаем unverified.
            decision = ClinicPaymentStatus.SUCCEEDED
            note = "unverified_amount_ok"
        else:
            decision = ClinicPaymentStatus.SUCCEEDED
    # прочие переходы (pending→cancelled и т.п.) — разрешены как есть

    payment.status = decision
    if decision == ClinicPaymentStatus.SUCCEEDED and paid_at is not None:
        payment.paid_at = paid_at
    if decision == ClinicPaymentStatus.REFUNDED:
        payment.refunded_at = datetime.utcnow()

    # Аудит: КАЖДОЕ принятое событие пишем в webhook_events (как обещает докстринг),
    # даже на чистом успехе без note/raw — иначе аудит-трейл неполный.
    meta = dict(payment.payment_metadata or {})
    webhooks = list(meta.get("webhook_events") or [])
    event: dict[str, Any] = {
        "received_at": datetime.utcnow().isoformat(),
        "raw": raw,
        "requested_status": requested,
        "applied_status": decision,
    }
    if note is not None:
        event["note"] = note
    webhooks.append(event)
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
    Не меняет статус на REFUNDED локально — это сделает webhook (или вызывающий
    после). Но фиксирует факт инициированного возврата в payment_metadata для
    идемпотентности.

    Защита (находка #36):
      - возврат разрешён только из статуса SUCCEEDED;
      - сумма возврата не может превышать сумму платежа;
      - повторный успешный возврат блокируется (idempotency по payment_id):
        если уже стоит статус REFUNDED либо в metadata есть отметка
        refund_initiated — повторно к шлюзу не идём.
    """
    # Блокируем строку платежа на время операции (SELECT ... FOR UPDATE на PG),
    # чтобы идемпотентность держалась и при конкурентных запросах возврата.
    is_pg = False
    try:
        is_pg = db.bind is not None and db.bind.dialect.name == "postgresql"
    except Exception:
        is_pg = False

    if is_pg:
        payment = (await db.execute(
            select(ClinicPayment)
            .where(ClinicPayment.id == payment_id)
            .with_for_update()
        )).scalar_one_or_none()
    else:
        payment = await db.get(ClinicPayment, payment_id)

    if payment is None:
        raise LookupError("Платёж не найден")
    if not payment.gateway_payment_id:
        raise LookupError("У платежа нет gateway_payment_id — возврат невозможен")

    # Идемпотентность: уже возвращён.
    if payment.status == ClinicPaymentStatus.REFUNDED:
        raise LookupError("Платёж уже возвращён")

    # Возврат допустим только из успешного платежа.
    if payment.status != ClinicPaymentStatus.SUCCEEDED:
        raise LookupError(
            f"Возврат недоступен: статус платежа {payment.status} (ожидался succeeded)"
        )

    meta = dict(payment.payment_metadata or {})
    if meta.get("refund_initiated"):
        raise LookupError("Возврат уже инициирован для этого платежа")

    # Ограничиваем сумму возврата суммой платежа.
    paid_amount = _quantize(payment.amount or Decimal("0"))
    if amount is not None:
        refund_amount = _quantize(amount)
        if refund_amount <= 0:
            raise LookupError("Сумма возврата должна быть положительной")
        if refund_amount - paid_amount > _AMOUNT_EPS:
            raise LookupError(
                f"Сумма возврата {refund_amount} превышает сумму платежа {paid_amount}"
            )
    else:
        refund_amount = None

    cfg = await _get_active_config(db, payment.clinic_id, gateway=payment.gateway)
    if cfg is None:
        raise LookupError(f"Конфиг шлюза {payment.gateway} не найден для клиники {payment.clinic_id}")

    # Отмечаем инициацию ДО вызова шлюза — параллельный повторный возврат
    # упрётся в refund_initiated. Лочим строку платежа на время операции.
    meta["refund_initiated"] = {
        "at": datetime.utcnow().isoformat(),
        "amount": str(refund_amount) if refund_amount is not None else str(paid_amount),
    }
    payment.payment_metadata = meta
    await db.flush()

    adapter = get_gateway(payment.gateway, cfg)
    raw = await adapter.refund(payment.gateway_payment_id, amount=refund_amount)
    return {"payment_id": str(payment.id), "raw": raw}
