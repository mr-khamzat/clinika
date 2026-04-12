# ===== БЛОК: Настройки системы =====
# Комиссия, общие настройки, статус МИС.
# /manager/settings/*, /manager/mis/status

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.services import audit_service
from app.services.audit_service import AuditAction
from app.models.user import User, UserRole
from app.schemas.manager import CommissionSettings, UpdateCommissionRequest
from app.services.settings_service import get_setting, set_setting

router = APIRouter(tags=["manager:settings"])


@router.get("/settings/commission", response_model=CommissionSettings)
async def get_commission_settings(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    enabled = (await get_setting(db, "commission_enabled", "false")) == "true"
    rate = float(await get_setting(db, "commission_rate", "10"))
    receiver_id_str = await get_setting(db, "commission_receiver_id", "")
    receiver_name = None
    receiver_uuid = None
    if receiver_id_str:
        try:
            receiver_uuid = uuid.UUID(receiver_id_str)
            u = await db.execute(select(User).where(User.id == receiver_uuid))
            u_obj = u.scalar_one_or_none()
            if u_obj: receiver_name = u_obj.full_name
        except Exception:
            pass
    return CommissionSettings(commission_enabled=enabled, commission_rate=rate,
        commission_receiver_id=receiver_uuid, commission_receiver_name=receiver_name)


@router.patch("/settings/commission", response_model=CommissionSettings)
async def update_commission_settings(
    body: UpdateCommissionRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    if body.commission_enabled is not None:
        await set_setting(db, "commission_enabled", "true" if body.commission_enabled else "false")
    if body.commission_rate is not None:
        if not (0 < body.commission_rate <= 100):
            raise HTTPException(status_code=400, detail="Ставка комиссии должна быть от 0.1 до 100")
        await set_setting(db, "commission_rate", str(body.commission_rate))
    if body.commission_receiver_id is not None:
        u = await db.execute(select(User).where(User.id == body.commission_receiver_id, User.role == UserRole.MANAGER, User.is_active == True))
        if not u.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Руководитель не найден")
        await set_setting(db, "commission_receiver_id", str(body.commission_receiver_id))
    return await get_commission_settings(current_user=current_user, db=db)


@router.get("/settings/general", response_model=dict)
async def get_general_settings(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    keys = [
        "mis_api_url", "mis_api_key",
        "telegram_notify_enabled", "telegram_chat_id", "telegram_bot_token",
        "telegram_notify_cancel", "telegram_notify_big_bonus", "telegram_big_bonus_threshold",
        "telegram_daily_report", "telegram_daily_report_time",
    ]
    return {key: await get_setting(db, key, "") for key in keys}


@router.patch("/settings/general", response_model=dict)
async def update_general_settings(
    body: dict,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    allowed_keys = {
        "mis_api_url", "mis_api_key",
        "telegram_notify_enabled", "telegram_chat_id", "telegram_bot_token",
        "telegram_notify_cancel", "telegram_notify_big_bonus", "telegram_big_bonus_threshold",
        "telegram_daily_report", "telegram_daily_report_time",
    }
    for key, value in body.items():
        if key in allowed_keys:
            await set_setting(db, key, str(value))
    return {"status": "ok"}


@router.post("/settings/test-mis", response_model=dict)
async def test_mis_connection(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    from app.services.mis_client import get_clinics
    try:
        clinics = await get_clinics()
        return {"status": "ok", "message": f"Соединение успешно, клиник в МИС: {len(clinics)}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/mis/status", response_model=dict)
async def get_mis_status(current_user: User = Depends(require_manager)):
    from app.services.mis_client import get_clinics
    try:
        clinics = await get_clinics()
        return {"online": len(clinics) > 0, "clinic_count": len(clinics)}
    except Exception as e:
        return {"online": False, "error": str(e)}
