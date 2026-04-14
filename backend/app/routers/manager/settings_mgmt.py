# ===== БЛОК: Настройки системы =====
# Комиссия, МИС, Telegram. Настройки изолированы по тенанту.
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
    tid = current_user.tenant_id
    enabled = (await get_setting(db, "commission_enabled", "false", tenant_id=tid)) == "true"
    rate = float(await get_setting(db, "commission_rate", "10", tenant_id=tid))
    receiver_id_str = await get_setting(db, "commission_receiver_id", "", tenant_id=tid)
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
    tid = current_user.tenant_id
    if body.commission_enabled is not None:
        await set_setting(db, "commission_enabled", "true" if body.commission_enabled else "false", tenant_id=tid)
    if body.commission_rate is not None:
        if not (0 < body.commission_rate <= 100):
            raise HTTPException(status_code=400, detail="Ставка комиссии должна быть от 0.1 до 100")
        await set_setting(db, "commission_rate", str(body.commission_rate), tenant_id=tid)
    if body.commission_receiver_id is not None:
        u = await db.execute(select(User).where(User.id == body.commission_receiver_id, User.role == UserRole.MANAGER, User.is_active == True))
        if not u.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Руководитель не найден")
        await set_setting(db, "commission_receiver_id", str(body.commission_receiver_id), tenant_id=tid)
    return await get_commission_settings(current_user=current_user, db=db)


GENERAL_SETTINGS_KEYS = {
    "mis_api_url", "mis_api_key",
    "telegram_notify_enabled", "telegram_chat_id", "telegram_bot_token",
    "telegram_notify_cancel", "telegram_notify_big_bonus", "telegram_big_bonus_threshold",
    "telegram_daily_report", "telegram_daily_report_time",
    "support_bot_token", "support_admin_chat_id",
}


@router.get("/settings/general", response_model=dict)
async def get_general_settings(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    tid = current_user.tenant_id
    result = {}
    for key in GENERAL_SETTINGS_KEYS:
        result[key] = await get_setting(db, key, "", tenant_id=tid)
    return result


@router.patch("/settings/general", response_model=dict)
async def update_general_settings(
    body: dict,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    tid = current_user.tenant_id
    for key, value in body.items():
        if key in GENERAL_SETTINGS_KEYS:
            await set_setting(db, key, str(value), tenant_id=tid)
    await audit_service.write_safe(
        db, AuditAction.SETTINGS_UPDATED,
        actor_id=current_user.id, actor_name=current_user.full_name,
        entity_type="settings", entity_id=None,
        after={k: v for k, v in body.items() if k in GENERAL_SETTINGS_KEYS and k not in ("mis_api_key", "telegram_bot_token", "support_bot_token")},
        tenant_id=tid,
    )
    return {"status": "ok"}


@router.post("/settings/test-mis", response_model=dict)
async def test_mis_connection(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    tid = current_user.tenant_id
    api_url = await get_setting(db, "mis_api_url", "", tenant_id=tid)
    api_key = await get_setting(db, "mis_api_key", "", tenant_id=tid)
    if not api_key:
        return {"status": "error", "message": "API ключ МИС не настроен"}
    from app.services.mis_client import test_connection
    try:
        result = await test_connection(api_url=api_url, api_key=api_key)
        return result
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/mis/status", response_model=dict)
async def get_mis_status(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    tid = current_user.tenant_id
    api_url = await get_setting(db, "mis_api_url", "", tenant_id=tid)
    api_key = await get_setting(db, "mis_api_key", "", tenant_id=tid)
    if not api_key:
        return {"online": False, "error": "API ключ не настроен"}
    from app.services.mis_client import test_connection
    try:
        result = await test_connection(api_url=api_url, api_key=api_key)
        return {"online": result.get("status") == "ok", "clinic_count": result.get("count", 0)}
    except Exception as e:
        return {"online": False, "error": str(e)}
