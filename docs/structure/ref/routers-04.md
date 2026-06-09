# routers [04] — чат клиники, платежи-эквайринг, коммерция, кабинет директора, AI-врач

Это срез из 15 FastAPI-роутеров `backend/app/routers/`, охватывающий пять смысловых блоков МИС-платформы:

1. **Чат «клиника ↔ пациент»** (`clinic_chat`, `clinic_chat_slots`, `chat_promo`, `chat_sla_stats`, `chat_templates`, `clinic_chat_templates`) — ядро Intercom-подобного чата для регистратора/врача: треды, сообщения, файлы, реакции, SLA-светофор, шаблоны быстрых ответов, промокоды, прайс-расчёт, слот-офферы.
2. **Интернет-эквайринг клиники** (`clinic_payments`) — приём платежей пациентов через шлюзы (ЮKassa и др.), webhook, конфиг шлюза.
3. **Коммерция платформы** (`commercial`) — super_admin-каталог модулей, подписки тенантов, интеграции (МИС/ЛИС).
4. **Кабинет директора** (`director`, `director_export`) — read-only финансово-операционная аналитика сети (P&L, ДДС, KPI, маркетинг) + экспорт в Excel/PDF.
5. **Прочее**: справочник клиник и расписание (`clinics`), CMS-страницы и тема (`cms`), 152-ФЗ согласия (`consent`), публичная контакт-форма (`contact`), «Врач AI» (`doctor_ai`).

Все роутеры монтируются в `main.py` **без дополнительного префикса** — каждый объявляет собственный `prefix=` внутри файла (поэтому пути в таблицах ниже — это финальные пути API). Сквозные сущности: `User`/`UserRole` (RBAC по ролям), `ChatThread`/`ChatMessage`, `ClinicPayment`, `Tenant`/`Franchise`. Изоляция арендаторов выполняется по-разному в разных файлах (`tenant_id`, `clinic_id` через `_user_clinic_ids`, `franchise_id`) — см. «Подводные камни» каждой секции.

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `chat_promo.py` | Выпуск промокодов в тред чата | 88 |
| `chat_sla_stats.py` | SLA-светофор по открытым тредам | 65 |
| `chat_templates.py` | CRUD шаблонов (legacy таблица message_templates) | 205 |
| `clinic_chat.py` | Ядро чата клиники: треды/сообщения/файлы/прайс | 1173 |
| `clinic_chat_slots.py` | Отправка slot-offer в PatientChat | 74 |
| `clinic_chat_templates.py` | CRUD шаблонов (новая таблица chat_message_templates) | 230 |
| `clinic_payments.py` | Интернет-эквайринг: init/refund/webhook/конфиг | 433 |
| `clinics.py` | Список клиник, услуги, расписание | 187 |
| `cms.py` | CMS-страницы и тема тенанта | 159 |
| `commercial.py` | Каталог модулей, подписки, интеграции (super_admin) | 493 |
| `consent.py` | 152-ФЗ согласие на обработку ПД | 188 |
| `contact.py` | Публичная контакт-форма + админ-список | 133 |
| `director.py` | Кабинет директора: P&L/ДДС/KPI/маркетинг (read-only) | 1507 |
| `director_export.py` | Экспорт отчётов директора в XLSX/PDF | 893 |
| `doctor_ai.py` | Врач AI: briefing + планы лечения | 608 |

---

## `backend/app/routers/chat_promo.py`

- **Назначение:** Выпуск промокода (скидки) сотрудником клиники в конкретный тред чата и его автодоставка пациенту отдельным сообщением-карточкой.
- **Ключевые элементы:** `router` (prefix `/clinic/chat`); Pydantic `PromoIn` (discount_type percent|fixed, discount_value, valid_days, max_uses); эндпоинты `issue_promo`, `list_promos`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/clinic/chat/threads/{thread_id}/promo-code` | любой авторизованный (`get_current_user`) | `PromoIn` | `{ok, promo_id, code, message_id}` | Создать промокод + сообщение в тред |
| GET | `/clinic/chat/threads/{thread_id}/promo-codes` | любой авторизованный | — | список промокодов треда | История промокодов треда |

- **Зависимости:** `app.models.chat_promo_code.ChatPromoCode`, `app.models.chat.ChatThread/ChatMessage`, `get_db`, `get_current_user`. Скидка кладётся и текстом, и в `ChatMessage.attachments` как `{type:'promo_code', data:{...}}`.
- **Где менять для типовых задач:** изменить правила скидки/срок — `PromoIn` и тело `issue_promo`; формат карточки промокода во фронте — поле `attachments` (line 54-63); генерация самого `code` — в модели `ChatPromoCode` (здесь только читается `promo.code`).
- **Подводные камни:** **Нет проверки роли и нет ownership-check** — любой авторизованный может выпустить промокод в любой тред по UUID (в отличие от `clinic_chat.py`, где есть `_ensure_clinic_role` + `_user_clinic_ids`). `tenant_id` берётся из `th.tenant_id or user.tenant_id`. Префикс `/clinic/chat` совпадает с `clinic_chat.py` — это намеренное расширение того же неймспейса.
- **Строк:** 88

## `backend/app/routers/chat_sla_stats.py`

- **Назначение:** Дашборд SLA-светофора (Intercom-style): сколько открытых тредов «просрочено/требует внимания/свежие» по всем клиникам, доступным пользователю.
- **Ключевые элементы:** `router` (prefix `/clinic/chat/sla`); единственный эндпоинт `sla_dashboard`. Пороги: red >15 мин, yellow 5–15 мин, green <5 мин (по `last_inbound_message_at`).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/clinic/chat/sla/dashboard` | clinic-роли (`_ensure_clinic_role`) | — | `{red, yellow, green, total_open}` | Счётчики SLA по открытым тредам |

