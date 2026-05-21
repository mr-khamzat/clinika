"""
chatslot01: бизнес-логика slot-booking.

Защита от двойного бука — pg_advisory_xact_lock на пару (doctor_id, start_at).
Lock освобождается на commit/rollback транзакции.

Ошибки бросаем как ValueError (convention репо — см. partner_offers service).
Роутер ловит и мапит на HTTPException.
"""
from datetime import datetime, timedelta
from uuid import UUID
import hashlib

from sqlalchemy import select, text, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.patient_chat import (
    PatientChat,
    PatientChatMessage,
    PatientChatSender,
    PatientChatMessageType,
)
from app.models.doctor import Appointment, AppointmentStatus, AppointmentSource, Doctor
from app.models.patient_account import PatientAccount
from app.models.service import Service  # type: ignore  # сервис из manager_mgmt
from app.schemas.chat_slots import (
    SlotOfferCreate,
    SlotRequestCreate,
    SlotOfferPayload,
    SlotOfferSlot,
    SlotRequestPayload,
    SlotBookedPayload,
    SlotExpiredPayload,
)


class SlotBookingError(ValueError):
    """Базовая ошибка slot-booking. Подклассы маппятся роутером в HTTP-коды."""
    pass


class SlotTakenError(SlotBookingError):
    """Слот уже занят (race / external booking)."""
    pass


class SlotExpiredError(SlotBookingError):
    """slot_offer просрочен (>24ч или status=expired)."""
    pass


class SlotNotFoundError(SlotBookingError):
    """message_id / slot_idx не найдены."""
    pass


def _advisory_lock_key(doctor_id: UUID, start_at: datetime) -> int:
    """Стабильный 8-byte int для pg_advisory_xact_lock."""
    raw = f"{doctor_id}|{start_at.isoformat()}".encode()
    digest = hashlib.sha256(raw).digest()[:8]
    return int.from_bytes(digest, byteorder="big", signed=True)


async def create_slot_offer(
    session: AsyncSession,
    *,
    chat_id: UUID,
    admin_user_id: UUID,
    payload: SlotOfferCreate,
) -> PatientChatMessage:
    """Регистратор отправляет slot_offer в чат."""
    slots = [
        SlotOfferSlot(
            idx=i,
            start_at=s.start_at,
            duration_min=s.duration_min,
            label=s.label,
        )
        for i, s in enumerate(payload.slots)
    ]
    offer_payload = SlotOfferPayload(
        doctor_id=payload.doctor_id,
        service_id=payload.service_id,
        slots=slots,
        status="active",
    )
    msg = PatientChatMessage(
        chat_id=chat_id,
        sender=PatientChatSender.ADMIN,
        message_type=PatientChatMessageType.SLOT_OFFER,
        text=None,
        payload=offer_payload.model_dump(mode="json"),
        admin_user_id=admin_user_id,
    )
    session.add(msg)
    await session.flush()
    return msg


async def create_slot_request(
    session: AsyncSession,
    *,
    chat_id: UUID,
    payload: SlotRequestCreate,
) -> PatientChatMessage:
    """Пациент шлёт slot_request в чат."""
    req_payload = SlotRequestPayload(
        doctor_id=payload.doctor_id,
        service_id=payload.service_id,
        preferred_dates=payload.preferred_dates,
        note=payload.note,
    )
    msg = PatientChatMessage(
        chat_id=chat_id,
        sender=PatientChatSender.PATIENT,
        message_type=PatientChatMessageType.SLOT_REQUEST,
        text=None,
        payload=req_payload.model_dump(mode="json"),
    )
    session.add(msg)
    await session.flush()
    return msg


