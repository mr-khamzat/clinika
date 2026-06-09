# models [05] — User, видимость тенантов и периферийные справочники

Это срез из 5 SQLAlchemy-ORM-моделей (наследники `app.database.Base`). В нём соседствуют разнородные сущности, но объединяет их одно: все они описывают **таблицы БД**, а не бизнес-логику и не HTTP. Здесь нет ни одного роутера/эндпоинта — только декларативные модели (`__tablename__`, колонки `Mapped[...]`, FK, индексы, relationships). Центральная и самая «тяжёлая» из них — `User` (таблица `users`), вокруг которой завязана почти вся система: роли, франшизы, клиники, рекрутеры, внешние врачи, шифрование PII. Остальные четыре — узкоспециализированные: матрица видимости тенантов друг для друга (StaffChat/Calls), исходящие вебхуки, wellness-партнёрки и внутренняя вики.

Общие соглашения по всем файлам:
- PK — `UUID(as_uuid=True)` с `default=uuid.uuid4` (генерация на стороне Python, не БД).
- Временные метки — `datetime.utcnow` (наивный UTC; в `wellness`/`wiki` используется `DateTime(timezone=True)`, в остальных — наивный `DateTime`).
- Все FK на «родителей» имеют `ondelete` (`CASCADE` / `SET NULL`) — важно при удалении тенантов/страниц.
- Изоляция арендаторов: `tenant_id` присутствует в `User`, `WebhookEndpoint`, `WebhookDelivery`. В `tenant_visibility`, `wellness`, `wiki` прямого `tenant_id` нет (это глобальные/межтенантные справочники) — фильтрацию нужно делать на уровне сервиса, см. подводные камни.

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `backend/app/models/tenant_visibility.py` | Матрица видимости тенантов в чате/звонках | 38 |
| `backend/app/models/user.py` | Центральная модель пользователя, роли, PII | 118 |
| `backend/app/models/webhook.py` | Исходящие вебхуки и лог доставки | 52 |
| `backend/app/models/wellness.py` | Wellness-партнёрки и клики пациентов | 53 |
| `backend/app/models/wiki.py` | Внутренняя вики: страницы и картинки | 41 |

---

## `backend/app/models/user.py`

- **Назначение:** Центральная модель сотрудника/пациента системы (`users`) и перечисление ролей `UserRole`. Хранит учётные данные, роль, привязки к тенанту/клинике/франшизе, реферальные и «внешний врач»-поля, согласие по 152-ФЗ, аватар, флаг принудительной смены пароля. Это самая импортируемая модель проекта.
- **Ключевые элементы:**
  - `class UserRole(str, enum.Enum)` — 17 значений: `super_admin`, `franchise_owner`, `manager`, `doctor`, `reg`, `nurse`, `recruiter`, `partner_doctor`, `visiting_doctor`, `acquisition_manager`, `patient`, `director`, `deputy_director`, `accountant`, `lab_ct`, `lab_xray`. Наследует `str` → значение enum сериализуется как строка.
  - `class User(Base)` — таблица `users`.
  - Колонки-группы: идентичность (`telegram_id`, `username`, `password_hash`, `full_name`, `phone_number`, `email`); привязки (`tenant_id`→tenants `SET NULL`, `clinic_id`→clinics, `franchise_id`→franchises `SET NULL`); рекрутинг (`recruiter_id`→users `SET NULL`, `bonus_percent` Numeric(5,2), `manager_id`→users `SET NULL`); внешние врачи (`doctor_type`, `external_doctor_inn`, `external_doctor_rate` JSONB, `external_doctor_active`); 152-ФЗ (`consent_given`/`consent_given_at`/`consent_version`); прочее (`category`, `date_of_birth`, `specialization`, `avatar_url`, `is_active`, `is_suspended`, `password_must_change`).
  - **Шифруемое PII:** колонка `address_encrypted` (Text). Доступ — через property `address` (геттер `decrypt`, сеттер `encrypt`). `__init__` перехватывает kwarg `address` и шифрует его в `address_encrypted` до вызова `super().__init__`.
  - Relationships: `clinic` (back_populates `users`), `referrals_created` (Referral по `created_by_admin_id`), `bonuses` (Bonus), `recruiter` (само-ссылка по `recruiter_id`), `doctor_clinic_access` (DoctorClinicAccess по `doctor_id`).
