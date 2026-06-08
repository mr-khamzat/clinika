"""
Endpoints для интернет-эквайринга клиники (модуль online_payments_pro).

Маршруты:
  POST /payments/init                  — старт оплаты (любой авторизованный)
  GET  /payments/{id}                  — статус (manager+)
  POST /payments/{id}/refund           — возврат (manager+)
  POST /webhooks/payment/{gateway}     — приём webhook от шлюза (без auth)
  GET  /clinics/{cid}/payments         — список платежей (manager+)
  GET  /clinics/{cid}/payment-config   — текущий конфиг шлюза (manager+)
  PUT  /clinics/{cid}/payment-config   — обновить конфиг (manager+)

Все маршруты (кроме webhook и чтения конфига) требуют активной подписки модуля.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_manager, get_tenant_db
from app.core.region_lock import enforce_region_lock
from app.core.tenant import get_current_tenant, require_module
from app.database import get_db
from app.models.clinic import Clinic
from app.models.payments_clinic import (
    ClinicPayment,
    ClinicPaymentStatus,
    PaymentGateway,
    PaymentGatewayConfig,
)
from app.models.tenant import Tenant
from app.models.user import User
from app.services.acquiring import get_gateway, list_registered as list_gateways
from app.services.acquiring_service import (
    init_clinic_payment,
    refund_clinic_payment,
    update_clinic_payment_status,
)


router = APIRouter(tags=["clinic_payments"])

_pay_module = Depends(require_module("online_payments_pro"))


async def _verify_clinic(db: AsyncSession, tenant_id: uuid.UUID, clinic_id: uuid.UUID) -> Clinic:
    """Проверяет, что clinic_id принадлежит тенанту (защита от IDOR).

    Строгое равенство по tenant_id: клиника с tenant_id=NULL не пройдёт.
    Возвращаем 404 (а не 403), чтобы не подтверждать существование чужого clinic_id.
    """
    clinic = (await db.execute(
        select(Clinic).where(Clinic.id == clinic_id, Clinic.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not clinic:
        raise HTTPException(status_code=404, detail="Клиника не найдена")
    return clinic


# ── Pydantic ─────────────────────────────────────────────────────────────────

class PaymentInitRequest(BaseModel):
    appointment_id: Optional[uuid.UUID] = None
    amount: Decimal = Field(..., gt=0, description="Сумма в рублях")
    description: str = Field(..., max_length=500)
    return_url: str = Field(..., max_length=500)
    gateway: Optional[str] = None  # явно выбрать шлюз; None — берём активный
    patient_phone: str = Field(..., max_length=32)
    patient_name: Optional[str] = None


class PaymentConfigBody(BaseModel):
    gateway: str
    shop_id: str
    secret_key: Optional[str] = None         # None = не менять текущий
    is_active: bool = True
    is_test_mode: bool = True
    config: dict[str, Any] = Field(default_factory=dict)


# ── Сериализация ─────────────────────────────────────────────────────────────

def _serialize_payment(p: ClinicPayment) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "tenant_id": str(p.tenant_id),
        "clinic_id": str(p.clinic_id),
        "appointment_id": str(p.appointment_id) if p.appointment_id else None,
        "patient_phone": p.patient_phone,
        "patient_name": p.patient_name,
        "amount": float(p.amount or 0),
        "gateway": p.gateway,
        "gateway_payment_id": p.gateway_payment_id,
        "status": p.status,
        "description": p.description,
        "return_url": p.return_url,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "paid_at": p.paid_at.isoformat() if p.paid_at else None,
        "refunded_at": p.refunded_at.isoformat() if p.refunded_at else None,
    }


def _serialize_config(c: PaymentGatewayConfig) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "clinic_id": str(c.clinic_id),
        "gateway": c.gateway,
        "shop_id": c.shop_id,
        "secret_key_present": bool(c.secret_key),
        "is_active": c.is_active,
        "is_test_mode": c.is_test_mode,
        "config": c.config or {},
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


# ── 1) Инициация платежа ─────────────────────────────────────────────────────

@router.post("/payments/init", dependencies=[_pay_module, Depends(enforce_region_lock)])
async def init_payment(
    body: PaymentInitRequest,
    user: User = Depends(get_current_user),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """
    Старт оплаты пациентом. Возвращает payment_url для редиректа.
    501 если шлюз ещё не реализован (заглушка NotImplementedError).
    """
    if tenant is None:
        raise HTTPException(status_code=403, detail="Тенант не определён")

    clinic_id = getattr(user, "clinic_id", None)
    if clinic_id is None:
        raise HTTPException(status_code=400, detail="У пользователя не указана клиника")

    try:
        payment, payment_url = await init_clinic_payment(
            db,
            tenant_id=tenant.id,
            clinic_id=clinic_id,
            amount=body.amount,
            description=body.description,
            return_url=body.return_url,
            patient_phone=body.patient_phone,
            patient_name=body.patient_name,
            appointment_id=body.appointment_id,
            gateway=body.gateway,
        )
    except LookupError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        # Эквайринг не сконфигурирован (нет ключей в .env / БД)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Эквайринг не настроен: {e}",
        )
    except NotImplementedError as e:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=f"Реальный шлюз не подключён: {e}",
        )

    return {"payment": _serialize_payment(payment), "payment_url": payment_url}


# ── 2) Статус платежа ────────────────────────────────────────────────────────

@router.get("/payments/{payment_id}", dependencies=[Depends(require_manager), _pay_module])
async def get_payment(
    payment_id: uuid.UUID = Path(...),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    p = await db.get(ClinicPayment, payment_id)
    if not p or (tenant and p.tenant_id != tenant.id):
        raise HTTPException(status_code=404, detail="Платёж не найден")
    return _serialize_payment(p)


# ── 3) Возврат ───────────────────────────────────────────────────────────────

@router.post("/payments/{payment_id}/refund", dependencies=[Depends(require_manager), _pay_module, Depends(enforce_region_lock)])
async def refund_payment(
    payment_id: uuid.UUID = Path(...),
    amount: Optional[Decimal] = Body(None, embed=True),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    p = await db.get(ClinicPayment, payment_id)
    if not p or (tenant and p.tenant_id != tenant.id):
        raise HTTPException(status_code=404, detail="Платёж не найден")
    try:
        return await refund_clinic_payment(db, payment_id=payment_id, amount=amount)
    except LookupError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Возврат не выполнен — {e}",
        )
    except NotImplementedError as e:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=f"Возврат через {p.gateway} не реализован: {e}",
        )


# ── 4) Webhook от шлюза ──────────────────────────────────────────────────────

@router.post("/webhooks/payment/{gateway}")
async def payment_webhook(
    request: Request,
    gateway: str = Path(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Приём webhook'а от шлюза. Без auth — подлинность проверяется через
    verify_webhook конкретного адаптера (для ЮKassa — IP allowlist).

    Маршрут поиска платежа:
      1) metadata.internal_payment_id — наш ClinicPayment.id (передаётся при init);
      2) metadata.invoice_id           — Invoice (подписки платформы);
      3) gateway_payment_id            — fallback по ID платежа шлюза.
    """
    if gateway not in list_gateways():
        raise HTTPException(status_code=404, detail=f"Шлюз '{gateway}' неизвестен")

    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}

    # Сначала пытаемся определить платёж ДО verify по metadata.internal_payment_id
    # из сырого тела — чтобы выбрать конфиг шлюза ИМЕННО этого тенанта/клиники
    # (его секрет), а не первого попавшегося активного конфига.
    pre_payment: ClinicPayment | None = None
    try:
        import json as _json
        _raw_pre = _json.loads(body.decode("utf-8") or "{}")
        _meta_pre = (_raw_pre.get("object") or {}).get("metadata") or {}
        _internal_pre = _meta_pre.get("internal_payment_id")
        if _internal_pre:
            pre_payment = await db.get(ClinicPayment, uuid.UUID(str(_internal_pre)))
    except (UnicodeDecodeError, ValueError, TypeError):
        pre_payment = None

    cfg = None
    if pre_payment is not None:
        # Конфиг строго того же тенанта/клиники/шлюза, что и платёж.
        cfg = (await db.execute(
            select(PaymentGatewayConfig).where(
                PaymentGatewayConfig.gateway == gateway,
                PaymentGatewayConfig.tenant_id == pre_payment.tenant_id,
                PaymentGatewayConfig.clinic_id == pre_payment.clinic_id,
                PaymentGatewayConfig.is_active == True,  # noqa: E712
            ).limit(1)
        )).scalar_one_or_none()

    if cfg is None:
        # Fallback: платёж не опознан заранее (или конфиг для него не настроен) —
        # берём первый активный конфиг шлюза. Если его нет — адаптер обязан
        # использовать ENV и сам бросить RuntimeError, если ENV пуст. Для ЮKassa
        # verify_webhook не требует ни того, ни другого.
        cfg = (await db.execute(
            select(PaymentGatewayConfig).where(
                PaymentGatewayConfig.gateway == gateway,
                PaymentGatewayConfig.is_active == True,  # noqa: E712
            ).limit(1)
        )).scalar_one_or_none()

    adapter = get_gateway(gateway, cfg)  # cfg может быть None — адаптер должен это пережить
    try:
        parsed = await adapter.verify_webhook(headers, body)
    except NotImplementedError as e:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))

    if parsed is None:
        # Подпись битая или IP не из allowlist
        raise HTTPException(status_code=403, detail="Webhook не прошёл проверку подлинности")

    # Контракт parsed: {payment_id, status, paid_at?, raw, event?}
    gateway_payment_id = parsed.get("payment_id")
    new_status = parsed.get("status")
    raw = parsed.get("raw") or {}

    # 1) Попытка найти по metadata (для платежей через init_clinic_payment).
    metadata = (raw.get("object") or {}).get("metadata") or {}
    internal_id = metadata.get("internal_payment_id")
    invoice_id_meta = metadata.get("invoice_id")

    payment: ClinicPayment | None = None
    if internal_id:
        try:
            payment = await db.get(ClinicPayment, uuid.UUID(str(internal_id)))
        except (ValueError, TypeError):
            payment = None

    # 2) Fallback по gateway_payment_id (если init проставил его)
    if payment is None and gateway_payment_id:
        payment = (await db.execute(
            select(ClinicPayment).where(ClinicPayment.gateway_payment_id == gateway_payment_id)
        )).scalar_one_or_none()

    paid_at = parsed.get("paid_at")
    if isinstance(paid_at, str):
        try:
            paid_at = datetime.fromisoformat(paid_at)
        except ValueError:
            paid_at = None

    if payment is not None:
        # Сумма из webhook'а (для сверки против payment.amount перед succeeded).
        # У ЮKassa лежит в object.amount.value; для прочих — None (тогда сверка
        # опирается на authoritative get_status, см. acquiring_service).
        webhook_amount: Optional[Decimal] = None
        yk_amount_val = ((raw.get("object") or {}).get("amount") or {}).get("value")
        if yk_amount_val is not None:
            try:
                webhook_amount = Decimal(str(yk_amount_val))
            except (ValueError, ArithmeticError):
                webhook_amount = None
        await update_clinic_payment_status(
            db,
            payment_id=payment.id,
            status=new_status or payment.status,
            paid_at=paid_at,
            raw=raw,
            webhook_amount=webhook_amount,
            gateway_payment_id=gateway_payment_id,
        )

    # 3) Ветка для подписки платформы (Invoice → record_payment).
    # Если webhook пришёл по Invoice (metadata.invoice_id), регистрируем платёж в billing.
    if invoice_id_meta and (new_status == "succeeded"):
        try:
            from decimal import Decimal as _D

            from app.models.billing import Invoice
            from app.services import billing_service

            inv_uuid = uuid.UUID(str(invoice_id_meta))
            invoice = await db.get(Invoice, inv_uuid)
            if invoice is not None and invoice.status != "paid":
                yk_amount = ((raw.get("object") or {}).get("amount") or {}).get("value")
                amount_dec = _D(str(yk_amount)) if yk_amount else _D(str(invoice.amount))
                await billing_service.record_payment(
                    db,
                    inv_uuid,
                    amount=amount_dec,
                    method="yookassa",
                    transaction_id=gateway_payment_id,
                    gateway=gateway,
                    meta={"webhook_event": parsed.get("event")},
                )
                await db.commit()
        except Exception as e:  # noqa: BLE001 — логируем, но всегда отдаём 200
            import logging
            logging.getLogger("clinic_payments").exception(
                "webhook → record_payment(invoice_id=%s) failed: %s", invoice_id_meta, e
            )

    if payment is None and not invoice_id_meta:
        # Платёж/счёт не найден ни по одному ключу — отдаём 200 чтобы шлюз не ретраил,
        # но логируем для отладки. Возвращать 404 нежелательно — шлюз начнёт спамить.
        import logging
        logging.getLogger("clinic_payments").warning(
            "webhook gateway=%s: платёж не найден ни по metadata ни по %s",
            gateway, gateway_payment_id,
        )

    return {"ok": True}


