# routers [09] — Кабинет пациента, семья, чаты, документы, engagement-CRM и франшизные партнёры

Этот срез — преимущественно **«пациент-центричная» половина API** clinika (МИС на FastAPI + React). Здесь живут публичные эндпоинты личного кабинета пациента (вход по QR/коду, сессии, направления, записи к врачу, отмена/перенос), асинхронные и AI-чаты пациента с клиникой, хранилище медицинских документов (две версии), семейный доступ (две модели — legacy и Глава 8), а также 152-ФЗ права субъекта ПД (экспорт/удаление данных). Сюда же примыкают **staff/менеджерские** инструменты engagement-CRM (карточки пациентов, теги/заметки, сегменты, push-шаблоны и кампании, аналитика удержания) и два «франшизных» роутера (партнёрские клиники и партнёрский прайс). Завершает группу webhook owner-бота Telegram.

Объединяющие черты:
- **Два мира аутентификации.** Публичные пациентские эндпоинты НЕ используют JWT-пользователя — они защищены `patient_session_token` (через `patient_session_service.restore_session`) либо одноразовыми `patient_token` / `appointment_token` (через `app.core.security`). Staff-эндпоинты используют обычные `get_current_user` / `require_manager` / `require_role` / `require_director_or_owner` / `require_franchise_owner`.
- **Идентификация пациента по нормализованному телефону**, а не по FK. `normalize_phone` из `app.utils.phone` применяется почти везде — это и есть «ключ» пациента. Это главный источник тонких багов (см. подводные камни).
- **Tenant-изоляция местами есть, местами нет.** Engagement-CRM строго фильтрует по `current_user.tenant_id`; пациентские эндпоинты фильтруют по `session.tenant_id` только «если задан» (`if session.tenant_id:`), поэтому сессия без тенанта видит данные по всем тенантам с этим телефоном.
- **Прямой возврат `dict`/`StreamingResponse`** вместо Pydantic response_model в большинстве пациентских роутеров (ручная сериализация с `.isoformat()` и `str(uuid)`).

Базовый URL без глобального `/api`-префикса (в `main.py` нет `prefix="/api"`); пути ниже — это реальные FastAPI-маршруты. Префикс `/api` в docstring owner-бота — это путь reverse-proxy, не FastAPI.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `owner_bot_webhook.py` | Telegram-webhook owner-бота → staff-chat reply | 277 |
| `partner_clinics.py` | Франшиза: контракты партнёрских клиник, выплаты | 344 |
| `partner_offers.py` | CRUD партнёрского прайса и категорий | 380 |
| `password_reset.py` | Self-service сброс пароля по email | 277 |
| `patient.py` | Публичный кабинет пациента: вход, направления, 152-ФЗ | 1502 |
| `patient_calendar.py` | Календарь пациента + iCal-feed | 182 |
| `patient_chat.py` | Чат пациента: AI-ассистент + регистратура | 480 |
| `patient_chat_slots.py` | Запрос/бронирование слотов в чат-треде | 168 |
| `patient_chat_threads.py` | Асинхронные треды пациент↔клиника | 291 |
| `patient_documents.py` | Документы пациента: staff-загрузка + скачивание | 256 |
| `patient_documents_v2.py` | Пациент-центричное хранилище health-documents | 168 |
| `patient_engagement_analytics.py` | Дашборд удержания, воронка, churn | 80 |
| `patient_engagement_crm.py` | CRM-карточка: теги, заметки, suggestions | 650 |
| `patient_engagement_segments.py` | Сегменты, push-шаблоны, A/B-кампании | 932 |
| `patient_family.py` | Семейный кабинет (Глава 8) + legacy | 522 |

---

## `backend/app/routers/owner_bot_webhook.py`

- **Назначение:** Принимает входящие Telegram-update'ы от owner-бота (`@stclinika_bot`) и превращает Reply владельца на уведомление в сообщение `/staff-chat` (текст и/или скачанный файл). Двусторонний мост Telegram ↔ внутренний staff-chat.
- **Ключевые элементы:** `router` (prefix `/owner-bot`); `_download_telegram_file()` — getFile → скачивание байтов через HTTP-прокси → сохранение в `/opt/clinika/data/staff_chat_files/<date>/`; `telegram_webhook()` — основной обработчик; константы `ROOM_MARKER_RE` (regex `room:<uuid>`), `STORAGE_ROOT`, `FILE_TTL_HOURS=48`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/owner-bot/webhook` | Telegram (опц. secret-token в `X-Telegram-Bot-Api-Secret-Token`) + только от `OWNER_TELEGRAM_ID` | raw Telegram update JSON | `{ok, message_id?, attachments_received?}` / skip-объект | Reply владельца в TG → сообщение в staff-chat комнату |

- **Зависимости:** `app.database.AsyncSessionLocal` (своя сессия, не через Depends); `app.models.user.User/UserRole`; `app.models.staff_chat.StaffChatFile`; сервис `staff_chat_service` (`is_member`, `get_room`, `send_message`, `serialize_message`); `app.config.settings` (`owner_bot_token`, `owner_telegram_id`, `owner_bot_webhook_secret`); `httpx`; WS-бродкаст через `app.routers.staff_chat.ws_hub`.
- **Где менять для типовых задач:** новые типы вложений (стикеры, видеозаметки) — блок `if msg.get("document") / elif ...` (строки 158-193); адрес/креды прокси — env `TELEGRAM_PROXY_URL` (строки 65-68, есть хардкод-fallback с логином/паролем!); TTL файлов — `FILE_TTL_HOURS`; формат маркера комнаты — `ROOM_MARKER_RE`.
- **Подводные камни:** в коде **захардкожены логин/пароль прокси** (`clinikabot:lT9k2Pq8mNxF5jB3@144.31.89.167:8080`) — секрет в репозитории. Скачивание файлов вынесено ЗА пределы первой БД-сессии (строки 217-223) и затем открывается **вторая** сессия — между ними `room`/`sender` уже detached, поэтому `send_message` получает заново загруженный `room`. Если отправитель не найден в БД по `telegram_id`, fallback — первый `SUPER_ADMIN` (строки 202-208), то есть атрибуция может «съехать». tenant_id вообще не проверяется — изоляция держится только на членстве в комнате (`is_member`).
- **Строк:** 277

## `backend/app/routers/partner_clinics.py`

- **Назначение:** Кабинет владельца франшизы (Этап 14): просмотр клиник-партнёров своей франшизы, редактирование их контрактов (royalty / per_referral / hybrid), предпросмотр выплат и смена статуса партнёрства (pause/resume/terminate).
- **Ключевые элементы:** `router` (prefix `/franchise-owner/partner-clinics`); Pydantic `ContractPatch`, `PartnerClinicOut`; типы `ContractType`/`RevenueSource`/`PartnerStatus`; хелперы `_get_my_franchise`, `_get_partner_clinic` (проверка принадлежности клиники франшизе), `_confirmed_referrals_count`, `_confirmed_revenue_sum`, `_set_status`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/franchise-owner/partner-clinics` (и `/`) | `require_franchise_owner` | — | `list[PartnerClinicOut]` | Список клиник-партнёров франшизы |
| PATCH | `/franchise-owner/partner-clinics/{clinic_id}/contract` | `require_franchise_owner` | `ContractPatch` | dict контракта | Изменить поля контракта |
| POST | `/franchise-owner/partner-clinics/{clinic_id}/calculate` | `require_franchise_owner` | `?period_days` | dict-предпросмотр выплаты | Оценка выплаты за период (без реального биллинга) |
| POST | `/franchise-owner/partner-clinics/{clinic_id}/pause` | `require_franchise_owner` | — | `{id, partner_status}` | Пауза партнёрства |
| POST | `/franchise-owner/partner-clinics/{clinic_id}/resume` | `require_franchise_owner` | — | `{id, partner_status}` | Возобновить |
| POST | `/franchise-owner/partner-clinics/{clinic_id}/terminate` | `require_franchise_owner` | — | `{id, partner_status}` | Расторгнуть контракт |