- **Эндпоинты:** нет (модель).
- **Зависимости:**
  - `app.database.Base`, SQLAlchemy, `JSONB`/`UUID` из диалекта postgresql.
  - **Lazy-импорт** `app.services.encryption_service.encrypt`/`decrypt` (внутри `__init__`, геттера и сеттера — чтобы избежать циклического импорта). `encrypt` возвращает строку с префиксом `enc:` (Fernet) либо `plain:` (fallback без ключа).
  - Строковые ссылки на модели `Clinic`, `Referral`, `Bonus`, `DoctorClinicAccess` (резолвятся реестром SQLAlchemy при старте).
  - Обратная сторона: модель импортируют десятки сервисов и роутеров (`bonus_service`, `referral_service`, `staff_chat_service`, `permission_override`, `regulation_service`, tg-боты и др.) — менять колонки нужно с оглядкой на них.
- **Где менять для типовых задач:**
  - Новая роль → добавить значение в `UserRole` (значение = строка в БД). ВАЖНО: `SAEnum(..., create_type=False)` → тип enum в Postgres НЕ создаётся автоматически, нужна миграция `ALTER TYPE ... ADD VALUE`.
  - Новое поле сотрудника → добавить колонку + Alembic-миграцию (именование миграций в проекте — короткие коды вида `director01`, `avatar01`, `pwdmust01`).
  - Новое шифруемое PII → завести колонку `<name>_encrypted` + property по образцу `address` + расширить список пар в `__init__`.
  - Изменить дефолтную роль при создании → `role=mapped_column(..., default=UserRole.REG)`.
- **Подводные камни:**
  - `tenant_id` **nullable** (`SET NULL`) — пользователь может быть без тенанта (например, `super_admin`); сервисная фильтрация по тенанту должна это учитывать.
  - `password_must_change` (server_default `false`): сбрасывается в FALSE только в `/profile/me` и `/password_reset`; все admin-side создание/сброс пароля обязаны выставлять TRUE. Фронт показывает блокирующую модалку `ForcePasswordChangeModal`.
  - `bonus_percent` — `Numeric(5,2)` → в Python это `Decimal`. Нельзя смешивать с `float` в расчётах бонусов (известный класс багов проекта).
  - `external_doctor_rate` — JSONB; Decimal в JSONB не сериализуется штатно (нужно приводить к float/str перед записью).
  - Property `address` дешифрует при каждом доступе (вызов Fernet) — не дёргать в горячих циклах.
  - Само-ссылочный FK `recruiter_id`/`manager_id` на `users` — осторожно с каскадами и циклами при выборках.
- **Строк:** 118

---

## `backend/app/models/tenant_visibility.py`

- **Назначение:** Асимметричная матрица видимости между тенантами внутри франшизы. Одна запись `(viewer_tenant_id, target_tenant_id)` задаёт, видит ли тенант-наблюдатель сотрудников целевого тенанта в StaffChat (`allow_chat`) и в Calls (`allow_calls`). Если записи для пары нет — действует дефолт «видны все» (`allow_chat=True`, `allow_calls=True`).
- **Ключевые элементы:**
  - `class TenantVisibility(Base)` — таблица `tenant_visibility`.
  - Уникальное ограничение `uq_tenant_visibility_pair` на пару `(viewer_tenant_id, target_tenant_id)` — не больше одной записи на направление.
  - Колонки: `viewer_tenant_id` (FK tenants `CASCADE`, index), `target_tenant_id` (FK tenants `CASCADE`), `allow_chat` (Bool, default True), `allow_calls` (Bool, default True), `created_at`, `updated_at` (с `onupdate`).
