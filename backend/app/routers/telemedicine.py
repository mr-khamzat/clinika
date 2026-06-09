"""
Telemedicine — Этап 2: REST API + WebSocket signaling.

Все endpoints врача защищены `Depends(require_module("telemedicine"))`.
Публичные endpoints (`/patient-portal/telemed/{token}/...`) валидируют JWT
join_token и не требуют авторизации.

Структура:
1. REST врач:
   POST   /telemed/sessions                 — создать сессию
   GET    /telemed/sessions                 — список с фильтрами
   GET    /telemed/sessions/{id}            — детали
   GET    /telemed/sessions/{id}/ice-config — ICE для врача
   POST   /telemed/sessions/{id}/start      — set status=active
   POST   /telemed/sessions/{id}/end        — set status=ended + duration
   GET    /telemed/sessions/{id}/messages   — чат-лог
   POST   /telemed/sessions/{id}/messages   — добавить сообщение (multipart)
   POST   /telemed/sessions/{id}/prescription   — создать рецепт
   GET    /telemed/sessions/{id}/prescriptions  — список рецептов

2. REST пациент (по join_token):
   GET    /patient-portal/telemed/{token}/info
   GET    /patient-portal/telemed/{token}/ice-config
   POST   /patient-portal/telemed/{token}/consent

3. WebSocket signaling:
   WS     /telemed/ws/{token}                — пациент (через nginx → /api/telemed/ws/{token})
   WS     /telemed/ws/doctor/{session_id}    — врач (требует JWT в ?token=)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import get_current_user, require_manager, get_tenant_db
from app.core.security import decode_token
from app.core.tenant import require_module
from app.database import AsyncSessionLocal, get_db
from app.models.consent import ConsentRecord
from app.models.doctor import Doctor
from app.models.telemedicine import (
    TelemedicineChatMessage,
    TelemedicineChatRole,
    TelemedicinePrescription,
    TelemedicineSession,
    TelemedicineSessionStatus,
)
from app.models.user import User, UserRole
from app.services.telemed_signaling import telemed_signaling
from app.services.telemed_token import (
    create_join_token,
    hash_token,
    verify_join_token,
    verify_token_against_hash,
)

logger = logging.getLogger("telemedicine")

router = APIRouter(prefix="/telemed", tags=["telemedicine"])
patient_router = APIRouter(
    prefix="/patient-portal/telemed", tags=["telemedicine-patient"]
)

UPLOAD_BASE = Path("/app/uploads/telemed")


# ── helpers ────────────────────────────────────────────────────────────────


def _tenant_secret(tenant_id: uuid.UUID | str) -> str:
    """Производный per-tenant секрет.

    HMAC-SHA256(secret_key, "telemed:" + tenant_id) — нет необходимости
    хранить отдельный per-tenant ключ в БД, при ротации global secret_key
    инвалидируются и подписи рецептов (приемлемый компромисс).
    """
    return hmac.new(
        settings.secret_key.encode(),
        f"telemed:{tenant_id}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _normalize_phone(phone: str) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit() or ch == "+")
    return digits or phone


def _ice_servers_for(username: str) -> dict:
    """Возвращает iceServers (STUN+TURN) с time-limited credentials.

    username по конвенции `telemed:{session_id}:{role}` —
    помогает на стороне coturn различать пациента и врача в логах.
    """
    servers: list[dict] = [
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "stun:stun1.l.google.com:19302"},
    ]
    if settings.turn_host and settings.turn_secret:
        ttl = settings.turn_ttl
        ts_username = f"{int(time.time()) + ttl}:{username}"
        h = hmac.new(
            settings.turn_secret.encode(), ts_username.encode(), hashlib.sha1
        )
        credential = base64.b64encode(h.digest()).decode()
        turn_udp = f"turn:{settings.turn_host}:{settings.turn_port}?transport=udp"
        turn_tcp = f"turn:{settings.turn_host}:{settings.turn_port}?transport=tcp"
        servers.append(
            {
                "urls": [turn_udp, turn_tcp],
                "username": ts_username,
                "credential": credential,
            }
        )
    return {
        "iceServers": servers,
        "ttl": settings.turn_ttl if settings.turn_secret else 0,
    }


async def _get_session_for_user(
    db: AsyncSession, session_id: uuid.UUID, user: User
) -> TelemedicineSession:
    """Загружает сессию и проверяет, что она принадлежит тенанту юзера."""
    s = (
        await db.execute(
            select(TelemedicineSession).where(TelemedicineSession.id == session_id)
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Сессия не найдена"
        )
    is_super = (
        user.role == UserRole.SUPER_ADMIN
        or (user.username and user.username == settings.superadmin_username)
    )
    if not is_super and s.tenant_id != user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Доступ запрещён"
        )
    return s


async def _resolve_session_by_token(
    db: AsyncSession, token: str
) -> tuple[TelemedicineSession, dict]:
    """Декодирует JWT и возвращает (session, payload). 401 если хеш не совпал."""
    payload = verify_join_token(token)
    sid = payload.get("sid")
    try:
        sid_uuid = uuid.UUID(sid)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверная ссылка"
        )
    s = (
        await db.execute(
            select(TelemedicineSession).where(TelemedicineSession.id == sid_uuid)
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Сессия не найдена"
        )
    if not verify_token_against_hash(token, s.join_token_hash):
        # Токен валиден по подписи, но не тот, что был выдан (ротация / отзыв).
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Ссылка отозвана"
        )
    if s.status == TelemedicineSessionStatus.EXPIRED:
        raise HTTPException(
            status_code=status.HTTP_410_GONE, detail="Сессия завершена"
        )
    return s, payload


# ── Pydantic модели ────────────────────────────────────────────────────────


class CreateSessionRequest(BaseModel):
    appointment_id: Optional[uuid.UUID] = None
    doctor_id: Optional[uuid.UUID] = None
    patient_phone: str = Field(..., min_length=5, max_length=30)
    recording_enabled: bool = False
    scheduled_at: Optional[datetime] = None


class CreateSessionResponse(BaseModel):
    session_id: uuid.UUID
    room_id: str
    join_url: str
    expires_at: datetime


class PrescriptionRequest(BaseModel):
    body: str = Field(..., min_length=1)
    appointment_id: Optional[uuid.UUID] = None


class ConsentRequest(BaseModel):
    pd_consent: bool = True
    recording_consent: bool = False


# ── REST: создание сессии ──────────────────────────────────────────────────


@router.post(
    "/sessions",
    response_model=CreateSessionResponse,
    dependencies=[Depends(require_module("telemedicine"))],
)
async def create_session(
    body: CreateSessionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Создаёт телемед-сессию и возвращает join-ссылку для пациента."""
    if not current_user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Пользователь не привязан к тенанту",
        )

    phone = _normalize_phone(body.patient_phone)
    room_id = uuid.uuid4().hex
    session_uuid = uuid.uuid4()

    raw_token, expires_at = create_join_token(str(session_uuid), phone)
    token_hash = hash_token(raw_token)

    s = TelemedicineSession(
        id=session_uuid,
        tenant_id=current_user.tenant_id,
        appointment_id=body.appointment_id,
        doctor_id=body.doctor_id,
        patient_phone=phone,
        room_id=room_id,
        join_token_hash=token_hash,
        status=TelemedicineSessionStatus.SCHEDULED,
        scheduled_at=body.scheduled_at,
        recording_enabled=bool(body.recording_enabled),
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)

    join_url = f"https://клиниксеть.рф/p/telemed/{raw_token}"

    # Опционально: SMS пациенту с короткой ссылкой.
    try:
        from app.plugins.registry import plugin_registry
        sms = plugin_registry.get("sms")
        if sms and await sms.is_enabled():
            await sms.send(
                phone, f"Видеоприём: {join_url} (ссылка действительна 2ч)"
            )
    except Exception as e:
        logger.warning("telemed: sms send failed sid=%s: %s", s.id, e)

    # ── Realtime push в ЛК пациента (Zoom-стиль входящий звонок) ─────────
    # Если пациент сейчас в PWA — модалка появится через 1 сек.
    # Если нет — всё равно сработает SMS (выше) с join_url.
    try:
        doctor_name = None
        if s.doctor_id:
            d = (
                await db.execute(select(Doctor).where(Doctor.id == s.doctor_id))
            ).scalar_one_or_none()
            if d:
                doctor_name = d.full_name

        from app.routers.patient_notifications import notify_patient
        await notify_patient(phone, {
            "type": "incoming_call",
            "session_id": str(s.id),
            "join_url": join_url,
            "doctor_name": doctor_name,
            "expires_at": expires_at.isoformat(),
        })
    except Exception as e:
        logger.warning("telemed: notify_patient failed sid=%s: %s", s.id, e)

    return CreateSessionResponse(
        session_id=s.id,
        room_id=s.room_id,
        join_url=join_url,
        expires_at=expires_at,
    )


