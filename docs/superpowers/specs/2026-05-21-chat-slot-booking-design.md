# Запись через чат + auto-identification пациента
**Дата:** 2026-05-21
**Автор:** mr-khamzat + Claude
**Статус:** design / approved by user
**Целевой релиз:** TBD

## Контекст и проблема

На сайте Клиника продвигается оффер: «Запись за 30 секунд. Слот выбирается прямо в чате, сразу попадает в расписание врача и СМС-напоминание». В продукте — не реализовано (см. аудит от 2026-05-21):

- `PatientChatSection.jsx` — только текстовый чат, никаких слотов.
- В `MessageBubble` нет интерактивных типов сообщений.
- `routers/patient_chat.py` / `patient_chat_threads.py` — endpoints только для send/receive.
- В `Appointment` нет поля `chat_thread_id`, источник записи не отслеживается.
- Есть отдельные `SlotBoard` (для врача/регистратора) и `QuickBook` (в кабинете пациента, не в чате) — это разные системы.

Вторая проблема: при первом сообщении пациента в чат клиника не знает, кто пишет. Пациент авторизован в ЛК — `user.phone` и `patient_account` есть, но `patient_account.mis_patient_id` часто пустой → клиника не видит карточку с историей визитов из МИС.

Решение должно отвечать на оба запроса одновременно.

## Цели

1. Регистратор/менеджер может из чата с пациентом отправить интерактивную карточку «выберите слот» — пациент кликает кнопку, Appointment создаётся, попадает в SlotBoard врача.
2. Пациент в своём чате может сам нажать «Записаться» — открывается slot-picker, выбор летит в чат как `slot_request`, регистратор отвечает оффером.
3. При первом сообщении пациента в thread'е — backend автоматически ищет/создаёт пациента в МИС, привязывает `mis_patient_id` к `patient_account`. На стороне клиники сайдбар чата показывает карточку с историей.
4. Без SMS-напоминаний — это можно добавить позже отдельным модулем.

## Не-цели

- AI-распознавание текста пациента («когда можно записаться?»). Slot-offer инициирует только регистратор или пациент явной кнопкой.
- Видеоконсультации, оплата прямо в чате — отдельные модули.
- Дозаполнение паспортных данных пациента в чате — пока 4xx от MIS на `addPatient` обрабатывается через ручную кнопку в сайдбаре.
- Замена существующего `QuickBook` в кабинете пациента — он остаётся для случая «пациент без чата».

## Архитектура

### A. Slot-booking — типы сообщений в чате

Расширяем `PatientChatMessage.message_type` (или эквивалент — определить точно при имплементации):

| message_type | Кто шлёт | payload JSON |
|---|---|---|
| `slot_offer` | клиника | `{doctor_id, service_id, slots: [{idx, start_at_iso, duration_min, label}], status: 'active'|'superseded'|'expired'}` |
| `slot_request` | пациент | `{doctor_id?, service_id?, preferred_dates: [iso], note?}` |
| `slot_booked` | system | `{appointment_id, slot: {...}, doctor_name, service_name}` |
| `slot_expired` | system | `{original_message_id}` |

Существующие `text` / `file` / `audio` / `reaction` — без изменений.

### B. Хранение Appointment с привязкой к чату

```sql
ALTER TABLE appointments
  ADD COLUMN chat_thread_id UUID NULL
    REFERENCES patient_chat_threads(id) ON DELETE SET NULL,
  ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'direct';
```

`source` enum: `direct` (создан регистратором вручную), `referral` (из направления), `chat` (из чата). Для existing rows — backfill `'direct'`.

### C. Patient identifier — MIS auto-link

При первом сообщении пациента в каждом thread'е enqueue background-task `patient_identifier.identify(thread_id, user_id)`:

```
if patient_account.mis_patient_id IS NULL:
    mis_id = mis_client.find_patient_by_phone(phone)
    if mis_id:
        patient_account.mis_patient_id = mis_id
        mis_sync_state = 'linked'
    else:
        try:
            mis_id = mis_client.add_patient(name, phone, birth_date)
            patient_account.mis_patient_id = mis_id
            mis_sync_state = 'created'
        except MisHttpError as e:
            if e.status >= 500: enqueue retry via mis_outbox
            elif e.status >= 400: mis_sync_state = 'manual_required'
WS push → ClinicChatSection sidebar refreshes
```

