# routers [11] — публичные витрины, чат сотрудников, расписание, маркетинг и безопасность

Это срез из 15 роутеров `backend/app/routers/*.py` (файлы 151–165 в алфавитном порядке проекта). Группа разнородная, но логически делится на несколько кластеров:

- **Публичные витрины без авторизации** — `public_clinic.py` (страница клиники в стиле prodoctorov), `public_onboarding.py` (self-service регистрация франшизы с OTP), `reviews.py` (приём отзывов от пациентов).
- **Рабочие кабинеты и операционка** — `recruiter.py` (регистрация врачей рекрутером), `referrals.py` + `reg_speed.py` (направления между клиниками и их печать), `scheduling.py` (врачи/расписание/записи), `slot_holds.py` (удержание слота в чате с пациентом), `regulations.py` (е-подпись регламентов сотрудниками).
- **Коммуникации и поиск** — `staff_chat.py` (Slack-подобный чат сотрудников с WebSocket, реакциями, опросами, файлами), `search.py` (глобальный Cmd+K поиск), `sms_marketing.py` (рассылки), `push.py` (Web Push / VAPID).
- **Себестоимость и безопасность** — `service_norms.py` (нормативы расходников и калькуляция себестоимости приёма), `security.py` (журнал безопасности и блокировки IP для super_admin).

Сквозные паттерны почти везде: async SQLAlchemy 2.0 (`select(...)` + `await db.execute`), tenant-изоляция по `current_user.tenant_id`, конвертация `Decimal`→`float` на выходе, depends-проверки ролей через `app.core.deps`. Все роутеры монтируются в `app/main.py` **без override-префикса** — префикс задаётся внутри файла в `APIRouter(prefix=...)` (исключение: `public_clinic` и `scheduling` без prefix, пути полные; `public_onboarding` объявляет prefix `/signup`, несмотря на «onboarding» в названии).

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `public_clinic.py` | Публичная страница клиники и профиль врача | 254 |
| `public_onboarding.py` | Self-service регистрация франшизы через OTP | 248 |
| `push.py` | Web Push подписки и отправка (VAPID) | 403 |
| `recruiter.py` | Регистрация врачей рекрутером, бонусы, инвайты | 481 |
| `referrals.py` | Межклинические направления: создание, подтверждение, комментарии | 537 |
| `reg_speed.py` | PDF-печать направления и поиск пациентов | 475 |
| `regulations.py` | Регламенты сотрудникам с е-подписью | 192 |
| `reviews.py` | Отзывы пациентов о врачах и модерация | 194 |
| `scheduling.py` | Врачи, расписание, слоты, записи на приём | 896 |
| `search.py` | Глобальный поиск для CommandPalette (Cmd+K) | 143 |
| `security.py` | Журнал безопасности, блокировки IP (super_admin) | 407 |
| `service_norms.py` | Нормативы расходников и себестоимость приёма | 424 |
| `slot_holds.py` | Удержание слота записи внутри чата | 79 |
| `sms_marketing.py` | SMS-шаблоны, кампании, лог отправок | 530 |
| `staff_chat.py` | Чат сотрудников: каналы, реакции, опросы, WS | 1526 |

---

## `backend/app/routers/public_clinic.py`
- **Назначение:** Публичная (без auth) страница клиники по slug — аналог prodoctorov.ru: брендинг, список врачей с рейтингами, последние отзывы, плюс детальная карточка врача с пагинацией отзывов.
- **Ключевые элементы:** `_tenant_or_404(slug, db)` (helper, ищет активный `Tenant` по slug); эндпоинты `public_clinic_page`, `public_doctor_profile`. Router без prefix, tag `public-clinic` — монтируется на тот же `/public`, что и `public_booking`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/public/{slug}/clinic` | публичный | path slug | tenant+branding+clinics+specialties+doctors+recent_reviews | Полная страница клиники |
| GET | `/public/{slug}/doctors/{doctor_id}/profile` | публичный | path slug+doctor_id, query limit≤50/offset | профиль врача + рейтинг + отзывы | Карточка врача с пагинацией |

- **Зависимости:** модели `Tenant`, `TenantBranding`, `Clinic`, `Doctor`, `DoctorSchedule`, `Review`/`ReviewStatus`. Сервисов не использует — вся агрегация запросами прямо в роутере.
- **Где менять для типовых задач:** добавить поле на витрину врача — словарь `doctors_out` (строки 129–144) + `public_doctor_profile` (строки 235–248); поменять количество последних отзывов — `limit(20)` на строке 106; дефолтные цвета брендинга — строки 158–159.
- **Подводные камни:** только `ReviewStatus.APPROVED` участвует в рейтингах; `is_anonymous` скрывает `patient_name` (строки 114, 224); `round(float(avg),1)` — приведение Decimal→float; врач без расписания помечается `has_schedule=False` (выводится из отдельного запроса по `DoctorSchedule`). Tenant-изоляция строгая: всё через `tenant.id`/`Clinic.tenant_id`.
- **Строк:** 254

## `backend/app/routers/public_onboarding.py`
- **Назначение:** Публичный self-service onboarding (регистрация новой франшизы) с OTP-подтверждением email. Создаёт черновик заявки, верифицирует код, создаёт все сущности и шлёт welcome-письмо. Логика делегирована в `onboarding_service`.
- **Ключевые элементы:** Pydantic-схемы `CheckSlugReq`, `ClinicIn`, `StartReq` (с валидатором плана по `PLANS`), `VerifyReq`, `ResendReq`, `CompleteReq`. In-memory rate-limiter `_START_BUCKET` + `_check_start_rate` (5 стартов/час/IP), `_client_ip`. Router с prefix `/signup`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/signup/check-slug` | публичный | `{slug}` | доступность slug | Live-валидация slug |
| POST | `/signup/start` | публичный (rate-limit 5/ч) | `StartReq` (email, franchise, clinics, plan) | `{request_id, expires_in:1800, max_attempts}` | Создать draft + отправить OTP |
| POST | `/signup/verify` | публичный | `{request_id, code}` | `{verified, request_id}` | Проверить OTP |
| POST | `/signup/resend` | публичный | `{request_id}` | `{ok}` | Перевыпустить код |
| POST | `/signup/complete` | публичный | `{request_id}` | результат создания | Создать тенант/клиники + welcome |
| GET | `/signup/status/{request_id}` | публичный | path | статус заявки | Polling/возобновление |
| GET | `/signup/trial-status` | auth (любой) | — | статус триала тенанта | Для TrialBanner |