- **Зависимости:** **импортирует из `clinic_chat.py`** функции `_user_clinic_ids` и `_ensure_clinic_role` (внутри тела эндпоинта, line 33) — сильная связь с ядром чата. Модель `ChatThread`.
- **Где менять для типовых задач:** изменить пороги SLA — константы 900/300 секунд в цикле (line 53-57); расширить ответ (например, разбивка по клиникам) — переписать агрегацию в цикле. Логика порогов **продублирована** в `clinic_chat.list_threads` (фильтр `sla`) — менять синхронно в обоих местах.
- **Подводные камни:** треды без `last_inbound_message_at` пропускаются (не считаются ни в одну категорию, но входят в `total_open`). Зависимость от приватных `_`-функций `clinic_chat.py` — при рефакторинге сигнатур там этот файл сломается.
- **Строк:** 65

## `backend/app/routers/chat_templates.py`

- **Назначение:** CRUD шаблонов быстрых ответов поверх **старой** таблицы `message_templates` (`MessageTemplate`), плюс идемпотентный сид 10 платформенных шаблонов.
- **Ключевые элементы:** `router` (prefix `/chat/templates`); `_require_staff` (запрещает patient/visiting_doctor/partner_doctor, требует tenant_id); `TemplateIn`; эндпоинты list/create/update/delete/use/seed-defaults; константа `DEFAULT_TEMPLATES` (10 шт.).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/chat/templates` | staff (не пациент) | query q, category, limit | `{templates:[...]}` | Поиск/список шаблонов тенанта |
| POST | `/chat/templates` | staff; is_global только manager/owner/super_admin | `TemplateIn` | сериализованный шаблон | Создать шаблон |
| PUT | `/chat/templates/{template_id}` | staff + `can_modify_template` | `TemplateIn` | шаблон | Редактировать |
| DELETE | `/chat/templates/{template_id}` | staff + `can_modify_template` | — | 204 | Удалить |
| POST | `/chat/templates/{template_id}/use` | staff | — | `{body, usage_count}` | Инкремент usage_count, отдать тело |
| POST | `/chat/templates/seed-defaults` | manager/franchise_owner/super_admin/director | — | `{created, skipped, total}` | Засеять 10 платформенных шаблонов |

- **Зависимости:** `app.models.message_template.MessageTemplate`, `app.services.chat_template_service.serialize_template / can_modify_template`. «Общий шаблон тенанта» = `created_by_user_id IS NULL`.
- **Где менять для типовых задач:** добавить дефолтные шаблоны — список `DEFAULT_TEMPLATES` (line 146); права на удаление/правку — `can_modify_template` в сервисе; поля шаблона — `TemplateIn` + сериализатор в сервисе.
- **Подводные камни:** **ВНИМАНИЕ — два конкурирующих роутера шаблонов чата.** Этот файл (`/chat/templates`, таблица `message_templates`) и `clinic_chat_templates.py` (`/clinic/chat/templates`, таблица `chat_message_templates`) — параллельные реализации одной фичи на разных таблицах. В `DEFAULT_TEMPLATES` есть дубль shortcut `prep` (line 151 и 152) и `schedule` (несколько) — при сиде второй с тем же shortcut пропускается из-за UNIQUE-конфликта. Конфликт при создании ловится широким `except Exception` → 409.
- **Строк:** 205

## `backend/app/routers/clinic_chat.py`

- **Назначение:** Ядро чата со стороны клиники (Глава 9): список/просмотр тредов, отправка сообщений, загрузка файлов, реакции, пины, цветовые метки, typing-индикатор, назначение/переназначение врача, закрытие, контекст пациента, скачивание документов и прайс-калькулятор. Самый крупный и центральный файл среза.
- **Ключевые элементы:** `router` (prefix `/clinic/chat`); множество клиник: `CLINIC_ROLES`, `_ensure_clinic_role`, `_sender_type_for`, **`_user_clinic_ids`** (главная RBAC-функция, переиспользуется другими файлами). Pydantic: `SendMessageIn` (body|attachments|reply_to_id), `AssignIn`, `ReactionIn`, `ColorLabelIn`, `ReassignIn`, `PriceQuoteRequest/Item/Response`. Хелперы: `_ensure_thread_access_for_patient_id`, `_build_price_quote`. Константы `MAX_UPLOAD_SIZE=50MB`, `UPLOAD_DIR=/app/uploads/clinic-chat`, `ALLOWED_COLOR_LABELS`.
- **Эндпоинты:** (все требуют `_ensure_clinic_role` + проверку `th.clinic_id in _user_clinic_ids`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/clinic/chat/threads` | clinic-роли | query clinic_id, status, sla | `{threads:[...]}` | Список тредов с enriched-данными + SLA-фильтр |
| GET | `/clinic/chat/threads/{thread_id}` | clinic-роли | query limit, before_id | `{thread, messages}` | Тред + сообщения + auto-claim |
| POST | `/clinic/chat/threads/{thread_id}/read` | clinic-роли | — | `{ok, thread_id}` | Обнулить unread_for_clinic |
| POST | `/clinic/chat/threads/{thread_id}/messages` | clinic-роли | `SendMessageIn` | сериализованное сообщение | Отправить сообщение (с reply) |
| POST | `/clinic/chat/threads/{thread_id}/files` | clinic-роли | UploadFile | `{url, name, mime, size}` | Загрузить файл (drag&drop) |
| POST | `/clinic/chat/threads/{thread_id}/typing` | clinic-роли | — | `{ok, last_typing_at_clinic}` | Пинг «клиника печатает» |
| POST | `/clinic/chat/threads/{thread_id}/assign` | clinic-роли | `AssignIn` | сериализованный тред | Назначить врача треду |
| PATCH | `/clinic/chat/threads/{thread_id}/label` | clinic-роли | `ColorLabelIn` | `{color_label, thread_id}` | Поставить/снять цветовую метку |
| POST | `/clinic/chat/threads/{thread_id}/pin` | clinic-роли | — | `{is_pinned, pinned_at, thread_id}` | Toggle pin |
| POST | `/clinic/chat/messages/{message_id}/reactions` | clinic-роли | `ReactionIn` | `{added, emoji, message_id}` | Toggle emoji-реакция |
| POST | `/clinic/chat/threads/{thread_id}/close` | clinic-роли | — | сериализованный тред | Закрыть тред |
| POST | `/clinic/chat/threads/{thread_id}/reassign` | manager/franchise_owner/reg/назначенный | `ReassignIn` | `{ok, thread_id, to_user_id}` | Передать тред другому сотруднику |
| GET | `/clinic/chat/threads/{thread_id}/patient-context` | clinic-роли | — | patient/appointments/chat_summary/documents/thread | Полная карточка пациента для панели чата |
| GET | `/clinic/chat/documents/patient_doc/{doc_id}/download` | clinic-роли + ownership | — | FileResponse | Скачать patient_document |
| GET | `/clinic/chat/documents/appt_attach/{att_id}/download` | clinic-роли + ownership | — | FileResponse/Redirect | Скачать вложение приёма |
| GET | `/clinic/chat/documents/lab_order/{order_id}/download` | clinic-роли + ownership | — | JSONResponse | Результаты лаб-заказа как JSON |
| POST | `/clinic/chat/threads/{thread_id}/price-quote` | clinic-роли | `PriceQuoteRequest` | `PriceQuoteResponse` | Рассчитать прайс с учётом подписки (без сохранения) |
| POST | `/clinic/chat/threads/{thread_id}/send-quote` | clinic-роли | `PriceQuoteRequest` | `{ok, message_id, quote, message}` | Рассчитать и отправить прайс-карточку в чат |