- **Зависимости:** `app.core.deps.require_franchise_owner`; модели `Franchise`, `Tenant`, `Clinic`, `Referral`/`ReferralStatus`, `Service`. Поля контракта (`contract_type`, `royalty_percent`, `bonus_per_referral`, `partner_status`, `revenue_source`, `contract_signed_at/expires_at`) живут прямо на модели `Clinic`.
- **Где менять для типовых задач:** новый тип контракта — `ContractType` + логика в `calculate_payout` (строки 278-284); формула выплаты — там же; новые статусы партнёрства — `PartnerStatus` + `_set_status`; реальный cron-биллинг сейчас отсутствует (явно отмечено в docstring, «Шаг 3»).
- **Подводные камни:** `royalty_percent`/`bonus_per_referral` хранятся как **Decimal** в БД, при записи оборачиваются `Decimal(str(...))` (строки 221-227), а наружу отдаются как `float(...)` — следите за этим контрактом при правках. Колонка `contract_signed_at` — `TIMESTAMP WITHOUT TIME ZONE`, поэтому есть явная функция `_naive()` для снятия tz (asyncpg иначе падает). В `calculate_payout` выручка считается по `Service.original_price` через JOIN, расчёт — на `float`, что нормально для предпросмотра, но не годится для финансовых начислений.
- **Строк:** 344

## `backend/app/routers/partner_offers.py`

- **Назначение:** CRUD партнёрского прайса внутри франшизы: категории (`PartnerCategory`) и офферы-услуги (`PartnerServiceOffer`) своей клиники, плюс read-only просмотр активных офферов другой клиники того же тенанта (picker при создании направления).
- **Ключевые элементы:** `router` (prefix `""` — пути полные); `MANAGER_ROLES` (MANAGER/FRANCHISE_OWNER/SUPER_ADMIN); хелперы `_require_manager`, `_user_clinic_id`, `_serialize_offer` (денормализация полей `Service` в ответ).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/clinics/me/partner-categories` | manager-роли | — | `list[PartnerCategoryResponse]` | Список своих категорий |
| POST | `/clinics/me/partner-categories` | manager-роли | `PartnerCategoryCreate` | категория (201) | Создать категорию |
| PATCH | `/clinics/me/partner-categories/{cat_id}` | manager-роли | `PartnerCategoryUpdate` | категория | Изменить категорию |
| DELETE | `/clinics/me/partner-categories/{cat_id}` | manager-роли | — | 204 | Удалить категорию |
| GET | `/clinics/me/partner-offers` | manager-роли | `?include_inactive` | `list[PartnerOfferResponse]` | Свои офферы |
| POST | `/clinics/me/partner-offers` | manager-роли | `PartnerOfferBulkCreate` | `list[...]` (201) | Bulk-создание офферов |
| PATCH | `/clinics/me/partner-offers/{offer_id}` | manager-роли | `PartnerOfferUpdate` | оффер | Изменить оффер |
| DELETE | `/clinics/me/partner-offers/{offer_id}` | manager-роли | — | 204 | Удалить (soft если есть Referral) |
| GET | `/clinics/{clinic_id}/partner-offers` | любой staff того же tenant | — | `list[PartnerOfferResponse]` | Активные офферы чужой клиники (picker) |

- **Зависимости:** `app.core.deps.get_current_user`; модели `Clinic`, `PartnerCategory`/`PartnerServiceOffer`, `Referral`, `Service`, `User/UserRole`; схемы из `app.schemas.partner_offer`. Использует `selectinload(...category)`.
- **Где менять для типовых задач:** набор привилегированных ролей — `MANAGER_ROLES`; денормализация (какие поля услуги уходят на фронт) — `_serialize_offer`; политика удаления (soft vs hard) — `delete_my_offer` (строки 331-342, soft-delete если есть ссылки из `Referral.partner_offer_id`).
- **Подводные камни:** изоляция здесь по **`clinic_id`** (не tenant) для своих офферов и по совпадению `tenant_id` для чужих (строка 359). `service` и `category` присваиваются объектам **вручную** как «приклеенные» атрибуты (`o.service = ...  # type: ignore`) — это не ORM-relationship, поэтому `_serialize_offer` рассчитывает на `getattr(offer, "service", None)`. Bulk-create молча пропускает уже существующие офферы (`valid_ids - skip_ids`) — дублей не будет, но и явной ошибки тоже.
- **Строк:** 380

## `backend/app/routers/password_reset.py`