- **Зависимости:** `onboarding_service as svc` (`create_signup_request`, `verify_otp`, `resend_otp`, `complete_onboarding`, `validate_slug`, `trial_status_for`, константы `MAX_OTP_ATTEMPTS`, `PLANS`); модели `SignupRequest`, `Tenant`, `Subscription`. `get_current_user` импортируется лениво через `__import__` (строка 234).
- **Где менять для типовых задач:** изменить лимит регистраций — `START_LIMIT`/`START_WINDOW` (строки 97–98); срок жизни OTP — `expires_in` (строка 160, должно совпадать с `verify_otp` в сервисе); состав создаваемых сущностей — НЕ здесь, а в `onboarding_service.complete_onboarding`.
- **Подводные камни:** rate-limiter in-memory — не переживёт рестарт и не работает на нескольких инстансах (в комментарии помечено «заменим на Redis»). `email` и `tenant_slug` принудительно `.lower()` (строки 144–145). `/signup/trial-status` — единственный auth-эндпоинт здесь, использует тот же расчёт, что `/admins/me`. Странность: название файла/модуля `public_onboarding`, prefix `/signup`, а docstring описывает пути `/onboarding/*` — **docstring устарел**, реальные пути с `/signup`.
- **Строк:** 248

## `backend/app/routers/push.py`
- **Назначение:** Web Push (VAPID) — выдача публичного ключа, подписка/отписка устройств, тестовое уведомление, manager-рассылки. Содержит много легаси-эндпоинтов для уже задеплоенного фронта.
- **Ключевые элементы:** схемы `SubscribeKeys`/`SubscribeBody` (новый формат браузера), `UnsubscribeBody`, `TestPushBody`, legacy `LegacySubscribeRequest`/`SendPushRequest`/`LegacyFlatSubscribe`. Helper `_delete_subscription`. Router без prefix, tag `push`. Работа с БД — через **сырой SQL `text(...)`**, а не ORM.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/push/vapid-public-key` | публичный | — | `{public_key}` | VAPID-ключ для браузера |
| GET | `/push/vapid-key` | публичный | — | `{public_key}` | Legacy-alias ключа |
| POST | `/push/subscribe` | опц. Bearer | новый или legacy JSON | `{status:ok}` | Создать/обновить подписку (идемпотентно) |
| DELETE | `/push/unsubscribe` | публичный | `{endpoint}` | `{status, deleted}` | Удалить подписку |
| POST | `/push/unsubscribe` | публичный | `{endpoint}` | `{status, deleted}` | Legacy POST-отписка |
| POST | `/push/test` | auth | `TestPushBody?` | `{sent}` | Тест себе |
| POST | `/manager/push/send` | `require_manager` | `SendPushRequest` | `{sent}` | Push пациенту/всем тенанта |
| GET | `/manager/push/stats` | `require_manager` | — | `{total_subscriptions}` | Статистика подписок |
| POST | `/push/subscribe-doctor` | auth (роли врача/manager) | `LegacyFlatSubscribe` | `{status:ok}` | Legacy подписка врача |
| POST | `/push/subscribe-user` | auth | `LegacyFlatSubscribe` | `{status:ok}` | Legacy подписка юзера |

- **Зависимости:** `push_service` (`get_vapid_public_key`, `send_push_to_phone`, `send_push_to_all`, `send_push`), `require_manager`/`get_current_user`, `decode_token`/`decode_patient_token`, `app.utils.phone.normalize_phone`. Таблица `push_subscriptions` и `patient_accounts`/`users` — через raw SQL.
- **Где менять для типовых задач:** новый формат подписки — ветка в `subscribe_push` (строки 124–145); связывание подписки с пациентом по телефону — блок `patient_id` (строки 178–195); удаление легаси — снести `vapid-key`, `subscribe-doctor`, `subscribe-user`, POST-`unsubscribe` (помечены «legacy» в docstring строки 10–16).
- **Подводные камни:** **сырой SQL `text()`** вместо ORM — следить за синтаксисом и SQL-инъекциями (используются bind-параметры, это норм). `subscribe_push` парсит тело руками через `request.json()` и сам различает форматы — Pydantic-валидации body нет. Извлечение пользователя из `Authorization` опционально и обёрнуто в `try/except` (подписка пациента без Bearer — это нормальный путь). Указанный в комментарии баг (не проставлялся `patient_id`) уже исправлен.
- **Строк:** 403

## `backend/app/routers/recruiter.py`
- **Назначение:** Кабинет рекрутера — прямая регистрация врачей (с выдачей логина/пароля и QR), список привлечённых врачей, бонусы, статистика. Плюс устаревший invite-флоу (приглашение по токену).
- **Ключевые элементы:** схемы `RegisterDoctorRequest`, `InviteRequest`, `AcceptInviteRequest`. Зависимость `_recruiter = Depends(require_role("recruiter"))`. Router prefix `/recruiter`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/recruiter/stats` | recruiter | — | счётчики врачей/бонусов | Сводная статистика |
| GET | `/recruiter/doctors` | recruiter | — | список привлечённых врачей | Мои врачи (batch-запросы) |
| GET | `/recruiter/bonuses` | recruiter | query limit≤200/offset | список бонусов | Бонусы рекрутера |
| POST | `/recruiter/register_doctor` | recruiter | `RegisterDoctorRequest` | врач + credentials + QR | Прямая регистрация врача |
| GET | `/recruiter/invites` | recruiter | — | список (устар.) | Совместимость, отдаёт врачей |
| POST | `/recruiter/invite` | recruiter | `InviteRequest` | invite_link | Устаревший инвайт |
| GET | `/recruiter/accept/{token}` | публичный | path token | валидность приглашения | Проверка инвайта |
| POST | `/recruiter/accept/{token}` | публичный | `AcceptInviteRequest` | данные нового врача | Принятие инвайта |