# ── 5) Список платежей клиники ───────────────────────────────────────────────

@router.get("/clinics/{clinic_id}/payments", dependencies=[Depends(require_manager), _pay_module])
async def list_clinic_payments(
    clinic_id: uuid.UUID = Path(...),
    status_filter: Optional[str] = Query(None, alias="status"),
    date_from: Optional[datetime] = Query(None, alias="from"),
    date_to: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(100, ge=1, le=500),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    if tenant is None:
        return []
    await _verify_clinic(db, tenant.id, clinic_id)
    q = select(ClinicPayment).where(
        ClinicPayment.tenant_id == tenant.id,
        ClinicPayment.clinic_id == clinic_id,
    )
    if status_filter:
        q = q.where(ClinicPayment.status == status_filter)
    if date_from:
        q = q.where(ClinicPayment.created_at >= date_from)
    if date_to:
        q = q.where(ClinicPayment.created_at <= date_to)
    q = q.order_by(ClinicPayment.created_at.desc()).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return [_serialize_payment(r) for r in rows]


# ── 6) Конфиг шлюза для клиники ──────────────────────────────────────────────

@router.get("/clinics/{clinic_id}/payment-config", dependencies=[Depends(require_manager)])
async def get_payment_config(
    clinic_id: uuid.UUID = Path(...),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Чтение конфига доступно даже без подписки (видно «Подключите модуль»)."""
    if tenant is None:
        return {"configs": [], "available_gateways": list_gateways()}
    await _verify_clinic(db, tenant.id, clinic_id)
    rows = (await db.execute(
        select(PaymentGatewayConfig).where(
            PaymentGatewayConfig.tenant_id == tenant.id,
            PaymentGatewayConfig.clinic_id == clinic_id,
        )
    )).scalars().all()
    return {
        "configs": [_serialize_config(r) for r in rows],
        "available_gateways": list_gateways(),
    }


@router.put("/clinics/{clinic_id}/payment-config", dependencies=[Depends(require_manager), _pay_module, Depends(enforce_region_lock)])
async def upsert_payment_config(
    body: PaymentConfigBody,
    clinic_id: uuid.UUID = Path(...),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Создаёт или обновляет конфиг шлюза (uniq по clinic_id+gateway)."""
    if tenant is None:
        raise HTTPException(status_code=403, detail="Тенант не определён")
    # IDOR-защита: clinic_id из path обязан принадлежать тенанту (404, иначе чужой
    # эквайринг можно перезаписать, подставив clinic_id другого тенанта).
    await _verify_clinic(db, tenant.id, clinic_id)
    if body.gateway not in list_gateways():
        raise HTTPException(
            status_code=400,
            detail=f"Шлюз '{body.gateway}' неизвестен. Доступны: {', '.join(list_gateways())}",
        )

    cfg = (await db.execute(
        select(PaymentGatewayConfig).where(
            and_(
                PaymentGatewayConfig.tenant_id == tenant.id,
                PaymentGatewayConfig.clinic_id == clinic_id,
                PaymentGatewayConfig.gateway == body.gateway,
            )
        )
    )).scalar_one_or_none()

    # Секрет шифруем перед записью (encryption_service: 'enc:'/'plain:').
    # Чтение — через PaymentGatewayConfig.decrypted_secret_key.
    from app.services.encryption_service import encrypt as _encrypt_secret

    if cfg is None:
        if not body.secret_key:
            raise HTTPException(status_code=400, detail="secret_key обязателен при создании")
        cfg = PaymentGatewayConfig(
            tenant_id=tenant.id,
            clinic_id=clinic_id,
            gateway=body.gateway,
            shop_id=body.shop_id,
            secret_key=_encrypt_secret(body.secret_key),
            is_active=body.is_active,
            is_test_mode=body.is_test_mode,
            config=body.config or {},
        )
        db.add(cfg)
    else:
        cfg.shop_id = body.shop_id
        if body.secret_key:
            cfg.secret_key = _encrypt_secret(body.secret_key)
        cfg.is_active = body.is_active
        cfg.is_test_mode = body.is_test_mode
        cfg.config = body.config or cfg.config or {}
        cfg.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(cfg)
    return _serialize_config(cfg)
