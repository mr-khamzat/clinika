"""
Глава 9 — Асинхронный чат пациента с клиниками.

ВНИМАНИЕ: в проекте есть legacy /patient/chat (AI-ассистент) — он смонтирован
другим router. Для патиент-центричных async-тредов используется prefix
/patient/chat/threads/* (это не конфликтует с legacy эндпоинтами без /threads).
"""
import uuid
from typing import Optional, List, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.patient_account import PatientAccount
from app.models.patient_session import PatientSession
from app.services import family_service as fs
from app.services import chat_service as cs
from app.services.patient_session_service import restore_session


router = APIRouter(tags=["patient-chat-threads"])


# ── Auth ───────────────────────────────────────────────────────────────────
async def _get_session(
    db: AsyncSession,
    request: Request,
    authorization: Optional[str] = None,
    x_patient_session: Optional[str] = None,
    session_token: Optional[str] = None,
) -> PatientSession:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
    token = token or x_patient_session or session_token
    if not token:
        token = request.cookies.get("clinika_patient_session")
    if not token:
        raise HTTPException(401, "Patient session required")
    sess = await restore_session(db, token)
    if not sess:
        raise HTTPException(401, "Session invalid or expired")
    return sess


async def _account(db: AsyncSession, sess: PatientSession) -> PatientAccount:
    acc = await fs.get_account_by_phone(db, sess.phone)
    if not acc:
        acc, _ = await fs.get_or_create_account_by_phone(db, sess.phone)
        await db.commit()
    return acc


# ── Schemas ────────────────────────────────────────────────────────────────
class CreateThreadIn(BaseModel):
    clinic_id: uuid.UUID
    subject: Optional[str] = Field(default=None, max_length=200)
    initial_message: str = Field(min_length=1, max_length=4000)


class SendMessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    attachments: Optional[List[Any]] = None


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/patient/chat/threads")
async def list_threads(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    threads = await cs.list_patient_threads(db, acc.id)
    out = []
    for th in threads:
        last = await cs.last_message(db, th.id)
        out.append(cs.serialize_thread(th, last))
    return {"threads": out}


@router.post("/patient/chat/threads", status_code=201)
async def create_thread(
    body: CreateThreadIn,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    # Проверяем лимит free-сообщений
    allowed, used, limit = await cs.check_patient_can_send(db, acc.id)
    if not allowed:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "subscription_required",
                "message": f"Лимит {limit} сообщений в месяц исчерпан. Подключите Здоровье+.",
                "used": used,
                "limit": limit,
            },
        )
    # Определяем tenant_id из клиники
    from app.models.clinic import Clinic
    from sqlalchemy import select as _select
    r = await db.execute(_select(Clinic).where(Clinic.id == body.clinic_id))
    clinic = r.scalar_one_or_none()
    if not clinic:
        raise HTTPException(404, "Clinic not found")
    th, msg = await cs.create_thread(
        db,
        tenant_id=clinic.tenant_id,
        clinic_id=body.clinic_id,
        patient_id=acc.id,
        subject=body.subject,
        initial_body=body.initial_message,
    )
    await db.commit()
    return {
        "thread": cs.serialize_thread(th, msg),
        "message": cs.serialize_message(msg),
    }


@router.get("/patient/chat/threads/{thread_id}")
async def get_thread_detail(
    thread_id: uuid.UUID,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    before_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    th = await cs.get_thread(db, thread_id)
    if not th or th.patient_id != acc.id:
        raise HTTPException(404, "Thread not found")
    msgs = await cs.list_messages(db, th.id, limit=limit, before_id=before_id)
    return {
        "thread": cs.serialize_thread(th),
        "messages": [cs.serialize_message(m) for m in msgs],
    }


@router.post("/patient/chat/threads/{thread_id}/messages", status_code=201)
async def post_message(
    thread_id: uuid.UUID,
    body: SendMessageIn,
    request: Request,
    background_tasks: BackgroundTasks,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    th = await cs.get_thread(db, thread_id)
    if not th or th.patient_id != acc.id:
        raise HTTPException(404, "Thread not found")
    allowed, used, limit = await cs.check_patient_can_send(db, acc.id)
    if not allowed:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "subscription_required",
                "message": f"Лимит {limit} сообщений в месяц исчерпан. Подключите Здоровье+.",
                "used": used,
                "limit": limit,
            },
        )
    msg = await cs.add_patient_message(db, th, acc.id, body.body, body.attachments)
    await db.commit()

    # chatslot01: если у пациента ещё не привязан mis_patient_id — запускаем
    # background identifier (find_by_phone / add_patient в МИС). Не блокируем ответ.
    # Используем отдельную async-сессию (AsyncSessionLocal) чтобы не делить state
    # с request-сессией, которая уже закрыта к моменту выполнения background-таска.
    if acc.mis_patient_id is None:
        from app.services.patient_identifier import identify_patient
        from app.database import AsyncSessionLocal
        patient_account_id = acc.id

        async def _run_identify():
            async with AsyncSessionLocal() as bg_session:
                try:
                    await identify_patient(bg_session, patient_account_id=patient_account_id)
                    await bg_session.commit()
                except Exception:
                    await bg_session.rollback()

        background_tasks.add_task(_run_identify)

    return cs.serialize_message(msg)


@router.post("/patient/chat/threads/{thread_id}/read")
async def mark_read(
    thread_id: uuid.UUID,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    th = await cs.get_thread(db, thread_id)
    if not th or th.patient_id != acc.id:
        raise HTTPException(404, "Thread not found")
    await cs.mark_read_for_patient(db, th)
    await db.commit()
    return {"ok": True, "unread_for_patient": 0}


@router.post("/patient/chat/threads/{thread_id}/typing")
async def patient_typing(
    thread_id: uuid.UUID,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Quick Wins: пинг "пациент печатает..." (см. clinic_chat.typing_indicator)."""
    from datetime import datetime as _dt
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    th = await cs.get_thread(db, thread_id)
    if not th or th.patient_id != acc.id:
        raise HTTPException(404, "Thread not found")
    th.last_typing_at_patient = _dt.utcnow()
    await db.commit()
    return {"ok": True, "last_typing_at_patient": th.last_typing_at_patient.isoformat()}
