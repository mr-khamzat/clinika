from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy import text as sql_text
import json as _json
from typing import Optional
from pydantic import BaseModel
from app.database import get_db
from app.models.referral import Referral, ReferralStatus
from app.models.clinic import Clinic
from app.models.tenant import Tenant
from app.models.user import User
from app.config import settings
from app.core.deps import require_manager
from app.services.settings_service import get_setting, set_setting
from app.services import encryption_service
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

            # Глава 8: начисление баллов лояльности (+100) автору направления
            try:
                from app.services import loyalty_ext_service as _ls
                await _ls.award_referral(db, referral.tenant_id, referral.patient_phone, referral.id)
            except Exception:
                pass

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


# ─────────────────────────────────────────────────────────────────────
# Настройки МИС-интеграции тенанта (находка #22 — фронт FranchiseOwnerCabinet
# зовёт PATCH /integrations/mis/settings, эндпоинт не был реализован).
# ─────────────────────────────────────────────────────────────────────
class MISSettingsPatch(BaseModel):
    mis_api_url: Optional[str] = None
    mis_api_key: Optional[str] = None
    mis_clinic_ids: Optional[list] = None


@router.patch("/mis/settings")
async def update_mis_settings(
    body: MISSettingsPatch,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Обновить настройки МИС-интеграции текущего тенанта.

    Доступ: manager / franchise_owner / super_admin (require_manager).
    Tenant-скоуп: всё пишется под tenant_id текущего пользователя
    (system_settings — с префиксом тенанта; mis_clinic_ids — в Tenant).

    Секрет api_key шифруется через encryption_service.encrypt и хранится в
    отдельном ключе ``mis_api_key_enc``. Легаси-ключ ``mis_api_key`` (plaintext)
    тоже обновляется — его читают существующие потребители (mis_sync, referral
    auto-confirm, ltv, ads и т.д.) без расшифровки. PATCH-семантика: поля со
    значением None пропускаются (не затирают сохранённое).
    """
    tid = current_user.tenant_id
    if not tid:
        # super_admin без тенанта не имеет «своих» настроек МИС
        raise HTTPException(status_code=400, detail="Пользователь без tenant_id")

    if body.mis_api_url is not None:
        await set_setting(db, "mis_api_url", body.mis_api_url.strip(), tenant_id=tid)

    if body.mis_api_key is not None:
        key = body.mis_api_key.strip()
        # Зашифрованная копия секрета (encryption_service.encrypt → enc:/plain:)
        await set_setting(
            db, "mis_api_key_enc", encryption_service.encrypt(key), tenant_id=tid
        )
        # Легаси plaintext-ключ — для существующих читателей, ожидающих сырой ключ
        await set_setting(db, "mis_api_key", key, tenant_id=tid)

    if body.mis_clinic_ids is not None:
        # mis_clinic_ids живёт в Tenant (JSONB), а не в system_settings
        ids = [str(x).strip() for x in body.mis_clinic_ids if str(x).strip()]
        tenant = (
            await db.execute(select(Tenant).where(Tenant.id == tid))
        ).scalar_one_or_none()
        if not tenant:
            raise HTTPException(status_code=404, detail="Тенант не найден")
        tenant.mis_clinic_ids = ids
        await db.commit()

    # Текущее состояние (api_key не отдаём — секрет)
    saved_url = await get_setting(db, "mis_api_url", "", tenant_id=tid)
    tenant_ids = (
        await db.execute(select(Tenant.mis_clinic_ids).where(Tenant.id == tid))
    ).scalar_one_or_none()
    return {
        "status": "ok",
        "mis_api_url": saved_url,
        "mis_api_key_set": bool(
            await get_setting(db, "mis_api_key", "", tenant_id=tid)
        ),
        "mis_clinic_ids": tenant_ids or [],
    }