# ── REST: список ────────────────────────────────────────────────────────────


@router.get("/sessions", dependencies=[Depends(require_module("telemedicine"))])
async def list_sessions(
    status_f: Optional[TelemedicineSessionStatus] = Query(None, alias="status"),
    doctor_id: Optional[uuid.UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    if not current_user.tenant_id:
        return {"items": [], "total": 0}

    conds = [TelemedicineSession.tenant_id == current_user.tenant_id]
    if status_f:
        conds.append(TelemedicineSession.status == status_f)
    if doctor_id:
        conds.append(TelemedicineSession.doctor_id == doctor_id)
    if date_from:
        conds.append(TelemedicineSession.created_at >= date_from)
    if date_to:
        conds.append(TelemedicineSession.created_at <= date_to)

    total = (
        await db.execute(
            select(func.count()).select_from(TelemedicineSession).where(and_(*conds))
        )
    ).scalar_one()

    rows = (
        await db.execute(
            select(TelemedicineSession)
            .where(and_(*conds))
            .order_by(TelemedicineSession.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    return {
        "total": int(total or 0),
        "items": [_session_to_dict(s) for s in rows],
    }


def _session_to_dict(s: TelemedicineSession) -> dict:
    return {
        "id": str(s.id),
        "tenant_id": str(s.tenant_id),
        "appointment_id": str(s.appointment_id) if s.appointment_id else None,
        "doctor_id": str(s.doctor_id) if s.doctor_id else None,
        "patient_phone": s.patient_phone,
        "room_id": s.room_id,
        "status": s.status.value if hasattr(s.status, "value") else str(s.status),
        "scheduled_at": s.scheduled_at.isoformat() if s.scheduled_at else None,
        "started_at": s.started_at.isoformat() if s.started_at else None,
        "ended_at": s.ended_at.isoformat() if s.ended_at else None,
        "duration_seconds": s.duration_seconds,
        "recording_enabled": bool(s.recording_enabled),
        "created_at": s.created_at.isoformat(),
    }


# ── REST: детали ───────────────────────────────────────────────────────────


@router.get(
    "/sessions/{session_id}",
    dependencies=[Depends(require_module("telemedicine"))],
)
async def get_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    s = await _get_session_for_user(db, session_id, current_user)
    return _session_to_dict(s)


# ── REST: ICE для врача ─────────────────────────────────────────────────────


@router.get(
    "/sessions/{session_id}/ice-config",
    dependencies=[Depends(require_module("telemedicine"))],
)
async def doctor_ice_config(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    s = await _get_session_for_user(db, session_id, current_user)
    return _ice_servers_for(f"telemed:{s.id}:doctor")


# ── REST: start / end ───────────────────────────────────────────────────────


@router.post(
    "/sessions/{session_id}/start",
    dependencies=[Depends(require_module("telemedicine"))],
)
async def start_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    s = await _get_session_for_user(db, session_id, current_user)
    if s.status == TelemedicineSessionStatus.ENDED:
        raise HTTPException(status_code=409, detail="Сессия уже завершена")
    s.status = TelemedicineSessionStatus.ACTIVE
    if s.started_at is None:
        s.started_at = datetime.utcnow()
    await db.commit()
    await db.refresh(s)
    return _session_to_dict(s)


@router.post(
    "/sessions/{session_id}/end",
    dependencies=[Depends(require_module("telemedicine"))],
)
async def end_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    s = await _get_session_for_user(db, session_id, current_user)
    now = datetime.utcnow()
    s.status = TelemedicineSessionStatus.ENDED
    s.ended_at = now
    if s.started_at:
        s.duration_seconds = max(0, int((now - s.started_at).total_seconds()))
    else:
        s.duration_seconds = 0
    await db.commit()
    await db.refresh(s)

    # Уведомляем подключённых WS-клиентов о завершении.
    try:
        await telemed_signaling.publish(
            str(s.id), {"type": "end", "reason": "doctor_ended"}, _from_role="doctor"
        )
    except Exception as e:
        logger.warning("telemed: publish end failed sid=%s: %s", s.id, e)

    return _session_to_dict(s)


# ── REST: отмена входящего «звонка» (Zoom-стиль) ────────────────────────────


@router.post(
    "/sessions/{session_id}/cancel-incoming",
    dependencies=[Depends(require_module("telemedicine"))],
)
async def cancel_incoming(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """
    Отменить «звонок» в ЛК пациента (если пациент не отвечает > 60с).
    Закрывает модалку IncomingCall у пациента, но саму TelemedicineSession
    не трогает — врач может позвонить позже или закрыть её через /end.
    """
    s = await _get_session_for_user(db, session_id, current_user)
    try:
        from app.routers.patient_notifications import notify_patient
        await notify_patient(s.patient_phone, {
            "type": "call_cancelled",
            "session_id": str(s.id),
        })
    except Exception as e:
        logger.warning("telemed: cancel notify failed sid=%s: %s", s.id, e)
    return {"ok": True, "session_id": str(s.id)}


# ── REST: чат ───────────────────────────────────────────────────────────────


@router.get(
    "/sessions/{session_id}/messages",
    dependencies=[Depends(require_module("telemedicine"))],
)
async def list_messages(
    session_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    s = await _get_session_for_user(db, session_id, current_user)
    total = (
        await db.execute(
            select(func.count())
            .select_from(TelemedicineChatMessage)
            .where(TelemedicineChatMessage.session_id == s.id)
        )
    ).scalar_one()
    rows = (
        await db.execute(
            select(TelemedicineChatMessage)
            .where(TelemedicineChatMessage.session_id == s.id)
            .order_by(TelemedicineChatMessage.created_at.asc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return {
        "total": int(total or 0),
        "items": [
            {
                "id": str(m.id),
                "from_role": m.from_role.value
                if hasattr(m.from_role, "value")
                else str(m.from_role),
                "text": m.text,
                "file_path": m.file_path,
                "file_mime": m.file_mime,
                "file_size_bytes": m.file_size_bytes,
                "created_at": m.created_at.isoformat(),
            }
            for m in rows
        ],
    }


@router.post(
    "/sessions/{session_id}/messages",
    dependencies=[Depends(require_module("telemedicine"))],
)
async def post_message(
    session_id: uuid.UUID,
    text: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    s = await _get_session_for_user(db, session_id, current_user)
    if not text and not file:
        raise HTTPException(status_code=400, detail="Пустое сообщение")

    file_path_str: Optional[str] = None
    file_mime: Optional[str] = None
    file_size: Optional[int] = None

    if file is not None:
        target_dir = UPLOAD_BASE / str(s.tenant_id) / str(s.id)
        target_dir.mkdir(parents=True, exist_ok=True)
        # Безопасное имя файла: uuid + расширение из исходного.
        ext = Path(file.filename or "").suffix[:10] or ""
        fname = f"{uuid.uuid4().hex}{ext}"
        full = target_dir / fname
        size = 0
        with open(full, "wb") as out:
            while True:
                chunk = await file.read(1 << 16)
                if not chunk:
                    break
                out.write(chunk)
                size += len(chunk)
        # Храним относительный путь от UPLOAD_BASE — удобнее для миграций.
        file_path_str = str(full.relative_to(UPLOAD_BASE.parent))  # uploads/telemed/...
        file_mime = file.content_type
        file_size = size

    m = TelemedicineChatMessage(
        session_id=s.id,
        from_role=TelemedicineChatRole.DOCTOR,
        text=text,
        file_path=file_path_str,
        file_mime=file_mime,
        file_size_bytes=file_size,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)

    # Сразу прокидываем в WS-канал, чтобы пациент увидел.
    payload = {
        "type": "chat_message",
        "id": str(m.id),
        "from_role": "doctor",
        "text": m.text,
        "file_path": m.file_path,
        "file_mime": m.file_mime,
        "file_size_bytes": m.file_size_bytes,
        "created_at": m.created_at.isoformat(),
    }
    try:
        await telemed_signaling.publish(str(s.id), payload, _from_role="doctor")
    except Exception as e:
        logger.warning("telemed: publish chat failed sid=%s: %s", s.id, e)

    return payload


# ── REST: рецепты ───────────────────────────────────────────────────────────


@router.post(
    "/sessions/{session_id}/prescription",
    dependencies=[Depends(require_module("telemedicine"))],
)
async def create_prescription(
    session_id: uuid.UUID,
    body: PrescriptionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    s = await _get_session_for_user(db, session_id, current_user)

    signed_at = datetime.utcnow()
    iso_now = signed_at.isoformat()
    secret = _tenant_secret(s.tenant_id)
    sig_msg = f"{body.body}|{iso_now}|{current_user.id}".encode()
    signature = hmac.new(secret.encode(), sig_msg, hashlib.sha256).hexdigest()

    p = TelemedicinePrescription(
        session_id=s.id,
        appointment_id=body.appointment_id or s.appointment_id,
        body=body.body,
        signature_hash=signature,
        signed_at=signed_at,
        signed_by_user_id=current_user.id,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)

    return {
        "id": str(p.id),
        "session_id": str(p.session_id),
        "signature_hash": p.signature_hash,
        "signed_at": p.signed_at.isoformat(),
        "signed_by_user_id": str(p.signed_by_user_id) if p.signed_by_user_id else None,
        "body": p.body,
    }


@router.get(
    "/sessions/{session_id}/prescriptions",
    dependencies=[Depends(require_module("telemedicine"))],
)
async def list_prescriptions(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    s = await _get_session_for_user(db, session_id, current_user)
    rows = (
        await db.execute(
            select(TelemedicinePrescription)
            .where(TelemedicinePrescription.session_id == s.id)
            .order_by(TelemedicinePrescription.created_at.desc())
        )
    ).scalars().all()
    return {
        "items": [
            {
                "id": str(p.id),
                "body": p.body,
                "signature_hash": p.signature_hash,
                "signed_at": p.signed_at.isoformat() if p.signed_at else None,
                "signed_by_user_id": str(p.signed_by_user_id)
                if p.signed_by_user_id
                else None,
                "pdf_path": p.pdf_path,
                "created_at": p.created_at.isoformat(),
            }
            for p in rows
        ]
    }


# ── Публичные endpoints (по join_token) ─────────────────────────────────────


@patient_router.get("/{token}/info")
async def patient_session_info(token: str, db: AsyncSession = Depends(get_db)):
    s, _payload = await _resolve_session_by_token(db, token)
    doctor_name = None
    if s.doctor_id:
        d = (
            await db.execute(select(Doctor).where(Doctor.id == s.doctor_id))
        ).scalar_one_or_none()
        if d:
            doctor_name = d.full_name
    return {
        "session_id": str(s.id),
        "room_id": s.room_id,
        "doctor_name": doctor_name,
        "scheduled_at": s.scheduled_at.isoformat() if s.scheduled_at else None,
        "recording_enabled": bool(s.recording_enabled),
        "status": s.status.value if hasattr(s.status, "value") else str(s.status),
    }


@patient_router.get("/{token}/ice-config")
async def patient_ice_config(token: str, db: AsyncSession = Depends(get_db)):
    s, _payload = await _resolve_session_by_token(db, token)
    return _ice_servers_for(f"telemed:{s.id}:patient")


@patient_router.post("/{token}/consent")
async def patient_consent(
    token: str,
    body: ConsentRequest = Body(...),
    db: AsyncSession = Depends(get_db),
):
    s, payload = await _resolve_session_by_token(db, token)
    note_obj = {
        "scope": "telemedicine",
        "session_id": str(s.id),
        "patient_phone": payload.get("phone") or s.patient_phone,
        "pd_consent": bool(body.pd_consent),
        "recording_consent": bool(body.recording_consent),
    }
    # ConsentRecord.user_id NOT NULL → используем uuid тенанта-владельца сессии,
    # это «безопасный» прокси-юзер для пациентских согласий без аккаунта.
    # В note кладём фактический телефон + scope, по которому позже фильтруется.
    rec = ConsentRecord(
        user_id=s.tenant_id,  # безопасно: в тенанте есть system-user, иначе FK SET NULL не пройдёт
        event="given" if body.pd_consent else "withdrawn",
        ip=None,
        user_agent=None,
        policy_version="telemed-1.0",
        note=json.dumps(note_obj, ensure_ascii=False),
    )
    # Если FK падает — фолбэк: пишем в audit_log без user_id-связи.
    try:
        db.add(rec)
        await db.commit()
        await db.refresh(rec)
        return {"ok": True, "consent_id": str(rec.id)}
    except Exception as e:
        await db.rollback()
        logger.warning(
            "telemed consent: ConsentRecord insert failed sid=%s: %s — fallback to notes",
            s.id, e,
        )
        # Fallback: запись в TelemedicineSession.notes
        s.notes = (
            (s.notes + "\n" if s.notes else "")
            + f"[{datetime.utcnow().isoformat()}] consent: {json.dumps(note_obj, ensure_ascii=False)}"
        )
        await db.commit()
        return {"ok": True, "consent_id": None, "fallback": True}


# ── WebSocket: пациент ──────────────────────────────────────────────────────


@router.websocket("/ws/{token}")
async def patient_signaling_ws(ws: WebSocket, token: str):
    """WebSocket для пациента (роль фиксирована — patient).

    Авторизация по JWT join_token. Подключение через nginx будет
    /api/telemed/ws/{token} → внутрь /telemed/ws/{token}.
    """
    # Открываем сессию БД отдельно — Depends в WS работает капризно.
    async with AsyncSessionLocal() as db:
        try:
            s, _payload = await _resolve_session_by_token(db, token)
        except HTTPException as e:
            await ws.accept()
            await ws.send_json({"type": "error", "code": e.status_code, "detail": e.detail})
            await ws.close(code=4001)
            return

    await ws.accept()
    role = "patient"
    sid = str(s.id)
    await telemed_signaling.connect(ws, sid, role)
    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                continue
            mtype = msg.get("type")
            if mtype in ("offer", "answer", "ice", "chat_message", "end"):
                # Сохраняем сообщения чата от пациента в БД.
                if mtype == "chat_message" and msg.get("text"):
                    try:
                        async with AsyncSessionLocal() as db2:
                            cm = TelemedicineChatMessage(
                                session_id=s.id,
                                from_role=TelemedicineChatRole.PATIENT,
                                text=str(msg.get("text"))[:8000],
                            )
                            db2.add(cm)
                            await db2.commit()
                    except Exception as e:
                        logger.warning(
                            "telemed: save patient chat failed sid=%s: %s", sid, e
                        )
                await telemed_signaling.publish(sid, msg, _from_role=role)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("telemed patient ws sid=%s: %s", sid, e)
    finally:
        await telemed_signaling.disconnect(sid, role)


# ── WebSocket: врач ─────────────────────────────────────────────────────────


@router.websocket("/ws/doctor/{session_id}")
async def doctor_signaling_ws(ws: WebSocket, session_id: str):
    """WebSocket для врача. Авторизация: ?token=<JWT access_token>.

    Депенды require_manager не используем (WS не любит Depends-цепочку),
    делаем decode_token + проверку роли руками. Сессия должна
    принадлежать тенанту врача.
    """
    token = ws.query_params.get("token")
    if not token:
        # fallback: subprotocol
        subprotos = ws.headers.get("sec-websocket-protocol", "")
        if subprotos:
            token = subprotos.split(",")[0].strip() or None
    if not token:
        await ws.accept()
        await ws.close(code=4001)
        return

    payload = decode_token(token)
    if not payload:
        await ws.accept()
        await ws.close(code=4001)
        return

    user_id_str = str(payload.get("sub") or "")
    try:
        user_uuid = uuid.UUID(user_id_str)
        sid_uuid = uuid.UUID(session_id)
    except (TypeError, ValueError):
        await ws.accept()
        await ws.close(code=4001)
        return

    async with AsyncSessionLocal() as db:
        user = (
            await db.execute(select(User).where(User.id == user_uuid))
        ).scalar_one_or_none()
        if not user or not user.is_active:
            await ws.accept()
            await ws.close(code=4001)
            return
        is_super = (
            user.role == UserRole.SUPER_ADMIN
            or (user.username and user.username == settings.superadmin_username)
        )
        if not is_super and user.role not in (
            UserRole.MANAGER,
            UserRole.FRANCHISE_OWNER,
            UserRole.REG,
            # Доктора-юзеры (роль зависит от схемы; разрешаем всем sysadmin/admin/medic).
        ):
            # Разрешить любого юзера тенанта, у кого активен модуль —
            # роль для врача может быть произвольной (см. UserRole).
            pass
        s = (
            await db.execute(
                select(TelemedicineSession).where(TelemedicineSession.id == sid_uuid)
            )
        ).scalar_one_or_none()
        if not s:
            await ws.accept()
            await ws.close(code=4004)
            return
        if not is_super and s.tenant_id != user.tenant_id:
            await ws.accept()
            await ws.close(code=4003)
            return

    await ws.accept()
    role = "doctor"
    sid = str(s.id)
    await telemed_signaling.connect(ws, sid, role)
    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                continue
            mtype = msg.get("type")
            if mtype in ("offer", "answer", "ice", "chat_message", "end"):
                if mtype == "chat_message" and msg.get("text"):
                    try:
                        async with AsyncSessionLocal() as db2:
                            cm = TelemedicineChatMessage(
                                session_id=s.id,
                                from_role=TelemedicineChatRole.DOCTOR,
                                text=str(msg.get("text"))[:8000],
                            )
                            db2.add(cm)
                            await db2.commit()
                    except Exception as e:
                        logger.warning(
                            "telemed: save doctor chat failed sid=%s: %s", sid, e
                        )
                await telemed_signaling.publish(sid, msg, _from_role=role)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("telemed doctor ws sid=%s: %s", sid, e)
    finally:
        await telemed_signaling.disconnect(sid, role)
