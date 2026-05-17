"""Telephony — конфиг, DID-номера, история звонков, dial endpoint."""
import re
import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.telephony import TelephonyConfig, DidNumber, PhoneCall
from app.models.user import User
from app.services.telephony.factory import get_provider
from app.services import encryption_service as enc  # Fernet helpers

router = APIRouter(tags=["telephony"])


class InvalidPhoneError(ValueError):
    pass


_RE_PHONE_ANY = re.compile(r"\D+")


def _normalize_phone(raw: str) -> str:
    """Нормализует РФ-номер в формат +7XXXXXXXXXX. Raises InvalidPhoneError."""
    if not raw or not isinstance(raw, str):
        raise InvalidPhoneError("Пустой номер")
    digits = _RE_PHONE_ANY.sub("", raw)
    if not digits:
        raise InvalidPhoneError("Нет цифр в номере")
    # 8XXXXXXXXXX -> 7XXXXXXXXXX
    if digits.startswith("8") and len(digits) == 11:
        digits = "7" + digits[1:]
    # 10 цифр без кода -> добавим 7
    if len(digits) == 10:
        digits = "7" + digits
    if len(digits) != 11 or not digits.startswith("7"):
        raise InvalidPhoneError(f"Неверный формат: {raw}")
    return "+" + digits


def _require_settings_role(user: User) -> None:
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role_val not in ("manager", "franchise_owner", "super_admin"):
        raise HTTPException(403, "Только manager/owner")
    if role_val != "super_admin" and not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")


def _serialize_config(cfg: TelephonyConfig | None) -> dict:
    if not cfg:
        return {
            "provider": "null",
            "api_url": None,
            "has_api_key": False,
            "has_api_secret": False,
            "is_active": False,
            "features": {},
        }
    return {
        "id": str(cfg.id),
        "provider": cfg.provider,
        "api_url": cfg.api_url,
        "has_api_key": bool(cfg.api_key_encrypted),
        "has_api_secret": bool(cfg.api_secret_encrypted),
        "is_active": bool(cfg.is_active),
        "features": cfg.features or {},
    }


def _serialize_did(d: DidNumber) -> dict:
    return {
        "id": str(d.id),
        "number": d.number,
        "display_name": d.display_name,
        "clinic_id": str(d.clinic_id) if d.clinic_id else None,
        "default_assignee_id": str(d.default_assignee_id) if d.default_assignee_id else None,
        "record_calls": bool(d.record_calls),
        "is_active": bool(d.is_active),
    }


# ── Schemas ───────────────────────────────────────────────────────────────────

class ConfigIn(BaseModel):
    provider: Optional[str] = Field(default=None, pattern=r"^(null|mango|sipuni|zadarma|onlinepbx|custom)$")
    api_url: Optional[str] = Field(default=None, max_length=300)
    api_key: Optional[str] = Field(default=None, max_length=500)
    api_secret: Optional[str] = Field(default=None, max_length=500)
    is_active: Optional[bool] = None
    features: Optional[dict] = None


class DidIn(BaseModel):
    number: str = Field(min_length=1, max_length=30)
    display_name: str = Field(min_length=1, max_length=200)
    clinic_id: Optional[uuid.UUID] = None
    default_assignee_id: Optional[uuid.UUID] = None
    record_calls: bool = True
    is_active: bool = True

    @field_validator("number")
    @classmethod
    def _norm(cls, v: str) -> str:
        try:
            return _normalize_phone(v)
        except InvalidPhoneError as e:
            raise ValueError(str(e))


class DialIn(BaseModel):
    to_number: str = Field(min_length=5, max_length=30)
    from_user_phone: Optional[str] = None  # если оператор хочет с конкретного номера


# ── Telephony config endpoints ────────────────────────────────────────────────