- **Назначение:** Self-service сброс пароля сотрудника по email: запрос ссылки (без раскрытия существования email) и смена пароля по одноразовому токену с TTL 1 час. Плюс APScheduler-job очистки истёкших токенов.
- **Ключевые элементы:** `router` (prefix `/auth`); `_RESET_TTL` (1 час); rate-limit фабрики `_forgot_limiter` (3/min), `_reset_limiter` (5/min); `_get_ip`, `_hash_token` (SHA-256); Pydantic `ForgotPasswordRequest`/`Response`, `ResetPasswordRequest` (строгий валидатор пароля ≥8, буква И цифра); `cleanup_expired_password_reset_tokens()` — экспортируется в `main.py`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/auth/forgot-password` | публичный, rate-limit 3/min/IP | `ForgotPasswordRequest` (email, tenant_slug?) | `ForgotPasswordResponse` (всегда 200) | Запросить ссылку сброса |
| POST | `/auth/reset-password` | публичный, rate-limit 5/min/IP | `ResetPasswordRequest` (token, new_password) | `{ok: True}` | Сменить пароль по токену |

- **Зависимости:** `app.core.security.hash_password`; модели `PasswordResetToken`, `RefreshToken`, `Tenant`, `User`; сервисы `audit_service.write`, `email_service.send_password_reset`; опционально `fastapi_limiter`. Job регистрируется в `main.py` (id `password_reset_cleanup`, interval 1h).
- **Где менять для типовых задач:** требования к паролю — валидатор `_check` (строки 90-104, тут строже общего `validate_password_strength`); TTL токена — `_RESET_TTL`; rate-limits — `_forgot_limiter`/`_reset_limiter`; базовый URL письма — хардкод `https://клиниксеть.рф` (строка 162).
- **Подводные камни:** анти-enumeration: `/forgot-password` всегда возвращает 200 и НИЧЕГО не пишет в БД, если юзер не найден (строки 144-147). При нескольких юзерах с одним email выбирается по `tenant_slug` либо первый активный — учитывайте при мультитенантности. Сброс пароля инвалидирует ВСЕ refresh-токены (logout-all) и снимает `password_must_change`. `audit_service.write` делает только flush — коммит общий в конце; обёрнут в try/except, чтобы сбой аудита не ломал сброс.
- **Строк:** 277

## `backend/app/routers/patient.py`

