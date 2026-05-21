# Chat Slot Booking + Patient Auto-Identify — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать запись через чат с пациентом (`slot_offer` / `slot_request` / `slot_booked`) с advisory-lock защитой от двойного бука + автоматическую идентификацию пациента в МИС при первом сообщении в thread.

**Architecture:** Расширяем существующую `PatientChatMessage` поляями `message_type` + `payload (JSONB)`, добавляем `Appointment.chat_thread_id` + `source`, добавляем `PatientAccount.mis_patient_id / mis_synced_at / mis_sync_state`. Бизнес-логика — два сервиса: `slot_booking_service` (с pg_advisory_xact_lock) и `patient_identifier` (background-task через FastAPI BackgroundTasks + mis_outbox для retry). Frontend — расширение `MessageBubble` через switch по типу сообщения + новые pickers/sidebar.

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy 2 (async) / Alembic / Pydantic v2 / PostgreSQL 16 / APScheduler / React 18 + Vite / pytest (async).

**Сервер:** 212.57.118.126. SSH: `sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh -o StrictHostKeyChecking=no root@212.57.118.126`. Корень: `/opt/clinika/`. Текущий alembic head: `partneroffers01`. После любых .jsx изменений — `docker compose build --no-cache clinika-frontend && docker compose up -d clinika-frontend`. Backend не имеет bind-mount: правки кода применяются через `docker cp` + `docker exec ... touch /tmp/reload` ИЛИ через `docker compose build clinika-backend` (но build может падать на apt — обходить через docker cp в running контейнер).

---

## Task 1: Backend models — расширение PatientChatMessage, Appointment, PatientAccount

**Files:**
- Modify: `backend/app/models/patient_chat.py` (добавить enum + поля)
- Modify: `backend/app/models/doctor.py` (Appointment в этом файле — добавить chat_thread_id + source)
- Modify: `backend/app/models/patient_account.py` (добавить mis_* поля)
- Create: `backend/app/models/mis_outbox.py` (новая таблица для retry-очереди)

- [ ] **Step 1: Расширить PatientChatMessage**

Открыть `backend/app/models/patient_chat.py`. После класса `PatientChatSender` добавить:

```python
class PatientChatMessageType(str, enum.Enum):
    TEXT = "text"
    SLOT_OFFER = "slot_offer"
    SLOT_REQUEST = "slot_request"
    SLOT_BOOKED = "slot_booked"
    SLOT_EXPIRED = "slot_expired"
```

В `PatientChatMessage` после поля `text: Mapped[str] = ...` добавить:

```python
    # chatslot01: тип сообщения и payload для интерактивных карточек (slot_offer и т.п.)
    message_type: Mapped[PatientChatMessageType] = mapped_column(
        SAEnum(
            PatientChatMessageType,
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
            name="patient_chat_message_type",
        ),
        nullable=False,
        default=PatientChatMessageType.TEXT,
        server_default=PatientChatMessageType.TEXT.value,
        index=True,
    )
    # Для slot_offer/slot_request/slot_booked/slot_expired — структура зависит от типа (см. spec).
    # Для text — NULL.
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
```

В импорты файла добавить (если ещё нет):
```python
from sqlalchemy.dialects.postgresql import JSONB
```

Заменить `text: Mapped[str] = mapped_column(Text, nullable=False)` на `text: Mapped[str | None] = mapped_column(Text, nullable=True)` — потому что slot_booked / slot_expired могут не иметь текста (или текст подставляется из payload).

- [ ] **Step 2: Расширить Appointment**

Открыть `backend/app/models/doctor.py`. Перед `class Appointment` добавить enum:

```python
class AppointmentSource(str, enum.Enum):
    DIRECT = "direct"
    REFERRAL = "referral"
    CHAT = "chat"
```

В `Appointment` после поля `referral_id` добавить:

```python
    # chatslot01: thread из которого создана запись (если из чата)
    chat_thread_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_chats.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # chatslot01: откуда пришла запись — для аналитики и MIS push
    source: Mapped[AppointmentSource] = mapped_column(
        SAEnum(
            AppointmentSource,
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
            name="appointment_source",
        ),
        nullable=False,
        default=AppointmentSource.DIRECT,
        server_default=AppointmentSource.DIRECT.value,
    )
```

- [ ] **Step 3: Расширить PatientAccount**

Открыть `backend/app/models/patient_account.py`. В классе `PatientAccount` после поля `marketing_opt_in` добавить:

```python
    # chatslot01: связь с МИС (заполняется patient_identifier service)
    mis_patient_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    mis_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # 'pending' | 'linked' | 'created' | 'manual_required' | 'ambiguous' | 'no_phone' | 'error'
    mis_sync_state: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
```

Убедиться, что Integer импортирован в начале файла.

- [ ] **Step 4: Создать модель MisOutbox**

Создать `backend/app/models/mis_outbox.py` с содержимым:

```python
"""
chatslot01: outbox-таблица для отложенных вызовов в МИС.

Используется когда МИС недоступен (5xx) или для будущего MIS replacement plan.
patient_identifier пишет сюда задачи add_patient/update_patient,
slot_booking_service — appointment.create/update/cancel.

Worker (отдельная фича) забирает rows со status='pending' и next_retry_at <= now(),
вызывает MIS, при успехе ставит status='sent', при 5xx — увеличивает attempt_count
и сдвигает next_retry_at по exp.backoff.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base


class MisOutbox(Base):
    __tablename__ = "mis_outbox"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # 'patient.create' | 'patient.update' | 'appointment.create' | 'appointment.update' | 'appointment.cancel'
    event_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    # Полезная нагрузка для вызова — зависит от event_type
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # 'pending' | 'sent' | 'failed' | 'manual_required'
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending", index=True
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    next_retry_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, index=True
    )
    last_error: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
```

- [ ] **Step 5: Зарегистрировать модель MisOutbox в моделях**

Открыть `backend/app/models/__init__.py` и добавить:

```python
from app.models.mis_outbox import MisOutbox  # noqa: F401
```

