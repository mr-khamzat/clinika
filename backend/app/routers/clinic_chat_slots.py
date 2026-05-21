"""
chatslot01: endpoint для отправки slot_offer от регистратора/менеджера.

POST /clinic-chat/threads/{thread_id}/slot-offer

Thread_id — это PatientChat.id (используется slot_booking_service, который
работает с моделью PatientChat).

Roles: MANAGER | FRANCHISE_OWNER | SUPER_ADMIN | REG | DOCTOR
(любой staff клиники с доступом к thread'у в его тенанте).
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.patient_chat import PatientChat
from app.schemas.chat_slots import SlotOfferCreate, ChatMessageResponse
from app.services.slot_booking_service import create_slot_offer


router = APIRouter(prefix="/clinic-chat", tags=["clinic-chat-slots"])


# Какие роли могут отправлять slot_offer (любой staff клиники).
STAFF_ROLES = {
    UserRole.MANAGER,
    UserRole.FRANCHISE_OWNER,
    UserRole.SUPER_ADMIN,
    UserRole.REG,
    UserRole.DOCTOR,
}


@router.post(
    "/threads/{thread_id}/slot-offer",
    response_model=ChatMessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_slot_offer(
    thread_id: UUID,
    body: SlotOfferCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ChatMessageResponse:
    # Проверка роли: только staff клиники
    if user.role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="role_not_allowed")

    # Загружаем thread (PatientChat)
    chat = (
        await session.execute(select(PatientChat).where(PatientChat.id == thread_id))
    ).scalar_one_or_none()
    if chat is None:
        raise HTTPException(status_code=404, detail="thread_not_found")

    # Проверка тенанта — super_admin может в любой, остальные только в свой
    if user.role != UserRole.SUPER_ADMIN and chat.tenant_id != user.tenant_id:
        raise HTTPException(status_code=403, detail="cross_tenant_forbidden")

    # Создаём slot_offer через сервис (advisory-lock не нужен на этом шаге)
    msg = await create_slot_offer(
        session,
        chat_id=chat.id,
        admin_user_id=user.id,
        payload=body,
    )
    await session.commit()
    return ChatMessageResponse.model_validate(msg)