- **Зависимости:** `app.services.chat_service as cs` (list_clinic_threads, get_thread, list_messages, last_message, add_staff_message, serialize_thread/message), `app.services.chat_workflow_service.reassign_thread/CrossTenantError`. Модели: `ChatThread`, `ChatMessage`, `ChatMessageReaction`, `Clinic`, `PatientAccount`, `Appointment`, `Doctor`, `PatientDocument`, `AppointmentAttachment`, `LabOrder`/`LabResult`, `Service`, `PatientSubscription`/`SubscriptionPlan`. Прайс-скидки — `app.services.subscription_plan_discount_service.get_effective_discount_for_service`. RBAC `_user_clinic_ids` импортируется из этого файла в `chat_sla_stats.py`.
- **Где менять для типовых задач:** добавить роль с доступом к чату — `CLINIC_ROLES` (line 38) и логику в `_user_clinic_ids` (line 56); новый тип attachment (карточка) — `add_staff_message` в сервисе + фронт; правила скидок прайса — `_build_price_quote` (line 991, clamp 0..50 на line 1085-1088); источники документов в карточке пациента — три блока в `patient_context` (patient_documents / appointment_attachments / lab_orders, line 681-816); auto-claim врача — `get_thread` (line 246-253).
- **Подводные камни:** **тонкая RBAC-логика в `_user_clinic_ids`** — у `franchise_owner` берутся клиники всех подчинённых тенантов, у `super_admin/admin/manager` без tenant_id — ВСЕ клиники (потенциальная утечка, line 81-83). Прайс считается в **int рублях** через `int(float(...))` — теряются копейки (line 1069); скидка clamp'ится до 50% жёстко. В `patient_context` весь сбор документов обёрнут в широкий `try/except` → при несовпадении моделей молча возвращает `documents=[]` (можно не заметить регресс). Download-эндпоинты делают ownership-check через `_ensure_thread_access_for_patient_id` (по phone/patient_id и доступным клиникам) — критично не убирать. Файлы пишутся на локальный диск `/app/uploads` (не S3). `before_id` пагинация без cursor-валидации.
- **Строк:** 1173

## `backend/app/routers/clinic_chat_slots.py`