- **Зависимости:** модели `User`/`UserRole`, `DoctorClinicAccess`, `RecruiterBonus`/`RecruiterBonusStatus`, `Clinic`, `Tenant`, `Doctor`, `Invitation` (ленивый импорт). `hash_password`, `generate_url_qr_base64` (qr_service). `require_role`.
- **Где менять для типовых задач:** поля врача при регистрации — `RegisterDoctorRequest` (строки 38–46) + создание `User`/`Doctor` (строки 225–297); URL входа в QR — строки 304–307 (`https://клиниксеть.рф/{slug}/admin`); расчёт «paid_bonuses» — строка 90.
- **Подводные камни:** при `register_doctor` ставится `password_must_change=True` (рекрутер задал пароль), а в invite-флоу — нет (врач сам ввёл). `bonuses`-эндпоинт делает `db.get(User, b.doctor_id)` **в цикле** (N+1), тогда как `doctors`-эндпоинт уже оптимизирован batch-запросами с `GROUP BY` — стоит выровнять. Создание записи `Doctor` обёрнуто в широкий `try/except: pass` с `rollback` — ошибки молча проглатываются (строки 274–297). Уникальность логина/email проверяется до flush. Invite-эндпоинты явно помечены устаревшими.
- **Строк:** 481

## `backend/app/routers/referrals.py`
- **Назначение:** Ядро межклинических направлений: верификация пациента в МИС Renovatio, создание пациента в МИС, создание направления, подтверждение по QR или 5-значному коду, входящие/исходящие списки, запрос отмены, комментарии. Содержит главный сериализатор `_enrich_referral`.
- **Ключевые элементы:** `_log` (запись в `ActivityLog`), `_patient_full_name`, `_patient_to_match` (нормализация ответа МИС), `_confirm_code_limiter`/`_CONFIRM_CODE_DEPS` (rate-limit 5/мин на confirm-by-code), `_enrich_referral` (DTO с обогащением клиниками/услугой/бонусом/SLA/patient_url). Схемы `CommentBody`, `ShortCodeRequest`. Router prefix `/referrals`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/referrals/verify-patient` | auth | query phone/full_name | `{matches}` | Поиск пациента в МИС |
| POST | `/referrals/mis-add-patient` | auth | `{phone, full_name}` | `{mis_patient_id}` | Создать пациента в МИС |
| POST | `/referrals/` | auth + region_lock | `ReferralCreate` | `ReferralResponse` | Создать направление |
| POST | `/referrals/confirm-by-code` | auth + region_lock + rate-limit | `{short_code}` | `ReferralResponse` | Подтвердить по коду |
| POST | `/referrals/scan` | auth + region_lock | `QRScanRequest` | `ReferralResponse` | Подтвердить по QR |
| GET | `/referrals/` | auth | — | список (мои, ≤50) | Мои направления |
| GET | `/referrals/incoming` | auth | query status | список (≤100) | Входящие в мою клинику |
| GET | `/referrals/{referral_id}` | auth | path | `ReferralResponse` | Одно направление |
| POST | `/referrals/{referral_id}/cancel-request` | auth (автор/manager) | `CancelRequestBody` | `ReferralResponse` | Запрос отмены |
| GET | `/referrals/{referral_id}/comments` | auth | path | список комментариев | Комментарии |
| POST | `/referrals/{referral_id}/comments` | auth | `CommentBody` | комментарий | Добавить комментарий |

- **Зависимости:** `referral_service` (`create_referral`, `confirm_referral`, `confirm_referral_by_short_code`, `make_patient_token`), `mis_client` (`find_patient_by_phone`, `add_patient`, `_post`), `mis_resolver.resolve_mis_creds`, `webhook_service.send_event`, `enforce_region_lock`. Модели `Referral`/`ReferralStatus`, `ReferralComment`, `Clinic`, `Service`, `Bonus`/`BonusType`, `Doctor`, `Tenant`, `ActivityLog`. Схемы из `app.schemas.referral`. Доп. печать/поиск — в `reg_speed.py` (тот же prefix).
- **Где менять для типовых задач:** валидация типов направления (service/doctor/lab) — строки 221–227; обогащение ответа (новое поле в `ReferralResponse`) — `_enrich_referral` (строки 450–536); генерация patient_url для WhatsApp — блок `_pu` (строки 482–504); SLA-дедлайн — строки 477–480.
- **Подводные камни:** `_enrich_referral` вызывается **для каждого** элемента списка (N+1 запросов в `/`, `/incoming`) — на больших объёмах дорого. Tenant-изоляция в `get_referral`/`comments` допускает `tenant_id == None` (платформенные направления). `confirm-by-code` защищён rate-limiter'ом из-за брутфорса 5-значного кода (пространство 90000). МИС-credentials резолвятся по клинике→тенанту (`resolve_mis_creds`), а не из глобального `.env` — иначе пациенты других клиник не находились. Бонус берётся только `BonusType.REGULAR`. `webhook_service.send_event` вызывается ДО `db.commit()`.
- **Строк:** 537

## `backend/app/routers/reg_speed.py`
- **Назначение:** Премиум-фичи регистратора (Глава 5): PDF-печать направления (A5, кириллица DejaVu, QR через WeasyPrint), быстрый поиск уникальных пациентов по своим направлениям и быстрая проверка/создание карточки пациента (с согласием 152-ФЗ).
- **Ключевые элементы:** хелперы `_esc`/`_fmt_date`/`_fmt_datetime`/`_normalize_phone`, `_get_user_clinic`, `_build_referral_html` (большой HTML-шаблон), `_html_to_pdf` (WeasyPrint, ленивый импорт), `_can_access_referral` (RBAC доступа к направлению). Router prefix `/referrals`, tag `referrals-print` — **тот же prefix, что у основного `referrals.py`** (доклеивается отдельным `include` в main.py, строка 1640).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/referrals/{referral_id}/print` | auth + `_can_access_referral` | query inline | PDF (application/pdf) | Печатная форма A5 |
| GET | `/referrals/patients/search` | auth | query q/phone/limit | `{patients}` | Поиск пациентов (дедуп по телефону) |
| POST | `/referrals/patients/quick-create` | auth | `{full_name, phone, consent…}` | duplicate-инфо или «можно создавать» | Быстрая проверка дубля пациента |