- **Эндпоинты:** нет (модель).
- **Зависимости:** `app.database.Base`, SQLAlchemy (`Boolean`, `DateTime`, `ForeignKey`, `UniqueConstraint`), `UUID` postgresql. Логически связана с сервисами видимости/чата (`staff_chat_service`, `call_rules_service`) — именно они интерпретируют отсутствие записи как «разрешено».
- **Где менять для типовых задач:**
  - Новый канал видимости (например, видимость в расписании) → добавить колонку `allow_<channel>` (Bool, default True) + миграция; учесть «дефолт = разрешено» в сервисе-потребителе.
  - Логика направления (кто кого видит) задаётся семантикой `viewer`→`target`; матрица **асимметрична** — для двусторонней блокировки нужны ДВЕ записи.
- **Подводные камни:**
  - Здесь НЕТ `tenant_id`-колонки изоляции в привычном смысле — обе колонки это и есть участники пары; не путать viewer/target местами.
  - Отсутствие строки = «всё разрешено» (а не «запрещено») — потребители обязаны соблюдать этот контракт, иначе тихая регрессия видимости.
  - `updated_at` обновляется через `onupdate`, но только при изменении полей через ORM-flush (raw SQL UPDATE его не тронет).
- **Строк:** 38

---

## `backend/app/models/webhook.py`

- **Назначение:** Исходящие вебхуки. `WebhookEndpoint` — зарегистрированный тенантом URL и набор событий, на которые он подписан. `WebhookDelivery` — лог каждой попытки доставки (для отладки и retry).
- **Ключевые элементы:**
  - `class WebhookEndpoint(Base)` — таблица `webhook_endpoints`. Колонки: `tenant_id` (FK tenants `CASCADE`, index), `url`, `events` (JSONB — список событий вида `referral_created,bonus_paid,patient_registered`), `secret` (для HMAC-подписи), `is_active`, `description`, статистика `last_triggered_at`/`last_status_code`/`fail_count`, `created_at`.
  - `class WebhookDelivery(Base)` — таблица `webhook_deliveries`. Колонки: `endpoint_id` (FK webhook_endpoints `CASCADE`, index), `tenant_id` (index, БЕЗ FK), `event`, `payload` (JSONB), `status_code`, `response_body` (Text), `attempt` (default 1), `success` (default False), `delivered_at`.
- **Эндпоинты:** нет (модель).
- **Зависимости:** `app.database.Base`, SQLAlchemy, `UUID`/`JSONB` postgresql. Потребляется сервисом отправки вебхуков (диспетчер событий → HTTP POST с HMAC по `secret`).
- **Где менять для типовых задач:**
  - Новый тип события → расширять не схему, а список допустимых значений в `events` (JSONB-массив) и в сервисе-диспетчере; миграция не нужна.
  - Добавить поля ретраев/бэкоффа (например, `next_retry_at`) → колонка в `WebhookEndpoint` или `WebhookDelivery` + миграция.
  - Подпись/безопасность → поле `secret` уже есть; алгоритм HMAC реализуется в сервисе, не в модели.
- **Подводные камни:**
  - `WebhookDelivery.tenant_id` — индекс есть, но **FK отсутствует** (денормализация для скорости логирования). Целостность тенанта не гарантируется на уровне БД — заполнять корректно в коде.
  - `events` хранится как JSONB; комментарий «через запятую» в коде вводит в заблуждение — фактический тип `list` (JSON-массив), не строка с запятыми.
  - `fail_count`/`last_status_code` — статистика на endpoint; при ретраях не забыть обновлять обе модели согласованно.
- **Строк:** 52

---

## `backend/app/models/wellness.py`

- **Назначение:** Глава 10 — wellness-партнёрки. `WellnessPartner` — справочник партнёров (фитнес/спа/питание/психология/йога) со скидкой/промокодом/ссылкой и требуемым минимальным тарифом подписки. `WellnessPartnerClick` — аналитика кликов пациентов по партнёру (оценка конверсии).
- **Ключевые элементы:**
  - `class WellnessPartner(Base)` — таблица `wellness_partners`. Колонки: `name`, `category` (index; `fitness|spa|nutrition|psychology|yoga|other`), `description`, `logo_url`, `discount_text`, `promo_code`, `link_url`, `min_subscription_plan` (default `health_plus`; значения `health_plus|family_plus|pro`), `active`, `sort_order`, `created_at`.
  - `class WellnessPartnerClick(Base)` — таблица `wellness_partner_clicks`. Колонки: `partner_id` (FK wellness_partners `CASCADE`, index), `patient_id` (FK **patient_accounts** `CASCADE`, index), `clicked_at` (index).
