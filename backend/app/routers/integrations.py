from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy import text as sql_text
import json as _json
from pydantic import BaseModel
from app.database import get_db
from app.models.referral import Referral, ReferralStatus
from app.models.clinic import Clinic
from app.config import settings
from app.utils.phone import phone_variants

router = APIRouter(prefix="/integrations", tags=["integrations"])


class MISWebhookPayload(BaseModel):
    event: str              # "patient_visited"
    patient_phone: str
    clinic_mis_id: int | None = None    # id клиники в МИС (1, 4 или 26)
    service_code: str | None = None
    referral_id: str | None = None      # UUID направления (если известен)


@router.post("/mis/webhook")
async def mis_webhook(
    payload: MISWebhookPayload,
    x_api_key: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Вебхук от МИС: пациент пришёл на приём → авто-подтверждение направления.
    Авторизация: заголовок X-Api-Key должен совпадать с WEBHOOK_API_KEY из .env.

    Алгоритм поиска направления:
    1. Если передан referral_id — ищем напрямую по UUID.
    2. Иначе — ищем CREATED направление по patient_phone (+ опционально по to_clinic).
    """
    # Используем отдельный ключ для вебхука (не JWT-секрет)
    if not settings.webhook_api_key or x_api_key != settings.webhook_api_key:
        raise HTTPException(status_code=401, detail="Неверный API ключ")

    if payload.event != "patient_visited":
        await db.execute(sql_text(
            "INSERT INTO mis_integration_log (event_type, status, detail) VALUES ('webhook_in', 'ignored', :d)"
        ), {"d": _json.dumps({"event": payload.event})})
        await db.commit()
        return {"status": "ignored", "event": payload.event}

    # --- Способ 1: по referral_id ---
    if payload.referral_id:
        try:
            from app.services.qr_service import generate_qr_data
            from app.services.referral_service import confirm_referral
            qr = generate_qr_data(payload.referral_id)
            # confirmed_by_admin_id = None (авто-система)
            referral = await confirm_referral(db, qr, confirmed_by_admin_id=None)
            await db.commit()
            await db.execute(sql_text(
                "INSERT INTO mis_integration_log (event_type, status, detail) VALUES ('webhook_in', 'ok', :d)"
            ), {"d": _json.dumps({"method": "referral_id", "referral_id": payload.referral_id})})
            await db.commit()
            return {"status": "confirmed", "referral_id": str(referral.id), "method": "referral_id"}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # --- Способ 2: по телефону пациента ---
    variants = phone_variants(payload.patient_phone)

    # Ищем клинику по mis_id если передан
    to_clinic_id = None
    if payload.clinic_mis_id:
        clinic_result = await db.execute(
            select(Clinic).where(Clinic.mis_id == payload.clinic_mis_id)
        )
        clinic = clinic_result.scalar_one_or_none()
        if clinic:
            to_clinic_id = clinic.id

    # Ищем направление: статус CREATED + телефон совпадает (+ клиника если известна)
    for phone in variants:
        filters = [
            Referral.status == ReferralStatus.CREATED,
            Referral.patient_phone == phone,
        ]
        if to_clinic_id:
            filters.append(Referral.to_clinic_id == to_clinic_id)

        result = await db.execute(
            select(Referral)
            .where(and_(*filters))
            .order_by(Referral.created_at.desc())
            .limit(1)
        )
        referral = result.scalar_one_or_none()

        if referral:
            from datetime import datetime
            referral.status = ReferralStatus.CONFIRMED
            referral.confirmed_at = datetime.utcnow()
            # confirmed_by_admin_id остаётся NULL (авто-подтверждение системой)
            await db.commit()
            await db.execute(sql_text(
                "INSERT INTO mis_integration_log (event_type, status, detail) VALUES ('webhook_in', 'ok', :d)"
            ), {"d": _json.dumps({"method": "phone_match", "phone": phone, "referral_id": str(referral.id)})})
            await db.commit()
            return {
                "status": "confirmed",
                "referral_id": str(referral.id),
                "method": "phone_match",
                "phone_used": phone,
            }

    await db.execute(sql_text(
        "INSERT INTO mis_integration_log (event_type, status, detail) VALUES ('webhook_in', 'not_found', :d)"
    ), {"d": _json.dumps({"phone": payload.patient_phone, "clinic_mis_id": payload.clinic_mis_id})})
    await db.commit()
    return {
        "status": "not_found",
        "detail": "Активное направление с таким телефоном не найдено",
    }