- **Зависимости:** модели `Referral`/`ReferralStatus`, `Clinic`, `Service`, `Doctor`; `get_current_user`; WeasyPrint (`weasyprint.HTML`) и `qrcode` — ленивые импорты внутри функций.
- **Где менять для типовых задач:** вёрстка печатной формы — `_build_referral_html` (строки 80–289, CSS встроен); права на печать — `_can_access_referral` (строки 304–322); логика дедупликации в поиске — строки 400–415 (ключ = телефон в нижнем регистре).
- **Подводные камни:** маршрут `patients/search` и `patients/quick-create` должны быть зарегистрированы **до** `/{referral_id}` основного роутера, иначе FastAPI может перехватить `patients` как `referral_id` — порядок include в main.py важен (reg_speed подключается строкой 1640, перед `referrals.router` на 1641 — это спасает). `quick-create` НЕ создаёт сам `Referral`, только проверяет дубликат; реальное создание идёт через основной POST `/referrals/`. WeasyPrint требует шрифт DejaVu в контейнере. `_can_access_referral` сравнивает `user.role` со строками (`"manager"` и т.п.) — если role это Enum, сравнение может не сработать (см. `getattr`/`.value` в других файлах).
- **Строк:** 475

## `backend/app/routers/regulations.py`
- **Назначение:** Публичная (для сотрудников) половина «Регламент-конструктора» (Глава 7): список доступных регламентов, детали с опубликованной версией, е-подпись («прочитал и подтверждаю»). Админская часть — в `admin_regulations.py`.
- **Ключевые элементы:** схема `CompleteBody` (signature_text, checkboxes_state). Хелперы `_get_regulation_or_404`, `_get_version_or_none`. Router prefix `/regulations`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/regulations/my-assigned` | auth (не patient) | — | список регламентов | Доступные пользователю |
| GET | `/regulations/{regulation_id}` | auth (не patient) | path | детали + версия + my_completion | Детали + статус подписи |
| POST | `/regulations/{regulation_id}/complete` | auth (не patient) | `CompleteBody` | completion | Е-подпись версии |

- **Зависимости:** `regulation_service` (`can_read_regulations`, `is_super_admin`, `list_assigned_for_user`, `regulation_to_dict`, `user_has_access_to_regulation`, `version_to_dict`, `completion_to_dict`); модели `Regulation`/`RegulationVersion`/`RegulationCompletion`/`RegulationStatus`; `get_current_user`.
- **Где менять для типовых задач:** правила доступа — `can_read_regulations`/`user_has_access_to_regulation` (в сервисе, не в роутере); проверка обязательных чекбоксов при подписи — строки 167–178; формат ответа детали — `regulation_to_dict` (сервис).
- **Подводные камни:** подпись **идемпотентна** — повторная подпись той же версии возвращает существующую запись (строки 154–164), не дублирует. Подписать можно только `RegulationStatus.PUBLISHED` с непустым `current_version_id`. Обязательные чекбоксы валидируются по `step{order}` в `checkboxes_state`. Пациентам всё запрещено (403). `signature_text` обрезается до 200 символов, дефолт — `full_name`.
- **Строк:** 192

## `backend/app/routers/reviews.py`
- **Назначение:** Отзывы пациентов о врачах. Публичная часть — оставить отзыв и получить рейтинг врача; защищённая — модерация (approve/reject/delete) для manager/supervisor. Это «plugin»-роутер (есть отдельный `ReviewsPlugin` в main.py).
- **Ключевые элементы:** схема `ReviewCreate`, сериализатор `_out(r)`, зависимость `_mgr = Depends(require_manager)`. Router prefix `/reviews`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/reviews` | публичный | `ReviewCreate` | review (PENDING) | Оставить отзыв |
| GET | `/reviews/doctor/{doctor_id}` | публичный | path | avg+total+last 10 | Рейтинг врача (approved) |
| GET | `/reviews/moderate` | manager | query status/doctor_id/limit/offset | `{total, items}` | Список на модерацию |
| PATCH | `/reviews/{review_id}/approve` | manager | path | review | Одобрить |
| PATCH | `/reviews/{review_id}/reject` | manager | path | review | Отклонить |
| DELETE | `/reviews/{review_id}` | manager | path | 204 | Удалить отзыв |

- **Зависимости:** модели `Review`/`ReviewStatus`, `Doctor` (ленивый импорт для вывода tenant_id); `require_manager`.
- **Где менять для типовых задач:** поля отзыва — `ReviewCreate` (строки 31–40) + `_out` (строки 43–57); защита от подделки тенанта — отзыв всегда получает `tenant_id` из `doctor.tenant_id`, а не из тела (строки 72–77); защита от дублей — проверка по `appointment_id` (строки 65–70).
- **Подводные камни:** `body.tenant_id` из запроса **игнорируется** намеренно (клиент мог бы подделать тенант) — берётся из врача. `is_anonymous` скрывает имя/телефон в `_out`. Новый отзыв всегда `PENDING` (не показывается публично до approve). Tenant-изоляция в модерации/approve/reject/delete: `r.tenant_id != current_user.tenant_id` → 404.
- **Строк:** 194