- **Назначение:** Главный публичный роутер личного кабинета пациента — самый большой файл группы. Вход по QR-токену / по short_code+телефон, long-lived PWA-сессии, просмотр направления со всей сопутствующей историей (включая подтяжку из МИС Renovatio), записи к приезжему врачу (просмотр/отмена/перенос), семейный аккаунт (legacy-модель), а также реализация прав 152-ФЗ (экспорт и удаление ПД).
- **Ключевые элементы:** `router` (prefix `/patient`); rate-limit deps `_view_deps`/`_code_deps`; Pydantic `CodeSearchRequest`, `SessionRestore/Logout/FromTokenRequest`, `CancelBody`, `RescheduleBody`, `FamilyAddBody`, `FamilySwitchBody`; хелперы `_load_mis_data` (история визитов из МИС), `_load_appointments_for_phone`, `_load_referrals_for_phone`, `_pick_active_referral`, `_format_referral`, `_session_or_401`, `_hours_until`, `_serialize_obj` (универсальный JSON-сериализатор для экспорта 152-ФЗ).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/patient/{referral_id:uuid}` | `patient_token`/`appointment_token` (query `t`) | — | dict кабинета (current + история + МИС + appointments) | Открыть направление/запись по токену |
| POST | `/patient/by-code` | публичный, rate-limit | `CodeSearchRequest` (code, phone) | `{referral_id, patient_token, session_token, found}` | Вход по коду+телефону (referral или appointment) |
| POST | `/patient/session/restore` | публичный, rate-limit | `SessionRestoreRequest` | dict кабинета | Авто-логин PWA по session_token |
| POST | `/patient/session/from-token` | публичный, rate-limit | `SessionFromTokenRequest` | `{session_token}` | Из QR-токена создать long-lived сессию |
| POST | `/patient/session/logout` | публичный | `SessionLogoutRequest` | `{ok}` | Отозвать сессию |
| GET | `/patient/appointment/{apt_id}` | `appointment_token` (query `t`) | — | dict записи | Просмотр записи к приезжему врачу |
| POST | `/patient/appointment/by-code` | публичный | `CodeSearchRequest` | `{appointment_id, patient_token, found}` | Найти запись по коду |
| POST | `/patient/appointment/{apt_id}/cancel` | `appointment_token` | `CancelBody?` | `{id, status}` | Отмена записи пациентом (окно 6ч) |
| POST | `/patient/appointment/{apt_id}/reschedule` | `appointment_token` | `RescheduleBody` | dict новой записи | Перенос (атомарно: новая→отмена старой) |
| GET | `/patient/appointments` | `patient_session_token` (query `t`) | `?include_past` | `list[dict]` | Все записи пациента (активные+прошлые) |
| GET | `/patient/family` | `patient_session_token` | — | `list[dict]` | Список членов семьи (legacy-модель) |
| GET | `/patient/family/mis-suggestions` | `patient_session_token` | — | `{suggestions, ...}` | Кандидаты в семью из МИС |
| POST | `/patient/family/add` | `patient_session_token` | `FamilyAddBody` | dict члена | Добавить члена семьи |
| DELETE | `/patient/family/{member_id}` | `patient_session_token` | — | `{ok}` | Удалить члена |
| POST | `/patient/session/switch` | `patient_session_token` | `FamilySwitchBody` (phone, short_code-proof) | `{session_token}` | Переключить контекст на члена семьи |
| GET | `/patient/export-personal-data` | `patient_session_token` | `?format=json\|pdf` | StreamingResponse (JSON/PDF) | 152-ФЗ ст.14 — экспорт всех данных |
| DELETE | `/patient/forget-personal-data` | `patient_session_token` | — | `{ok, anon_id}` | 152-ФЗ ст.21 — анонимизация |

- **Зависимости:** `app.core.security` (`verify_patient_token`, `make_patient_token`, `decode_patient_token`, `make/verify_appointment_token`, `decode_patient_session_token`); `patient_session_service` (`create_session`/`restore_session`/`revoke_session`); `app.utils.phone.normalize_phone`; модели `Referral`, `Appointment/Doctor`, `Clinic`, `Service`, `PatientFamilyMember`, `PatientAccount`, `PatientSession`, `Consent`, `User`, `ai_assistant`, `patient_document`, `patient_chat`, `recruiter_bonus`; сервисы `mis_client`, `settings_service`, `scheduling_service.book_slot`, `qr_service`, `audit_service`; опционально `reportlab` (PDF, lazy import с fallback на JSON).
- **Где менять для типовых задач:** окно отмены/переноса — константа `MIN_CANCEL_HOURS=6`; что показывается в кабинете — `_format_referral` + сборка в `get_patient_referral`/`restore_patient_session`; подтяжка МИС-визитов — `_load_mis_data` (период 730 дней, лимит 50); состав экспорта 152-ФЗ — список запросов в `export_personal_data`; поля анонимизации — `forget_personal_data` (строки 1416-1476).
- **Подводные камни:** **Очень много lazy-импортов внутри функций** (модели/сервисы импортируются по месту) — это легаси-стиль файла, но облегчает циклические зависимости. `get_patient_referral` сначала пытается декодировать токен как `appointment` и при провале «глотает» исключение и идёт дальше как referral (хрупкий control-flow, строки 262-308). В нескольких dict'ах **дублируются ключи** (`patient_phone`/`patient_name` повторяются в строках 301-303 — последний выигрывает, безвредно, но грязно). Tenant-фильтр условный (`if tenant_id:`), поэтому сессия без тенанта видит все направления по телефону. Перенос записи генерирует `short_code` в цикле до 20 попыток — гонка возможна. `_load_*_for_phone` фильтруют по `normalize_phone` уже ПОСЛЕ выборки из БД (в `referrals` точное сравнение `== phone`, в appointments — выбираются все по tenant и фильтруются в Python) — потенциально дорого. PDF-экспорт регистрирует DejaVu-шрифт по жёсткому пути `/usr/share/fonts/...` с fallback на Helvetica (кириллица сломается). Анонимизация НЕ трогает МИС.
- **Строк:** 1502

## `backend/app/routers/patient_calendar.py`

- **Назначение:** Календарь пациента (Глава 9): список ближайших приёмов, выпуск/просмотр/отзыв персональных iCal-токенов и публичный `.ics`-feed для подписки в Google/Apple Calendar.
- **Ключевые элементы:** `router` (без prefix — пути полные `/patient/calendar/*`); хелперы `_get_session` (универсальный извлекатель токена: Bearer / `X-Patient-Session` / query / cookie `clinika_patient_session`) и `_account` (get-or-create `PatientAccount`).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/patient/calendar/upcoming` | patient_session | `?weeks_ahead` (1-24) | `{appointments}` | Ближайшие приёмы |
| POST | `/patient/calendar/issue-token` | patient_session | — | `{id, token, feed_url}` (201) | Выпустить iCal-токен |
| GET | `/patient/calendar/tokens` | patient_session | — | `{tokens: [...]}` | Список iCal-токенов |
| POST | `/patient/calendar/tokens/{token_id}/revoke` | patient_session | — | `{id, revoked_at}` | Отозвать токен |
| GET | `/patient/calendar/feed.ics` | **без auth**, только `?token=` | `?weeks_ahead` | `text/calendar` Response | iCal-feed подписки |

- **Зависимости:** `patient_session_service.restore_session`; `family_service` (`get_account_by_phone`, `get_or_create_account_by_phone`); `calendar_service` (`upcoming_appointments`, `serialize_upcoming`, `issue_token`, `revoke_token`, `get_token_record`, `build_ics`); модели `PatientAccount`, `PatientSession`, `PatientCalendarToken`.
- **Где менять для типовых задач:** формат iCal — `calendar_service.build_ics` (не здесь); диапазон по умолчанию — `weeks_ahead` default 4; способы передачи токена — `_get_session`.
- **Подводные камни:** `feed.ics` намеренно без аутентификации (по токену) — токен в URL = секрет, поэтому стоит `Cache-Control: no-store`. Локальное имя параметра-переменной `t` в `list_tokens` затеняет query-параметр `t` в цикле (строки 119-127) — работает, но читается тяжело. Логика get-or-create аккаунта в `_account` коммитит сессию (строка 56).
- **Строк:** 182

## `backend/app/routers/patient_chat.py`

- **Назначение:** Чат пациента «вариант D» — гибрид AI-ассистента и живой регистратуры. Пациент пишет → если режим `AI` и лимит не исчерпан, отвечает LLM; при исчерпании лимита / недоступности AI / явном запросе человека ветка переключается в `MANUAL`. Плюс админская часть для операторов.
- **Ключевые элементы:** `router` (без prefix, пути `/patient/chat/*` и `/admin/patient-chats/*`); Pydantic `SendBody`, `AdminReplyBody`; сериализаторы `_serialize_message`/`_serialize_chat`; хелперы `_require_session`, `_get_or_create_chat`, `_update_chat_meta`, `_notify_admin_new_message` (пока только инкремент `unread_admin`, push — TODO).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/patient/chat` | patient_session (`?t`) | — | `{chats}` | Список чатов пациента |
| GET | `/patient/chat/{chat_id}/messages` | patient_session | — | `{chat, messages}` | История (limit 100) + mark-read |
| POST | `/patient/chat/send` | patient_session | `SendBody` (chat_id?, text) | `{chat, new_messages}` | Отправить, при AI-режиме сразу ответ LLM |
| POST | `/patient/chat/{chat_id}/manual` | patient_session | — | `{chat, new_messages}` | Запросить человека → MANUAL |
| GET | `/admin/patient-chats` | `require_manager` | — | `{chats, total_unread}` | Список чатов тенанта |
| GET | `/admin/patient-chats/{chat_id}/messages` | `require_manager` | — | `{chat, messages}` | История + сброс unread |
| POST | `/admin/patient-chats/{chat_id}/reply` | `require_manager` | `AdminReplyBody` | `{chat, message}` | Ответ оператора (→ MANUAL) |
| POST | `/admin/patient-chats/{chat_id}/toggle-mode` | `require_manager` | — | `{chat}` | Переключить AI ↔ MANUAL |

- **Зависимости:** `app.core.deps.require_manager`; модели `PatientChat`/`PatientChatMessage`/`PatientChatMode`/`PatientChatSender`, `PatientSession`, `User`; `patient_session_service.restore_session`; `patient_chat_ai.chat_with_ai` + константа `DAILY_AI_LIMIT`; `normalize_phone`.
- **Где менять для типовых задач:** дневной лимит AI — `DAILY_AI_LIMIT` (в `patient_chat_ai`, не здесь); логика хэндоффа/fallback-текстов — блоки в `patient_send_message` (строки 264-324); реальные уведомления оператору — `_notify_admin_new_message` (там TODO про push/Telegram).
- **Подводные камни:** это **legacy AI-чат**, существующий ПАРАЛЛЕЛЬНО с новыми async-тредами (`/patient/chat/threads/*` в `patient_chat_threads.py`) — пути специально не пересекаются (`/threads` сегмент). Не путайте две модели чата. Tenant-фильтр условный (`if user.tenant_id and chat.tenant_id`). `chat_with_ai` дёргается синхронно внутри request (может занять секунды). Ownership проверяется по `normalize_phone`.
- **Строк:** 480

## `backend/app/routers/patient_chat_slots.py`

- **Назначение:** `chatslot01` — пациентские эндпоинты внутри async-треда: создать запрос на слот и забронировать конкретный предложенный слот. `thread_id` здесь = `PatientChat.id` (тот же объект, что в legacy-чате).
- **Ключевые элементы:** `router` (без prefix, пути `/patient/chat/threads/{thread_id}/*`); хелперы `_get_session`, `_account`, `_load_thread_for_patient` (проверка владения тредом по телефону+тенанту).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/patient/chat/threads/{thread_id}/slot-request` | patient_session | `SlotRequestCreate` | `ChatMessageResponse` (201) | Запросить слоты у клиники |
| POST | `/patient/chat/threads/{thread_id}/book-slot` | patient_session | `SlotBookRequest` (+`Idempotency-Key`) | `SlotBookResponse` (201) | Забронировать предложенный слот |

- **Зависимости:** схемы `app.schemas.chat_slots`; `slot_booking_service` (`create_slot_request`, `book_slot` + исключения `SlotTaken/Expired/NotFoundError`); `family_service`, `patient_session_service.restore_session`; модели `PatientAccount`, `PatientChat`, `PatientSession`.
- **Где менять для типовых задач:** маппинг доменных исключений в HTTP-коды — `post_book_slot` (409 slot_taken / 410 expired / 404 not_found, строки 153-160); сама бизнес-логика бронирования — в `slot_booking_service`.
- **Подводные камни:** при `SlotTakenError` делается `await db.commit()` ПЕРЕД raise (строки 153-156) — чтобы сохранить пометку `offer.taken` для UI; не считайте это «ничего не закоммичено при ошибке». Принимается заголовок `Idempotency-Key`, но в этом файле он лишь прокидывается дальше (поведение — в сервисе). Проверка владения тредом — по `normalize_phone` + опциональному tenant.
- **Строк:** 168

## `backend/app/routers/patient_chat_threads.py`

- **Назначение:** Глава 9 — асинхронные треды пациент↔клиника (новая модель чата, отдельная от legacy AI-чата). Создание тредов, отправка сообщений с web-push клинике, пагинация, mark-read, typing-индикатор. Учитывает лимит free-сообщений (подписка «Здоровье+»).
- **Ключевые элементы:** `router` (без prefix); Pydantic `CreateThreadIn`, `SendMessageIn` (валидатор «body или attachments»); хелперы `_get_session`, `_account`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/patient/chat/threads` | patient_session | — | `{threads}` | Список тредов пациента |
| POST | `/patient/chat/threads` | patient_session | `CreateThreadIn` | `{thread, message}` (201) | Создать тред (проверка лимита → 402) |
| GET | `/patient/chat/threads/{thread_id}` | patient_session | `?limit&before_id` | `{thread, messages}` | Детали + пагинация сообщений |
| POST | `/patient/chat/threads/{thread_id}/messages` | patient_session | `SendMessageIn` | `serialize_message` (201) | Отправить сообщение (лимит → 402) |
| POST | `/patient/chat/threads/{thread_id}/read` | patient_session | — | `{ok, unread_for_patient:0}` | Отметить прочитанным |
| POST | `/patient/chat/threads/{thread_id}/typing` | patient_session | — | `{ok, last_typing_at_patient}` | Пинг «печатает...» |

- **Зависимости:** `chat_service` (`list_patient_threads`, `last_message`, `serialize_thread`/`serialize_message`, `check_patient_can_send`, `create_thread`, `get_thread`, `list_messages`, `add_patient_message`, `mark_read_for_patient`); `family_service`, `patient_session_service`; `push_dispatcher.notify_clinic_about_new_message`; `patient_identifier.identify_patient` (background); модель `Clinic`.
- **Где менять для типовых задач:** лимит сообщений и текст 402 — `check_patient_can_send` (сервис) + JSON-detail в строках 112-120/204-212; push-уведомления клинике — `push_dispatcher`; авто-привязка `mis_patient_id` — background-таск `_run_identify` (строки 231-244).
- **Подводные камни:** web-push и background-identify обёрнуты в try/except — «никогда не падаем». Background-таск `_run_identify` открывает **свою** `AsyncSessionLocal`, т.к. request-сессия к моменту выполнения закрыта — не используйте request-`db` в background. Лимит подписки проверяется и при создании треда, и при каждом сообщении (HTTP 402). Auto-claim VIP-counselor через `acc.default_counselor_user_id`.
- **Строк:** 291

## `backend/app/routers/patient_documents.py`

- **Назначение:** Документы пациента (справки/выписки/больничные): пациент видит и скачивает свои документы по session-токену; staff (manager/reg/doctor) загружает, удаляет (manager/reg) и скачивает. Хранение — на диске в `/app/uploads/patient_docs/<tenant>/`.
- **Ключевые элементы:** `router` (без prefix, пути `/patient/documents/*` и `/documents/*`); `UPLOAD_BASE`, `MAX_SIZE=25МБ`, `ALLOWED_DOC_TYPES`; `_doc_dict`; `_patient_session_or_401`; deps `_uploader_dep` (manager/reg/doctor), `_manager_dep` (manager/reg).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/patient/documents` | patient_session | — | `list[doc]` | Список своих документов |
| GET | `/patient/documents/{doc_id}/download` | patient_session | — | FileResponse | Скачать (owner-check по phone) |
| POST | `/documents/upload` | `require_role(manager,reg,doctor)` | multipart (patient_phone, file, ...) | doc | Загрузить документ |
| DELETE | `/documents/{doc_id}` | `require_role(manager,reg)` | — | `{ok}` | Удалить (файл+запись) |
| GET | `/documents` | manager/reg/doctor | `?patient_phone` | `list[doc]` | Список по телефону пациента |
| GET | `/documents/{doc_id}/download` | manager/reg/doctor | — | FileResponse | Staff-скачивание |

- **Зависимости:** `app.core.deps` (`get_current_user`, `require_role`); модель `PatientDocument`; `patient_session_service.restore_session`; `normalize_phone`. Volume: `/opt/clinika/uploads:/app/uploads`.
- **Где менять для типовых задач:** лимит размера — `MAX_SIZE`; разрешённые MIME — список `allowed` в `staff_upload_document` (строки 149-160); типы документов — `ALLOWED_DOC_TYPES`; роли загрузки/удаления — `_uploader_dep`/`_manager_dep`.
- **Подводные камни:** это **«v1» staff-ориентированное** хранилище; есть параллельная пациент-центричная «v2» (`patient_documents_v2.py`, prefix `/patient/health-documents`) — модель `PatientDocument` общая, но эндпоинты и сервисный слой разные, легко перепутать. Имя файла на диске = UUID (защита от path-injection), оригинальное имя хранится отдельно. Owner-check пациента — по `normalize_phone` + опциональный tenant. При удалении файла ошибки `OSError` глотаются.
- **Строк:** 256

## `backend/app/routers/patient_documents_v2.py`

- **Назначение:** Глава 9 — пациент-центричное хранилище документов здоровья. Пациент сам загружает/смотрит/скачивает/удаляет свои документы. Отдельный prefix `/patient/health-documents`, отдельный сервисный слой `document_service`.
- **Ключевые элементы:** `router` (prefix `/patient/health-documents`); хелперы `_get_session`, `_account` (тот же паттерн, что в calendar/threads).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/patient/health-documents` | patient_session | — | `{documents}` | Список своих документов |
| POST | `/patient/health-documents/upload` | patient_session | multipart (file, category, title, visibility...) | doc (201) | Загрузить документ |
| GET | `/patient/health-documents/{doc_id}/download` | patient_session | — | FileResponse | Скачать (owner: patient_id ИЛИ phone) |
| DELETE | `/patient/health-documents/{doc_id}` | patient_session | — | `{ok, deleted_at}` | Soft-delete |

- **Зависимости:** `document_service` (`list_patient_documents`, `save_patient_document`, `serialize_document`, `get_document`, `soft_delete_document`); `family_service`, `patient_session_service`; модели `PatientAccount`, `PatientDocument`, `PatientSession`; `normalize_phone` (lazy import).
- **Где менять для типовых задач:** валидация файла/категорий/visibility — в `document_service.save_patient_document` (роутер ловит `ValueError` → 400); soft-delete — `soft_delete_document` (использует `deleted_at`).
- **Подводные камни:** при загрузке `tenant_id=None` передаётся ЯВНО (строка 102) — документы v2 не привязываются к тенанту. Ownership на скачивании двойной: `patient_id == acc.id` ИЛИ `patient_phone == normalize_phone(...)` (для legacy-документов, строка 135); на удалении — только по `patient_id` (строже). Soft-delete фильтруется через `doc.deleted_at is not None`. Не путать с `patient_documents.py` (v1, staff).
- **Строк:** 168

## `backend/app/routers/patient_engagement_analytics.py`

- **Назначение:** Тонкий read-only роутер аналитики удержания для менеджера: дашборд-сводка, тепловая карта логинов, retention-когорты, воронка, churn-список, «застрявшие в воронке». Вся логика — в сервисе `engagement_analytics`.
- **Ключевые элементы:** `router` (prefix `/engagement`); 6 GET-эндпоинтов-обёрток.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/engagement/dashboard` | `require_manager` | — | сводка | Дашборд удержания |
| GET | `/engagement/login-heatmap` | `require_manager` | `?days` | `{days, cells}` | Тепловая карта логинов |
| GET | `/engagement/retention-cohorts` | `require_manager` | `?weeks` | `{weeks, cohorts}` | Retention-когорты |
| GET | `/engagement/funnel` | `require_manager` | `?days` | сводка воронки | Воронка вовлечения |
| GET | `/engagement/churn-list` | `require_manager` | `?days_threshold&limit` | `{items}` | Список оттока |
| GET | `/engagement/stuck-in-funnel` | `require_manager` | `?opens_threshold&limit` | `{items}` | Застрявшие в воронке |

- **Зависимости:** `app.core.deps.require_manager`; сервис `engagement_analytics` (`dashboard_summary`, `login_heatmap`, `retention_cohorts`, `funnel_summary`, `churn_list`, `stuck_in_funnel`); модель `User`.
- **Где менять для типовых задач:** формулы/SQL аналитики — в сервисе `engagement_analytics`, не здесь; этот файл правят только при добавлении нового эндпоинта-обёртки или параметра.
- **Подводные камни:** делит prefix `/engagement` с `patient_engagement_crm.py` и `patient_engagement_segments.py` — три файла образуют единый namespace `/engagement/*`, следите за коллизиями путей при добавлении новых маршрутов. Tenant передаётся через `current_user.tenant_id` (heatmap/cohorts тенанта НЕ принимают — проверьте в сервисе, глобальны ли они).
- **Строк:** 80

## `backend/app/routers/patient_engagement_crm.py`

- **Назначение:** CRM-карточка пациента для менеджера: главная таблица пациентов с фильтрами, детальная карточка (профиль + теги + заметки + comm-prefs + логины + приёмы + направления + suggestions, с обогащением из МИС), CRUD тегов/заметок/comm-prefs и работа с engagement-подсказками.
- **Ключевые элементы:** `router` (prefix `/engagement`); Pydantic `TagCreate`, `NoteCreate`, `CommPrefsUpdate`, `PostponeRequest`; большие функции `list_patients` (динамические фильтры + raw SQL) и `patient_card` (агрегатор + write-back из МИС).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/engagement/patients` | `require_manager` | фильтры (q, last_login, login_count, birthday, has_tag, ...) | `{total, items}` | Таблица пациентов CRM |
| GET | `/engagement/patients/{patient_id}` | `require_manager` | — | карточка пациента | Детальная карточка + МИС |
| POST | `/engagement/patients/{patient_id}/tags` | `require_manager` | `TagCreate` | `{id, tag, color}` | Добавить тег |
| DELETE | `/engagement/patients/{patient_id}/tags/{tag_id}` | `require_manager` | — | `{ok}` | Удалить тег |
| POST | `/engagement/patients/{patient_id}/notes` | `require_manager` | `NoteCreate` | note | Добавить заметку |
| PATCH | `/engagement/patients/{patient_id}/notes/{note_id}` | `require_manager` | `NoteCreate` | note | Изменить заметку |
| DELETE | `/engagement/patients/{patient_id}/notes/{note_id}` | `require_manager` | — | `{ok}` | Удалить заметку |
| PATCH | `/engagement/patients/{patient_id}/comm-prefs` | `require_manager` | `CommPrefsUpdate` | `{ok}` | Обновить comm-prefs |
| GET | `/engagement/suggestions` | `require_manager` | `?status&kind&limit` | `{groups, items, total}` | Список подсказок |
| POST | `/engagement/suggestions/{sug_id}/dismiss` | `require_manager` | — | `{ok}` | Отклонить подсказку |
| POST | `/engagement/suggestions/{sug_id}/postpone` | `require_manager` | `PostponeRequest` | `{ok}` | Отложить подсказку |
| POST | `/engagement/suggestions/regenerate` | `require_director_or_owner` | — | `{stats}` | Перегенерировать подсказки |

- **Зависимости:** `app.core.deps` (`require_manager`, `require_director_or_owner`); модели `PatientAccount`, `PatientSession`, `engagement.*` (`PatientTag/Note/CommPrefs/EngagementSuggestion`); сервисы `mis_sync_service.get_patient_from_mis`, `settings_service.get_setting`, `suggestion_engine.run_engine`.
- **Где менять для типовых задач:** новые фильтры таблицы — `list_patients` (блоки `conds.append(...)`, строки 48-104); состав карточки — `patient_card`; маппинг полей Renovatio при обогащении — строки 271-291; статусы подсказок — pattern в `list_suggestions` (строка 552).
- **Подводные камни:** активно используется **raw SQL через `text()`** (фильтр дней рождения, has_appointments, referrals, appointments) — `birthday_in_next_days` подставляется через `f-string` с `int(...)` (защита приведением, не bind-параметром — строки 67-72, осознанно прокомментировано). `patient_card` делает **write-back в локальную БД** из МИС (`pa.name/email/birth_date`, `await db.flush()` строки 293-307) — побочный эффект GET-запроса. Изоляция строгая по `current_user.tenant_id`, НО `PatientAccount` сам по себе глобален (поиск без tenant), а теги/заметки/suggestions — тенантные. `PatientSession` линкуется по phone (нет account_id, строки 193-203). `appointments` возвращают `service_name=NULL` намеренно (поля нет в модели). Добавление тега ловит любой Exception → 400 «tag exists» (рассчитывает на unique-констрейнт).
- **Строк:** 650

## `backend/app/routers/patient_engagement_segments.py`

- **Назначение:** Самый большой файл CRM-блока (Phase E2): сегменты пациентов (динамические фильтры), push-шаблоны (welcome/birthday/abandonment/...), push-кампании с A/B-тестированием, отправкой/планированием/отменой и анти-спам-логикой (opt-out, throttle 1/7д, quiet-hours).
- **Ключевые элементы:** `router` (prefix `/engagement`); Pydantic `Segment*`, `Template*`, `Campaign*`; сериализаторы `_seg_out`/`_tmpl_out`/`_camp_out`; ключевой хелпер `_can_send_push` (opt_out/throttled/quiet_hours); `_DEFAULT_TEMPLATES` для seed.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/engagement/segments` | `require_manager` | — | `{items}` | Список сегментов |
| POST | `/engagement/segments` | `require_manager` | `SegmentCreate` | сегмент | Создать сегмент |
| GET | `/engagement/segments/{id}` | `require_manager` | — | сегмент | Получить сегмент |
| PATCH | `/engagement/segments/{id}` | `require_manager` | `SegmentUpdate` | сегмент | Изменить сегмент |
| DELETE | `/engagement/segments/{id}` | `require_director_or_owner` | — | `{deleted}` | Удалить сегмент |
| POST | `/engagement/segments/{id}/resolve` | `require_manager` | — | `{size, patient_ids}` | Пересчитать сегмент |
| POST | `/engagement/segments/preview` | `require_manager` | `SegmentPreviewRequest` | `{size, sample}` | Превью фильтра без сохранения |
| GET | `/engagement/templates` | `require_manager` | `?category` | `{items}` | Список шаблонов |
| POST | `/engagement/templates` | `require_manager` | `TemplateCreate` | шаблон | Создать шаблон |
| PATCH | `/engagement/templates/{id}` | `require_manager` | `TemplateUpdate` | шаблон | Изменить шаблон |
| DELETE | `/engagement/templates/{id}` | `require_director_or_owner` | — | `{deleted}` | Удалить шаблон |
| POST | `/engagement/templates/seed-defaults` | `require_manager` | — | `{created, count}` | Создать дефолтные шаблоны |
| GET | `/engagement/campaigns` | `require_manager` | `?status` | `{items}` | Список кампаний |
| POST | `/engagement/campaigns` | `require_manager` | `CampaignCreate` | кампания (draft) | Создать кампанию |
| GET | `/engagement/campaigns/{id}` | `require_manager` | — | кампания | Получить кампанию |
| POST | `/engagement/campaigns/{id}/send` | `require_director_or_owner` | — | сводка отправки | Отправить сейчас |
| POST | `/engagement/campaigns/{id}/schedule` | `require_director_or_owner` | `CampaignSchedule` | кампания | Запланировать |
| POST | `/engagement/campaigns/{id}/cancel` | `require_director_or_owner` | — | кампания | Отменить |
| GET | `/engagement/campaigns/{id}/stats` | `require_manager` | — | метрики+CTR | Статистика A/B |
| DELETE | `/engagement/campaigns/{id}` | `require_director_or_owner` | — | `{deleted}` | Удалить кампанию |

- **Зависимости:** `app.core.deps` (`require_manager`, `require_director_or_owner`); модели `PatientAccount`, `engagement.*` (`PatientSegment`, `PatientCommPrefs`, `PushTemplate`, `PushCampaign`, `EngagementSuggestion`, `TemplateCategory`), `PushSubscription`; сервисы `push_service.send_push_to_phone`, `ads_substitute.substitute`, `segment_service` (`resolve_segment`, `resolve_segment_filter`).
- **Где менять для типовых задач:** анти-спам-правила — `_can_send_push` (строки 164-221, throttle_days по умолч. 7); дефолтные шаблоны — `_DEFAULT_TEMPLATES`; логика A/B-разбиения — `send_campaign` (строки 714-723); подстановка переменных — `substitute` + словарь `ctx` (строки 763-768); метрики/CTR — `campaign_stats`.
- **Подводные камни:** throttle реализован НЕ отдельной таблицей, а через журнал `EngagementSuggestion` со `status="sent"` (запись добавляется после успешной доставки, строки 786-796) — если менять модель suggestions, не сломайте throttle. `send_campaign` загружает все `PatientAccount` одним запросом, но `_can_send_push` внутри цикла снова дёргает БД по каждому пациенту (N+1, строки 742-746) — для крупных сегментов дорого. Без сегмента кампания шлётся **всем** с `marketing_opt_in=True` БЕЗ tenant-фильтра (строки 668-674) — потенциальная кросс-тенант рассылка! Quiet-hours корректно обрабатывают переход через полночь. Отправка считается успешной только если `delivered > 0`. Реальный планировщик `scheduled`-кампаний — вне файла (статус ставится, диспетчер отдельно).
- **Строк:** 932

## `backend/app/routers/patient_family.py`

- **Назначение:** Семейный кабинет пациента (Глава 8): группы (`FamilyGroup`), члены (`FamilyMember`) с гранулярными правами, приглашения (`FamilyInvite`), переключение контекста на члена семьи и агрегированный просмотр его приёмов. Содержит hotfix-совместимость со старой плоской моделью `patient_family_members`.
- **Ключевые элементы:** `router` (prefix `/patient/family`); Pydantic `CreateGroupIn`, `InviteIn`, `AcceptInviteIn`, `PatchMemberIn`; хелперы `_get_session`, `_current_account`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/patient/family` | patient_session | `?format=legacy&t=` | группа+members(+legacy) или плоский array | Моя семья (новый/legacy формат) |
| POST | `/patient/family` | patient_session | `CreateGroupIn` | `{group, members, is_owner}` (201) | Создать/получить группу |
| POST | `/patient/family/invite` | patient_session | `InviteIn` | added / invite_pending / already_member (201) | Пригласить родственника |
| POST | `/patient/family/accept-invite` | patient_session | `AcceptInviteIn` | `{status: joined}` | Принять приглашение |
| PATCH | `/patient/family/members/{member_id}` | patient_session (только owner) | `PatchMemberIn` | `{status: updated}` | Изменить права члена |
| DELETE | `/patient/family/members/{member_id}` | patient_session (только owner) | — | `{status: deleted}` | Удалить члена (не self) |
| GET | `/patient/family/switch-context/{patient_id}` | patient_session | — | `{session_token, ...}` | Сессия на члена семьи |
| GET | `/patient/family/aggregated-cabinet` | patient_session | `?patient_id` | приёмы+права члена | Просмотр данных члена (если can_view_records) |

- **Зависимости:** модели `family.*` (`FamilyGroup`, `FamilyMember`, `FamilyInvite`), `PatientFamilyMember` (legacy), `PatientAccount`, `PatientSession`, `Appointment/AppointmentStatus`; `family_service` (`get_account_by_phone`, `get_or_create_account_by_phone`, `get_or_create_group`, `list_members`, `create_invite`, `find_invite_by_token`, `accept_invite`, `is_member_of`, `find_membership`, `VALID_RELATIONS`); `patient_session_service` (`restore_session`, `create_session`); `make_patient_session_token`; `normalize_phone`.
- **Где менять для типовых задач:** допустимые отношения — `family_service.VALID_RELATIONS`; права члена — `PatchMemberIn` + поля `can_view_records/can_book_appointments/can_manage_payments`; логика приглашения (skeleton vs invite) — `invite_member` (строки 236-279); совместимость со старым UI — блок `legacy_members` / `?format=legacy` в `get_family`.
- **Подводные камни:** в файле **две модели семьи одновременно** — новая (`FamilyGroup`/`FamilyMember`) и legacy `PatientFamilyMember` (та же таблица, что используется в `patient.py`!). `get_family` склеивает обе и поддерживает `?format=legacy` для старого `FamilyModal` в `PatientCabinet.jsx` — при изменениях не сломайте оба формата. Обратите внимание: **docstring функции `get_family` стоит ПОСЛЕ исполняемого кода** (строки 97-99 идут до тройных кавычек на 100) — это не настоящий docstring, а просто строковый литерал; будьте аккуратны при рефакторинге. `switch_context` и `aggregated_cabinet` дублируют логику поиска группы (owner или член). Импорты `and_, or_, FamilyInvite, make_patient_session_token, AppointmentStatus` присутствуют, но частично не используются (легаси-хвосты).
- **Строк:** 522

---

### Сводные риски по группе (для ревью)
1. **Кросс-тенант утечки при пустом фильтре:** пациентские эндпоинты используют `if session.tenant_id:` и кампании без сегмента шлют всем `marketing_opt_in=True` без tenant — самый частый класс багов здесь.
2. **Два параллельных набора моделей** в чатах (legacy AI `patient_chat.py` vs threads) и документах (v1 staff vs v2 health) и семье (legacy `PatientFamilyMember` vs Глава 8) — легко доработать «не ту» половину.
3. **Секрет прокси захардкожен** в `owner_bot_webhook.py`.
4. **N+1 и raw SQL:** `send_campaign` (`_can_send_push` в цикле) и `patient.py` (`_load_*_for_phone` фильтруют после выборки); CRM активно использует `text()` с f-string-подстановкой.
5. **Decimal vs float:** `partner_clinics.py` хранит ставки как Decimal, отдаёт float, считает выплаты во float (ок для preview, не для биллинга).
