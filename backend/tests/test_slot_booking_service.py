"""
chatslot01: тесты бизнес-логики slot booking.

Используем @pytest.mark.integration с реальной БД (db_session фикстура).
pg_advisory_xact_lock работает только в реальном Postgres — без testcontainers
тесты будут SKIP (фикстура автоматом).

PatientChatFactory / DoctorFactory / ServiceFactory / UserFactory не существуют
в backend/tests/factories.py (там только Tenant/User/Manager/Reg/Recruiter/
PartnerDoctor/Referral). Поэтому объекты строим напрямую через session.add().
"""
from datetime import datetime, timedelta
import uuid

import pytest
from sqlalchemy import select

from app.models.patient_chat import (
    PatientChat,
    PatientChatMessage,
    PatientChatMessageType,
)
from app.models.doctor import (
    Appointment,
    AppointmentStatus,
    AppointmentSource,
    Doctor,
)
from app.models.service import Service
from app.models.clinic import Clinic
from app.models.user import User, UserRole
from app.services.slot_booking_service import (
    create_slot_offer,
    book_slot,
    expire_old_offers,
    SlotTakenError,
    SlotExpiredError,
)
from app.schemas.chat_slots import SlotOfferCreate, SlotOfferSlot


pytestmark = pytest.mark.asyncio


async def _make_world(session):
    """Создаёт минимальный набор сущностей: clinic, doctor, service, chat, admin user."""
    clinic = Clinic(name=f"Test Clinic {uuid.uuid4().hex[:6]}", is_active=True)
    session.add(clinic)
    await session.flush()

    doctor = Doctor(
        clinic_id=clinic.id,
        full_name="Dr Test",
        specialty="терапевт",
        slot_duration=30,
        is_active=True,
    )
    session.add(doctor)

    service = Service(
        name=f"Test Service {uuid.uuid4().hex[:6]}",
        bonus_amount=0,
        is_active=True,
        clinic_id=clinic.id,
        price=1500,
    )
    session.add(service)

    chat = PatientChat(
        patient_phone="+79991112233",
        patient_name="Test Patient",
    )
    session.add(chat)

    admin = User(
        full_name="Test Admin",
        username=f"admin-{uuid.uuid4().hex[:6]}@test.com",
        password_hash="$2b$12$xxxxxxxxxxxxxxxxxxxxxx",
        role=UserRole.MANAGER,
        is_active=True,
        is_suspended=False,
    )
    session.add(admin)
    await session.flush()

    return {
        "clinic": clinic,
        "doctor": doctor,
        "service": service,
        "chat": chat,
        "admin": admin,
    }


@pytest.mark.integration
async def test_create_slot_offer_creates_message(db_session):
    """create_slot_offer создаёт ChatMessage type=slot_offer с правильным payload."""
    w = await _make_world(db_session)
    body = SlotOfferCreate(
        doctor_id=w["doctor"].id,
        service_id=w["service"].id,
        slots=[
            SlotOfferSlot(
                idx=0,
                start_at=datetime.utcnow() + timedelta(days=1),
                duration_min=30,
            ),
        ],
    )

    msg = await create_slot_offer(
        db_session,
        chat_id=w["chat"].id,
        admin_user_id=w["admin"].id,
        payload=body,
    )

    assert msg.message_type == PatientChatMessageType.SLOT_OFFER
    assert msg.payload["doctor_id"] == str(w["doctor"].id)
    assert msg.payload["status"] == "active"
    assert len(msg.payload["slots"]) == 1


@pytest.mark.integration
async def test_book_slot_happy_path(db_session):
    """Пациент кликает свободный слот → создаётся Appointment, msg → slot_booked."""
    w = await _make_world(db_session)
    slot_time = datetime.utcnow().replace(microsecond=0) + timedelta(days=1, hours=10)
    body = SlotOfferCreate(
        doctor_id=w["doctor"].id,
        service_id=w["service"].id,
        slots=[SlotOfferSlot(idx=0, start_at=slot_time, duration_min=30)],
    )
    offer_msg = await create_slot_offer(
        db_session,
        chat_id=w["chat"].id,
        admin_user_id=w["admin"].id,
        payload=body,
    )

    appt, booked_msg, sys_msg = await book_slot(
        db_session,
        chat_id=w["chat"].id,
        message_id=offer_msg.id,
        slot_idx=0,
        patient_phone="+79991112233",
        patient_name="Test",
    )

    assert appt.doctor_id == w["doctor"].id
    assert appt.source == AppointmentSource.CHAT
    assert appt.chat_thread_id == w["chat"].id
    assert booked_msg.message_type == PatientChatMessageType.SLOT_BOOKED
    assert booked_msg.payload["status"] == "superseded"
    assert sys_msg.message_type == PatientChatMessageType.SLOT_BOOKED
    assert "записан" in (sys_msg.text or "").lower() or "✅" in (sys_msg.text or "")


@pytest.mark.integration
async def test_book_slot_already_taken_raises(db_session):
    """Если в БД уже есть Appointment на (doctor_id, start_at) — SlotTakenError."""
    w = await _make_world(db_session)
    slot_time = datetime.utcnow().replace(microsecond=0) + timedelta(days=1, hours=10)

    # Существующий аппойнтмент на этот слот
    existing = Appointment(
        doctor_id=w["doctor"].id,
        clinic_id=w["doctor"].clinic_id,
        patient_phone="+79990000000",
        appointment_date=slot_time.date(),
        start_time=slot_time.time(),
        end_time=(slot_time + timedelta(minutes=30)).time(),
        status=AppointmentStatus.PENDING,
    )
    db_session.add(existing)
    await db_session.flush()

    body = SlotOfferCreate(
        doctor_id=w["doctor"].id,
        service_id=w["service"].id,
        slots=[SlotOfferSlot(idx=0, start_at=slot_time, duration_min=30)],
    )
    offer_msg = await create_slot_offer(
        db_session,
        chat_id=w["chat"].id,
        admin_user_id=w["admin"].id,
        payload=body,
    )

    with pytest.raises(SlotTakenError):
        await book_slot(
            db_session,
            chat_id=w["chat"].id,
            message_id=offer_msg.id,
            slot_idx=0,
            patient_phone="+79991112233",
            patient_name="Test",
        )


@pytest.mark.integration
async def test_expire_old_offers_marks_active_as_expired(db_session):
    """Сообщения старше 24ч с status='active' → message_type=slot_expired."""
    w = await _make_world(db_session)
    body = SlotOfferCreate(
        doctor_id=w["doctor"].id,
        service_id=w["service"].id,
        slots=[
            SlotOfferSlot(
                idx=0,
                start_at=datetime.utcnow() + timedelta(hours=1),
                duration_min=30,
            )
        ],
    )
    msg = await create_slot_offer(
        db_session,
        chat_id=w["chat"].id,
        admin_user_id=w["admin"].id,
        payload=body,
    )
    # «Состарим» сообщение на 25 часов
    msg.created_at = datetime.utcnow() - timedelta(hours=25)
    await db_session.flush()

    count = await expire_old_offers(db_session)

    refreshed = (
        await db_session.execute(
            select(PatientChatMessage).where(PatientChatMessage.id == msg.id)
        )
    ).scalar_one()
    assert count == 1
    assert refreshed.message_type == PatientChatMessageType.SLOT_EXPIRED
    assert refreshed.payload["status"] == "expired"