@router.get("/tenant/settings/telephony")
async def get_config(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    cfg = (await db.execute(
        select(TelephonyConfig).where(TelephonyConfig.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    return _serialize_config(cfg)


@router.patch("/tenant/settings/telephony")
async def update_config(
    body: ConfigIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    cfg = (await db.execute(
        select(TelephonyConfig).where(TelephonyConfig.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not cfg:
        cfg = TelephonyConfig(tenant_id=user.tenant_id, provider="null")
        db.add(cfg)
    if body.provider is not None:
        cfg.provider = body.provider
    if body.api_url is not None:
        cfg.api_url = body.api_url
    if body.api_key is not None:
        cfg.api_key_encrypted = enc.encrypt(body.api_key) if body.api_key else None
    if body.api_secret is not None:
        cfg.api_secret_encrypted = enc.encrypt(body.api_secret) if body.api_secret else None
    if body.is_active is not None:
        cfg.is_active = body.is_active
    if body.features is not None:
        cfg.features = body.features
    await db.commit()
    await db.refresh(cfg)
    return _serialize_config(cfg)


# ── DID number CRUD ───────────────────────────────────────────────────────────

@router.get("/tenant/did-numbers")
async def list_dids(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    rows = (await db.execute(
        select(DidNumber).where(DidNumber.tenant_id == user.tenant_id).order_by(DidNumber.created_at)
    )).scalars().all()
    return {"dids": [_serialize_did(d) for d in rows]}


@router.post("/tenant/did-numbers", status_code=201)
async def create_did(
    body: DidIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    d = DidNumber(
        tenant_id=user.tenant_id,
        number=body.number,
        display_name=body.display_name,
        clinic_id=body.clinic_id,
        default_assignee_id=body.default_assignee_id,
        record_calls=body.record_calls,
        is_active=body.is_active,
    )
    db.add(d)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Номер уже добавлен")
    await db.refresh(d)
    return _serialize_did(d)


@router.patch("/tenant/did-numbers/{did_id}")
async def update_did(
    did_id: uuid.UUID,
    body: DidIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    d = (await db.execute(
        select(DidNumber).where(DidNumber.id == did_id, DidNumber.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not d:
        raise HTTPException(404, "DID не найден")
    d.number = body.number
    d.display_name = body.display_name
    d.clinic_id = body.clinic_id
    d.default_assignee_id = body.default_assignee_id
    d.record_calls = body.record_calls
    d.is_active = body.is_active
    await db.commit()
    return _serialize_did(d)


@router.delete("/tenant/did-numbers/{did_id}", status_code=204)
async def delete_did(
    did_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    d = (await db.execute(
        select(DidNumber).where(DidNumber.id == did_id, DidNumber.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not d:
        raise HTTPException(404, "DID не найден")
    await db.delete(d)
    await db.commit()
    return None


# ── Dial + history ────────────────────────────────────────────────────────────

async def _create_outgoing_call(
    db: AsyncSession, user: User, *, to_number: str,
    provider_call_id: str | None, status: str,
) -> PhoneCall:
    """Создаёт PhoneCall record для исходящего. Возвращает несохранённый объект (commit делает caller)."""
    call = PhoneCall(
        tenant_id=user.tenant_id,
        clinic_id=getattr(user, "clinic_id", None),
        direction="out",
        external_number=to_number,
        operator_id=user.id,
        status=status,
        provider_call_id=provider_call_id,
        started_at=datetime.utcnow(),
    )
    db.add(call)
    return call


@router.post("/calls/dial", status_code=200)
async def dial(
    body: DialIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Инициирует исходящий звонок. Если провайдер не настроен — 503."""
    if not user.tenant_id:
        raise HTTPException(403, "Нет тенанта")
    try:
        to_norm = _normalize_phone(body.to_number)
    except InvalidPhoneError as e:
        raise HTTPException(400, str(e))
    provider = await get_provider(db, user.tenant_id)
    from_phone = body.from_user_phone or getattr(user, "phone", None) or ""
    result = await provider.initiate_call(from_user_phone=from_phone, to_number=to_norm)
    if not result.success:
        # Всё равно создаём record (для аудита неуспешных попыток)
        await _create_outgoing_call(
            db, user, to_number=to_norm,
            provider_call_id=result.provider_call_id, status="failed",
        )
        await db.commit()
        raise HTTPException(
            503,
            result.error or "Провайдер телефонии не настроен. Откройте /manager/telephony",
        )
    call = await _create_outgoing_call(
        db, user, to_number=to_norm,
        provider_call_id=result.provider_call_id, status="initiated",
    )
    await db.commit()
    await db.refresh(call)
    return {
        "call_id": str(call.id),
        "provider_call_id": result.provider_call_id,
        "status": call.status,
        "to_number": to_norm,
    }


@router.get("/telephony/calls")
async def list_calls(
    direction: Optional[str] = Query(None, pattern=r"^(in|out)$"),
    status: Optional[str] = Query(None, max_length=20),
    q: Optional[str] = Query(None, max_length=30),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    stmt = select(PhoneCall).where(PhoneCall.tenant_id == user.tenant_id)
    if direction:
        stmt = stmt.where(PhoneCall.direction == direction)
    if status:
        stmt = stmt.where(PhoneCall.status == status)
    if q:
        stmt = stmt.where(PhoneCall.external_number.ilike(f"%{q}%"))
    stmt = stmt.order_by(desc(PhoneCall.started_at)).offset((page - 1) * limit).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "calls": [
            {
                "id": str(c.id),
                "direction": c.direction,
                "external_number": c.external_number,
                "started_at": c.started_at.isoformat() if c.started_at else None,
                "duration_sec": c.duration_sec,
                "status": c.status,
                "operator_id": str(c.operator_id) if c.operator_id else None,
                "patient_id": str(c.patient_id) if c.patient_id else None,
                "recording_url": c.recording_url,
            } for c in rows
        ],
        "page": page,
    }


# ── Recording download ────────────────────────────────────────────────────────

@router.get("/telephony/calls/{call_id}/recording")
async def get_call_recording(
    call_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Скачивает аудио-запись звонка через активный провайдер тенанта.

    1. Загружает PhoneCall по id, проверяет принадлежность tenant.
    2. Через factory получает провайдер и вызывает fetch_recording(provider_call_id).
    3. Если bytes — отдаёт audio/mpeg (inline), иначе 404.
    """
    _require_settings_role(user)
    call = (await db.execute(
        select(PhoneCall).where(
            PhoneCall.id == call_id,
            PhoneCall.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if not call:
        raise HTTPException(404, "Звонок не найден")
    if not call.provider_call_id:
        raise HTTPException(404, "У звонка нет provider_call_id")
    provider = await get_provider(db, user.tenant_id)
    try:
        audio = await provider.fetch_recording(call.provider_call_id)
    except Exception as e:
        # Защитный fallback: провайдер не должен падать, но мало ли
        raise HTTPException(502, f"Ошибка получения записи: {e}")
    if not audio:
        raise HTTPException(404, "Запись недоступна")
    filename = f"call-{call.id}.mp3"
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


# ── Sipuni webhook (no auth — Sipuni не подписывает) ──────────────────────────

@router.post("/telephony/webhook/sipuni")
async def sipuni_webhook(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """Принимает уведомления от Sipuni о статусах звонков.

    Sipuni не подписывает webhook'и — публичный endpoint. Логика:
    1. Найти PhoneCall по provider_call_id
    2. Обновить status, duration, ended_at, recording_url
    """
    from app.services.telephony.sipuni import SipuniProvider
    # Используем парсер из SipuniProvider (без credentials — public-static logic)
    parsed = await SipuniProvider("", "").handle_incoming_webhook(payload)
    if not parsed.get("ok") or not parsed.get("provider_call_id"):
        return {"ok": False}
    call = (await db.execute(
        select(PhoneCall).where(PhoneCall.provider_call_id == parsed["provider_call_id"])
    )).scalar_one_or_none()
    if not call:
        return {"ok": False, "reason": "call_not_found"}
    call.status = parsed["status"]
    if parsed.get("duration_sec"):
        call.duration_sec = parsed["duration_sec"]
        call.ended_at = datetime.utcnow()
    if parsed.get("recording_url"):
        call.recording_url = parsed["recording_url"]
    await db.commit()
    return {"ok": True}


# ── Mango webhook (no auth — Mango ставит подпись только на исходящих) ────────

@router.post("/telephony/webhook/mango")
async def mango_webhook(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """Принимает call_state_change от Mango Office.

    Mango шлёт state = Appeared|Connected|Disappeared|NoAnswer|Busy|Failed.
    Логика:
    1. Найти PhoneCall по provider_call_id (command_id или entry_id)
    2. Обновить status, duration, ended_at, recording_url
    """
    from app.services.telephony.mango import MangoProvider
    parsed = await MangoProvider("", "").handle_incoming_webhook(payload)
    if not parsed.get("provider_call_id"):
        return {"ok": False}
    call = (await db.execute(
        select(PhoneCall).where(PhoneCall.provider_call_id == parsed["provider_call_id"])
    )).scalar_one_or_none()
    if not call:
        return {"ok": False, "reason": "call_not_found"}
    call.status = parsed["status"]
    if parsed.get("duration_sec"):
        call.duration_sec = parsed["duration_sec"]
        call.ended_at = datetime.utcnow()
    if parsed.get("recording_url"):
        call.recording_url = parsed["recording_url"]
    await db.commit()
    return {"ok": True}


# ── Zadarma webhook (no auth — signature валидируется на уровне настроек Zadarma) ──

@router.post("/telephony/webhook/zadarma")
async def zadarma_webhook(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """Принимает NOTIFY_* события от Zadarma.

    Zadarma шлёт callback на webhook URL, заданный в личном кабинете.
    Логика идентична Sipuni: найти PhoneCall по provider_call_id и обновить статус.
    """
    from app.services.telephony.zadarma import ZadarmaProvider
    parsed = await ZadarmaProvider("", "").handle_incoming_webhook(payload)
    if not parsed.get("ok") or not parsed.get("provider_call_id"):
        return {"ok": False}
    call = (await db.execute(
        select(PhoneCall).where(PhoneCall.provider_call_id == parsed["provider_call_id"])
    )).scalar_one_or_none()
    if not call:
        return {"ok": False, "reason": "call_not_found"}
    call.status = parsed["status"]
    if parsed.get("duration_sec"):
        call.duration_sec = parsed["duration_sec"]
        call.ended_at = datetime.utcnow()
    if parsed.get("recording_url"):
        call.recording_url = parsed["recording_url"]
    await db.commit()
    return {"ok": True}