- [ ] **Step 6: Закоммитить**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/app/models/patient_chat.py backend/app/models/doctor.py backend/app/models/patient_account.py backend/app/models/mis_outbox.py backend/app/models/__init__.py && git commit -m "feat(chatslot): models — message_type+payload, appointment.chat_thread_id+source, patient_account.mis_*, MisOutbox" && git push'
```

---

## Task 2: Alembic миграция `chatslot01`

**Files:**
- Create: `backend/alembic/versions/chatslot01_chat_slot_booking.py`

- [ ] **Step 1: Создать файл миграции**

Создать `backend/alembic/versions/chatslot01_chat_slot_booking.py`:

```python
"""chatslot01 — chat slot booking + patient MIS auto-link

Revision ID: chatslot01
Revises: partneroffers01
Create Date: 2026-05-21

Изменения:
1. patient_chat_messages: + message_type enum (default 'text'), + payload JSONB nullable.
   text: становится nullable (для slot_booked/slot_expired без текста).
2. appointments: + chat_thread_id UUID nullable FK -> patient_chats.id,
   + source enum (default 'direct'). Backfill: source='direct' для всех existing.
3. patient_accounts: + mis_patient_id, mis_synced_at, mis_sync_state.
4. mis_outbox: новая таблица для retry-очереди MIS-вызовов.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "chatslot01"
down_revision = "partneroffers01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─── 1. patient_chat_messages ─────────────────────────────────────────
    op.add_column(
        "patient_chat_messages",
        sa.Column(
            "message_type",
            sa.String(20),
            nullable=False,
            server_default="text",
        ),
    )
    op.create_index(
        "ix_patient_chat_messages_message_type",
        "patient_chat_messages",
        ["message_type"],
    )
    op.add_column(
        "patient_chat_messages",
        sa.Column("payload", JSONB, nullable=True),
    )
    # text становится nullable (slot_booked/slot_expired могут не иметь текста)
    op.alter_column("patient_chat_messages", "text", nullable=True)

    # ─── 2. appointments ──────────────────────────────────────────────────
    op.add_column(
        "appointments",
        sa.Column(
            "chat_thread_id",
            UUID(as_uuid=True),
            sa.ForeignKey("patient_chats.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_appointments_chat_thread_id",
        "appointments",
        ["chat_thread_id"],
    )
    op.add_column(
        "appointments",
        sa.Column(
            "source",
            sa.String(16),
            nullable=False,
            server_default="direct",
        ),
    )

    # ─── 3. patient_accounts ──────────────────────────────────────────────
    op.add_column(
        "patient_accounts",
        sa.Column("mis_patient_id", sa.Integer, nullable=True),
    )
    op.create_index(
        "ix_patient_accounts_mis_patient_id",
        "patient_accounts",
        ["mis_patient_id"],
    )
    op.add_column(
        "patient_accounts",
        sa.Column("mis_synced_at", sa.DateTime, nullable=True),
    )
    op.add_column(
        "patient_accounts",
        sa.Column(
            "mis_sync_state",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
    )

    # ─── 4. mis_outbox ────────────────────────────────────────────────────
    op.create_table(
        "mis_outbox",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("attempt_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("next_retry_at", sa.DateTime, nullable=False),
        sa.Column("last_error", sa.String(2000), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_mis_outbox_event_type", "mis_outbox", ["event_type"])
    op.create_index("ix_mis_outbox_status", "mis_outbox", ["status"])
    op.create_index("ix_mis_outbox_next_retry_at", "mis_outbox", ["next_retry_at"])


def downgrade() -> None:
    # mis_outbox
    op.drop_index("ix_mis_outbox_next_retry_at", table_name="mis_outbox")
    op.drop_index("ix_mis_outbox_status", table_name="mis_outbox")
    op.drop_index("ix_mis_outbox_event_type", table_name="mis_outbox")
    op.drop_table("mis_outbox")
    # patient_accounts
    op.drop_column("patient_accounts", "mis_sync_state")
    op.drop_column("patient_accounts", "mis_synced_at")
    op.drop_index("ix_patient_accounts_mis_patient_id", table_name="patient_accounts")
    op.drop_column("patient_accounts", "mis_patient_id")
    # appointments
    op.drop_column("appointments", "source")
    op.drop_index("ix_appointments_chat_thread_id", table_name="appointments")
    op.drop_column("appointments", "chat_thread_id")
    # patient_chat_messages
    op.alter_column("patient_chat_messages", "text", nullable=False)
    op.drop_column("patient_chat_messages", "payload")
    op.drop_index("ix_patient_chat_messages_message_type", table_name="patient_chat_messages")
    op.drop_column("patient_chat_messages", "message_type")
```

- [ ] **Step 2: Залить файл на сервер**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' scp /tmp/chatslot01_chat_slot_booking.py root@212.57.118.126:/opt/clinika/backend/alembic/versions/
```

Затем docker cp в running контейнер (backend без bind-mount):

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'docker cp /opt/clinika/backend/alembic/versions/chatslot01_chat_slot_booking.py clinika-backend:/app/alembic/versions/'
```

- [ ] **Step 3: Применить миграцию**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'docker exec clinika-backend alembic upgrade head'
```

Ожидаемый вывод:
```
INFO  [alembic.runtime.migration] Running upgrade partneroffers01 -> chatslot01, chat slot booking
```

- [ ] **Step 4: Проверить миграцию применилась**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'docker exec clinika-backend alembic current'
```

Ожидаемый вывод содержит `chatslot01 (head)`.

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'docker exec clinika-db psql -U clinika -d clinika -c "\d patient_chat_messages" | grep -E "(message_type|payload)"'
```

Ожидаемый вывод содержит обе колонки.

- [ ] **Step 5: Закоммитить**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/alembic/versions/chatslot01_chat_slot_booking.py && git commit -m "feat(chatslot): alembic migration chatslot01" && git push'
```

---

## Task 3: Pydantic схемы

**Files:**
- Create: `backend/app/schemas/chat_slots.py`

- [ ] **Step 1: Создать схемы**

Создать `backend/app/schemas/chat_slots.py`:

```python
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
```

- [ ] **Step 2: Закоммитить**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/app/schemas/chat_slots.py && git commit -m "feat(chatslot): pydantic schemas" && git push'
```

---

## Task 4: SlotBookingService — бизнес-логика с advisory lock

**Files:**
- Create: `backend/app/services/slot_booking_service.py`

- [ ] **Step 1: Создать сервис**

Создать `backend/app/services/slot_booking_service.py`:

```python
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
```

**Примечание:** import `Service` идёт из `app.models.service` — проверь точный путь при имплементации; в репо может быть `app.models.services` или другой модуль. Если не уверен — `grep -r "class Service" backend/app/models/`.

- [ ] **Step 2: Закоммитить**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/app/services/slot_booking_service.py && git commit -m "feat(chatslot): SlotBookingService — advisory lock + booking logic" && git push'
```

---

## Task 5: PatientIdentifier service — MIS auto-link

**Files:**
- Create: `backend/app/services/patient_identifier.py`

- [ ] **Step 1: Создать сервис**

Создать `backend/app/services/patient_identifier.py`:

```python
"""
chatslot01: автоматическая идентификация пациента в МИС при первом сообщении в thread.

Вызывается hook'ом в send_message (см. patient_chat_threads router).
Если patient_account.mis_patient_id ещё пуст:
  1. find_patient_by_phone → если найден, связываем
  2. иначе add_patient → связываем
  3. при 5xx — запись в mis_outbox для retry
  4. при 4xx — mis_sync_state='manual_required' (регистратор дозаполнит)
"""
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.patient_account import PatientAccount
from app.models.mis_outbox import MisOutbox
from app.services.mis_client import mis_client  # singleton, см. backend/app/services/mis_client.py


async def identify_patient(
    session: AsyncSession,
    *,
    patient_account_id: UUID,
) -> str:
    """
    Идентифицирует пациента в МИС.

    Возвращает финальный mis_sync_state.
    Не бросает исключения — все ошибки маппятся в mis_sync_state.
    """
    acc = (
        await session.execute(
            select(PatientAccount).where(PatientAccount.id == patient_account_id)
        )
    ).scalar_one_or_none()
    if acc is None:
        return "error"

    if acc.mis_patient_id is not None:
        # Уже привязан — ничего не делаем
        return acc.mis_sync_state

    if not acc.phone:
        acc.mis_sync_state = "no_phone"
        await session.flush()
        return "no_phone"

    # ─── 1. Проверяем дубликаты телефона ───
    dupes = (
        await session.execute(
            select(PatientAccount).where(
                PatientAccount.phone == acc.phone,
                PatientAccount.id != acc.id,
            )
        )
    ).scalars().all()
    if len(dupes) > 0:
        # Несколько аккаунтов с одним телефоном — нужно ручное разрешение
        acc.mis_sync_state = "ambiguous"
        await session.flush()
        return "ambiguous"

    # ─── 2. Поиск в МИС по телефону ───
    try:
        mis_id = await mis_client.find_patient_by_phone(acc.phone)
    except Exception as e:  # noqa: BLE001 — обёртываем любые MIS-ошибки
        await _enqueue_outbox(
            session,
            event_type="patient.find",
            payload={"patient_account_id": str(acc.id), "phone": acc.phone},
            error=str(e)[:1000],
        )
        acc.mis_sync_state = "error"
        await session.flush()
        return "error"

    if mis_id:
        acc.mis_patient_id = mis_id
        acc.mis_synced_at = datetime.utcnow()
        acc.mis_sync_state = "linked"
        await session.flush()
        return "linked"

    # ─── 3. Не найден — создаём в МИС ───
    try:
        mis_id = await mis_client.add_patient(
            full_name=acc.name or "",
            phone=acc.phone,
            birth_date=acc.birth_date.isoformat() if acc.birth_date else None,
        )
    except Exception as e:  # noqa: BLE001
        status = getattr(e, "status", None) or getattr(e, "status_code", None)
        if status and 400 <= status < 500:
            # 4xx — валидационная ошибка, ручная корректировка
            acc.mis_sync_state = "manual_required"
            await session.flush()
            return "manual_required"
        # 5xx или сетевая — в outbox
        await _enqueue_outbox(
            session,
            event_type="patient.create",
            payload={
                "patient_account_id": str(acc.id),
                "full_name": acc.name or "",
                "phone": acc.phone,
                "birth_date": acc.birth_date.isoformat() if acc.birth_date else None,
            },
            error=str(e)[:1000],
        )
        acc.mis_sync_state = "error"
        await session.flush()
        return "error"

    acc.mis_patient_id = mis_id
    acc.mis_synced_at = datetime.utcnow()
    acc.mis_sync_state = "created"
    await session.flush()
    return "created"


async def _enqueue_outbox(
    session: AsyncSession,
    *,
    event_type: str,
    payload: dict[str, Any],
    error: str,
) -> None:
    """Кладём событие в mis_outbox для retry."""
    outbox = MisOutbox(
        event_type=event_type,
        payload=payload,
        status="pending",
        attempt_count=0,
        next_retry_at=datetime.utcnow() + timedelta(minutes=1),
        last_error=error,
    )
    session.add(outbox)
    await session.flush()
```

**Примечание:** функции `find_patient_by_phone` и `add_patient` могут иметь немного другие сигнатуры в `mis_client.py:113,130` — при имплементации сверь через grep и адаптируй (имена параметров, return-тип).

- [ ] **Step 2: Закоммитить**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/app/services/patient_identifier.py && git commit -m "feat(chatslot): patient_identifier service — auto-link patient_account to mis_id" && git push'
```

---

## Task 6: Routers — clinic_chat_slots + patient_chat_slots

**Files:**
- Create: `backend/app/routers/clinic_chat_slots.py`
- Create: `backend/app/routers/patient_chat_slots.py`
- Modify: `backend/app/main.py` (зарегистрировать новые роутеры — если есть main, иначе соответствующий router include)

- [ ] **Step 1: Создать clinic_chat_slots.py**

Создать `backend/app/routers/clinic_chat_slots.py`:

```python
"""
chatslot01: endpoint для отправки slot_offer от регистратора/менеджера.

