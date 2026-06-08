"""
chatslot01: endpoints для пациента — slot_request + book-slot.

POST /patient/chat/threads/{thread_id}/slot-request
POST /patient/chat/threads/{thread_id}/book-slot

Thread_id — это PatientChat.id (slot_booking_service оперирует PatientChat).
Аутентификация — patient_session_service.restore_session по
Authorization Bearer / X-Patient-Session header / session_token query / cookie
(тот же паттерн что в patient_chat_threads.py + patient_chat.py).
"""
import uuid
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.patient_account import PatientAccount
from app.models.patient_chat import PatientChat
from app.models.patient_session import PatientSession
from app.schemas.chat_slots import (
    ChatMessageResponse,
    SlotBookRequest,
    SlotBookResponse,
    SlotRequestCreate,
)
from app.services import family_service as fs
from app.services.patient_session_service import restore_session
from app.services.slot_booking_service import (
    SlotExpiredError,
    SlotNotFoundError,
    SlotTakenError,
    book_slot,
    create_slot_request,
)
from app.utils.phone import normalize_phone


router = APIRouter(tags=["patient-chat-slots"])


# ── Auth helpers (тот же паттерн что в patient_chat_threads.py) ────────────
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
    # [#18] Изоляция: ищем/создаём аккаунт в рамках тенанта сессии.
    acc = await fs.get_account_by_phone(db, sess.phone, tenant_id=sess.tenant_id)
    if not acc:
        acc, _ = await fs.get_or_create_account_by_phone(
            db, sess.phone, tenant_id=sess.tenant_id
        )
        await db.commit()
    return acc


async def _load_thread_for_patient(
    db: AsyncSession,
    thread_id: UUID,
    sess: PatientSession,
) -> PatientChat:
    """Загружает PatientChat и проверяет, что он принадлежит этому пациенту."""
    chat = (
        await db.execute(select(PatientChat).where(PatientChat.id == thread_id))
    ).scalar_one_or_none()
    if chat is None:
        raise HTTPException(404, "thread_not_found")
    # Сверяем phone (нормализуем — в БД может быть с +7, а в сессии без)
    if normalize_phone(chat.patient_phone) != normalize_phone(sess.phone):
        raise HTTPException(403, "thread_not_yours")
    # Тенант сессии (если есть) должен совпадать с тенантом thread
    if sess.tenant_id and chat.tenant_id and chat.tenant_id != sess.tenant_id:
        raise HTTPException(403, "thread_not_yours")
    return chat


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.post(
    "/patient/chat/threads/{thread_id}/slot-request",
    response_model=ChatMessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_slot_request(
    thread_id: UUID,
    body: SlotRequestCreate,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
) -> ChatMessageResponse:
    sess = await _get_session(
        db, request, authorization, x_patient_session, session_token or t
    )
    chat = await _load_thread_for_patient(db, thread_id, sess)

    msg = await create_slot_request(db, chat_id=chat.id, payload=body)
    await db.commit()
    return ChatMessageResponse.model_validate(msg)


@router.post(
    "/patient/chat/threads/{thread_id}/book-slot",
    response_model=SlotBookResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_book_slot(
    thread_id: UUID,
    body: SlotBookRequest,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
) -> SlotBookResponse:
    sess = await _get_session(
        db, request, authorization, x_patient_session, session_token or t
    )
    chat = await _load_thread_for_patient(db, thread_id, sess)
    acc = await _account(db, sess)

    try:
        appt, booked_msg, sys_msg = await book_slot(
            db,
            chat_id=chat.id,
            message_id=body.message_id,
            slot_idx=body.slot_idx,
            patient_phone=acc.phone,
            patient_name=acc.name or chat.patient_name,
        )
    except SlotTakenError:
        # Коммитим: offer.taken мог быть обновлён внутри book_slot для UI
        await db.commit()
        raise HTTPException(409, "slot_taken")
    except SlotExpiredError:
        raise HTTPException(410, "slot_offer_expired")
    except SlotNotFoundError as e:
        raise HTTPException(404, str(e))

    await db.commit()
    return SlotBookResponse(
        appointment_id=appt.id,
        slot_booked_message_id=booked_msg.id,
        system_message_id=sys_msg.id,
    )
