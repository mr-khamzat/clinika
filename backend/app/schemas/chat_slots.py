"""
chatslot01: Pydantic схемы для slot-booking в чате.

Структура payload в PatientChatMessage:
- slot_offer:   SlotOfferPayload  — массив слотов от клиники
- slot_request: SlotRequestPayload — запрос от пациента
- slot_booked:  SlotBookedPayload  — системное «✅ записан»
- slot_expired: SlotExpiredPayload — системное «слоты неактуальны»
"""
from datetime import datetime, date
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict


# ─── Payload structures (хранится в PatientChatMessage.payload JSONB) ───

class SlotOfferSlot(BaseModel):
    """Один слот внутри slot_offer."""
    idx: int = Field(..., ge=0)
    start_at: datetime
    duration_min: int = Field(..., gt=0, le=240)
    label: str | None = None  # для UI: «Пн 22 мая, 10:00»
    taken: bool = False  # помечается true когда кто-то занял этот слот вне offer


class SlotOfferPayload(BaseModel):
    doctor_id: UUID
    service_id: UUID
    slots: list[SlotOfferSlot] = Field(..., min_length=1, max_length=10)
    status: Literal["active", "superseded", "expired"] = "active"
    booked_slot_idx: int | None = None  # выставляется когда пациент кликнул


class SlotRequestPayload(BaseModel):
    doctor_id: UUID | None = None
    service_id: UUID | None = None
    preferred_dates: list[date] = Field(default_factory=list, max_length=7)
    note: str | None = Field(None, max_length=500)


class SlotBookedPayload(BaseModel):
    appointment_id: UUID
    doctor_name: str
    service_name: str
    start_at: datetime
    duration_min: int


class SlotExpiredPayload(BaseModel):
    original_message_id: UUID


# ─── Request bodies ─────────────────────────────────────────────────────

class SlotOfferCreate(BaseModel):
    """POST /clinic-chat/threads/{thread_id}/slot-offer — body."""
    doctor_id: UUID
    service_id: UUID
    slots: list[SlotOfferSlot] = Field(..., min_length=1, max_length=10)


class SlotRequestCreate(BaseModel):
    """POST /patient/chat/threads/{thread_id}/slot-request — body."""
    doctor_id: UUID | None = None
    service_id: UUID | None = None
    preferred_dates: list[date] = Field(default_factory=list, max_length=7)
    note: str | None = Field(None, max_length=500)


class SlotBookRequest(BaseModel):
    """POST /patient/chat/threads/{thread_id}/book-slot — body."""
    message_id: UUID
    slot_idx: int = Field(..., ge=0)


# ─── Response bodies ────────────────────────────────────────────────────

class ChatMessageResponse(BaseModel):
    """Сообщение в чате (любого типа). Используется в API ответах роутеров slot-*."""
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    chat_id: UUID
    sender: str
    message_type: str
    text: str | None
    payload: dict | None
    created_at: datetime


class SlotBookResponse(BaseModel):
    appointment_id: UUID
    slot_booked_message_id: UUID
    system_message_id: UUID