- **Назначение:** Отправка slot-offer (предложение записи на приём) от регистратора/менеджера в чат. Работает с **другой** моделью чата — `PatientChat` (не `ChatThread`).
- **Ключевые элементы:** `router` (prefix `/clinic-chat`, с дефисом, не путать с `/clinic/chat`); `STAFF_ROLES` (UserRole enum); эндпоинт `post_slot_offer`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/clinic-chat/threads/{thread_id}/slot-offer` | MANAGER/FRANCHISE_OWNER/SUPER_ADMIN/REG/DOCTOR | `SlotOfferCreate` | `ChatMessageResponse` (201) | Создать slot-offer в PatientChat |

- **Зависимости:** `app.models.patient_chat.PatientChat`, `app.schemas.chat_slots.SlotOfferCreate/ChatMessageResponse`, `app.services.slot_booking_service.create_slot_offer`. `thread_id` здесь — это `PatientChat.id`.
- **Где менять для типовых задач:** логику создания оффера/брони — `slot_booking_service.create_slot_offer`; набор ролей — `STAFF_ROLES` (line 30); схема оффера — `app.schemas.chat_slots`.
- **Подводные камни:** **архитектурный разлом** — этот эндпоинт оперирует `PatientChat`, тогда как основной чат (`clinic_chat.py`) — `ChatThread`. Это две разные системы чата с похожими названиями; `thread_id` означает разные сущности. Tenant-check: super_admin в любой, остальные `chat.tenant_id == user.tenant_id`. Сравнение ролей идёт через `user.role` напрямую с enum (а не `.value`), в отличие от большинства других файлов.
- **Строк:** 74

## `backend/app/routers/clinic_chat_templates.py`

- **Назначение:** CRUD шаблонов быстрых ответов поверх **новой** таблицы `chat_message_templates` (`ChatMessageTemplate`) — с платформенными (`is_default`) и тенантными шаблонами, sort_order, usage_count.
- **Ключевые элементы:** `router` (prefix `/clinic/chat/templates`); `_role` хелпер; `TemplateIn`; эндпоинты list/create/delete/use/seed-defaults; список `DEFAULTS` (10 шаблонов с shortcut вида `/прив`).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/clinic/chat/templates` | любой авторизованный | query q | список шаблонов | Default + шаблоны тенанта |
| POST | `/clinic/chat/templates` | manager/director/franchise_owner/super_admin/admin | `TemplateIn` | `{id}` (201) | Создать шаблон |
| DELETE | `/clinic/chat/templates/{template_id}` | владелец тенанта (не is_default) | — | `{ok}` | Удалить шаблон |
| POST | `/clinic/chat/templates/{template_id}/use` | **без авторизации** | — | `{ok, usage_count}` | Инкремент usage_count |
| POST | `/clinic/chat/templates/seed-defaults` | super_admin | — | `{ok, seeded, total}` | Засеять 10 платформенных шаблонов |

- **Зависимости:** `app.models.chat_message_template.ChatMessageTemplate`. Нет сервисного слоя — вся логика inline.
- **Где менять для типовых задач:** дефолтные шаблоны — список `DEFAULTS` (line 143); права на создание — список ролей в `create_template` (line 81); сортировка выдачи — `order_by(sort_order, title)`.
- **Подводные камни:** **дубль фичи** с `chat_templates.py` (см. там; этот — на новой таблице, как и сказано в docstring). Эндпоинт `/use` **не имеет `get_current_user`** — инкремент счётчика доступен анонимно. Префикс `/clinic/chat/templates` вложен в неймспейс `clinic_chat.py` (`/clinic/chat`) — порядок include в `main.py` важен, чтобы пути не перехватывались. `is_default`-шаблоны имеют `tenant_id=None`.
- **Строк:** 230

## `backend/app/routers/clinic_payments.py`

- **Назначение:** Интернет-эквайринг клиники (модуль `online_payments_pro`): инициация платежа пациентом, статус, возврат, приём webhook от шлюза, список платежей и управление конфигом шлюза.
- **Ключевые элементы:** `router` (без prefix — пути в корне); `_pay_module = Depends(require_module("online_payments_pro"))`; Pydantic `PaymentInitRequest`, `PaymentConfigBody`; сериализаторы `_serialize_payment`, `_serialize_config`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/payments/init` | авторизованный + модуль + region_lock | `PaymentInitRequest` | `{payment, payment_url}` | Старт оплаты, редирект-URL |
| GET | `/payments/{payment_id}` | manager + модуль | — | сериализованный платёж | Статус платежа |
| POST | `/payments/{payment_id}/refund` | manager + модуль + region_lock | amount (body) | результат возврата | Возврат платежа |
| POST | `/webhooks/payment/{gateway}` | **без auth** (verify внутри адаптера) | raw body | `{ok}` | Приём webhook шлюза |
| GET | `/clinics/{clinic_id}/payments` | manager + модуль | query status/from/to/limit | список платежей | Платежи клиники |
| GET | `/clinics/{clinic_id}/payment-config` | manager (без модуля) | — | `{configs, available_gateways}` | Чтение конфига шлюза |
| PUT | `/clinics/{clinic_id}/payment-config` | manager + модуль + region_lock | `PaymentConfigBody` | сериализованный конфиг | Upsert конфига шлюза |

- **Зависимости:** `app.services.acquiring.get_gateway/list_registered`, `app.services.acquiring_service.init_clinic_payment/refund_clinic_payment/update_clinic_payment_status`, `app.services.billing_service.record_payment` (для подписок платформы), `app.services.encryption_service.encrypt` (секретный ключ шлюза). Модели `ClinicPayment`/`ClinicPaymentStatus`/`PaymentGateway`/`PaymentGatewayConfig`, `Invoice`. Гейты: `require_module`, `enforce_region_lock`, `require_manager`, `get_current_tenant`.
- **Где менять для типовых задач:** новый платёжный шлюз — регистрация адаптера в `app.services.acquiring` (здесь только `list_gateways()`/`get_gateway()`); логика init/refund — `acquiring_service`; разбор webhook — `payment_webhook` (маршрут поиска платежа: metadata.internal_payment_id → metadata.invoice_id → gateway_payment_id, line 252-268); шифрование ключа — `encryption_service`.
- **Подводные камни:** webhook **всегда возвращает 200** даже если платёж не найден (чтобы шлюз не ретраил) — только логирует warning; подлинность проверяет адаптер (`verify_webhook`, для ЮKassa — IP allowlist). Ветка Invoice→`record_payment` обёрнута в широкий `except` и **отдельно коммитит** (line 309). `amount` — `Decimal` (правильно), но `_serialize_payment` отдаёт `float(p.amount)`. `secret_key=None` в `PaymentConfigBody` означает «не менять». `is_active == True` в webhook-запросе — namespace-сравнение SQLAlchemy (есть `# noqa: E712`). Заглушки шлюзов кидают `NotImplementedError` → 501.
- **Строк:** 433

## `backend/app/routers/clinics.py`