## `backend/app/routers/scheduling.py`
- **Назначение:** Расписание врачей и записи на приём. CRUD врачей, загрузка/отдача фото, шаблон расписания по дням, свободные слоты, создание/перенос/отмена записей, недельная сетка с обогащением (заключения/направления), статистика. Требует feature `scheduling` (план enterprise).
- **Ключевые элементы:** схемы `DoctorCreate`/`DoctorUpdate`/`DoctorOut`, `ScheduleDayIn`, `AppointmentCreate`/`AppointmentStatusUpdate`/`AppointmentOut`/`AppointmentMove`. Зависимость `_FEAT = [Depends(require_feature("scheduling"))]`. Хелперы фото `_find_existing_photo`, константы `DOCTOR_PHOTO_DIR`, `_ALLOWED_PHOTO_TYPES`, `_MAX_PHOTO_SIZE`. Router без prefix.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/doctors` | auth + feat | query clinic_id | список врачей | Врачи тенанта (franchise_owner — всех своих) |
| GET | `/doctors/{doctor_id}` | auth + feat | path | `DoctorOut` | Один врач |
| POST | `/doctors` | manager + feat | `DoctorCreate` | `DoctorOut` | Создать врача |
| PATCH | `/doctors/{doctor_id}` | manager + feat | `DoctorUpdate` | `DoctorOut` | Обновить врача |
| POST | `/doctors/{doctor_id}/photo` | manager + feat | multipart file | `{photo_url}` | Загрузить фото (≤5МБ) |
| DELETE | `/doctors/{doctor_id}/photo` | manager + feat | — | `{ok}` | Удалить фото |
| GET | `/uploads/doctors/{filename}` | публичный | path | файл | Отдача фото |
| GET | `/doctors/{doctor_id}/schedule` | auth + feat | path | 7 дней | Шаблон расписания |
| PUT | `/doctors/{doctor_id}/schedule` | manager + feat | `list[ScheduleDayIn]` | `{status:ok}` | Заменить расписание |
| GET | `/doctors/{doctor_id}/slots` | auth + feat | query target_date | слоты | Слоты на дату |
| POST | `/appointments` | auth + feat | `AppointmentCreate` | запись + скидка | Записать пациента |
| GET | `/appointments` | auth + feat | query фильтры | список записей | Список записей |
| PATCH | `/appointments/{id}/status` | auth + feat | `AppointmentStatusUpdate` | `{id, status}` | Сменить статус (+inventory hook) |
| PATCH | `/appointments/{id}` | auth + feat | `AppointmentMove` | запись | Перенос/редактирование |
| DELETE | `/appointments/{id}` | manager + feat | — | `{deleted}` | Мягкая отмена + аудит |
| GET | `/doctors/{doctor_id}/week` | auth + feat | query start_date | недельная сетка | Неделя с занятостью |
| GET | `/my-doctor` | auth (без feat!) | — | Doctor текущего юзера | Профиль врача по user_id |
| GET | `/appointments/stats` | auth + feat | query days | статистика | По статусам и врачам |

- **Зависимости:** `scheduling_service` (`get_available_slots`, `book_slot`), `subscription_service as ss` (`compute_discount_for`, `get_active_subscription_by_phone`, `benefits_for_db`), `appointment_costing` (`on_appointment_completed`/`on_appointment_uncomplete`), `audit_service.write`, `require_feature`, `require_manager`. Модели `Doctor`/`DoctorSchedule`/`Appointment`/`AppointmentStatus`, `Clinic`, `Tenant`, `AppointmentOutcome`/`InternalReferral`.
- **Где менять для типовых задач:** новое поле врача — `DoctorCreate`/`DoctorUpdate`/`DoctorOut` (строки 33–75); конфликт слотов при переносе — `move_appointment` (строки 549–611); inventory-хук при смене статуса — строки 497–511; скидка по подписке при записи — строки 393–417; обогащение недельной сетки чипами — строки 728–746.
- **Подводные камни:** `/my-doctor` **намеренно без** `_FEAT` (врач должен видеть свой профиль даже без модуля). Хуки себестоимости и аудита обёрнуты в `try/except` (best-effort, не валят запрос). `delete_appointment` — мягкое (status=cancelled), жёсткого нет из-за FK на заключения/бонусы. `franchise_owner` видит врачей/слоты всех подчинённых тенантов (отдельные ветки в `list_doctors`/`get_slots`). Фото — путь `/app/uploads/doctors`, защита от path-traversal в `serve_doctor_photo`. Decimal→float везде на выходе (price, discount). Самый большой файл группы.
- **Строк:** 896

## `backend/app/routers/search.py`
- **Назначение:** Глобальный поиск для CommandPalette (Cmd+K) — короткие сводки по 4 коллекциям (пациенты, врачи, направления, услуги), макс 5 каждая.
- **Ключевые элементы:** `_norm_phone` (только цифры), единственный эндпоинт `global_search`. Router без prefix.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/search` | `require_manager` | query q (1–80) | `{patients, doctors, referrals, services}` | Универсальный поиск Cmd+K |

- **Зависимости:** модели `User`/`UserRole`, `Referral`, `Service`; `require_manager`.
- **Где менять для типовых задач:** добавить коллекцию в поиск — отдельный блок по аналогии с «Услуги» (строки 121–135) + ключ в финальном dict (137–142); изменить лимит выдачи — `.limit(5)` в каждом блоке; поиск по телефону — `_norm_phone` + `like(f"%{q_phone}%")`.
- **Подводные камни:** пациенты/врачи здесь — это `User` с соответствующей ролью (не `Doctor`/`PatientAccount`), врачи включают `PARTNER_DOCTOR`/`VISITING_DOCTOR`/`LAB_CT`/`LAB_XRAY`. Tenant-изоляция везде, где есть `tenant_id` (у `User`, `Referral`, `Service`). `short_code` ищется только если `q` целиком цифры ≤9 знаков. Услуги подгружаются батчем для направлений (`svc_map`), без N+1.
- **Строк:** 143