async def book_slot(
    session: AsyncSession,
    *,
    chat_id: UUID,
    message_id: UUID,
    slot_idx: int,
    patient_phone: str,
    patient_name: str | None,
) -> tuple[Appointment, PatientChatMessage, PatientChatMessage]:
    """
    Пациент кликает слот в slot_offer.

    Возвращает (appointment, booked_message, system_message).
    Бросает SlotTakenError / SlotExpiredError / SlotNotFoundError.

    Защита от двойного бука — pg_advisory_xact_lock на (doctor_id, start_at).
    """
    # 1. Загружаем offer-сообщение
    msg = (
        await session.execute(
            select(PatientChatMessage).where(
                and_(
                    PatientChatMessage.id == message_id,
                    PatientChatMessage.chat_id == chat_id,
                )
            )
        )
    ).scalar_one_or_none()
    if msg is None:
        raise SlotNotFoundError("message_not_found")
    if msg.message_type != PatientChatMessageType.SLOT_OFFER:
        raise SlotNotFoundError("not_a_slot_offer")
    offer = SlotOfferPayload.model_validate(msg.payload)
    if offer.status == "expired":
        raise SlotExpiredError("offer_expired")
    if slot_idx >= len(offer.slots):
        raise SlotNotFoundError("slot_idx_out_of_range")
    slot = offer.slots[slot_idx]
    if slot.taken:
        raise SlotTakenError("slot_already_taken")

    # 2. Advisory lock на (doctor_id, start_at) — освобождается на commit
    lock_key = _advisory_lock_key(offer.doctor_id, slot.start_at)
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})

    # 3. Проверка занятости на уровне БД
    start_date = slot.start_at.date()
    start_time = slot.start_at.time()
    existing = (
        await session.execute(
            select(Appointment).where(
                and_(
                    Appointment.doctor_id == offer.doctor_id,
                    Appointment.appointment_date == start_date,
                    Appointment.start_time == start_time,
                    Appointment.status != AppointmentStatus.CANCELLED,
                )
            )
        )
    ).scalar_one_or_none()
    if existing:
        # Помечаем слот занятым в offer, чтобы UI обновился
        offer.slots[slot_idx].taken = True
        msg.payload = offer.model_dump(mode="json")
        await session.flush()
        raise SlotTakenError("slot_already_taken")

    # 4. Загружаем doctor + service для контекста
    doctor = (
        await session.execute(select(Doctor).where(Doctor.id == offer.doctor_id))
    ).scalar_one()
    service = (
        await session.execute(select(Service).where(Service.id == offer.service_id))
    ).scalar_one()

    # 5. Создаём Appointment
    end_at = slot.start_at + timedelta(minutes=slot.duration_min)
    chat = (
        await session.execute(select(PatientChat).where(PatientChat.id == chat_id))
    ).scalar_one()
    appt = Appointment(
        tenant_id=chat.tenant_id,
        doctor_id=offer.doctor_id,
        clinic_id=doctor.clinic_id,
        patient_phone=patient_phone,
        patient_name=patient_name or chat.patient_name,
        appointment_date=start_date,
        start_time=start_time,
        end_time=end_at.time(),
        status=AppointmentStatus.PENDING,
        chat_thread_id=chat_id,
        source=AppointmentSource.CHAT,
        price=getattr(service, "price", None),
    )
    session.add(appt)
    await session.flush()

    # 6. Помечаем offer как забронированный
    offer.status = "superseded"
    offer.booked_slot_idx = slot_idx
    msg.message_type = PatientChatMessageType.SLOT_BOOKED
    msg.payload = offer.model_dump(mode="json")

    # 7. Системное сообщение «✅ Запись подтверждена»
    sys_payload = SlotBookedPayload(
        appointment_id=appt.id,
        doctor_name=doctor.full_name,
        service_name=getattr(service, "name", "услуга"),
        start_at=slot.start_at,
        duration_min=slot.duration_min,
    )
    sys_msg = PatientChatMessage(
        chat_id=chat_id,
        sender=PatientChatSender.ASSISTANT,
        message_type=PatientChatMessageType.SLOT_BOOKED,
        text=f"✅ Запись подтверждена: {doctor.full_name}, {slot.start_at.strftime('%d.%m.%Y %H:%M')}",
        payload=sys_payload.model_dump(mode="json"),
    )
    session.add(sys_msg)
    await session.flush()

    return appt, msg, sys_msg


async def expire_old_offers(session: AsyncSession, *, older_than_hours: int = 24) -> int:
    """Cron-задача: помечает слот-офферы старше N часов как expired.
    Возвращает число обновлённых строк."""
    cutoff = datetime.utcnow() - timedelta(hours=older_than_hours)
    result = await session.execute(
        select(PatientChatMessage).where(
            and_(
                PatientChatMessage.message_type == PatientChatMessageType.SLOT_OFFER,
                PatientChatMessage.created_at < cutoff,
            )
        )
    )
    updated = 0
    for msg in result.scalars().all():
        offer = SlotOfferPayload.model_validate(msg.payload)
        if offer.status != "active":
            continue
        offer.status = "expired"
        msg.payload = offer.model_dump(mode="json")
        msg.message_type = PatientChatMessageType.SLOT_EXPIRED
        updated += 1
    await session.flush()
    return updated