- **Назначение:** Справочник клиник для форм направлений: список клиник (с учётом франшизы), услуги клиники, чтение/замена расписания работы.
- **Ключевые элементы:** `router` (prefix `/clinics`); хелпер **`_franchise_tenant_ids`** (все tenant_id той же франшизы); `ScheduleDayInput`; эндпоинты list_clinics, get_clinic_services, get/update schedule.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/clinics/` | любой авторизованный | — | список клиник (своя франшиза) | Клиники для направлений |
| GET | `/clinics/{clinic_id}/services` | авторизованный (своя франшиза) | — | список услуг | Услуги для формы направления |
| GET | `/clinics/{clinic_id}/schedule` | авторизованный (своя франшиза) | — | расписание 7 дней | Расписание клиники |
| PUT | `/clinics/{clinic_id}/schedule` | `require_reports_access` (менеджер) + region_lock | `list[ScheduleDayInput]` | `{status:ok}` | Полная замена расписания |

- **Зависимости:** модели `Clinic`, `ClinicSchedule`, `Service`, `Tenant`; `app.schemas.clinic.ClinicResponse` (импортирован, но фактически ответы строятся вручную dict); гейты `get_current_user`, `require_reports_access`, `enforce_region_lock`.
- **Где менять для типовых задач:** видимость клиник между тенантами франшизы — `_franchise_tenant_ids` (line 20); фильтр услуг для направлений — `is_active && visible_for_referrals` (line 95-96); финансовые поля услуги в ответе (`referral_payout`, `bonus_amount`) — line 100-112; дефолтные часы расписания — line 142-149.
- **Подводные камни:** **cross-tenant by design** — список и услуги намеренно показывают клиники всей франшизы (через `franchise_id`), а не только свой tenant; PUT расписания, наоборот, строго свой `tenant_id` (line 171). Цены отдаются как `float(s.price)` (исходно Decimal). Дни недели 0..6 = Пн..Вс.
- **Строк:** 187

## `backend/app/routers/cms.py`

- **Назначение:** CMS тенанта: публичная тема (JSON/CSS), меню, страницы (список/чтение/CRUD). Создание/редактирование/удаление страниц гейтуется модулем `white_label`.
- **Ключевые элементы:** `router` (prefix `/cms`); `PageCreate`, `PageUpdate`; хелпер `_resolve_tenant_optional` (тенант из `?slug=` для public-эндпоинтов); эндпоинты theme/theme.css/menu/pages CRUD.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/cms/theme` | public (slug) | query slug | тема (dict) | Тема тенанта |
| GET | `/cms/theme/css` | public (slug) | query slug | CSS (text/css) | Тема как CSS-переменные |
| GET | `/cms/menu` | tenant из контекста | — | список пунктов меню | Меню сайта |
| GET | `/cms/pages` | авторизованный | query all | список страниц | Страницы (published или все для staff) |
| GET | `/cms/pages/{slug}` | tenant | — | страница | Одна страница |
| POST | `/cms/pages` | reg/super_admin/manager + модуль white_label | `PageCreate` | страница | Создать страницу |
| PUT | `/cms/pages/{slug}` | reg/super_admin/manager + модуль | `PageUpdate` | страница | Обновить |
| DELETE | `/cms/pages/{slug}` | reg/super_admin/manager + модуль | — | `{ok}` | Удалить |

- **Зависимости:** `app.services.cms_service.CmsService` (get_menu/list_pages/get_page/create/update/delete), `app.services.theme_service.ThemeService` (get_theme/to_css_variables). Тенант: `get_current_tenant` (для приватных) либо `_resolve_tenant_optional` (для публичных по slug).
- **Где менять для типовых задач:** поля страницы — `PageCreate`/`PageUpdate` + сервис; роли редактирования — проверка `current_user.role not in ("reg","super_admin","manager")` (повторяется в 3 эндпоинтах); видимость черновиков — `published_only` (line 93); генерация CSS — `ThemeService.to_css_variables`.
- **Подводные камни:** проверка роли сравнивает `current_user.role` со строками напрямую — если role это enum, нужно `.value` (здесь работает только если role сериализуется как строка). `list_pages` показывает все страницы только если `all=True` **И** роль входит в staff-набор. Гейт `white_label` стоит на mutating-эндпоинтах через `dependencies=`, а доп. проверка роли — внутри тела (двойной барьер).
- **Строк:** 159

## `backend/app/routers/commercial.py`