- **Эндпоинты:** нет (модель).
- **Зависимости:** `app.database.Base`, SQLAlchemy, `UUID` postgresql. Связь с моделью `patient_accounts` (через `patient_id`), а не с `users`. `min_subscription_plan` логически связан с тарифами подписки пациента — гейтинг доступа делает сервис.
- **Где менять для типовых задач:**
  - Новая категория партнёра → это свободная строка `category` (валидация на уровне сервиса/схемы), миграция не требуется; для строгого набора стоит вынести в enum/CHECK.
  - Новый тариф-гейт → менять допустимые значения `min_subscription_plan` и логику сравнения тарифов в сервисе.
  - Доп. метрики кликов (источник, гео) → колонки в `WellnessPartnerClick` + миграция.
- **Подводные камни:**
  - Нет `tenant_id` — справочник партнёров глобальный (общий для всех тенантов). Если потребуется привязка к франшизе/тенанту, это структурное изменение.
  - `patient_id` ссылается на `patient_accounts`, НЕ на `users` — не перепутать при join.
  - `created_at`/`clicked_at` — `DateTime(timezone=True)` (aware), в отличие от наивных меток в `user`/`webhook`/`tenant_visibility`; при сравнении дат следить за tz.
- **Строк:** 53

---

## `backend/app/models/wiki.py`

- **Назначение:** Внутренняя вики. `WikiPage` — древовидные markdown-страницы (через `parent_id` на саму себя). `WikiImage` — встроенные картинки, хранимые прямо в БД как base64.
- **Ключевые элементы:**
  - `class WikiPage(Base)` — таблица `wiki_pages`. Колонки: `slug` (unique, index), `title`, `content_md` (Text, markdown), `icon` (default `article`), `parent_id` (само-ссылка FK wiki_pages `SET NULL`), `sort_order`, `is_published`, `created_at`/`updated_at` (`onupdate`), `created_by_id` (FK users `SET NULL`).
  - `class WikiImage(Base)` — таблица `wiki_images`. Колонки: `page_id` (FK wiki_pages `SET NULL`, nullable), `filename`, `mime_type` (default `image/png`), `data_b64` (Text — содержимое картинки в base64), `size_bytes`, `created_at`.
- **Эндпоинты:** нет (модель).
- **Зависимости:** `app.database.Base`, SQLAlchemy, `UUID` postgresql. FK на `users` (`created_by_id`) и само-ссылка для дерева. Потребляется сервисом/роутером вики (рендер markdown, выдача картинок).
- **Где менять для типовых задач:**
  - Иерархия/перемещение страниц → работать с `parent_id` + `sort_order`; при удалении родителя дети не удаляются (`SET NULL` → становятся корневыми).
  - Версионирование/история правок → новой таблицей `wiki_page_revisions` (в текущей схеме истории нет).
  - Внешнее хранилище картинок вместо base64 → заменить `data_b64` на `storage_url` + миграция (см. подводные камни).
- **Подводные камни:**
  - `WikiImage.data_b64` хранит бинарь картинки **в БД как base64-Text** — раздувает таблицу и бэкапы; для больших/многочисленных изображений это узкое место. Учитывать при выборках (не тянуть `data_b64` в списках).
  - Нет `tenant_id` — вики глобальная (общая для всех тенантов франшизы); если нужна пер-тенантная вики, это структурное изменение.
  - `slug` глобально уникален → коллизии между разными разделами/языками возможны; именование slug на совести сервиса.
  - `parent_id` `SET NULL` без CHECK на циклы — теоретически можно создать цикл в дереве через прямые правки; защищать в сервисе.
- **Строк:** 41