Поля `patient_account.mis_synced_at` и `patient_account.mis_sync_state` уже могут быть — проверить при имплементации, добавить если нет.

### D. Race-protection при клике слота

```python
async def book_slot(thread_id, message_id, slot_index, user):
    async with advisory_lock(f"doctor_{doctor_id}_{start_at}"):
        existing = await session.execute(
            select(Appointment).where(
                Appointment.doctor_id == doctor_id,
                Appointment.start_at == start_at,
                Appointment.status != 'cancelled'
            )
        )
        if existing.scalar_one_or_none():
            await mark_slot_taken_in_offer(message_id, slot_index)
            raise HTTPException(409, "slot_taken")
        # FREE → создаём Appointment, обновляем message
```

Advisory lock — Postgres `pg_advisory_xact_lock(hash)` — освобождается на commit/rollback. Альтернатива через unique constraint `(doctor_id, start_at)` WHERE status != 'cancelled' — но cancellation history может дать ложные коллизии, advisory lock проще.

### E. Auto-expire `slot_offer`

Cron-задача каждые 15 минут (APScheduler в backend):
```
UPDATE patient_chat_messages
   SET message_type = 'slot_expired',
       payload = jsonb_set(payload, '{status}', '"expired"')
 WHERE message_type = 'slot_offer'
   AND payload->>'status' = 'active'
   AND created_at < NOW() - INTERVAL '24 hours'
RETURNING id, thread_id;
```
По каждой возвращённой строке — WS push в thread.

## Компоненты

### Backend
| Файл | Изменения |
|---|---|
| `backend/app/models/chat_patient.py` *(или эквивалент)* | расширить `message_type` enum |
| `backend/app/models/appointment.py` | + `chat_thread_id` (UUID FK nullable), + `source` enum |
| `backend/app/models/patient_account.py` | убедиться/добавить `mis_patient_id`, `mis_synced_at`, `mis_sync_state` |
| `backend/app/routers/clinic_chat_slots.py` *(new)* | `POST /clinic-chat/threads/{tid}/slot-offer` |
| `backend/app/routers/patient_chat_slots.py` *(new)* | `POST /patient/chat/threads/{tid}/slot-request`, `POST /patient/chat/threads/{tid}/book-slot` |
| `backend/app/services/slot_booking_service.py` *(new)* | бизнес-логика бронирования с advisory lock |
| `backend/app/services/patient_identifier.py` *(new)* | background-task MIS auto-link |
| `backend/app/services/mis_outbox.py` *(new или extend)* | outbox-таблица для retry, готовит почву под MIS replacement plan |
| `backend/app/routers/patient_chat.py` *(existing)* | hook в send_message → enqueue identifier |
| `backend/app/schemas/chat_slots.py` *(new)* | Pydantic схемы |
| `backend/alembic/versions/chatslot01_*.py` *(new)* | миграция: message_type enum, appointment.chat_thread_id, appointment.source, patient_account.mis_* (если нет), mis_outbox table |

### Frontend
| Файл | Изменения |
|---|---|
| `frontend/src/api/chatSlots.js` *(new)* | API клиент |
| `frontend/src/components/chat/MessageBubble.jsx` | рендер новых типов через switch |
| `frontend/src/components/chat/SlotOfferBubble.jsx` *(new)* | карточка слотов-кнопок с состояниями active/booked/expired |
| `frontend/src/components/chat/SlotRequestBubble.jsx` *(new)* | для клиники: «пациент просит запись», кнопка «Предложить слоты» |
| `frontend/src/components/chat/SlotBookedBubble.jsx` *(new)* | системное «✅ Запись подтверждена» |
| `frontend/src/components/chat/ClinicSlotPicker.jsx` *(new)* | mini-SlotBoard для регистратора в drawer |
| `frontend/src/components/chat/PatientSlotRequestPicker.jsx` *(new)* | пациент: выбор врача/услуги/дат |
| `frontend/src/components/chat/PatientCardSidebar.jsx` *(new)* | карточка пациента в сайдбаре `ClinicChatSection` |
| `frontend/src/sections/ClinicChatSection.jsx` | + кнопка «Предложить слоты», + PatientCardSidebar |
| `frontend/src/sections/PatientChatSection.jsx` | + кнопка «Записаться» в composer |