- **Назначение:** Super-admin управление коммерцией платформы: каталог модулей с ценами и marketplace-полями, интеграции тенантов (МИС/ЛИС/Барс) с тест-соединением, подписки тенантов на модули (enable/disable/config/цена) с записью в billing_ledger.
- **Ключевые элементы:** `router` (prefix `/admin`); `_sa = Depends(require_super_admin)` на каждом эндпоинте; схемы Module/Integration/Subscription; хелперы `_calc_expires`, `_get_module/_get_sub/_get_integration`, `_do_test` (httpx-пинг), сериализаторы `_mod_out/_sub_out/_int_out`.
- **Эндпоинты:** (все `dependencies=[_sa]`, роль super_admin)

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/admin/modules` | — | список модулей | Каталог модулей |
| PUT | `/admin/modules/{key}/price` | `ModulePriceUpdate` | модуль | Изменить цену |
| PATCH | `/admin/modules/{key}` | `ModuleUpdate` | модуль | Имя/описание/активность |
| PATCH | `/admin/modules/{key}/marketplace` | `ModuleMarketplaceUpdate` | модуль | Marketplace-поля витрины |
| GET | `/admin/tenants/{tid}/integrations` | — | список интеграций | Интеграции тенанта |
| POST | `/admin/tenants/{tid}/integrations` | `IntegrationCreate` | интеграция (201) | Добавить интеграцию |
| PUT | `/admin/tenants/{tid}/integrations/{int_id}` | `IntegrationUpdate` | интеграция | Обновить |
| DELETE | `/admin/tenants/{tid}/integrations/{int_id}` | — | 204 | Удалить |
| POST | `/admin/tenants/{tid}/integrations/{int_id}/test` | — | `{status, error, tested_at}` | Тест соединения (httpx GET) |
| GET | `/admin/tenants/{tid}/modules` | — | модули + статус подписки | Модули тенанта |
| POST | `/admin/tenants/{tid}/modules/{key}/enable` | `EnableModuleRequest` | подписка | Включить (trial/active) + ledger |
| POST | `/admin/tenants/{tid}/modules/{key}/disable` | — | `{ok, status}` | Отключить (cancelled) |
| PUT | `/admin/tenants/{tid}/modules/{key}/config` | `ModuleConfigUpdate` | подписка | Изменить config |
| PUT | `/admin/tenants/{tid}/modules/{key}/price` | `ModulePriceNegotiate` | подписка | Переговорная цена |

- **Зависимости:** модели `CommercialModule`, `TenantModuleSubscription`, `TenantIntegration`, `ModuleStatus`; `app.services.billing_service.record_billing_ledger / _apply_revenue_split`; `EntryType`/`Direction` из `billing_ledger`; `httpx` (тест интеграции). `_do_test` импортируется в `main.py` (line 632 — фоновая проверка).
- **Где менять для типовых задач:** новый billing-цикл — `_calc_expires` (line 387) + pattern в `EnableModuleRequest`; запись в леджер при активации — `enable_module` (line 297-330, trial → CREDIT 0, платный → DEBIT + revenue split); marketplace-поля — `ModuleMarketplaceUpdate` + `_mod_out`; логика теста интеграции — `_do_test` (httpx, verify=False, timeout 8с).
- **Подводные камни:** цены преобразуются `Decimal(str(float))` корректно, но `_mod_out/_sub_out` отдают `float(...)`. `_do_test` ходит с `verify=False` (игнор TLS) — осознанно для self-signed МИС. **`api_key` хранится в открытом виде** в `TenantIntegration` (в ответе маскируется `api_key_hint`, но в БД — plaintext, в отличие от платёжных ключей в `clinic_payments`, которые шифруются). `enable_module` при trial не пишет charge, expires_at=None при trial.
- **Строк:** 493

## `backend/app/routers/consent.py`

- **Назначение:** 152-ФЗ: принятие/отзыв согласия на обработку ПД, статус и история, право на забвение (анонимизация), список пользователей без согласия для менеджера.
- **Ключевые элементы:** `router` (prefix `/consent`); `POLICY_VERSION="1.0"`; `_get_ip` (X-Real-IP / X-Forwarded-For / client.host); `ConsentAcceptRequest`, `ConsentStatusResponse`; эндпоинты accept/withdraw/status/forget/users.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/consent/accept` | авторизованный | `ConsentAcceptRequest` | `{ok, message}` | Принять согласие |
| POST | `/consent/withdraw` | авторизованный | — | `{ok, message}` | Отозвать согласие |
| GET | `/consent/status` | авторизованный | — | `ConsentStatusResponse` | Статус + история событий |
| DELETE | `/consent/forget` | авторизованный | — | `{ok, message}` | Анонимизация ПД (право на забвение) |
| GET | `/consent/users` | `require_manager` | — | `{count, users}` | Пользователи без согласия |

- **Зависимости:** модели `ConsentRecord`, `User`; гейты `get_current_user`, `require_manager`. Каждое действие пишет `ConsentRecord` (event: given/withdrawn/forgotten) + обновляет флаги на `User`.
- **Где менять для типовых задач:** версия политики — `POLICY_VERSION` (line 24); что именно анонимизируется в `forget` — `update(User).values(...)` (line 137-146: full_name → `Anonymized_{hash}`, обнуляются phone/telegram/date_of_birth, is_active=False); определение IP — `_get_ip`.
- **Подводные камни:** `forget` оставляет пароль и токены «для аудита», но деактивирует аккаунт; хэш ФИО детерминирован от `user.id`. `consent_version` читается через `getattr(user, "consent_version", None)` (поле может отсутствовать). История в `/status` отдаётся полностью без пагинации.
- **Строк:** 188

## `backend/app/routers/contact.py`