POST /clinic-chat/threads/{thread_id}/slot-offer

Roles: MANAGER | FRANCHISE_OWNER | SUPER_ADMIN | REG | DOCTOR (любой staff клиники с доступом к thread'у).
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_current_user  # сверь точные имена при имплементации
from app.models.user import User, UserRole
from app.models.patient_chat import PatientChat
from app.schemas.chat_slots import SlotOfferCreate, ChatMessageResponse
from app.services.slot_booking_service import create_slot_offer

router = APIRouter(prefix="/clinic-chat", tags=["clinic-chat-slots"])

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
    if user.role not in STAFF_ROLES:
        raise HTTPException(403, "role_not_allowed")

    chat = (
        await session.execute(select(PatientChat).where(PatientChat.id == thread_id))
    ).scalar_one_or_none()
    if chat is None:
        raise HTTPException(404, "thread_not_found")
    # Проверка доступа к thread (тенант пользователя должен совпадать с тенантом thread'а
    # или пользователь super_admin)
    if user.role != UserRole.SUPER_ADMIN and chat.tenant_id != user.tenant_id:
        raise HTTPException(403, "cross_tenant_forbidden")

    msg = await create_slot_offer(
        session,
        chat_id=chat.id,
        admin_user_id=user.id,
        payload=body,
    )
    await session.commit()
    return ChatMessageResponse.model_validate(msg)
```

- [ ] **Step 2: Создать patient_chat_slots.py**

Создать `backend/app/routers/patient_chat_slots.py`:

```python
"""
chatslot01: endpoints для пациента — slot_request + book-slot.

POST /patient/chat/threads/{thread_id}/slot-request
POST /patient/chat/threads/{thread_id}/book-slot
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_current_patient  # сверь имена
from app.models.patient_account import PatientAccount
from app.models.patient_chat import PatientChat
from app.schemas.chat_slots import (
    SlotRequestCreate,
    SlotBookRequest,
    SlotBookResponse,
    ChatMessageResponse,
)
from app.services.slot_booking_service import (
    create_slot_request,
    book_slot,
    SlotTakenError,
    SlotExpiredError,
    SlotNotFoundError,
)

router = APIRouter(prefix="/patient/chat", tags=["patient-chat-slots"])


def _check_thread_access(chat: PatientChat | None, patient: PatientAccount) -> PatientChat:
    if chat is None:
        raise HTTPException(404, "thread_not_found")
    if chat.patient_phone != patient.phone:
        raise HTTPException(403, "thread_not_yours")
    return chat


@router.post(
    "/threads/{thread_id}/slot-request",
    response_model=ChatMessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_slot_request(
    thread_id: UUID,
    body: SlotRequestCreate,
    patient: PatientAccount = Depends(get_current_patient),
    session: AsyncSession = Depends(get_db),
) -> ChatMessageResponse:
    chat = (
        await session.execute(select(PatientChat).where(PatientChat.id == thread_id))
    ).scalar_one_or_none()
    chat = _check_thread_access(chat, patient)
    msg = await create_slot_request(session, chat_id=chat.id, payload=body)
    await session.commit()
    return ChatMessageResponse.model_validate(msg)


@router.post(
    "/threads/{thread_id}/book-slot",
    response_model=SlotBookResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_book_slot(
    thread_id: UUID,
    body: SlotBookRequest,
    patient: PatientAccount = Depends(get_current_patient),
    session: AsyncSession = Depends(get_db),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
) -> SlotBookResponse:
    chat = (
        await session.execute(select(PatientChat).where(PatientChat.id == thread_id))
    ).scalar_one_or_none()
    chat = _check_thread_access(chat, patient)
    try:
        appt, booked_msg, sys_msg = await book_slot(
            session,
            chat_id=chat.id,
            message_id=body.message_id,
            slot_idx=body.slot_idx,
            patient_phone=patient.phone,
            patient_name=patient.name,
        )
    except SlotTakenError:
        await session.commit()  # сохраняем обновлённый offer.taken
        raise HTTPException(409, "slot_taken")
    except SlotExpiredError:
        raise HTTPException(410, "slot_offer_expired")
    except SlotNotFoundError as e:
        raise HTTPException(404, str(e))

    await session.commit()
    return SlotBookResponse(
        appointment_id=appt.id,
        slot_booked_message_id=booked_msg.id,
        system_message_id=sys_msg.id,
    )
```

- [ ] **Step 3: Зарегистрировать роутеры в main.py**

Открыть `backend/app/main.py` и найти секцию `app.include_router(...)`. Добавить:

```python
from app.routers import clinic_chat_slots, patient_chat_slots
app.include_router(clinic_chat_slots.router)
app.include_router(patient_chat_slots.router)
```

Точное место — рядом с другими `include_router` вызовами (искать `clinic_chat` или `patient_chat`).

- [ ] **Step 4: Залить файлы в running контейнер**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && docker cp backend/app/routers/clinic_chat_slots.py clinika-backend:/app/routers/ && docker cp backend/app/routers/patient_chat_slots.py clinika-backend:/app/routers/ && docker cp backend/app/services/slot_booking_service.py clinika-backend:/app/services/ && docker cp backend/app/services/patient_identifier.py clinika-backend:/app/services/ && docker cp backend/app/schemas/chat_slots.py clinika-backend:/app/schemas/ && docker cp backend/app/models/mis_outbox.py clinika-backend:/app/models/ && docker cp backend/app/models/patient_chat.py clinika-backend:/app/models/ && docker cp backend/app/models/doctor.py clinika-backend:/app/models/ && docker cp backend/app/models/patient_account.py clinika-backend:/app/models/ && docker cp backend/app/models/__init__.py clinika-backend:/app/models/ && docker cp backend/app/main.py clinika-backend:/app/'
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'docker restart clinika-backend'
```

После рестарта подождать ~5 секунд.

- [ ] **Step 5: Проверить, что роуты зарегистрированы**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'docker exec clinika-backend python -c "from app.main import app; [print(getattr(r, chr(34)+chr(109)+chr(101)+chr(116)+chr(104)+chr(111)+chr(100)+chr(115)+chr(34), set()), r.path) for r in app.routes if \"slot\" in str(r.path) or \"book-slot\" in str(r.path)]"'
```

Ожидаемый вывод: 3 строки c `/clinic-chat/threads/{thread_id}/slot-offer`, `/patient/chat/threads/{thread_id}/slot-request`, `/patient/chat/threads/{thread_id}/book-slot`.

- [ ] **Step 6: Закоммитить**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/app/routers/clinic_chat_slots.py backend/app/routers/patient_chat_slots.py backend/app/main.py && git commit -m "feat(chatslot): routers — clinic_chat_slots + patient_chat_slots, registered in main" && git push'
```

---

## Task 7: Hook identify + APScheduler cron для expire

**Files:**
- Modify: `backend/app/routers/patient_chat_threads.py` (hook на /messages — enqueue identify)
- Modify: `backend/app/scheduler.py` *(или где APScheduler инициализируется — проверь при имплементации)*

- [ ] **Step 1: Hook identify в send_message**

Открыть `backend/app/routers/patient_chat_threads.py`. Найти функцию-обработчик POST `/patient/chat/threads/{thread_id}/messages` (строка ~162).

После создания PatientChatMessage и `await session.commit()` добавить:

```python
    # chatslot01: если у пациента ещё не привязан mis_patient_id — запускаем
    # background identifier. Не блокируем ответ — отвечаем сразу.
    from app.services.patient_identifier import identify_patient
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.database import async_engine

    async def _run_identify():
        # Отдельная сессия для background-задачи
        async_session = async_sessionmaker(async_engine, expire_on_commit=False)
        async with async_session() as bg_session:
            try:
                await identify_patient(bg_session, patient_account_id=patient.id)
                await bg_session.commit()
            except Exception:
                await bg_session.rollback()

    background_tasks.add_task(_run_identify)
```

Убедиться, что функция принимает `background_tasks: BackgroundTasks` параметром:

```python
from fastapi import BackgroundTasks

@router.post("/patient/chat/threads/{thread_id}/messages", status_code=201)
async def post_message(
    ...
    background_tasks: BackgroundTasks,
    ...
):
```

- [ ] **Step 2: APScheduler cron для expire**

Найти место в backend, где инициализируется APScheduler. Обычно `backend/app/main.py` или `backend/app/scheduler.py` — поиск `AsyncIOScheduler` или `add_job`. Добавить:

```python
from app.services.slot_booking_service import expire_old_offers

async def _expire_slot_offers_job():
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.database import async_engine
    async_session = async_sessionmaker(async_engine, expire_on_commit=False)
    async with async_session() as session:
        try:
            count = await expire_old_offers(session)
            if count > 0:
                await session.commit()
        except Exception:
            await session.rollback()

scheduler.add_job(
    _expire_slot_offers_job,
    "interval",
    minutes=15,
    id="expire_slot_offers",
    replace_existing=True,
)
```

Точное место — рядом с другими `scheduler.add_job()` вызовами.

- [ ] **Step 3: Перезагрузить backend**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && docker cp backend/app/routers/patient_chat_threads.py clinika-backend:/app/routers/ && docker cp backend/app/main.py clinika-backend:/app/ && docker restart clinika-backend'
```

- [ ] **Step 4: Проверить логи на отсутствие ошибок**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'sleep 5 && docker logs --since 30s clinika-backend 2>&1 | grep -iE "(error|traceback|chatslot|identify|expire)" | head -20'
```

Ожидаемый вывод: либо пусто, либо строка вида `INFO ... expire_slot_offers job registered`.

- [ ] **Step 5: Закоммитить**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/app/routers/patient_chat_threads.py backend/app/main.py backend/app/scheduler.py 2>/dev/null; git commit -m "feat(chatslot): hook identify in send_message + cron expire_slot_offers (15min)" && git push'
```

---

## Task 8: Backend tests

**Files:**
- Create: `backend/tests/test_slot_booking_service.py`
- Create: `backend/tests/test_patient_identifier.py`
- Create: `backend/tests/test_chat_slot_routers.py`

- [ ] **Step 1: Тесты SlotBookingService**

Создать `backend/tests/test_slot_booking_service.py`:

```python
"""
chatslot01: тесты бизнес-логики slot booking.

Используем @pytest.mark.integration с реальной БД (testcontainers),
потому что pg_advisory_xact_lock не работает в моке.
"""
import asyncio
from datetime import datetime, timedelta
from uuid import uuid4
import pytest
from sqlalchemy import select

from app.models.patient_chat import (
    PatientChat,
    PatientChatMessage,
    PatientChatMessageType,
)
from app.models.doctor import Appointment, AppointmentStatus, AppointmentSource
from app.services.slot_booking_service import (
    create_slot_offer,
    create_slot_request,
    book_slot,
    expire_old_offers,
    SlotTakenError,
    SlotExpiredError,
)
from app.schemas.chat_slots import SlotOfferCreate, SlotOfferSlot, SlotRequestCreate
from tests.factories import (
    PatientChatFactory,
    DoctorFactory,
    ServiceFactory,
    UserFactory,
)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_create_slot_offer_creates_message(db_session):
    """create_slot_offer создаёт ChatMessage type=slot_offer с правильным payload."""
    chat = await PatientChatFactory.create(session=db_session)
    doctor = await DoctorFactory.create(session=db_session)
    service = await ServiceFactory.create(session=db_session)
    admin = await UserFactory.create(session=db_session, role="manager")
    body = SlotOfferCreate(
        doctor_id=doctor.id,
        service_id=service.id,
        slots=[
            SlotOfferSlot(idx=0, start_at=datetime.utcnow() + timedelta(days=1), duration_min=30),
        ],
    )

    msg = await create_slot_offer(
        db_session, chat_id=chat.id, admin_user_id=admin.id, payload=body
    )
    await db_session.commit()

    assert msg.message_type == PatientChatMessageType.SLOT_OFFER
    assert msg.payload["doctor_id"] == str(doctor.id)
    assert msg.payload["status"] == "active"
    assert len(msg.payload["slots"]) == 1


@pytest.mark.integration
@pytest.mark.asyncio
async def test_book_slot_happy_path(db_session):
    """Пациент кликает свободный слот → создаётся Appointment, message становится slot_booked."""
    chat = await PatientChatFactory.create(session=db_session, patient_phone="+79991112233")
    doctor = await DoctorFactory.create(session=db_session)
    service = await ServiceFactory.create(session=db_session)
    admin = await UserFactory.create(session=db_session, role="manager")
    slot_time = datetime.utcnow() + timedelta(days=1, hours=10)
    body = SlotOfferCreate(
        doctor_id=doctor.id,
        service_id=service.id,
        slots=[SlotOfferSlot(idx=0, start_at=slot_time, duration_min=30)],
    )
    offer_msg = await create_slot_offer(
        db_session, chat_id=chat.id, admin_user_id=admin.id, payload=body
    )
    await db_session.commit()

    appt, booked_msg, sys_msg = await book_slot(
        db_session,
        chat_id=chat.id,
        message_id=offer_msg.id,
        slot_idx=0,
        patient_phone="+79991112233",
        patient_name="Test",
    )
    await db_session.commit()

    assert appt.doctor_id == doctor.id
    assert appt.source == AppointmentSource.CHAT
    assert appt.chat_thread_id == chat.id
    assert booked_msg.message_type == PatientChatMessageType.SLOT_BOOKED
    assert booked_msg.payload["status"] == "superseded"
    assert sys_msg.message_type == PatientChatMessageType.SLOT_BOOKED
    assert "✅" in sys_msg.text


@pytest.mark.integration
@pytest.mark.asyncio
async def test_book_slot_already_taken_raises_409(db_session):
    """Если в БД уже есть Appointment на (doctor_id, start_at) — SlotTakenError."""
    chat = await PatientChatFactory.create(session=db_session, patient_phone="+79991112233")
    doctor = await DoctorFactory.create(session=db_session)
    service = await ServiceFactory.create(session=db_session)
    admin = await UserFactory.create(session=db_session, role="manager")
    slot_time = datetime.utcnow() + timedelta(days=1, hours=10)
    # Заранее создаём Appointment на этот слот
    existing = Appointment(
        doctor_id=doctor.id,
        clinic_id=doctor.clinic_id,
        patient_phone="+79990000000",
        appointment_date=slot_time.date(),
        start_time=slot_time.time(),
        end_time=(slot_time + timedelta(minutes=30)).time(),
        status=AppointmentStatus.PENDING,
    )
    db_session.add(existing)
    await db_session.commit()

    body = SlotOfferCreate(
        doctor_id=doctor.id,
        service_id=service.id,
        slots=[SlotOfferSlot(idx=0, start_at=slot_time, duration_min=30)],
    )
    offer_msg = await create_slot_offer(
        db_session, chat_id=chat.id, admin_user_id=admin.id, payload=body
    )
    await db_session.commit()

    with pytest.raises(SlotTakenError):
        await book_slot(
            db_session,
            chat_id=chat.id,
            message_id=offer_msg.id,
            slot_idx=0,
            patient_phone="+79991112233",
            patient_name="Test",
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_expire_old_offers_marks_active_as_expired(db_session):
    """Сообщения старше 24ч с status='active' → message_type=slot_expired."""
    chat = await PatientChatFactory.create(session=db_session)
    doctor = await DoctorFactory.create(session=db_session)
    service = await ServiceFactory.create(session=db_session)
    admin = await UserFactory.create(session=db_session, role="manager")
    body = SlotOfferCreate(
        doctor_id=doctor.id,
        service_id=service.id,
        slots=[SlotOfferSlot(idx=0, start_at=datetime.utcnow() + timedelta(hours=1), duration_min=30)],
    )
    msg = await create_slot_offer(
        db_session, chat_id=chat.id, admin_user_id=admin.id, payload=body
    )
    # «Состарим» сообщение на 25 часов
    msg.created_at = datetime.utcnow() - timedelta(hours=25)
    await db_session.commit()

    count = await expire_old_offers(db_session)
    await db_session.commit()

    refreshed = (await db_session.execute(
        select(PatientChatMessage).where(PatientChatMessage.id == msg.id)
    )).scalar_one()
    assert count == 1
    assert refreshed.message_type == PatientChatMessageType.SLOT_EXPIRED
    assert refreshed.payload["status"] == "expired"
```

- [ ] **Step 2: Тесты PatientIdentifier**

Создать `backend/tests/test_patient_identifier.py`:

```python
"""
chatslot01: тесты автоматической идентификации пациента в МИС.

Мокаем mis_client.find_patient_by_phone и mis_client.add_patient.
"""
from unittest.mock import AsyncMock, patch
from uuid import uuid4
import pytest

from app.services.patient_identifier import identify_patient
from tests.factories import PatientAccountFactory


@pytest.mark.integration
@pytest.mark.asyncio
async def test_identify_found_in_mis_links(db_session):
    """find_patient_by_phone вернул mis_id → mis_sync_state='linked'."""
    acc = await PatientAccountFactory.create(session=db_session, phone="+79991112233", mis_patient_id=None)
    with patch("app.services.patient_identifier.mis_client") as mock_client:
        mock_client.find_patient_by_phone = AsyncMock(return_value=12345)
        state = await identify_patient(db_session, patient_account_id=acc.id)

    assert state == "linked"
    await db_session.refresh(acc)
    assert acc.mis_patient_id == 12345
    assert acc.mis_sync_state == "linked"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_identify_not_found_creates_in_mis(db_session):
    """Не найден → add_patient → mis_sync_state='created'."""
    acc = await PatientAccountFactory.create(session=db_session, phone="+79991112233", name="Иван", mis_patient_id=None)
    with patch("app.services.patient_identifier.mis_client") as mock_client:
        mock_client.find_patient_by_phone = AsyncMock(return_value=None)
        mock_client.add_patient = AsyncMock(return_value=67890)
        state = await identify_patient(db_session, patient_account_id=acc.id)

    assert state == "created"
    await db_session.refresh(acc)
    assert acc.mis_patient_id == 67890


@pytest.mark.integration
@pytest.mark.asyncio
async def test_identify_5xx_enqueues_outbox(db_session):
    """add_patient бросил 5xx → mis_sync_state='error', строка в mis_outbox."""
    from app.models.mis_outbox import MisOutbox
    from sqlalchemy import select

    acc = await PatientAccountFactory.create(session=db_session, phone="+79991112233", mis_patient_id=None)

    class FakeMisError(Exception):
        status = 503

    with patch("app.services.patient_identifier.mis_client") as mock_client:
        mock_client.find_patient_by_phone = AsyncMock(return_value=None)
        mock_client.add_patient = AsyncMock(side_effect=FakeMisError("upstream"))
        state = await identify_patient(db_session, patient_account_id=acc.id)

    assert state == "error"
    outbox_rows = (await db_session.execute(select(MisOutbox))).scalars().all()
    assert any(row.event_type == "patient.create" for row in outbox_rows)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_identify_4xx_manual_required(db_session):
    """add_patient бросил 4xx → mis_sync_state='manual_required'."""
    acc = await PatientAccountFactory.create(session=db_session, phone="+79991112233", mis_patient_id=None)

    class FakeMisError(Exception):
        status = 422

    with patch("app.services.patient_identifier.mis_client") as mock_client:
        mock_client.find_patient_by_phone = AsyncMock(return_value=None)
        mock_client.add_patient = AsyncMock(side_effect=FakeMisError("validation"))
        state = await identify_patient(db_session, patient_account_id=acc.id)

    assert state == "manual_required"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_identify_no_phone_marks_no_phone(db_session):
    """Пациент без phone → mis_sync_state='no_phone', mis_client не вызывается."""
    acc = await PatientAccountFactory.create(session=db_session, phone="", mis_patient_id=None)
    state = await identify_patient(db_session, patient_account_id=acc.id)
    assert state == "no_phone"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_identify_ambiguous_when_duplicate_phone(db_session):
    """Если есть >1 patient_account с тем же phone → mis_sync_state='ambiguous'."""
    phone = "+79991112233"
    await PatientAccountFactory.create(session=db_session, phone=phone, mis_patient_id=None)
    acc = await PatientAccountFactory.create(session=db_session, phone=phone, mis_patient_id=None)
    state = await identify_patient(db_session, patient_account_id=acc.id)
    assert state == "ambiguous"
```

- [ ] **Step 3: Тесты роутеров (smoke RBAC)**

Создать `backend/tests/test_chat_slot_routers.py`:

```python
"""
chatslot01: smoke-тесты роутеров — RBAC + 401/403 без auth.

Полная end-to-end через client (httpx ASGITransport).
"""
import pytest


@pytest.mark.asyncio
async def test_slot_offer_requires_auth(client):
    """POST /clinic-chat/threads/{tid}/slot-offer без токена → 401/403."""
    resp = await client.post(
        "/clinic-chat/threads/00000000-0000-0000-0000-000000000000/slot-offer",
        json={"doctor_id": "00000000-0000-0000-0000-000000000000",
              "service_id": "00000000-0000-0000-0000-000000000000",
              "slots": [{"idx": 0, "start_at": "2026-06-01T10:00:00", "duration_min": 30}]},
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_book_slot_requires_patient_auth(client):
    """POST /patient/chat/threads/{tid}/book-slot без токена → 401/403."""
    resp = await client.post(
        "/patient/chat/threads/00000000-0000-0000-0000-000000000000/book-slot",
        json={"message_id": "00000000-0000-0000-0000-000000000000", "slot_idx": 0},
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_slot_request_requires_patient_auth(client):
    """POST /patient/chat/threads/{tid}/slot-request без токена → 401/403."""
    resp = await client.post(
        "/patient/chat/threads/00000000-0000-0000-0000-000000000000/slot-request",
        json={"preferred_dates": ["2026-06-01"]},
    )
    assert resp.status_code in (401, 403)
```

- [ ] **Step 4: Залить и прогнать тесты**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'docker cp backend/tests/test_slot_booking_service.py clinika-backend:/app/tests/ && docker cp backend/tests/test_patient_identifier.py clinika-backend:/app/tests/ && docker cp backend/tests/test_chat_slot_routers.py clinika-backend:/app/tests/'
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'docker exec clinika-backend pytest tests/test_slot_booking_service.py tests/test_patient_identifier.py tests/test_chat_slot_routers.py -v 2>&1 | tail -40'
```

Ожидаемый вывод: `XX passed` (минимум 14 тестов). Если integration-тесты скипаются (нет testcontainers) — это нормально, ждём `skipped`. Smoke router-тесты должны пройти.

**Если тесты падают — НЕ продолжать**, дебажить корень причины. Не пропускать xfail-ами.

- [ ] **Step 5: Закоммитить**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/tests/test_slot_booking_service.py backend/tests/test_patient_identifier.py backend/tests/test_chat_slot_routers.py && git commit -m "test(chatslot): slot booking + patient identifier + routers RBAC" && git push'
```

---

## Task 9: Frontend — message bubble расширение + API клиент

**Files:**
- Create: `frontend/src/api/chatSlots.js`
- Create: `frontend/src/components/chat/SlotOfferBubble.jsx`
- Create: `frontend/src/components/chat/SlotRequestBubble.jsx`
- Create: `frontend/src/components/chat/SlotBookedBubble.jsx`
- Modify: `frontend/src/components/chat/MessageBubble.jsx` (switch по message_type)

- [ ] **Step 1: API клиент**

Создать `frontend/src/api/chatSlots.js`:

```js
import api from './index'

export const chatSlotsApi = {
  // Регистратор → пациент
  postSlotOffer: (threadId, body) =>
    api.post(`/clinic-chat/threads/${threadId}/slot-offer`, body).then(r => r.data),

  // Пациент → клиника
  postSlotRequest: (threadId, body) =>
    api.post(`/patient/chat/threads/${threadId}/slot-request`, body).then(r => r.data),

  // Пациент кликает слот
  bookSlot: (threadId, messageId, slotIdx) =>
    api.post(
      `/patient/chat/threads/${threadId}/book-slot`,
      { message_id: messageId, slot_idx: slotIdx },
      { headers: { 'Idempotency-Key': `${threadId}-${messageId}-${slotIdx}` } }
    ).then(r => r.data),
}
```

- [ ] **Step 2: SlotOfferBubble**

Создать `frontend/src/components/chat/SlotOfferBubble.jsx`:

```jsx
/**
 * chatslot01: интерактивная карточка слотов от клиники в чате пациента.
 *
 * Props:
 *   message: { id, payload: SlotOfferPayload, message_type, ... }
 *   isPatient: true если рендерим в PatientChatSection (показываем кнопки)
 *   threadId: для bookSlot вызова
 *   onBooked: callback после успешного бронирования
 */
import { useState } from 'react'
import { chatSlotsApi } from '../../api/chatSlots'

function formatSlotLabel(startAt) {
  const d = new Date(startAt)
  return d.toLocaleString('ru-RU', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

export default function SlotOfferBubble({ message, isPatient, threadId, onBooked }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const offer = message.payload || {}
  const slots = offer.slots || []
  const expired = offer.status === 'expired' || message.message_type === 'slot_expired'
  const superseded = offer.status === 'superseded'

  async function handleClick(slotIdx) {
    if (!isPatient || busy || expired || superseded) return
    setBusy(true)
    setErr(null)
    try {
      const res = await chatSlotsApi.bookSlot(threadId, message.id, slotIdx)
      onBooked?.(res)
    } catch (e) {
      if (e?.response?.status === 409) setErr('Слот уже занят — выбери другой')
      else if (e?.response?.status === 410) setErr('Слоты больше неактуальны')
      else setErr('Не удалось забронировать')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl p-3 bg-blue-50 border border-blue-100 max-w-md">
      <div className="text-xs text-gray-600 mb-2">
        {expired ? '⏱ Слоты больше неактуальны' :
         superseded ? '✅ Один из слотов выбран' :
         '🗓 Выберите удобный слот:'}
      </div>
      <div className="flex flex-col gap-1.5">
        {slots.map((s, i) => {
          const isBooked = superseded && offer.booked_slot_idx === i
          const disabled = expired || superseded || s.taken || !isPatient || busy
          return (
            <button
              key={i}
              onClick={() => handleClick(i)}
              disabled={disabled}
              className={`text-sm text-left px-3 py-2 rounded-lg border transition ${
                isBooked ? 'bg-green-100 border-green-300 text-green-800 font-semibold' :
                s.taken ? 'bg-gray-100 border-gray-200 text-gray-400 line-through' :
                disabled ? 'bg-white border-gray-200 text-gray-500' :
                'bg-white border-blue-200 hover:bg-blue-100 cursor-pointer'
              }`}
            >
              {isBooked && '✅ '}{formatSlotLabel(s.start_at)}
              {s.taken && !isBooked && ' (занят)'}
            </button>
          )
        })}
      </div>
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
    </div>
  )
}
```

- [ ] **Step 3: SlotRequestBubble**

Создать `frontend/src/components/chat/SlotRequestBubble.jsx`:

```jsx
/**
 * chatslot01: бабл «пациент просит записать» — рендерится в чате клиники.
 *
 * Props:
 *   message: { payload: SlotRequestPayload, ... }
 *   isStaff: true если рендерим в ClinicChatSection (показываем кнопку «Предложить слоты»)
 *   onOfferRequest: callback — открывает ClinicSlotPicker для конкретного doctor/service/dates
 */
export default function SlotRequestBubble({ message, isStaff, onOfferRequest }) {
  const req = message.payload || {}
  const dates = (req.preferred_dates || []).map(d =>
    new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
  ).join(', ')

  return (
    <div className="rounded-2xl p-3 bg-amber-50 border border-amber-100 max-w-md">
      <div className="text-xs text-amber-800 font-semibold mb-1">📅 Пациент просит запись</div>
      {dates && <div className="text-sm text-gray-700">Желаемые даты: {dates}</div>}
      {req.note && <div className="text-sm text-gray-700 mt-1">«{req.note}»</div>}
      {isStaff && (
        <button
          onClick={() => onOfferRequest?.(req)}
          className="mt-2 text-sm bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg"
        >
          Предложить слоты
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: SlotBookedBubble**

Создать `frontend/src/components/chat/SlotBookedBubble.jsx`:

```jsx
/**
 * chatslot01: системное сообщение «✅ Запись подтверждена».
 *
 * Props:
 *   message: { text, payload: SlotBookedPayload }
 */
export default function SlotBookedBubble({ message }) {
  const p = message.payload || {}
  const dt = p.start_at ? new Date(p.start_at).toLocaleString('ru-RU', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }) : ''

  return (
    <div className="rounded-xl px-3 py-2 bg-green-50 border border-green-200 text-sm text-green-800 max-w-md mx-auto text-center">
      ✅ Запись подтверждена
      {p.doctor_name && <div className="text-xs text-green-700">{p.doctor_name}</div>}
      {dt && <div className="text-xs text-green-700">{dt}</div>}
    </div>
  )
}
```

- [ ] **Step 5: Расширить MessageBubble**

Открыть `frontend/src/components/chat/MessageBubble.jsx`. В начало рендера (после деструктуризации props и до возврата обычного текстового бабла) добавить:

```jsx
import SlotOfferBubble from './SlotOfferBubble'
import SlotRequestBubble from './SlotRequestBubble'
import SlotBookedBubble from './SlotBookedBubble'

// ... внутри компонента, после const { message, ... } = props и до return:
const mt = message.message_type || 'text'
if (mt === 'slot_offer' || mt === 'slot_expired') {
  return <SlotOfferBubble message={message} isPatient={isPatient} threadId={threadId} onBooked={onSlotBooked} />
}
if (mt === 'slot_request') {
  return <SlotRequestBubble message={message} isStaff={!isPatient} onOfferRequest={onOfferRequest} />
}
if (mt === 'slot_booked') {
  return <SlotBookedBubble message={message} />
}
// default — обычный текст/файл, существующий рендер ниже
```

Проверь, что пропы `isPatient`, `threadId`, `onSlotBooked`, `onOfferRequest` пробрасываются в MessageBubble из родителя. Если нет — добавь дефолты (`isPatient = false`, остальные — `undefined`).

- [ ] **Step 6: Закоммитить**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add frontend/src/api/chatSlots.js frontend/src/components/chat/SlotOfferBubble.jsx frontend/src/components/chat/SlotRequestBubble.jsx frontend/src/components/chat/SlotBookedBubble.jsx frontend/src/components/chat/MessageBubble.jsx && git commit -m "feat(chatslot): SlotOffer/Request/Booked bubbles + MessageBubble switch" && git push'
```

---

## Task 10: Frontend — slot pickers + patient card sidebar

**Files:**
- Create: `frontend/src/components/chat/ClinicSlotPicker.jsx`
- Create: `frontend/src/components/chat/PatientSlotRequestPicker.jsx`
- Create: `frontend/src/components/chat/PatientCardSidebar.jsx`

- [ ] **Step 1: ClinicSlotPicker — drawer для регистратора**

Создать `frontend/src/components/chat/ClinicSlotPicker.jsx`:

```jsx
/**
 * chatslot01: drawer для регистратора — выбор врача → услуги → 2-3 свободных слотов.
 * Открывается из ClinicChatSection. После выбора шлёт slot_offer в thread.
 *
 * Props:
 *   open: bool
 *   onClose: () => void
 *   threadId: UUID
 *   defaults: { doctor_id?, service_id?, preferred_dates? } — из slot_request пациента
 *   onSent: () => void — после успешной отправки offer'а
 */
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import api from '../../api'
import { chatSlotsApi } from '../../api/chatSlots'

export default function ClinicSlotPicker({ open, onClose, threadId, defaults = {}, onSent }) {
  const [doctorId, setDoctorId] = useState(defaults.doctor_id || '')
  const [serviceId, setServiceId] = useState(defaults.service_id || '')
  const [doctors, setDoctors] = useState([])
  const [services, setServices] = useState([])
  const [freeSlots, setFreeSlots] = useState([])  // {start_at, duration_min}
  const [selected, setSelected] = useState([])     // массив выбранных индексов
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!open) return
    api.get('/manager/doctors/').then(r => setDoctors(r.data || []))
    api.get('/manager/services/').then(r => setServices(r.data || []))
  }, [open])

  useEffect(() => {
    if (!doctorId) { setFreeSlots([]); return }
    // Загружаем свободные слоты ближайших 7 дней. Endpoint — существующий /manager/doctors/{id}/free-slots или аналог.
    api.get(`/manager/doctors/${doctorId}/free-slots?days=7`)
       .then(r => setFreeSlots(r.data || []))
       .catch(() => setFreeSlots([]))
  }, [doctorId])

  function toggleSlot(i) {
    setSelected(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i].slice(0, 5))
  }

  async function send() {
    if (!doctorId || !serviceId || selected.length === 0) {
      setErr('Выбери врача, услугу и хотя бы один слот')
      return
    }
    setBusy(true); setErr(null)
    try {
      const slots = selected.map((idx, i) => ({
        idx: i,
        start_at: freeSlots[idx].start_at,
        duration_min: freeSlots[idx].duration_min,
      }))
      await chatSlotsApi.postSlotOffer(threadId, { doctor_id: doctorId, service_id: serviceId, slots })
      onSent?.()
      onClose()
    } catch (e) {
      setErr('Не удалось отправить — попробуй ещё раз')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full overflow-y-auto p-4 shadow-xl">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold">Предложить слоты</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">✕</button>
        </div>

        <label className="block text-sm text-gray-700 mb-1">Врач</label>
        <select value={doctorId} onChange={e => setDoctorId(e.target.value)}
                className="w-full mb-3 border rounded px-2 py-1.5">
          <option value="">— выбери —</option>
          {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>

        <label className="block text-sm text-gray-700 mb-1">Услуга</label>
        <select value={serviceId} onChange={e => setServiceId(e.target.value)}
                className="w-full mb-3 border rounded px-2 py-1.5">
          <option value="">— выбери —</option>
          {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <div className="text-sm text-gray-700 mb-1">Свободные слоты (до 5):</div>
        <div className="flex flex-col gap-1 mb-3 max-h-72 overflow-y-auto">
          {freeSlots.map((s, i) => (
            <label key={i} className="flex items-center gap-2 text-sm px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
              <input type="checkbox" checked={selected.includes(i)} onChange={() => toggleSlot(i)} />
              {new Date(s.start_at).toLocaleString('ru-RU', {
                weekday: 'short', day: '2-digit', month: '2-digit',
                hour: '2-digit', minute: '2-digit'
              })}
            </label>
          ))}
          {freeSlots.length === 0 && doctorId && <div className="text-xs text-gray-500">Нет свободных слотов на 7 дней</div>}
        </div>

        {err && <div className="text-sm text-red-600 mb-2">{err}</div>}

        <button
          onClick={send}
          disabled={busy}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white py-2 rounded-lg"
        >
          {busy ? 'Отправка...' : `Отправить (${selected.length})`}
        </button>
      </div>
    </div>,
    document.body
  )
}
```

**Примечание:** endpoint `/manager/doctors/{id}/free-slots?days=7` может не существовать в текущем API — при имплементации проверь и адаптируй (либо используй существующий `slot-picker` API из коммита 986707e).

- [ ] **Step 2: PatientSlotRequestPicker — пациент**

Создать `frontend/src/components/chat/PatientSlotRequestPicker.jsx`:

```jsx
/**
 * chatslot01: пациент выбирает врача/услугу/даты → шлёт slot_request в чат.
 *
 * Props:
 *   open, onClose, threadId, onSent
 */
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import api from '../../api'
import { chatSlotsApi } from '../../api/chatSlots'

export default function PatientSlotRequestPicker({ open, onClose, threadId, onSent }) {
  const [doctorId, setDoctorId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [doctors, setDoctors] = useState([])
  const [services, setServices] = useState([])
  const [dates, setDates] = useState([])  // ['2026-05-22', ...]
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    // Публичные endpoints для пациента
    api.get('/patient/doctors').then(r => setDoctors(r.data || [])).catch(() => setDoctors([]))
    api.get('/patient/services').then(r => setServices(r.data || [])).catch(() => setServices([]))
  }, [open])

  function toggleDate(d) {
    setDates(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].slice(0, 7))
  }

  async function send() {
    setBusy(true)
    try {
      await chatSlotsApi.postSlotRequest(threadId, {
        doctor_id: doctorId || null,
        service_id: serviceId || null,
        preferred_dates: dates,
        note: note || null,
      })
      onSent?.()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  // Список ближайших 14 дней
  const upcoming = []
  for (let i = 0; i < 14; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    upcoming.push(d.toISOString().slice(0, 10))
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full overflow-y-auto p-4 shadow-xl">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold">Записаться</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">✕</button>
        </div>

        <label className="block text-sm text-gray-700 mb-1">Врач (необязательно)</label>
        <select value={doctorId} onChange={e => setDoctorId(e.target.value)}
                className="w-full mb-3 border rounded px-2 py-1.5">
          <option value="">— любой —</option>
          {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>

        <label className="block text-sm text-gray-700 mb-1">Услуга (необязательно)</label>
        <select value={serviceId} onChange={e => setServiceId(e.target.value)}
                className="w-full mb-3 border rounded px-2 py-1.5">
          <option value="">— по описанию —</option>
          {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <div className="text-sm text-gray-700 mb-1">Удобные даты (до 7):</div>
        <div className="grid grid-cols-2 gap-1 mb-3">
          {upcoming.map(d => (
            <label key={d} className="flex items-center gap-1 text-xs px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
              <input type="checkbox" checked={dates.includes(d)} onChange={() => toggleDate(d)} />
              {new Date(d).toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' })}
            </label>
          ))}
        </div>

        <label className="block text-sm text-gray-700 mb-1">Комментарий</label>
        <textarea value={note} onChange={e => setNote(e.target.value)}
                  className="w-full mb-3 border rounded px-2 py-1.5 text-sm" rows={2}
                  placeholder="например, до обеда удобнее" maxLength={500} />

        <button
          onClick={send}
          disabled={busy}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white py-2 rounded-lg"
        >
          {busy ? 'Отправка...' : 'Запросить запись'}
        </button>
      </div>
    </div>,
    document.body
  )
}
```

- [ ] **Step 3: PatientCardSidebar**

Создать `frontend/src/components/chat/PatientCardSidebar.jsx`:

```jsx
/**
 * chatslot01: карточка пациента в сайдбаре ClinicChatSection.
 *
 * Подтягивает: имя/телефон из patient_account, mis_sync_state, последние визиты из МИС.
 * Endpoint /clinic-chat/threads/{thread_id}/patient-context уже существует (см. clinic_chat.py:494).
 *
 * Props:
 *   threadId
 */
import { useEffect, useState } from 'react'
import api from '../../api'

const STATE_LABELS = {
  pending: { label: '⏳ Проверка в МИС…', color: 'text-amber-600' },
  linked: { label: '✅ Найден в МИС', color: 'text-green-700' },
  created: { label: '✅ Создан в МИС', color: 'text-green-700' },
  manual_required: { label: '⚠️ Требуется дозаполнение', color: 'text-red-600' },
  ambiguous: { label: '⚠️ Несколько аккаунтов с этим телефоном', color: 'text-red-600' },
  no_phone: { label: '⚠️ Телефон не указан', color: 'text-red-600' },
  error: { label: '⚠️ МИС недоступен', color: 'text-orange-600' },
}

export default function PatientCardSidebar({ threadId }) {
  const [ctx, setCtx] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!threadId) return
    setLoading(true)
    api.get(`/clinic-chat/threads/${threadId}/patient-context`)
       .then(r => setCtx(r.data))
       .catch(() => setCtx(null))
       .finally(() => setLoading(false))
  }, [threadId])

  if (loading) return <div className="p-3 text-sm text-gray-500">Загрузка карточки…</div>
  if (!ctx) return <div className="p-3 text-sm text-gray-500">Карточка недоступна</div>

  const state = STATE_LABELS[ctx.mis_sync_state] || STATE_LABELS.pending

  return (
    <div className="p-3 border-l border-gray-200 bg-white text-sm">
      <div className="font-semibold mb-1">{ctx.name || 'Без имени'}</div>
      <div className="text-gray-600 mb-2">{ctx.phone}</div>
      <div className={`text-xs mb-3 ${state.color}`}>{state.label}</div>

      {ctx.last_visits && ctx.last_visits.length > 0 && (
        <>
          <div className="text-xs text-gray-500 mb-1">Последние визиты:</div>
          <div className="flex flex-col gap-0.5 mb-3">
            {ctx.last_visits.slice(0, 5).map((v, i) => (
              <div key={i} className="text-xs text-gray-700">
                {new Date(v.date).toLocaleDateString('ru-RU')} — {v.doctor} ({v.service})
              </div>
            ))}
          </div>
        </>
      )}

      {ctx.balance !== undefined && (
        <div className="text-xs text-gray-700">Баланс: <b>{ctx.balance} ₽</b></div>
      )}
    </div>
  )
}
```

**Примечание:** `/clinic-chat/threads/{thread_id}/patient-context` — endpoint существует (см. `clinic_chat.py:494`). Проверь поля ответа при имплементации, и если их недостаточно — расширь хендлер, чтобы возвращал `mis_sync_state`, `last_visits` (из `mis_client.get_appointments`), `balance` (если есть).

- [ ] **Step 4: Закоммитить**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add frontend/src/components/chat/ClinicSlotPicker.jsx frontend/src/components/chat/PatientSlotRequestPicker.jsx frontend/src/components/chat/PatientCardSidebar.jsx && git commit -m "feat(chatslot): ClinicSlotPicker + PatientSlotRequestPicker + PatientCardSidebar" && git push'
```

---

## Task 11: Wire-up в ClinicChatSection + PatientChatSection + build

**Files:**
- Modify: `frontend/src/sections/ClinicChatSection.jsx`
- Modify: `frontend/src/sections/PatientChatSection.jsx`

- [ ] **Step 1: ClinicChatSection — кнопка «Предложить слоты» + sidebar**

Открыть `frontend/src/sections/ClinicChatSection.jsx`. В composer (внизу, где input + send button) добавить кнопку слева от input:

```jsx
import ClinicSlotPicker from '../components/chat/ClinicSlotPicker'
import PatientCardSidebar from '../components/chat/PatientCardSidebar'

// ... внутри компонента
const [pickerOpen, setPickerOpen] = useState(false)
const [pickerDefaults, setPickerDefaults] = useState({})

// Open from slot_request bubble:
function handleOfferRequest(req) {
  setPickerDefaults(req)
  setPickerOpen(true)
}

// В composer — рядом со «Send»:
<button onClick={() => { setPickerDefaults({}); setPickerOpen(true) }}
        className="px-3 py-2 text-sm bg-blue-100 hover:bg-blue-200 rounded">
  🗓 Слоты
</button>

// В layout (рядом с messages list, справа):
<div className="hidden md:block w-64">
  <PatientCardSidebar threadId={selectedThreadId} />
</div>

// В конец компонента:
<ClinicSlotPicker
  open={pickerOpen}
  onClose={() => setPickerOpen(false)}
  threadId={selectedThreadId}
  defaults={pickerDefaults}
  onSent={() => refetchMessages()}
/>
```

Пробросить `onOfferRequest={handleOfferRequest}` и `isPatient={false}` в `<MessageBubble />`.

- [ ] **Step 2: PatientChatSection — кнопка «Записаться»**

Открыть `frontend/src/sections/PatientChatSection.jsx`. В composer добавить кнопку:

```jsx
import PatientSlotRequestPicker from '../components/chat/PatientSlotRequestPicker'

// ... внутри компонента
const [reqOpen, setReqOpen] = useState(false)

// В composer:
<button onClick={() => setReqOpen(true)}
        className="px-3 py-2 text-sm bg-green-100 hover:bg-green-200 rounded">
  📅 Записаться
</button>

// В конец:
<PatientSlotRequestPicker
  open={reqOpen}
  onClose={() => setReqOpen(false)}
  threadId={threadId}
  onSent={() => refetchMessages()}
/>
```

Пробросить `isPatient={true}`, `threadId={threadId}`, `onSlotBooked={() => refetchMessages()}` в `<MessageBubble />`.

- [ ] **Step 3: Rebuild и redeploy frontend**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && docker compose build --no-cache clinika-frontend' 2>&1 | tail -10
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && docker compose up -d clinika-frontend'
```

Ожидаемый вывод — успешный build (без `npm error` или `exit code: 1` в финале).

- [ ] **Step 4: Smoke verification**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'sleep 5 && docker ps --format "{{.Names}}: {{.Status}}" | grep clinika'
# Backend health
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'curl -sk -o /dev/null -w "frontend HTTP %{http_code}\n" https://клиниксеть.рф/arc/'
# Slot endpoints
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 '
  for path in /api/clinic-chat/threads/00000000-0000-0000-0000-000000000000/slot-offer /api/patient/chat/threads/00000000-0000-0000-0000-000000000000/slot-request /api/patient/chat/threads/00000000-0000-0000-0000-000000000000/book-slot; do
    echo "$path:" $(curl -sk -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "{}" "https://клиниксеть.рф$path")
  done
'
```

Ожидаемые коды: 401/403 (auth required) или 422 (валидация) — НЕ 404 / 500.

- [ ] **Step 5: Закоммитить и записать память**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add frontend/src/sections/ClinicChatSection.jsx frontend/src/sections/PatientChatSection.jsx && git commit -m "feat(chatslot): wire-up — кнопки в composer + sidebar в ClinicChat + PatientChat" && git push'
```

Записать память (`clinika_chat_slot_booking.md`) с финальной картой:
- alembic head: `chatslot01`
- Routers: `/clinic-chat/threads/{tid}/slot-offer`, `/patient/chat/threads/{tid}/slot-request`, `/patient/chat/threads/{tid}/book-slot`
- Список 11 commits, ссылки на spec + plan.

---

## Параллелизация (если выполнение через subagent-driven-development)

| Задача | Зависимости | Может параллельно? |
|--------|-------------|--------------------|
| 1 (Models) | — | Нет — foundation |
| 2 (Migration) | 1 | Нет |
| 3 (Schemas) | 1 | Нет — нужны типы из Pydantic для Task 4 |
| 4 (SlotBookingService) | 1, 3 | Может параллельно с 5 (разные файлы) |
| 5 (PatientIdentifier) | 1 | **Параллельно с 4** |
| 6 (Routers) | 4, 5 | Нет |
| 7 (Hook + cron) | 6 | Нет |
| 8 (Tests) | 4, 5, 6 | Нет |
| 9 (Frontend bubbles) | 6 (API известно) | **Параллельно с 10** |
| 10 (Pickers + sidebar) | 6 (API известно) | **Параллельно с 9** |
| 11 (Wire-up + build) | 9, 10 | Нет — главный агент |

**Рекомендуемые группы (учёт `feedback_parallel_agents_overload` — макс 2-3 docker build параллельно):**
- Группа A (sequential): 1 → 2 → 3
- Группа B (parallel): 4 + 5 одновременно
- Группа C (sequential): 6 → 7 → 8
- Группа D (parallel): 9 + 10 одновременно
- Группа E (sequential): 11

**Важно из памяти:**
- `feedback_parallel_frontend_agents` — App.jsx правит только главный агент в Task 11.
- `feedback_parallel_backend_routers` — в Task 6 главный агент мерджит main.py одной правкой.
- Backend без bind-mount — менять файлы через `docker cp` или `docker compose build clinika-backend`.