## `backend/app/routers/security.py`
- **Назначение:** Журнал безопасности для super_admin: paginated audit-лента с фильтрами, сводка за 24ч, heatmap атак по часам×дням, управление ручными блокировками IP. Префикс `/admin/security`.
- **Ключевые элементы:** схемы `BlockIpRequest` (с валидатором IP через `ipaddress`), `UnblockIpRequest`. Сериализаторы `_audit_out`, `_blocked_out`. Все эндпоинты под `require_super_admin`. Router prefix `/admin/security`, tags `super-admin`/`security`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/admin/security/audit` | super_admin | query since/until/action/actor/entity/tenant/search/page | `{total, items}` | Paginated журнал (все тенанты) |
| GET | `/admin/security/summary` | super_admin | — | сводка | События за 24ч |
| GET | `/admin/security/heatmap` | super_admin | query days≤30 | `{grid 7×24}` | Heatmap атак час×день |
| GET | `/admin/security/blocked-ips` | super_admin | query include_inactive | `{total, items}` | Список блокировок |
| POST | `/admin/security/block-ip` | super_admin | `BlockIpRequest` | `{ok, id, blocked_until}` | Заблокировать IP |
| POST | `/admin/security/unblock-ip` | super_admin | `UnblockIpRequest` | `{ok, deactivated}` | Снять блокировку (soft) |

- **Зависимости:** `audit_service` (`write_safe`, `AuditAction`), `security_service.get_summary`, `require_super_admin`; модели `AuditEntry`, `BlockedIp`, `Tenant`, `User`.
- **Где менять для типовых задач:** новые фильтры журнала — `list_audit` (строки 116–199); список «атакующих» действий для heatmap — `attack_actions` (строки 229–236); инвалидация кеша middleware блокировок — `block_ip` (строки 357–363, через `request.app.state.block_ip_mw`).
- **Подводные камни:** блокировка/разблокировка инвалидирует кеш middleware: `block_ip` использует **правильный** путь через `app.state.block_ip_mw.invalidate()`, а `unblock_ip` всё ещё пытается импортировать `from app.main import block_ip_middleware` (строки 400–404) — **рассинхрон**, потенциально устаревший способ (см. комментарий на строке 1528 main.py о новом подходе). `ttl_hours=0` = бессрочно. unblock — soft (`is_active=False`, запись остаётся). Postgres `dow` нормализуется к 0=понедельник (строка 257). Heatmap-запрос использует `func.extract` — Postgres-специфично.
- **Строк:** 407

## `backend/app/routers/service_norms.py`
- **Назначение:** Этапы 2–3 INVENTORY_COST_PLAN: нормативы расходников на услугу (CRUD + копирование) и расчёт себестоимости приёма (read-only для директора + ручной пересчёт для менеджера).
- **Ключевые элементы:** схемы `ConsumableIn`/`ConsumableOut` (с `Decimal` quantity), `NormsBulkIn`. Хелперы `_get_service_or_404`, `_norms_to_out` (batch-подгрузка имён items). Router без prefix.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/services/{service_id}/consumables` | auth | path | `list[ConsumableOut]` | Норматив услуги |
| POST | `/services/{service_id}/consumables` | manager | `ConsumableIn` | `ConsumableOut` | Добавить позицию |
| PUT | `/services/{service_id}/consumables` | manager | `NormsBulkIn` | `list[ConsumableOut]` | Массовая замена норматива |
| DELETE | `/services/{service_id}/consumables/{item_id}` | manager | path | `{ok}` | Удалить позицию |
| POST | `/inventory/norms/copy` | manager | query from/to_service_id | `{copied, skipped}` | Копировать нормативы |
| GET | `/appointments/{id}/cost` | director/owner/manager | path | себестоимость+детализация | Читать стоимость приёма |
| POST | `/appointments/{id}/cost/recalculate` | manager | path | пересчитанная стоимость | Ручной пересчёт |

- **Зависимости:** `appointment_costing` (`calculate_appointment_cost`, `cost_breakdown`); модели `AppointmentCost`/`InventoryItem`/`ServiceConsumable`, `Service`, `Appointment`, `User`; deps `get_current_user`/`require_manager`/`require_director_or_owner`.
- **Где менять для типовых задач:** валидация принадлежности item тенанту — `add_consumable`/`bulk_replace` (строки 164–173, 223–235); логика копирования без дублей — `copy_norms` (строки 334–351); права на чтение себестоимости — проверка роли в `get_appointment_cost` (строки 377–388).
- **Подводные камни:** `quantity` — **`Decimal`**, не float; на выходе recalculate приводится к `float`. Tenant-изоляция учитывает, что `Service.tenant_id` может быть `NULL` (платформенные услуги) — `_get_service_or_404` пропускает такие. Дубликат `(service, item)` пресекается 409. `bulk_replace` удаляет всё старое и создаёт новое в одной транзакции. `import require_director_or_owner` подключён, но в `get_appointment_cost` доступ проверяется вручную по `role.value` (строки 377–388), а не зависимостью — потенциальная путаница.
- **Строк:** 424