- **Назначение:** Публичная контакт-форма с сайта (с rate-limit и honeypot) + админ-просмотр обращений (super_admin). Дублирует обращение в Telegram владельцу/админу.
- **Ключевые элементы:** `router` (prefix `/contact`); `_contact_rl` (rate_limit 5/600с/IP); `ContactForm` (с honeypot-полем `website_url`); эндпоинты send + admin list/unread-count/read/delete.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/contact/` | public + rate-limit | `ContactForm` | `{ok}` | Принять обращение, уведомить TG |
| GET | `/contact/admin/list` | super_admin | query unread_only/limit/offset | `{total, items}` | Список обращений |
| GET | `/contact/admin/unread-count` | super_admin | — | `{count}` | Кол-во непрочитанных |
| PATCH | `/contact/admin/{contact_id}/read` | super_admin | — | `{ok}` | Отметить прочитанным |
| DELETE | `/contact/admin/{contact_id}` | super_admin | — | `{ok}` | Удалить обращение |

- **Зависимости:** модель `ContactRequest`; `app.utils.rate_limit.rate_limit_dep/check_honeypot`; `app.services.alert_service.notify_admin/send_to_owner`; `app.utils.phone.mask_phone`. Telegram-уведомления через `BackgroundTasks`.
- **Где менять для типовых задач:** лимит формы — `rate_limit_dep('contact', limit=5, window=600)` (line 23); поля формы — `ContactForm`; текст Telegram-уведомления — line 59-65; маршрут уведомлений (owner-бот vs notify_admin) — line 68-70.
- **Подводные камни:** honeypot `website_url` (TODO: заменить на hCaptcha/Turnstile). Telegram-вызовы вынесены в `BackgroundTasks` (не блокируют ответ). `ContactRequest` — глобальная таблица **без tenant_id** (учитывается в `director.kpi_funnel`, где leads помечаются `all_platform`). HTML-escape сообщений перед отправкой в TG.
- **Строк:** 133

## `backend/app/routers/director.py`

- **Назначение:** Кабинет Директора — **read-only** финансово-операционная отчётность сети франшизы: дашборд, P&L (общий/по клиникам/услугам/врачам), ДДС, KPI, воронка, маркетинг (источники, ROI), список клиник с метриками.
- **Ключевые элементы:** `router` (prefix `/director`); RBAC-хелпер **`_get_franchise_id`** (super_admin→None, director→user.franchise_id, franchise_owner→через Franchise) и **`_get_tenant_ids`**; финансовые хелперы `_revenue_sum`, `_appointments_count`, `_materials_expenses`, `_ads_expenses`, `_expenses_total`, `_top_services`, `_top_doctors`, `_default_period`, `_prev_period_bounds`. Эти хелперы **переиспользуются в `director_export.py`**.
- **Эндпоинты:** (все GET, гейт `require_director_or_owner`)

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/director/me` | — | user + franchise + summary | Профиль директора |
| GET | `/director/dashboard` | — | revenue/expenses/profit/cashflow/sparkline/top | Виджеты главной (30 дней) |
| GET | `/director/pnl` | from/to/granularity(day\|month) | series + totals | P&L по периодам |
| GET | `/director/pnl/by-clinic` | from/to | clinics[] | Выручка/прибыль по клиникам |
| GET | `/director/pnl/by-service` | from/to | services[] (топ-20) | Топ услуг |
| GET | `/director/pnl/by-doctor` | from/to | doctors[] (топ-20) | Топ врачей |
| GET | `/director/cashflow` | from/to | series + totals (in/out/net) | ДДС по дням |
| GET | `/director/kpi` | from/to | avg_check/repeat/ltv | KPI сети |
| GET | `/director/kpi/funnel` | from/to | stages[] | Воронка лиды→оплаты |
| GET | `/director/marketing/sources` | from/to | sources[] (donut) | Источники пациентов |
| GET | `/director/marketing/roi` | from/to | channels[] + totals | ROI рекламы (CPL/CAC) |
| GET | `/director/clinics` | from/to | clinics[] | Клиники с метриками |

- **Зависимости:** модели `ClinicPayment`/`ClinicPaymentStatus` (источник выручки), `Appointment`/`AppointmentStatus`/`Doctor`, `InventoryMovement`/`InventoryBatch`/`InventoryItem` (материалы-расходы), `AdSpendEntry` (реклама), `Clinic`, `Tenant`, `Franchise`, `Service`, `Referral`, `ContactRequest`. Маркетинг (`sources`/`roi`) использует **сырой SQL** (`text(...)`) с CTE по `patient_attribution`/`marketing_channels`/`clinic_payments`.
- **Где менять для типовых задач:** источник выручки — везде через `_revenue_sum` (только `ClinicPayment.status==SUCCEEDED`); состав расходов — `_materials_expenses` (write_off+outgoing × batch.unit_cost, fallback item.cost_per_unit) и `_ads_expenses` (line 185-275); период по умолчанию — `_default_period` (30 дней); связь услуга↔платёж (для топа) — JOIN payments→appointments→referrals→services в `_top_services` (line 718-739, в `try/except` с fallback на пустой список); SQL источников/ROI — `marketing_sources`/`marketing_roi`.
- **Подводные камни:** **write-операции запрещены глобальным middleware `director_readonly_guard` в main.py** — не добавляйте сюда POST/PUT без снятия гейта. Все деньги считаются в `Decimal`, но в ответ уходят `float(...)`. `_top_services`/`_top_doctors` обёрнуты в `try/except SQLAlchemyError` → при ошибке схемы молча возвращают `[]`. Сырые SQL в маркетинге **Postgres-специфичны** (`= ANY(:tids)`, `::date`, `date_trunc`, `FILTER`) — на SQLite-тестах не пройдут. `kpi_funnel.leads` берёт `ContactRequest` без tenant_id → помечен `all_platform` (шум для франшизы). `clinics_list` делает N+1 запросов на клинику (по 4 запроса каждой). LTV считается по всей истории, не за период.
- **Строк:** 1507

## `backend/app/routers/director_export.py`