## API

### POST /clinic-chat/threads/{thread_id}/slot-offer
Регистратор → пациент.
**Roles:** `MANAGER`, `FRANCHISE_OWNER`, `SUPER_ADMIN`, `REG`, `DOCTOR` (любой staff клиники).
**Body:**
```json
{
  "doctor_id": "uuid",
  "service_id": "uuid",
  "slots": [
    {"start_at": "2026-05-22T10:00:00Z", "duration_min": 30},
    {"start_at": "2026-05-22T10:30:00Z", "duration_min": 30}
  ]
}
```
**Response 201:** созданное `ChatMessage`.

### POST /patient/chat/threads/{thread_id}/slot-request
Пациент → клиника.
**Roles:** только владелец thread.
**Body:**
```json
{
  "doctor_id": "uuid?",
  "service_id": "uuid?",
  "preferred_dates": ["2026-05-22", "2026-05-23"],
  "note": "до обеда удобнее"
}
```
**Response 201:** созданное `ChatMessage`.

### POST /patient/chat/threads/{thread_id}/book-slot
Пациент кликает на слот.
**Body:**
```json
{"message_id": "uuid", "slot_index": 0}
```
**Response 201:**
```json
{
  "appointment_id": "uuid",
  "slot_booked_message_id": "uuid",
  "system_message_id": "uuid"
}
```
**409 if slot_taken:** body содержит обновлённый `slot_offer` с пометкой занятого слота.
**410 if expired:** body содержит ссылку на `slot_expired` сообщение.

### Идемпотентность
Заголовок `Idempotency-Key` обязателен на `book-slot`. Серверный кэш по `(thread_id, message_id, user_id)` 60 сек.

## Error handling

См. секцию 3 в дизайн-обсуждении. Ключевые правила:
- 409 `slot_taken` → клиент пересинхронизирует offer, остальные слоты живые.
- MIS 5xx → запись в `mis_outbox`, retry exp.backoff до 1 ч → потом TG алерт.
- MIS 4xx → `mis_sync_state='manual_required'`, кнопка «Дозаполнить» в сайдбаре.
- WS reconnect → фронт re-fetch'ит сообщения, видит актуальный state.

## Тесты

**Backend (pytest-async):**
- `test_chat_slots_offer.py`: RBAC, валидация payload, мульти-слот offer.
- `test_chat_slots_book.py`: happy path, race (двое кликают одновременно), slot занят вне чата, expired offer.
- `test_chat_slots_request.py`: пациент шлёт request, регистратор видит.
- `test_patient_identifier.py`: found_in_mis, addPatient_ok, addPatient_5xx_to_outbox, addPatient_4xx_to_manual, duplicate_phone_to_ambiguous.
- `test_appointment_chat_source.py`: Appointment.source='chat', chat_thread_id в API ответе.
- `test_slot_expiry_cron.py`: 24-hour TTL, offer → expired, WS-push.

**Frontend:** build + 200 на routes; manual UI checklist в конце.

**Migration:** alembic upgrade/downgrade без потери данных, backfill `source='direct'`.

## Открытые вопросы

- **WS-протокол**: какие именно события publish'им — `chat.message.created`, `chat.message.updated`, `chat.slot_booked`. Уточнить в момент имплементации (посмотреть существующий WS handler `patient_chat.py`).
- **Доступ модуля чата**: проверить, что endpoints возвращают 403 если у тенанта нет premium chat подписки.
- **Race в SlotBoard у регистратора**: если регистратор смотрит SlotBoard и одновременно из чата другого регистратора создаётся Appointment — WS-push в SlotBoard обновит UI (стандартное поведение, не требует кода в этой фиче).
- **24-часовой TTL — конфигурируемый?**: пока хардкод в cron. Можно вынести в `clinic_settings.slot_offer_ttl_hours` отдельной фичей.

## Risk

- **МИС лежит часто** → identifier будет копить outbox. Нужен мониторинг очереди (если >50 pending → алерт).
- **Concurrent slot booking** → advisory_lock закрывает, но при росте RPS нужен мониторинг lock wait time.
- **PatientChatMessage схема** — у `patient_chat` может быть payload JSONB или плоские колонки. При имплементации первым делом проверить, и если плоские — добавить JSONB через миграцию.