## `backend/app/routers/slot_holds.py`
- **Назначение:** Удержание (hold) слота записи прямо из чата с пациентом: создаёт `SlotHold` с таймером и постит в тред чата интерактивное сообщение-вложение; отдельный эндпоинт для снятия удержания.
- **Ключевые элементы:** схема `HoldIn` (doctor_id, date, start_time, hold_minutes 5–120). Router prefix `/clinic/chat`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/clinic/chat/threads/{thread_id}/hold-slot` | auth | `HoldIn` | `{ok, hold_id, expires_at}` | Удержать слот + сообщение в чат |
| POST | `/clinic/chat/holds/{hold_id}/release` | auth | path | `{ok}` | Снять удержание |

- **Зависимости:** модели `SlotHold`, `ChatThread`/`ChatMessage`, `PatientAccount` (ленивый импорт); `get_current_user`.
- **Где менять для типовых задач:** расчёт `end_time` (сейчас жёстко +30 минут) — строка 37; текст/структура сообщения-вложения в чат — строки 47–63 (`attachments[0].data`); дефолтный/диапазон времени удержания — `HoldIn.hold_minutes` (строка 20).
- **Подводные камни:** `end_time` считается **захардкоженным +30 минут** (строка 37) независимо от `slot_duration` врача — баг/упрощение, расходится со `scheduling.py`, где end_time = start + doctor.slot_duration. `release_hold` идемпотентен (повторный вызов — `already_released`). Телефон/имя пациента подтягиваются из `PatientAccount` треда; если `patient_id` пуст — пустая строка. Нет проверки, что слот реально свободен (конфликт не валидируется здесь). Самый короткий файл группы.
- **Строк:** 79

## `backend/app/routers/sms_marketing.py`
- **Назначение:** SMS-маркетинг: CRUD шаблонов, кампании (draft → preview → launch → cancel), лог отправок. Тенант-изолировано, требует подписки на модуль `sms_marketing`. Реальная отправка — через scheduler-job (здесь стаб `provider='internal'`).
- **Ключевые элементы:** схемы `SmsTemplateIn`/`Patch`/`Out`, `SmsCampaignIn`/`Out`/`PreviewOut`, `SmsMessageLogOut`. Хелперы `_tenant_id` (или 400), `_estimate_audience_size` (стаб-оценка аудитории). Router prefix `/sms`. Все эндпоинты с `dependencies=[Depends(require_module("sms_marketing"))]`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/sms/templates` | manager + module | query limit/offset/only_active | `list[SmsTemplateOut]` | Список шаблонов |
| POST | `/sms/templates` | manager + module | `SmsTemplateIn` | `SmsTemplateOut` | Создать шаблон |
| PATCH | `/sms/templates/{id}` | manager + module | `SmsTemplatePatch` | `SmsTemplateOut` | Обновить шаблон |
| DELETE | `/sms/templates/{id}` | manager + module | — | 204 | Soft delete |
| GET | `/sms/campaigns` | manager + module | query status/limit/offset | `list[SmsCampaignOut]` | Список кампаний |
| POST | `/sms/campaigns` | manager + module | `SmsCampaignIn` | `SmsCampaignOut` | Создать draft |
| POST | `/sms/campaigns/{id}/preview` | manager + module | — | `{total_recipients}` | Посчитать аудиторию |
| POST | `/sms/campaigns/{id}/launch` | manager + module | — | `SmsCampaignOut` | Запустить (scheduled/sending) |
| POST | `/sms/campaigns/{id}/cancel` | manager + module | — | `SmsCampaignOut` | Отменить |
| GET | `/sms/campaigns/{id}/messages` | manager + module | query status/limit/offset | `list[SmsMessageLogOut]` | Лог отправок |

- **Зависимости:** модели `SmsTemplate`/`SmsCampaign`/`SmsMessageLog` + энумы `SmsAudienceType`/`SmsCampaignStatus`/`SmsMessageStatus`, `Tenant`, `User`, `Appointment` (для оценки аудитории); deps `require_manager`, `get_current_tenant`, `require_module`. Сам диспетчер кампаний — воркер `sms_campaign_dispatch` в main.py (строка 1155).
- **Где менять для типовых задач:** реальный сегментатор аудитории — `_estimate_audience_size` (строки 147–195, сейчас стаб: для большинства типов одинаковый distinct phone из appointments); переходы статусов кампании — `launch`/`cancel` (строки 441–489); состав лога отправки — `SmsMessageLogOut` (строки 117–131).
- **Подводные камни:** `_estimate_audience_size` — **заглушка**: SLEEPING_30D/90D/SPECIFIC_SEGMENT/ALL_PATIENTS возвращают одно и то же (distinct phone тенанта), реальная сегментация будет с модулем `ltv_pro`. Soft delete шаблона (`is_active=False`), т.к. на него ссылаются кампании. Запуск возможен только из draft/scheduled. Отправка не выполняется в роутере — только смена статуса на `sending`, воркер обрабатывает. `_tenant_id(None)` → 400 (SMS только в tenant-режиме).
- **Строк:** 530