- **Назначение:** Экспорт отчётов кабинета директора в Excel (openpyxl) и PDF (WeasyPrint, HTML→PDF): P&L, ДДС, сравнение клиник, сводный дашборд.
- **Ключевые элементы:** `router` (prefix `/director/export`); форматтеры `_fmt_rub/_fmt_int/_fmt_pct/_fmt_date_ru`; обёртки `_xlsx_response/_pdf_response/_xlsx_apply_header/_xlsx_set_widths`; PDF — `_PDF_CSS`, `_pdf_html`, `_render_pdf` (ленивый импорт weasyprint); сборщики данных `_collect_pnl_series` (day/week/month/quarter), `_collect_clinics_breakdown`, `_collect_cashflow_series`.
- **Эндпоинты:** (все GET, гейт `require_director_or_owner`)

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/director/export/pnl.xlsx` | from/to/granularity(day\|week\|month\|quarter) | XLSX | P&L в Excel |
| GET | `/director/export/pnl.pdf` | from/to/granularity | PDF | P&L в PDF |
| GET | `/director/export/cashflow.xlsx` | from/to | XLSX | ДДС в Excel |
| GET | `/director/export/cashflow.pdf` | from/to | PDF | ДДС в PDF |
| GET | `/director/export/clinics.xlsx` | from/to | XLSX | Сравнение клиник Excel |
| GET | `/director/export/clinics.pdf` | from/to | PDF | Сравнение клиник PDF |
| GET | `/director/export/dashboard.pdf` | from/to | PDF | Сводный отчёт (KPI+топы) |

- **Зависимости:** **импортирует из `director.py`** `_appointments_count`, `_default_period`, `_get_franchise_id`, `_get_tenant_ids`, `_revenue_sum`, `_top_doctors`, `_top_services` (line 35-43). `openpyxl` (Workbook/styles, ленивый импорт), `weasyprint.HTML` (ленивый). Внутри сборщиков повторно импортируются модели `Clinic`/`ClinicPayment`.
- **Где менять для типовых задач:** добавить гранулярность экспорта — `_collect_pnl_series` (line 189, week/quarter здесь есть, а в `director.pnl` только day/month — рассинхрон); стиль PDF — `_PDF_CSS` (line 136); шапка XLSX (цвет 0097A7) — `_xlsx_apply_header`; новый отчёт — добавить `_collect_*` + пару эндпоинтов xlsx/pdf.
- **Подводные камни:** **расходы в экспорте захардкожены в 0.0** (`expenses=0.0`, profit=revenue) — `_collect_*` НЕ используют `_materials_expenses/_ads_expenses` из `director.py`, в отличие от живого дашборда (там расходы реальные). Это рассинхрон: цифры P&L в UI и в выгрузке будут разными. PDF требует WeasyPrint + шрифт DejaVu (для кириллицы) в Docker-образе. `_render_pdf` импортирует weasyprint лениво — на машинах без него эндпоинт упадёт только при вызове. `_collect_clinics_breakdown` дублирует логику `director.pnl_by_clinic`, но без расходов.
- **Строк:** 893

## `backend/app/routers/doctor_ai.py`

- **Назначение:** «Врач AI» (Глава 6): pre-visit briefing с AI-рекомендациями (кеш Redis 1ч) и CRUD планов лечения (генерация AI → draft → approve/archive → копирование в медкарту).
- **Ключевые элементы:** `router` (prefix `/doctor`); ACL `_ALLOWED=(doctor, partner_doctor, visiting_doctor, super_admin)`, `_dep_doctor`. Redis-хелперы `_get_redis/_cache_get/_cache_set/_cache_delete`, ключ `_briefing_cache_key`, TTL 3600с. Утилиты `_norm_phone` (→7XXX), `_age_from_birth`, `_log_ai_call` (пишет `AIDoctorLog`), `_get_appt_or_404`, `_get_plan_or_404`, `_plan_to_dict`. Pydantic `GeneratePlanBody`, `UpdatePlanBody`.
- **Эндпоинты:** (все `dependencies=[_dep_doctor]`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/doctor/appointments/{appointment_id}/briefing` | doctor-роли | query refresh | briefing (patient/history/allergies/vitals/ai) | Pre-visit briefing + кеш |
| POST | `/doctor/appointments/{appointment_id}/generate-plan` | doctor-роли | `GeneratePlanBody` | план (201) | AI-генерация плана (draft) |
| GET | `/doctor/treatment-plans` | doctor-роли | query status/appointment_id/limit | список планов | Планы текущего врача |
| GET | `/doctor/treatment-plans/{plan_id}` | doctor-роли | — | план | Получить план |
| PATCH | `/doctor/treatment-plans/{plan_id}` | doctor-роли | `UpdatePlanBody` | план | Правка payload/смена статуса |
| POST | `/doctor/treatment-plans/{plan_id}/copy-to-medcard` | doctor-роли | — | `{ok, appointment_id}` | Копировать план в AppointmentOutcome |

- **Зависимости:** `app.services.doctor_ai_service.generate_briefing_recommendations/generate_treatment_plan`. Модели `Appointment`/`Doctor`, `PatientDiagnosis`/`PatientAllergy` (medcard), `PatientVital`, `AppointmentOutcome`, `TreatmentPlan`/`TreatmentPlanStatus`/`AIDoctorLog`. Redis: `redis.asyncio` + `settings.redis_url` (опционально).
- **Где менять для типовых задач:** логика/провайдер AI — `doctor_ai_service` (здесь только вызов и логирование токенов в `AIDoctorLog`); состав briefing-контекста — `get_appointment_briefing` (history/allergies/vitals_last/complaints, line 224-339); TTL кеша — `_BRIEFING_TTL`; сериализация плана в текст медкарты — `copy_plan_to_medcard` (line 551-583); статусы плана — `TreatmentPlanStatus`.
- **Подводные камни:** связь пациента — **по телефону** (`_norm_phone`, нет patient_id FK); все запросы фильтруются по `patient_phone` + опционально `tenant_id`. Redis полностью опционален — при недоступности кеш молча no-op (briefing пересчитывается каждый раз). Все cache-операции и `_log_ai_call` глушат исключения. `copy-to-medcard` **аппендит** план к существующим `recommendations` (не перезаписывает). `_get_plan_or_404` проверяет и tenant, и `doctor_id==user.id` (кроме super_admin) — врач видит только свои планы. Возраст пациента тянется через `User.phone_number`, gender всегда None (заглушка).
- **Строк:** 608