## `backend/app/routers/staff_chat.py`
- **Назначение:** Полноценный чат сотрудник↔сотрудник (Slack-подобный): каналы/группы/DM, сообщения с reply, реакции, pin, mentions, read receipts, опросы, файлы (50МБ/TTL 48ч), WebSocket для real-time и presence, плюс bot-эндпоинт для CI/мониторинга. Самый объёмный файл группы.
- **Ключевые элементы:** исключения `GroupJoinForbidden`/`LastAdminError`/`PinLimitError`; pure-logic хелперы `_create_channel_logic`/`_join_channel_logic`/`_leave_channel_logic`/`_toggle_reaction_logic`/`_toggle_pin_logic` (вынесены для unit-тестов); `_ensure_not_patient`; класс `WsHub` (in-memory WebSocket hub) и singleton `ws_hub`; `_authenticate_ws`. Множество Pydantic-схем. Основной router prefix `/staff-chat`; отдельный `_bot_router` с prefix `/api/staff-chat` (защита shared-secret). Константы: `MAX_FILE_SIZE`, `FILE_TTL_HOURS`, `STORAGE_ROOT`.
- **Эндпоинты (основной router `/staff-chat`):**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/staff-chat/channels` | auth (не patient) | `CreateChannelIn` | комната | Создать канал/группу |
| GET | `/staff-chat/channels/public` | auth | query q | `{channels}` | Публичные каналы франшизы |
| POST | `/staff-chat/channels/{room_id}/join` | auth | — | `{ok}` | Вступить в открытый канал |
| POST | `/staff-chat/channels/{room_id}/invite` | admin канала | `InviteIn` | `{added}` | Пригласить участников |
| POST | `/staff-chat/channels/{room_id}/leave` | auth | — | 204 | Выйти (не последний admin) |
| PATCH | `/staff-chat/channels/{room_id}` | admin канала | `PatchChannelIn` | комната | Редактировать канал |
| DELETE | `/staff-chat/channels/{room_id}` | admin/manager+ | — | 204 | Удалить канал (каскад) |
| POST | `/staff-chat/messages/{message_id}/reactions` | member | `ReactionIn` | `{action}` | Toggle реакции |
| POST | `/staff-chat/messages/{message_id}/pin` | admin/manager+ | — | `{action}` | Toggle pin (лимит 20) |
| GET | `/staff-chat/mentions/unread` | auth | — | `{rooms}` | Непрочитанные упоминания |
| GET | `/staff-chat/rooms/{room_id}/pinned` | member | — | `{messages}` | Закреплённые сообщения |
| GET | `/staff-chat/me` | auth | — | brief юзера | Я (для UI) |
| GET | `/staff-chat/contacts` | auth | — | `{groups}` | Доступные собеседники (RBAC, сгруппированы) |
| GET | `/staff-chat/rooms` | auth | query include_cross | `{rooms}` | Мои комнаты |
| POST | `/staff-chat/rooms/direct` | auth | `DirectRoomCreate` | комната | Создать/получить DM |
| GET | `/staff-chat/rooms/{room_id}` | member | — | комната + участники | Детали комнаты |
| GET | `/staff-chat/rooms/{room_id}/messages` | member | query before/limit | `{messages}` | Сообщения (пагинация) |
| POST | `/staff-chat/rooms/{room_id}/messages` | member | `MessageCreate` | сообщение | Отправить (+mentions +WS +TG) |
| POST | `/staff-chat/rooms/{room_id}/read` | member | — | 204 | Отметить прочитанным |
| POST | `/staff-chat/rooms/{room_id}/mark-read` | member | `MarkReadRequest` | `{marked}` | Массовые read receipts |
| POST | `/staff-chat/rooms/{room_id}/mute` | member | `MuteRequest` | 204 | Mute/unmute |
| DELETE | `/staff-chat/messages/{message_id}` | автор | — | 204 | Soft-delete своего |
| WS | `/staff-chat/ws` | JWT в query token | — | поток событий | Real-time + presence |
| GET | `/staff-chat/presence` | auth | — | `{online}` | Кто онлайн |
| POST | `/staff-chat/rooms/{room_id}/files` | member | multipart | мета файла | Загрузить вложение |
| GET | `/staff-chat/files/{file_id}/download` | member | — | файл | Скачать вложение |
| GET | `/staff-chat/files/policy` | публичный | — | лимиты/TTL | Политика файлов |
| GET | `/staff-chat/search` | auth | query q/limit | `{results}` | Поиск по сообщениям |
| POST | `/staff-chat/polls` | member | `CreatePollIn` | poll | Создать опрос |
| POST | `/staff-chat/polls/{poll_id}/vote` | member | `VotePollIn` | poll | Голосовать (toggle) |
| POST | `/api/staff-chat/bot/post` | shared secret | `BotPostIn` | сообщение | Постинг от CI/бота |

- **Зависимости:** `staff_chat_service as svc` (десятки функций: `visible_users_for`, `user_room_ids`, `get_or_create_direct_room`, `send_message`, `mark_read`/`mark_messages_read`, `serialize_*`, `load_reactions/reads_for_messages`, `count_unread`, `create_poll_logic`, `toggle_poll_vote_logic`, `search_messages_logic`, `_user_franchise_id` …); `staff_chat_mentions` (`parse_mention_strings`, `resolve_mentions`, `notify_mentions`); `alert_service` (`send_to_owner_to`, `send_document_to_owner_to`); модели `StaffChatRoom`/`Member`/`Message`/`File`/`Reaction`/`Poll`, `User`/`UserRole`, `Tenant`, `Clinic`; `decode_token`, `AsyncSessionLocal`. Связан с `staff_chat_cross.py` (cross-tenant комнаты) и cleanup-job в main.py.
- **Где менять для типовых задач:** RBAC видимости собеседников — `svc.visible_users_for` (в сервисе) + группировка в `list_contacts` (строки 545–654); лимит pin — `_toggle_pin_logic` (строка 429, `>= 20`); лимит/TTL файлов — константы строки 46–48; Telegram-нотификация владельцу при новом сообщении — большой блок в `post_room_message` (строки 874–982); WebSocket-события — класс `WsHub` (строки 1098–1151) и `ws_endpoint` (строки 1174–1246).
- **Подводные камни:** `WsHub` — **in-memory**, без Redis pub-sub: работает только на single-instance, для масштабирования нужен внешний pub-sub (комментарий строки 1102). WebSocket аутентифицируется по `token` в query (Depends в WS не работает) — `_authenticate_ws`. `post_room_message` делает много всего: mentions-резолв, WS-broadcast, TG-нотификации владельцу (fire-and-forget через `asyncio.create_task`) — всё в try/except, чтобы не ломать отправку; OWNER_TELEGRAM_ID всегда получает копию (дедуп по telegram_id). Bot-эндпоинт постит с `sender_id=NULL` (system), на отдельном prefix `/api/staff-chat` вне auth-цикла. `unread_mentions` итерирует по всем комнатам пользователя и грузит сообщения в цикле — потенциально дорого. Soft-delete сообщения обнуляет body/attachments. Файлы каскадно живут 48ч (cleanup-job). `mark-read` идемпотентен (UNIQUE message_id+user_id).
- **Строк:** 1526

---

Все 15 файлов задокументированы. При изменениях помните общий принцип группы: префикс ищите внутри `APIRouter(prefix=...)` самого файла (main.py монтирует без override), а tenant-изоляцию и Decimal→float проверяйте на каждом новом поле.
