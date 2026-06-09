# План устранения critical + high — clinika

**Проект:** clinika — мультитенантная МИС (FastAPI + React, ~263k строк, 7 кабинетов), боевой сервер 212.57.118.126.
**Дата сборки плана:** 2026-06-08.

## Вводка

- **Всего находок в этом плане:** 20 (2 critical + 18 high).
- **Перепроверка:** все 20 находок имеют статус `reproduced: confirmed` — каждая воспроизведена по реальному коду (Grep/чтение файлов), ни одна не «отвалилась» при ревизии. Раздела «не воспроизвелось» нет (см. ниже — он пуст осознанно).
- **Как пользоваться планом:**
  1. Идите по разделу **«Дорожная карта»** сверху вниз — порядок волн уже учитывает `dependsOn`, тему и blast-radius. Не начинайте находку, пока не закрыты её зависимости (иначе строгие RLS/NOT-NULL/шифрование упадут на NULL-данных или платежи уйдут не туда).
  2. Детали каждой находки — в разделе **«По темам»** (поиск по `[idx]`).
  3. Перед коммитом backend-изменений **обязательно прогоняйте конвейер на SQLite** (импорт `app.main`, weasyprint lazy) — по опыту проекта живые тесты ловят реальные баги (Decimal-в-JSONB, sum() пустого генератора, двойной учёт). Кросс-тенантные RLS-тесты гонять на **PostgreSQL** (на SQLite `with_for_update`/RLS не работают).
  4. Денежные и ПДн-фиксы выкатывать **отдельными релизами** с дымовым деплоем на стейдж; массовую замену `Depends(get_db)` — доменными волнами, не одним коммитом.

---

## 🎯 Дорожная карта (порядок устранения)

Ключевая связность зависимостей:
- **Ось ПДн/изоляции:** `7 → 2 → 1`, плюс `17` и `18` опираются на `7,1`. То есть сначала backfill NULL `tenant_id` (#7), затем целостность appointments (#2), потом системный RLS (#1), и только поверх — шифрование медданных (#17) и M2M tenant↔patient (#18).
- **Ось денег:** `9 → 10 → 5 → 16 → 11`. Сначала закрыть IDOR конфига шлюза (#9, чисто tenant-фикс), затем починить чтение секрета адаптером (#10/#5), затем верификацию webhook (#16) и сверку суммы в record_payment (#11).
- **Независимые «быстрые победы»:** #4, #6, #8, #12, #13, #14, #15, #19, #20 — без зависимостей, можно параллелить с волнами.

### Волна 0 — немедленно (безопасность/деньги/ПДн, без зависимостей или с минимальными)

Первыми, потому что закрывают активно эксплуатируемые дыры и не требуют тяжёлого backfill:

- **#6** (S) — `/tenant/create` без аутентификации при пустом `onboarding_secret` (fail-open). Любой аноним создаёт тенанта + admin. Чистая правка auth, нет зависимостей.
- **#20** (S) — реальный пароль БД захардкожен в обоих compose + `.env.example`. Утечка секрета в git-историю. Ротация + вынос в `${POSTGRES_PASSWORD}`. Нет зависимостей.
- **#19** (S) — auth-store разлогинивает не тот токен (`clinika_admin_token_*` и refresh остаются валидны). Неполный logout = угон сессии. Нет зависимостей.
- **#9** (S) — IDOR upsert конфига платёжного шлюза (нет фильтра `tenant_id`). Менеджер тенанта A перезаписывает эквайринг тенанта B. Нужен для оси денег (`10` зависит от `9`).
- **#7** (L) — системный bypass tenant-изоляции при NULL `tenant_id` + backfill NULL. **Фундамент всей оси ПДн/изоляции** — без него #1/#2/#17/#18 нельзя выкатывать в строгом режиме.

### Волна 1 — целостность данных и подготовка осей

- **#2** (XL) — appointments: NOT NULL `tenant_id` + FK ondelete + шифрование PHI (телефон/ФИО/заметки). Зависит от `7` (backfill), `1` (RLS). Делать после Волны 0 backfill, под-фиксами (сначала FK/NOT-NULL+RLS, отдельным релизом — шифрование).
- **#10** (S) — per-clinic шлюз читает несуществующий `secret_key` → платежи идут на ENV платформы. Зависит от `5,9`. Реализуется вместе с #5.
- **#5** (M) — Fernet-секреты write-only (пишутся, не читаются). Зависит от `10`. Один общий property-паттерн с #10.
- **#12** (M) — `reverse_writeoff` не идемпотентен, цикл complete↔uncomplete раздувает склад. Без зависимостей, data-integrity.
- **#15** (M) — TOCTOU в наградах лояльности (claim без блокировки). Без зависимостей, data-integrity.
- **#13** (S) — `_add_months` падает для подписок 29–31 числа. Без зависимостей, быстрый фикс.
- **#14** (S) — напоминания сравнивают МСК-слот с UTC-окном (сдвиг 3 ч). Без зависимостей.
- **#8** (M) — CVE-пакеты (multipart/Pillow/weasyprint/starlette) не подняты. Без зависимостей; рискованный апгрейд FastAPI — отдельной веткой.

### Волна 2 — системный RLS и шифрование (поверх backfill)

- **#1** (XL) — RLS включён на 3 из 126 tenant-таблиц + RLS-контекст де-факто мёртв (`set_config` не применяется). Зависит от `7,2,18`. **Только после полного backfill NULL** (иначе строгая политика спрячет исторические записи). Часть A (политики на всех таблицах) + Часть B (реальный set_config в рантайме) внедрять синхронно.
- **#17** (M) — медданные (диагнозы/аллергии/прививки/lab-результаты/виталки) в plaintext. Зависит от `7,1`. Готовый паттерн `*_encrypted`.
- **#16** (M) — `update_clinic_payment_status` доверяет webhook без сверки суммы и защиты от понижения статуса. Зависит от `10,5`.

### Волна 3 — производные фичи и завершение осей

- **#18** (L) — `PatientAccount` без `tenant_id`, межтенантная связность ПДн. Зависит от `7,1,17`. Решение через M2M `TenantPatient`.
- **#11** (M) — `record_payment` помечает счёт оплаченным при любой сумме. Зависит от `16` (общая ось сверки сумм).
- **#3** (M) — вкладка «Атрибуция маркетинга» нерабочая (нет эндпоинтов). Зависит от `7` (tenant-фильтр в новых ручках). Аддитивно.
- **#4** (S) — кабинет врача/франчайзи зовёт несуществующий `/manager/referrals/`. Без зависимостей, можно и раньше — помещено сюда как косметика на фоне приоритетных.

### Таблица дорожной карты

| # | idx | Находка | Тема | Тяжесть | Effort | Зависит от |
|---|-----|---------|------|---------|--------|------------|
| 1 | 6 | `/tenant/create` без auth при пустом secret | auth-access | high | S | — |
| 2 | 20 | Пароль БД захардкожен в compose/.env.example | auth-access | high | S | — |
| 3 | 19 | Auth-store разлогинивает не тот токен | auth-access | high | S | — |
| 4 | 9 | IDOR upsert конфига платёжного шлюза | tenant-isolation | high | S | 7 |
| 5 | 7 | Bypass tenant-изоляции при NULL tenant_id | tenant-isolation | high | L | 2, 1 |
| 6 | 2 | appointments: nullable tenant_id + FK + PHI plaintext | pii-152fz | **critical** | XL | 7, 1 |
| 7 | 10 | Per-clinic шлюз не читает сохранённый secret_key | payments | high | S | 5, 9 |
| 8 | 5 | Fernet-секреты write-only | payments | high | M | 10 |
| 9 | 12 | reverse_writeoff не идемпотентен (раздувает склад) | data-integrity | high | M | — |
| 10 | 15 | TOCTOU в наградах лояльности | data-integrity | high | M | — |
| 11 | 13 | `_add_months` падает для дней 29–31 | payments | high | S | — |
| 12 | 14 | Напоминания: МСК-слот vs UTC-окно (сдвиг 3 ч) | dead-feature | high | S | — |
| 13 | 8 | CVE-пакеты не обновлены | deps-cve | high | M | — |
| 14 | 1 | RLS на 3 из 126 таблиц + мёртвый RLS-контекст | tenant-isolation | **critical** | XL | 7, 2, 18 |
| 15 | 17 | Медданные в plaintext | pii-152fz | high | M | 7, 1 |
| 16 | 16 | webhook без сверки суммы/защиты от понижения статуса | payments | high | M | 10, 5 |
| 17 | 18 | PatientAccount без tenant_id (межтенантная связность ПДн) | tenant-isolation | high | L | 7, 1, 17 |
| 18 | 11 | record_payment закрывает счёт при любой сумме | payments | high | M | 16 |
| 19 | 3 | Атрибуция маркетинга: нет эндпоинтов | dead-feature | high | M | 7 |
| 20 | 4 | Кабинет врача/франчайзи зовёт несуществующий /manager/referrals/ | dead-feature | high | S | — |

---

## По темам

### Тема: tenant-isolation

#### [7] Системный bypass tenant-изоляции при NULL tenant_id (условные проверки чужого тенанта) (high, L)

- **Где править:** `backend/app/routers/patient_chat.py:183,396,436,470` (+ list-эндпоинты `159-161,372-373` и `_get_or_create_chat:108-111`); `backend/app/routers/medcard.py:214,244,316,342,420,450` (staff patch/delete) + list-фильтры `259-260,357-358,465-466` + patient-фильтры `101-102,119-120,136-137`; `backend/app/routers/patient_documents.py:109` (download), `81-82` (list); `backend/app/core/deps.py` — новый хелпер `assert_same_tenant(user, obj)`; опц. `appointments.py:128,370` и `ai_assistant.py:527,555`; новая миграция backfill+NOT NULL.
- **Корень:** Повсеместный fail-open `if user.tenant_id and obj.tenant_id and obj.tenant_id != user.tenant_id: raise`. Если ЛЮБОЙ операнд NULL — проверка пропускается. `User.tenant_id`, `PatientSession.tenant_id`, `Clinic.tenant_id`, `PatientChat.tenant_id` объявлены `nullable=True, ondelete=SET NULL`, а demo/seed-данные рождаются с NULL (`main.py:1322-1324` создаёт Clinic без tenant_id). Менеджер любого тенанта читает/правит чужой чат/медкарту/документы с `tenant_id=NULL`. Даже RLS не закрывает — политика `l2m3n4o5p6q7:32` явно пропускает `tenant_id IS NULL` всем.
- **Как чинить:** 1) Ввести единый guard `assert_same_tenant(user, obj, status=404)` в `core/deps.py` по образцу `regulation_service.py:295-297`: super_admin пропускается ЯВНО по роли (`is_super_admin`), а NULL у записи/пользователя — запрет. 2) Заменить все инлайн-лесенки на вызов хелпера. Для пациентских эндпоинтов — строгое `sess.tenant_id == obj.tenant_id` без super_admin-исключения. 3) List/select: фильтр накладывать ВСЕГДА для тенантного пользователя, пропуск только для super_admin. 4) Запретить рождение NULL-тенанта: в местах создания `if not is_super_admin(user) and not user.tenant_id: raise 400/409`. 5) Почистить источник NULL (demo-клиники в `main.py:1322-1324` привязать к demo-тенанту). 6) Тот же guard в appointments/ai_assistant.
- **Миграция:** Да. Alembic backfill: проставить `tenant_id` по связям (`clinic_id→clinics.tenant_id`, `patient_phone→appointments`, `patient_account→clinic→tenant`); demo-clinics привязать к demo-тенанту или удалить как сид; после backfill, где 0 NULL и сущность всегда тенантная — `ALTER COLUMN tenant_id SET NOT NULL`. Идемпотентна, с корректным downgrade. Шифрование тут не требуется (это #17).
- **Проверка:** Юнит `assert_same_tenant`: (a) свой=ok, (b) чужой=404, (c) `obj.tenant_id=None`=404 (ключевой кейс, сейчас даёт доступ), (d) `user.tenant_id=None & не super_admin`=404, (e) super_admin=ok. Интеграционный: чат/документ/диагноз с `tenant_id=NULL` → менеджер T1 получает 403/404 (раньше 200). После миграции — `COUNT(*) WHERE tenant_id IS NULL = 0`.
- **Риск:** Инверсия super_admin-логики на «NULL=разрешено» сломает доступ super_admin (его tenant_id обычно NULL) — исключение строго по роли. Ранний `SET NOT NULL` без полного backfill уронит миграцию. Demo/seed и старые тесты, читающие NULL-записи, начнут получать 403/404 — поправить фикстуры.

#### [9] IDOR в upsert конфига платёжного шлюза: поиск без фильтра tenant_id (high, S)

- **Где править:** `backend/app/routers/clinic_payments.py:380-432` (`upsert_payment_config`) — валидация владельца clinic_id + tenant_id-предикат в SELECT (`396-403`); опц. хелпер `_verify_clinic(db, tenant_id, clinic_id)`; для единообразия `get_payment_config:359-377` и `list_clinic_payments:330-354`.
- **Корень:** `upsert_payment_config` выбирает существующий конфиг по `clinic_id + gateway` БЕЗ предиката `tenant_id`; `clinic_id` из path не проверяется на принадлежность тенанту. UniqueConstraint глобальный (`clinic_id,gateway`). Менеджер тенанта A, подставив `clinic_id` тенанта B, перезаписывает чужой `shop_id/secret_key_encrypted/is_active`.
- **Как чинить:** 1) В начало хэндлера добавить проверку владельца (копия `_verify_clinic` из `inventory_batches.py:199-205`): `select(Clinic).where(Clinic.id==clinic_id, Clinic.tenant_id==tenant.id)`; None → 404 (не 403, чтобы не подтверждать существование). Импортировать `Clinic`. 2) Добавить `PaymentGatewayConfig.tenant_id == tenant.id` в SELECT существующего конфига. 3) Использовать строгое равенство (NULL-clinic не пройдёт — это и нужно), НЕ `if clinic.tenant_id and ...`. 4) Применить хелпер в get/list для консистентности.
- **Миграция:** Схема не нужна. Опционально (отдельной задачей): заменить UniqueConstraint на `(tenant_id, clinic_id, gateway)` или добавить RLS на `payment_gateway_configs` (см. #1). Разовый SELECT-аудит конфигов, чей `clinic_id` указывает на клинику с другим/NULL tenant_id.
- **Проверка:** Кросс-тенант: A создаёт конфиг clinic_A → B вызывает PUT с `clinic_A_id` → 404, строка не изменена. Позитив: A создаёт/обновляет свою клинику → 200. GET/list своей клиники — без регресса.
- **Риск:** 403 вместо 404 раскроет существование чужого clinic_id. Проверить ролевую модель franchise_owner (single-tenant manager-скоуп). Добавление tenant_id в SELECT не должно мешать легитимному повторному upsert (иначе UniqueConstraint violation → 500).

#### [1] RLS включён лишь на 3 таблицах из 126 — изоляция тенантов почти отсутствует на уровне БД (critical, XL)

- **Где править:** новая миграция `<new>_rls_all_tenant_tables.py` (цикл по всем таблицам с `tenant_id` из `Base.metadata`); `l2m3n4o5p6q7_rls_tenant_isolation.py` (DROP POLICY IF EXISTS перед CREATE); `backend/app/database.py:41-78` (get_db транзакционность + get_db_for_tenant); `backend/app/core/deps.py:169-192` (get_tenant_db — починить транзакционность и подключить во все тенантные роутеры); `backend/app/routers/*.py` (заменить `Depends(get_db)` на tenant-aware зависимость, поэтапно); новый `backend/tests/test_rls_coverage.py`; `backend/alembic/env.py` (target_metadata = Base.metadata).
- **Корень:** Единственная RLS-миграция покрывает только `referrals/bonuses/audit_log`, тогда как `tenant_id` есть в ~79 моделях. БОЛЕЕ ТОГО: RLS-инфраструктура де-факто мёртвая — `get_tenant_db`/`get_db_for_tenant` (делающие `set_config('app.tenant_id')`) НЕ используются НИ ОДНИМ роутером (0 вхождений), `Depends(get_db)` встречается 1096 раз. Даже на 3 покрытых таблицах RLS не срабатывает: `app.tenant_id` не выставляется, политика пропускает по ветке `current_setting(...)=''`. Плюс `set_config(is_local=true)` без явной транзакции в autocommit не держится.
- **Как чинить:** Две обязательные части. **A) Политики на ВСЕХ tenant-таблицах:** узнать реальный head (`alembic heads` — дерево ветвистое); в `upgrade()` импортировать Base, `tables = [t.name for t in Base.metadata.sorted_tables if 'tenant_id' in t.columns]`; для каждой `ENABLE+FORCE ROW LEVEL SECURITY`, `DROP POLICY IF EXISTS`, `CREATE POLICY tenant_isolation` со СТРОГИМ USING (без ветки `tenant_id IS NULL`): `current_setting('app.tenant_id', true) IS NULL OR = '' OR tenant_id::text = current_setting(...)`; + `WITH CHECK` с тем же предикатом; whitelist глобальных таблиц (`patient_accounts` из #18, справочники). **B) Включить контекст:** починить `get_tenant_db` так, чтобы `set_config(is_local=true)` работал внутри транзакции (`async with session.begin()` или event-listener на соединение); подключить tenant-aware зависимость вместо `Depends(get_db)` волнами (начать с medcard/lab/patient_documents/appointments/telemedicine/patient_chat/clinic_payments). Части A и B внедрять синхронно.
- **Миграция:** Да. (1) Основная — авто-создание политик. (2) ПРЕДВАРИТЕЛЬНЫЙ backfill NULL tenant_id (см. #7) — иначе строгая политика спрячет исторические записи. (3) Зафиксировать список сознательно-глобальных таблиц.
- **Проверка:** Мета-тест `test_rls_coverage` (падает при новой tenant-таблице без политики). Кросс-тенант на реальном PostgreSQL (на SQLite RLS не работает): под `app.tenant_id=A` SELECT без WHERE возвращает только A. Негатив на запись (WITH CHECK). Тест транзакционности через TestClient (ловит autocommit-проблему). Полный `alembic upgrade head` + downgrade. Smoke super_admin видит все тенанты.
- **Риск:** Строгая политика ДО backfill спрячет все NULL-записи (приёмы/медкарты/документы) → массовый сбой + риск дублей. FORCE RLS применяется к владельцу — при непочиненной транзакционности (текущая ситуация) запросы вернут пусто или всё → внедрять A и B синхронно. Фоновые джобы через get_db должны осознанно работать как супер-режим. Замена `Depends(get_db)` в 175 файлах — доменными волнами. Неверный down_revision (merge-головы) сломает upgrade.

#### [18] PatientAccount не имеет tenant_id — аккаунты пациентов глобальны по телефону (high, L)

- **Где править:** новая модель `backend/app/models/tenant_patient.py` (TenantPatient: tenant_id+patient_id, UniqueConstraint, опц. local_*_encrypted); `backend/app/services/family_service.py:27-58` (get_or_create/get_account_by_phone — параметр tenant_id + линковка TenantPatient); `patient_session_service.py` (пробросить tenant_id); все роутеры с хелпером `_account(db,sess)` — `patient_lab.py:45, patient_documents_v2.py:52, patient_chat_threads.py:48, patient_chat_slots.py:67, patient_calendar.py:52, patient_subscription.py:57, subscription_pending.py:80, wellness.py:65, patient_family.py:55, patient_loyalty.py:56`; `patient.py` (~1146 DSAR, ~1392 анонимизация); `pii_sync.py:15-18` (+ name шифрование); новая миграция.
- **Корень:** `PatientAccount` (`patient_account.py:12-37`) объявляет `phone unique=True` ГЛОБАЛЬНО и не имеет `tenant_id` вовсе. Все точки входа ищут по телефону без тенанта. Один телефон = одна запись на платформу, справочник пациентов де-факто общий. ФИО (`name`) в plaintext (в `pii_sync._MAP` для PatientAccount только phone/email). DSAR/«право на забвение» работают по всей платформе, игнорируя границы тенанта.
- **Как чинить:** НЕ добавлять `tenant_id` прямо в PatientAccount (сломает unique по phone и не отражает реальность «лечится в N клиниках»). Ввести M2M `TenantPatient` (паттерн `LoyaltyAccountExt`, `UniqueConstraint(tenant_id, patient_id)`). family_service: get-or-create глобального аккаунта → get-or-create `TenantPatient(tenant_id, patient_id)`; `get_account_by_phone` JOIN+фильтр по tenant_id (None для «не из этой клиники»). Прокинуть `sess.tenant_id` во все `_account(...)`. DSAR — только данные tenant сессии; «забвение» — в рамках тенанта, глобальный phone обнулять лишь когда не осталось TenantPatient-связей. Дошифровать name (добавить в `pii_sync._MAP` + shadow-колонки по образцу `piimed_03_shadow.py`).
- **Миграция:** Да. (а) Таблица `tenant_patients` + индексы. (б) Backfill связей из `loyalty_accounts_ext, family_groups, lab_orders, patient_documents, patient_chat_threads`. (в) `name_encrypted/name_hash` в patient_accounts + row-by-row backfill. ПОСЛЕ backfill tenant_id дочерних таблиц (#7).
- **Проверка:** `get_or_create(tenant=A)` → `get_account_by_phone(tenant=B)`=None, `(tenant=A)`=тот же. Кросс-тенант через API (lab/docs/loyalty). DSAR из A отдаёт только данные A. «Забвение» из A не стирает идентичность в B. Шифрование: дамп без ФИО в plaintext. Регресс `test_patient_identifier.py` (dupes по глобальному phone сохраняются).
- **Риск:** Жёсткий фильтр без корректного backfill спрячет существующих пациентов от их клиники (пустые ЛК, ложные 404). `identify_patient` считает дубли по глобальному phone — не фильтровать по тенанту. name в `_MAP` без миграции shadow-колонок → listener упадёт на insert. Ошибка в «нет других связей» сотрёт глобальный phone активного в другой клинике пациента. Backfill row-by-row — в maintenance-окно.

### Тема: pii-152fz

#### [2] Центральная PHI-таблица appointments: tenant_id nullable+SET NULL, FK без ondelete, медзаметки и ФИО/телефон в plaintext (critical, XL)

- **Где править:** `backend/app/models/doctor.py:91-93` (tenant_id NOT NULL + ondelete RESTRICT), `:97-99` (clinic_id ondelete RESTRICT), `:126-137` (notes→notes_encrypted, маппинг patient_phone_encrypted/_hash, patient_name_encrypted/_hash, property/setter по `appointment_outcome.py`); `pii_sync.py:30-32` (+ patient_name); новая миграция; и ~15 точек чтения plaintext-телефона в `reports.py:920, analytics_retention.py:112-273, kpi_service.py:171-188, cohort_service.py:222, calendar_service.py:67, spending_service.py:44, medcard.py:542, clinic_chat.py:641, public_api_v1.py:168-220, patient_family.py:490, sms_campaign_dispatch.py:58, director.py:385,1468, sms_marketing.py:173-192, engagement_analytics.py:192,196` (заменить на `patient_phone_hash`).
- **Корень:** `Appointment.tenant_id` nullable+SET NULL → приёмы осиротеют, а RLS-политика пропускает NULL всем (кросс-тенантная утечка). `clinic_id` FK без ondelete (несогласовано с Doctor.clinic_id CASCADE). `patient_phone/patient_name/notes` plaintext, хотя соседние PHI шифруются. Усугубление: миграция `piimed_03_shadow.py` УЖЕ создала `patient_phone_encrypted/_hash` и backfill-нула их, listener их пишет, НО колонки НЕ объявлены в модели → setattr в transient-атрибут (не персистится), чтения идут по plaintext. name/notes не покрыты вовсе.
- **Как чинить:** 3 независимых под-фикса. **A) Целостность:** backfill `tenant_id` из clinics → NOT NULL → пересоздать FK с ondelete RESTRICT (оба). **B) RLS на appointments** (часть #1; после NOT NULL дыр нет). **C) Шифрование PHI** по образцу `appointment_outcome.py`: `notes→notes_encrypted`, `patient_name_encrypted`(+hash), `patient_phone` — объявить уже существующие в БД `*_encrypted/_hash`, сделать `patient_phone` @property=decrypt; для всех exact-match/DISTINCT заменить `== x`/`distinct()` на `patient_phone_hash = hash_phone(x)`; ilike по телефону (`public_api_v1:170`) заменить на exact-hash. Расширить `pii_sync._MAP['Appointment']` на patient_name. Имена колонок модели = именам в БД.
- **Миграция:** Да, одна (down_revision — текущий head, уточнить `alembic heads`). Backfill tenant_id + NOT NULL + ondelete; add `patient_name_encrypted/_hash`, `notes_encrypted` + backfill через encryption_service; phone уже backfilled (piimed_03). **SECRET_KEY должен быть задан при миграции** (иначе plain:-fallback).
- **Проверка:** Unit: создать Appointment → property возвращают plaintext, в БД `enc:`/`plain:` + непустой hash. Кросс-тенант: под tenant(A) нет строк B; `tenant_id=None` падает (NOT NULL). FK: удаление clinic/tenant с приёмами → IntegrityError. Blind-index регресс на kpi/cohort/calendar (golden-набор). Полный upgrade→downgrade→upgrade. Smoke `install_pii_sync`.
- **Риск:** NOT NULL уронит миграцию при остаточных NULL → обязателен backfill + ручная зачистка сирот. RESTRICT изменит поведение удаления клиник/тенантов. Шифрование телефона: 330+ обращений в 66 файлах, ~30 exact-match/DISTINCT/ilike — пропуск любого ломает поиск/SMS/KPI/когорты тихими пустыми результатами. `select(Appointment.patient_name)` в отчётах вернёт токен — переводить на ORM+property. Без SECRET_KEY backfill «зашифрует» как plain:. Выкатывать под-фиксами (FK/NOT-NULL+RLS отдельно, шифрование отдельно с полным аудитом).

#### [17] Медицинские данные (диагнозы, аллергии, прививки, результаты анализов) в plaintext (high, M)

- **Где править:** `backend/app/models/medcard.py` (PatientDiagnosis.name/notes, PatientAllergy.allergen/reaction, PatientVaccination.vaccine_name → `*_encrypted` + __init__/property); `lab.py:107-125` (LabResult.value/reference_range/raw_json); `patient_vital.py:48,51,62` (value_extra/note); `lab_service.py:158-168` (проверить kwargs); **`patient_lab_dynamics.py:166-186`** (РЕГРЕССИЯ: читает `lr.value` сырым SQL мимо property — переписать на ORM); `patient_medical_record.py:214,236` (raw-SQL); новая миграция.
- **Корень:** Шифрование вводилось точечно, таблицы medcard/lab/vitals пропущены. Готовый паттерн `*_encrypted + __init__ + property` применён в AppointmentOutcome/PatientDocument/LabOrder/Referral, но `grep '_encrypted'` по этим трём моделям = 0. Несогласованность очевидна: `LabOrder.notes` шифруется, `LabResult.value` рядом — нет. Сведения о здоровье (спец.категория ПДн по 152-ФЗ) лежат открытым текстом.
- **Как чинить:** Применить готовый паттерн: переименовать в `<field>_encrypted` (Text), добавить `__init__` (plain-kwarg→encrypt), property getter (decrypt)/setter (encrypt). **НЕ шифровать:** `icd10_code` (структурированный код МКБ для фильтров), `flagged` (Boolean, не ПДн). `raw_json/value_extra` (JSONB) → Text, getter делает `json.loads`, setter `json.dumps`+encrypt. **ОСОБЫЙ СЛУЧАЙ `value_num`** (Numeric, используется для графиков/агрегации): оставить как есть или согласовать (числовой показатель вне ФИО малочувствителен) — сужение исходной рекомендации, отметить в PR. **КРИТИЧНО:** `patient_lab_dynamics.py` читает value сырым `text()` SQL → вернёт `enc:...`, `_parse_number`→None, графики молча опустеют (общий try/except). Переписать на ORM или `decrypt()` над сырым значением. grep сырых SQL по `lab_results/patient_diagnoses/patient_allergies` перед мерджем.
- **Миграция:** Да (по образцу `piimed_01_encrypt.py`). `alter_column` rename + type_=Text (Fernet длиннее; String(120)→Text, JSONB→Text через `::text`); backfill префиксом `plain:` (как piimed_01 — делает читаемым через decrypt, но реального шифрования истории нет — для этого нужен отдельный data-скрипт). downgrade: SUBSTRING FROM 7 + восстановление типов. value_num не трогать.
- **Проверка:** Unit: создать PatientDiagnosis → `d.name`=исходное, в `name_encrypted` `enc:`/`plain:`. Round-trip JSON. E2E medcard POST→GET. **Регресс на patient_lab_dynamics** (analytes НЕ пустые). Тест миграции upgrade/downgrade. grep `text()`/raw SQL по lab/diagnoses = 0 необработанных.
- **Риск:** Сырые SQL обходят property → отдадут `enc:...`; из-за широких try/except проявится молчаливо пустыми данными. Недостаточная ширина колонки (оставленный String(120)) → усечётся INSERT → обязательно Text. JSONB→Text ломает `->>/@>` если используются. Потеря числовой агрегации если зашифровать value_num. SECRET_KEY должен быть стабилен. Backfill только ставит `plain:` — реального шифрования истории нет.

### Тема: payments

#### [10] Per-clinic платёжный шлюз НИКОГДА не использует сохранённые ключи — адаптер читает несуществующий secret_key (high, S)

- **Где править:** `backend/app/models/payments_clinic.py:117-147` (@property secret_key=decrypt; докстринг :13); `yookassa_adapter.py:78-97` (_credentials через property, убрать слепой ENV-fallback при активном конфиге); опц. `acquiring/base.py:35-49` (хелпер для будущих адаптеров); `test_yookassa_adapter.py:22-27` (_mk_config маскирует баг).
- **Корень:** Модель хранит секрет только в `secret_key_encrypted`, атрибута/property `secret_key` НЕТ. Адаптер читает `getattr(self.config,'secret_key',None)` → всегда None → молчаливый fallback на `os.getenv('YOOKASSA_SECRET_KEY')`: платежи всех клиник идут через единый аккаунт платформы (деньги не тому юрлицу) или 503. Шифрование де-факто write-only. Та же первопричина, что #5.
- **Как чинить:** Добавить @property secret_key (lazy import encryption_service, return decrypt). Тогда `getattr` начнёт возвращать ключ. В `_credentials`: брать shop_id и secret_key из cfg; ENV ТОЛЬКО когда `self.config is None`; если конфиг активен, но decrypt вернул None — `raise RuntimeError` (→503), НЕ падать в чужой ENV. Обновить докстринг. Опц. `_decrypted_secret()` в BasePaymentGateway.
- **Миграция:** Не нужна. decrypt читает `enc:`/`plain:`/legacy. **Проверить стабильность SECRET_KEY на проде** (Fernet-ключ derive-ится из него) — при смене `enc:`-секреты нечитаемы, потребуют повторного ввода.
- **Проверка:** Unit round-trip. Переписать `_mk_config` на `secret_key_encrypted`. Негатив: активный cfg + decrypt fail → RuntimeError, не ENV. Приоритет: cfg важнее ENV. e2e init с mock httpx — Basic-auth = (shop_id, расшифрованный secret).
- **Риск:** Слишком жёсткое удаление ENV-fallback → клиники без конфига перестанут принимать оплату (массовый 503) — fallback сохранить для `config is None`. Несовпадение SECRET_KEY на проде → прежде «работавшие» через ENV платежи начнут падать. Lazy import (циклы). Property не должен утечь в `__repr__`/сериализацию (`_serialize_config`).

#### [5] Fernet-шифрование платёжных секретов НЕ работает — секрет пишется, но никогда не читается (high, M)

- **Где править:** `payments_clinic.py:117-147` (@property+setter secret_key, __init__, докстринг :13); `yookassa_adapter.py:78-97` (читать через property, убрать молчаливый ENV-fallback); `test_yookassa_adapter.py:22-27`; `payments_clinic.py:193-221` (OFDConfig — аналогично api_key поверх api_key_encrypted, чтобы не оставить второй write-only секрет).
- **Корень:** Рассогласование имён: модель хранит в `secret_key_encrypted`, адаптер читает `secret_key` (которого нет) → None → ENV-fallback. `decrypt()` не вызывается во всём слое acquiring. Шифрование write-only. Баг прошёл мимо тестов: `_mk_config` подменяет MagicMock'ом с `cfg.secret_key`. Тесно связано с #10.
- **Как чинить:** Воспроизвести паттерн `referral.py:86-103`: `__init__` (kwarg secret_key→encrypt в secret_key_encrypted), @property getter (decrypt), @setter (encrypt). Lazy import. Колонку НЕ переименовывать. В адаптере убрать тихий ENV-fallback при активном конфиге (см. #10 — согласованно). Удалить докстринг «Пока plain text». Добавить symmetric property api_key в OFDConfig. Проверить, что `_serialize_config` отдаёт только `secret_key_present`.
- **Миграция:** Не нужна (схема не меняется, decrypt читает enc:/plain:/legacy). Контроль: стабильность SECRET_KEY на проде.
- **Проверка:** Unit round-trip. Переписать `_mk_config` на реальную модель. Негатив: битый секрет + активный cfg → RuntimeError. Регресс `test_init_payment_no_credentials_raises`. E2E PUT payment-config → init с mock httpx использует cfg-ключ, не ENV. Symmetric OFDConfig.api_key.
- **Риск:** Агрессивное удаление ENV-fallback (в т.ч. для cfg=None) сломает сценарий ненастроенного шлюза. Несовпадение SECRET_KEY → все платежи в 503. Не объявлять `secret_key` как mapped_column (конфликт с property). Не логировать расшифрованный секрет. Изменение `_mk_config` временно «покраснит» пайплайн — это цель.

#### [16] update_clinic_payment_status доверяет статусу webhook без сверки суммы и без защиты от понижения статуса (high, M)

- **Где править:** `acquiring_service.py:125-154` (параметры expected_amount/gateway_payment_id, сверка суммы, машина переходов); новая `_confirm_via_adapter`; `clinic_payments.py:277-284` (передавать gateway_payment_id и сумму из webhook); `acquiring/base.py:27-33` (контракт amount в PaymentStatusResult); новый `test_acquiring_service.py`.
- **Корень:** Функция безусловно ставит `payment.status = status` из webhook. Нет: (1) повторной сверки через `adapter.get_status` (хотя docstring verify_webhook предписывает; подпись ЮKassa отсутствует, защита только IP-allowlist); (2) сверки суммы; (3) защиты от регресса (succeeded/refunded терминальны, но поздний pending их перезапишет). Статус питает выручку (`_sum_revenue` по SUCCEEDED).
- **Как чинить:** 1) Терминальные статусы + матрица переходов: если уже терминальный, а новый нетерминальный — не менять (только дозаписать webhook_events). REFUNDED только из SUCCEEDED. 2) Сверка суммы: расширить сигнатуру `webhook_amount/gateway_payment_id`; перед SUCCEEDED — `webhook_amount != payment.amount` (quantize 0.01) → не succeeded, пометка amount_mismatch. 3) `_confirm_via_adapter` через `get_status` (authoritative); fallback: NotImplementedError/RuntimeError для шлюзов-заглушек (tinkoff/sber/...) → succeeded только при совпадении суммы, `verified=False`. Для ЮKassa get_status реализован. 4) Дёргать сверку только при переходе в SUCCEEDED. 5) Записывать все webhook_events в payment_metadata (аудит).
- **Миграция:** Не нужна (поля есть). Опц. разовый аудит SUCCEEDED-платежей (до фикса succeeded мог проставиться на заниженную сумму).
- **Проверка:** regress-protection (succeeded + pending → остаётся succeeded). amount-mismatch (1500 vs 1 → не succeeded). happy-path ЮKassa. адаптер без get_status (verified=False/неверная сумма → не succeeded). refunded только из succeeded. Прогон на SQLite (Decimal-в-JSONB).
- **Риск:** Жёсткая сверка через get_status на каждый webhook + недоступность API → succeeded зависнут в pending; ошибки сети ловить и деградировать. Запрет легитимного succeeded→refunded сломает возврат. Decimal без quantize → ложные mismatch. Заглушки: осознанный компромисс. Не трогать подписочную ветку (Invoice→record_payment).

#### [11] record_payment помечает счёт полностью оплаченным при ЛЮБОЙ сумме платежа (high, M)

- **Где править:** `billing_service.py:201-257` (`record_payment` — сверка amount с invoice.amount, накопление paid_amount), `:218-234` (блок статуса); `models/billing.py:28-33` (InvoiceStatus.PARTIAL); `routers/billing.py:59-64` (RecordPaymentRequest); `clinic_payments.py:288-309` (webhook-ветка — регресс-проверка).
- **Корень:** Функция безусловно ставит `invoice.status = PAID`, `paid_amount = amount`, реактивирует подписку — НЕ сверяя `amount` с `invoice.amount` и не накапливая частичные. Единственная защита — `if status==PAID: raise`. `RecordPaymentRequest.amount: Field(gt=0)` задаёт только нижнюю границу. Менеджер закроет счёт 49900₽ платежом 1₽ → PAID + ACTIVE + заниженная запись в ledger. Эксплуатируется и через `/pay`.
- **Как чинить:** Единая точка в сервисе (покрывает /pay, shortcut, webhook). 1) `already = invoice.paid_amount or 0; new_total = already + amount`. 2) Переплата: `new_total > invoice.amount` → ValueError (роутеры ловят →400); epsilon Decimal('0.01'). 3) Статус: Payment всегда COMPLETED; `paid_amount = new_total`; если `new_total >= invoice.amount` → PAID + paid_at + реактивация PAST_DUE→ACTIVE (перенести под условие); иначе PARTIAL (добавить в InvoiceStatus), без реактивации. Альтернатива — строгое равенство без PARTIAL. 4) ledger пишет фактическую сумму платежа. 5) Webhook не менять (уже подставляет сумму шлюза).
- **Миграция:** Не нужна (status — String(30), PARTIAL допустим; paid_amount есть). Опц. аудит PAID-инвойсов с `paid_amount < amount` (следы эксплуатации).
- **Проверка:** Негатив: 49900 + платёж 1 → ValueError, не PAID, не ACTIVE, нет ledger-записи. Полный: `amount==invoice.amount` → PAID. Частичный (20000+29900) → PARTIAL→PAID. Переплата → ValueError. Сверка ledger. API: POST /pay amount=1 → 400.
- **Риск:** float/Decimal без нормализации → ложные 400 (amount из float). Webhook отдаёт 200 даже при ошибке — новая ValueError на легитимном колбэке → счёт молча не закроется, шлюз не ретраит. Ошибка в условии реактивации → потеря доступа или баг наоборот. PARTIAL должны учесть потребители (`mark_invoice_overdue`, `get_billing_summary`, фронт).

#### [13] _add_months падает ValueError для подписок, начатых 29-31 числа (high, S)

- **Где править:** `billing_service.py:27-31` (`_add_months` — кламп дня), `:33-36` (`_period_end` — проверить), точки вызова `:59,129,155`; `tests/test_billing.py:110-132`.
- **Корень:** `date(year, month, start.day)` без ограничения длиной месяца. Подписка 29/30/31 числа + короткий месяц → `ValueError: day is out of range`. `_period_end` зовёт со всеми n (1/3/6/9/12) — падает в любом цикле. В проекте уже есть канонический кламп через `calendar.monthrange` (`admin.py:512`), но в billing не применён. dateutil отсутствует — чинить stdlib.
- **Как чинить:** Заменить `return date(year, month, start.day)` на `day = min(start.day, calendar.monthrange(year, month)[1]); return date(year, month, day)`. Не трогать `_period_end`. Не добавлять dateutil. Сохранить сигнатуру.
- **Миграция:** Не требуется. Опц. backfill застрявших без счёта подписок (next_invoice_date в прошлом без Invoice) — операционный фикс.
- **Проверка:** Unit: `(2026,1,31)+1мес=2026-02-28`; `(2024,1,31)+1=2024-02-29`; `(2026,1,31)+3=2026-04-30`; `(2026,8,31)+6=2027-02-28`. Async: create_subscription от 31-го + generate_invoice. Негатив «до фикса» = ValueError. UI: подписка 31-го числа.
- **Риск:** Семантика «конца месяца» — дата может дрейфовать к началу месяца (нормально, зафиксировать в тестах). Не менять `_period_end` (off-by-one). Не задевать `arr_ltv_service._add_months`/`cost_forecast`. Простоя нет.

### Тема: data-integrity

#### [12] reverse_writeoff не идемпотентен — цикл complete→uncomplete раздувает остатки (high, M)

- **Где править:** `models/inventory.py:161-228` (InventoryMovement + колонка `reversed` Boolean, опц. reversed_at/reversal_movement_id); `inventory_fifo.py:213-274` (`reverse_writeoff` — фильтр `reversed==False`, пометка `m.reversed=True`); `appointment_costing.py:333-343` (`on_appointment_completed` — учитывать только не-реверснутые WRITE_OFF); новая миграция; `test_cost_attribution.py` или новый `test_inventory_reversal.py`.
- **Корень:** `reverse_writeoff` выбирает ВСЕ движения с `quantity < 0` и создаёт обратные +qty, но оригинальные WRITE_OFF не удаляются и не помечаются — журнал append-only, флага `reversed` нет. Рассинхрон критериев: `on_appointment_completed` считает «уже списано» по `type==WRITE_OFF`, а `reverse_writeoff` — по `quantity<0` не исключая свои реверсы. Цикл completed↔in_progress (через kanban/scheduling) множит остаток.
- **Как чинить:** 1) Колонка `reversed = mapped_column(Boolean, nullable=False, default=False, server_default="false")` (паттерн `is_optional`). Опц. reversed_at/reversal_movement_id. 2) В `select` добавить `reversed.is_(False)`; в цикле после reverse_m — `m.reversed=True` (в той же транзакции). Помечать ТОЛЬКО исходные write-off. 3) В `on_appointment_completed` добавить `reversed.is_(False)` к условию WRITE_OFF (повторный complete снова спишет). qty_remaining/InventoryStock не трогать.
- **Миграция:** Да. `ADD COLUMN reversed boolean NOT NULL DEFAULT false` (опц. reversed_at, reversal_movement_id FK). down_revision — уточнить `alembic heads` (цепочка ветвится). Backfill: `reversed=True` исходным WRITE_OFF, у которых есть парный INCOME-реверс. Корректировку уже раздутых остатков — отдельная инвентаризация.
- **Проверка:** Идемпотентность: два reverse_writeoff подряд → второй возвращает 0, склад не меняется. Полный цикл complete#1→uncomplete#1→complete#2→uncomplete#2 → итог == исходному. Негатив: 4 цикла не увеличивают остаток. Ручная на Postgres в kanban.
- **Риск:** Правка только select без `on_appointment_completed` → повторный complete уйдёт в already_written_off → недосписание. NOT NULL без server_default уронит миграцию. Неверный backfill → занижение. Пометка вне транзакции → рассинхрон. Best-effort try/except проглотит опечатку в имени колонки — покрыть тестом.

#### [15] Награды лояльности: TOCTOU без блокировки — можно получить награду без баллов (high, M)

- **Где править:** `loyalty_ext_service.py` (новая `lock_account_and_reward` или блокирующие SELECT в create_claim), `:319-341` (create_claim — re-validate в локе), `:148-177` (adjust_points — allow_negative=False/проверка); `routers/patient_loyalty.py:170-198` (убрать преждевременный commit, атомарная транзакция, 409).
- **Корень:** Классический TOCTOU: `_require_module_and_account` делает `db.commit()` (закрывает транзакцию, лока нет) → `db.get(LoyaltyReward)` без блокировки → `can_claim` in-memory без with_for_update → `create_claim` → один commit. Между check и use нет row-lock/unique-constraint. Два параллельных запроса проходят can_claim, оба вставляют claim. `adjust_points` клампит `max(0, ...)` → перерасход теряется молча; `reward.stock-=1` → lost update, отрицательный остаток.
- **Как чинить:** 1) Хелпер перечитывает обе строки с `with_for_update()` (паттерн `referral_service.py:208`, `inventory_fifo.py:74`): `select(LoyaltyAccountExt).where(id==).with_for_update()` и аналогично LoyaltyReward. 2) create_claim на заблокированных объектах: re-validate `can_claim` ВНУТРИ лока, при недостатке — доменное исключение `LoyaltyClaimError` (не молчаливый max(0)). 3) adjust_points для списаний: validate `(points+delta)>=0` до клампа. 4) В роутере убрать разрыв транзакции (commit на :59/61), лочить ПОСЛЕ подготовительных commit; `LoyaltyClaimError`→409. 5) Defense-in-depth: `if stock is not None and stock<=0: raise`; опц. advisory-lock на account_id.
- **Миграция:** Структурная не обязательна (хватает блокировок). Рекомендуется CHECK `stock>=0`, `points>=0`. Backfill-аудит: аккаунты где списания>начисления, stock<0.
- **Проверка:** Конкурентность (на Postgres — with_for_update на SQLite не сериализует, skip-маркер): два параллельных create_claim → ровно один claim, второй 409, points==0. stock=1 + два claim → stock==0, не -1. Позитив: одиночный claim. Регресс read-only `/rewards`.
- **Риск:** Deadlock — единый порядок локов (account, затем reward), короткая транзакция. Разрыв транзакции в `_require_module_and_account` — лочить ПОСЛЕ всех commit. Убрав max(0), не задеть начисления award_* (delta>0). Триггеры лояльности не должны падать — ошибку бросать ТОЛЬКО в claim_reward. Не лочить каталог.

### Тема: auth-access

#### [6] Эндпоинт создания тенанта /tenant/create без аутентификации при пустом onboarding_secret (high, S)

- **Где править:** `routers/tenant.py:204-219` (`create_tenant` — Depends(require_super_admin), переосмыслить secret_key), `:14` (импорт require_super_admin); `core/deps.py:103` (уже есть); опц. `config.py:64-65` (семантика onboarding_secret).
- **Корень:** Хэндлер только с `Depends(get_db)`, роутер подключён без `dependencies=`. Единственная защита — `if expected and data.secret_key != expected`. Но `config.py:65` дефолт `onboarding_secret = ""` (falsy) → проверка целиком пропускается → эндпоинт публичный (fail-open). Любой аноним создаёт tenant+trial+branding+admin, в ответе — логин/пароль admin. Легитимные потребители (PlatformSection/AdminLayout) уже шлют super_admin-токен без secret_key.
- **Как чинить:** Fail-closed. Добавить `current_user: User = Depends(require_super_admin)` в сигнатуру (паттерн как require_manager). Проверку секрета сделать строгой («если передан — обязан совпадать», никогда не «пропустить»); поле secret_key можно удалить как мёртвое или оставить как доп.фактор. Для публичного self-service — направлять на `public_onboarding.py` (`/signup/*`, OTP + rate-limit 5/час/IP), НЕ открывать /tenant/create. Обновить ref-доку.
- **Миграция:** Не требуется. Операционно: разовый аудит таблицы `tenants` на спам-тенанты (подозрительные slug/created_at).
- **Проверка:** Негатив: POST без токена → 401/403, тенант не создан (раньше 201). manager/franchise_owner → 403. Позитив: super_admin → 201. Фронт-регресс в панели super_admin. Публичный `/signup/start` доступен анонимно + rate-limit.
- **Риск:** Легитимный неаутентифицированный вызов (CLI/скрипт) сломается — проверить грепом (по фронту: только два super_admin-вызова). require_manager вместо require_super_admin даст менеджерам плодить тенанты. Удаление поля secret_key без согласования сломает внешних клиентов — безопаснее оставить опциональным. Простоя нет.

#### [19] Auth-store (zustand) рассинхронизирован с реальным набором токенов в api/index.js (high, S)

- **Где править:** `store/auth.js:12-15` (logout — очистка всех 4 ключей), `:1-5` (импорт общих имён); новый `lib/authKeys.js` (tokenKey/adminTokenKey/refreshKey/adminRefreshKey + clearAllAuth); `api/index.js:23-38` (импорт из authKeys); `components/Layout.jsx:150-155`, `DirectorLayout.jsx:103-106`, `App.jsx:205-208` (убрать ручной removeItem); `_AccountantShell.jsx:46-52` (заменить дубль на clearAllAuth).
- **Корень:** `store/auth.js` оперирует ОДНИМ токеном (`clinika_token_`), а `api/index.js` (`_getActiveTokenInfo`) — ЧЕТЫРЬМЯ ключами/SLUG (token, admin_token, refresh, admin_refresh), причём для admin/manager/franchise_owner/super_admin активен `clinika_admin_token_`. `store.logout()` удаляет НЕ ТОТ токен → `clinika_admin_token_*` и оба refresh остаются валидны, интерсептор молча восстановит access. Везде по-разному (только `_AccountantShell` корректен), централизованного модуля имён нет.
- **Как чинить:** 1) Создать `lib/authKeys.js` с функциями имён (БУКВАЛЬНО те же, что в api/index.js) + `clearAllAuth(slug)` (try/catch, все 4 ключа, образец `_AccountantShell:46-52`). 2) В store/auth.js logout → `clearAllAuth(SLUG)` + `set({token:null,user:null})`; init оставить как чтение userTokenKey. 3) В api/index.js заменить инлайн-строки на хелперы (без изменения логики). 4) Убрать компенсирующий removeItem у вызывающих. **НЕ трогать** `ImpersonationBanner.jsx` (удаление admin-токена там — осознанный выход из impersonation). Edge: пустой SLUG (super_admin) → ключ `clinika_admin_token_`.
- **Миграция:** Не требуется (только localStorage). Опц. дёргать серверный `/auth/logout` для отзыва refresh.
- **Проверка:** Ручной негатив: login manager → DevTools показывает admin_token+admin_refresh → logout → ВСЕ 4 ключа удалены. Повтор для super_admin (SLUG='') и пациента. Регресс: выход из impersonation возвращает к origin. Опц. vitest на logout().
- **Риск:** Опечатка/пропуск пустого суффикса → очистка молча не сработает (ложное чувство закрытости) — имена из общего модуля 1:1. Чтение admin-token в init сломает состояние обычного пользователя — менять только logout(). `localStorage.clear()` сотрёт impersonation/настройки — чистить только 4 ключа. Удаление компенсаций — ПОСЛЕ полного logout.

#### [20] Реальный пароль БД захардкожен в обоих compose-файлах (high, S)

- **Где править:** `docker-compose.yml:23-26` (POSTGRES_PASSWORD), `docker-compose.monitoring.yml:40-41` (DATA_SOURCE_NAME), `.env.example:1` (DATABASE_URL → плейсхолдер + POSTGRES_PASSWORD=), `/opt/clinika/.env` на сервере, `.gitignore` (создать/проверить).
- **Корень:** `clinika_pass` зашит в трёх местах: compose-db, monitoring-exporter DSN, `.env.example`. По MEMORY `.env` отслеживается git → литерал утёк в историю. Механизм `${VAR}` в проекте уже применяется (VITE_SENTRY_DSN). Дублирование делает ротацию ошибкоопасной.
- **Как чинить:** 1) `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}` (fail-closed). 2) monitoring: `DATA_SOURCE_PASS: ${POSTGRES_PASSWORD:?...}` (+ DATA_SOURCE_URI/USER) или интерполяция в DSN; передать тот же `--env-file .env`. 3) `.env`: `POSTGRES_PASSWORD=<сильный>` + согласованный DATABASE_URL. 4) `.env.example`: `CHANGE_ME`. 5) **РОТАЦИЯ обязательна** (пароль в истории): `ALTER ROLE clinika WITH PASSWORD '<новый>'` на живой БД (compose НЕ меняет пароль в инициализированном volume!) + обновить .env + `docker compose up -d`. 6) `.env` в .gitignore, `git rm --cached .env`, при возможности почистить историю (BFG/filter-repo).
- **Миграция:** Alembic не требуется. Операционная ротация: ALTER ROLE на 212.57.118.126 (НЕ пересоздавать volume — потеря данных).
- **Проверка:** grep `clinika_pass` = 0 в *.yml/.env.example. `docker compose config` без POSTGRES_PASSWORD → падает (fail-closed). Backend /health 200. exporter `curl :9187/metrics` без 'password authentication failed'. После ротации старый пароль → 'authentication failed', новый → ok. Bot healthcheck.
- **Риск:** Рассинхрон POSTGRES_PASSWORD и DATABASE_URL → полный простой API. Ожидание, что compose перепишет пароль в существующем volume — НЕТ (нужен ALTER ROLE). Удаление volume для смены пароля → потеря ВСЕХ данных (категорически нельзя). monitoring запускается отдельной командой — забыть .env → exporter упадёт. Спецсимволы в пароле внутри DSN → сломают парсинг (выбрать [A-Za-z0-9] или url-encode).

### Тема: dead-feature

#### [3] Вкладка «Атрибуция маркетинга» полностью нерабочая — нет ни одного эндпоинта /marketing/attribution (high, M)

- **Где править:** `routers/marketing_ads.py` (4 эндпоинта GET/POST/PATCH/DELETE /marketing/attribution + схемы AttributionOut/Create/Update + helper _attribution_out), `:33` (импорт PatientAttribution + User); `tests/` (test_marketing_attribution.py).
- **Корень:** Фронт `AttributionTab.jsx` зовёт GET/POST/PATCH/DELETE `/marketing/attribution`, но в `marketing_ads.py` только `/channels` и `/ad-spend`. При этом БД готова: модель `PatientAttribution` (`marketing.py:95`), таблица создана `marketingads01`, колонки 1:1 совпадают с payload фронта. CRUD-роутер просто не написали (dead-feature) — фронт получает 404.
- **Как чинить:** Реализовать CRUD в marketing_ads.py, переиспользуя паттерны файла (tenant-фильтрация, резолв канала, права). Импорт PatientAttribution + User. Схемы с вложенными patient/channel (фронт читает `it.patient?.full_name`, `it.channel?.name/icon`). helper `_attribution_out` по образцу `_ad_spend_out:257-269`. GET (require_read_access, фильтр `tenant_id==tid`, search/channel_id, outerjoin). POST (require_manager, tid обязателен, проверка принадлежности канала). PATCH/DELETE (require_manager, db.get→404, `tenant_id!=tid→403`). Альтернатива-митигейт: скрыть вкладку, но дешевле дописать роутер.
- **Миграция:** Не требуется (таблица patient_attribution и индексы созданы marketingads01).
- **Проверка:** CRUD (httpx AsyncClient на SQLite): менеджер A создаёт→читает→правит→удаляет (201/200/200/204). GET без записей → пустой список, не 404. Резолв вложенных объектов. Кросс-тенант: B видит/правит запись A → 403/404. Валидация: POST без phone и user_id → 422/400. UI: вкладка грузится без 404.
- **Риск:** Забыть фильтр `tenant_id` → IDOR на ПДн (телефоны/ФИО). Расхождение формы ответа → пустые ячейки. Join на User без tenant-фильтра подтянет чужих пациентов — нормализацию/фильтр брать из `search.py`. Простоя/потери данных нет.

#### [4] Кабинет врача и франчайзи зовут несуществующий GET /manager/referrals/ (high, S)

- **Где править:** `frontend/src/pages/DoctorLayout.jsx:549,555` (путь), `:11` (докстринг); `FranchiseOwnerCabinet.jsx:1381` (путь + параметр); `routers/manager/reports.py:464` (опц. Query author_id); опц. `manager/__init__.py` (алиас).
- **Корень:** Фронт зовёт `/manager/referrals/`, которого нет — у менеджера только `GET /manager/reports/referrals`. Нюанс: DoctorLayout рендерится для DOCTOR/PARTNER_DOCTOR/VISITING_DOCTOR с admin-токеном, а `/manager/reports/referrals` под `require_manager` (пускает только manager/super_admin/franchise_owner) → реврайт для врача даст 403. Франчайзи проходит require_manager, но шлёт author_id, не поддерживаемый эндпоинтом.
- **Как чинить:** Чинить на фронте по ролям. 1) **Врач:** оба вызова (549/555) → `GET /referrals/` (`referrals.py:298`, фильтр по `created_by_admin_id`, использует get_current_user — admin-токен пройдёт). limit игнорируется (безвреден). Парсинг фронта терпим к массиву. Обновить докстринг. 2) **Франчайзи:** `loadReferrals` → `GET /manager/reports/referrals` + расширить эндпоинт `Query author_id: Optional[UUID]`, при наличии `filters.append(Referral.created_by_admin_id == author_id)` (поверх tenant/clinic фильтров). Альтернатива (вариант A): алиас `/manager/referrals/`, но врач всё равно должен идти на `/referrals/`.
- **Миграция:** Не требуется.
- **Проверка:** Врач: вкладка «Направления» грузится (200, не 404), показаны его направления. Франчайзи: loadReferrals 200 (не 404/403), направления выбранного врача. Кросс-тенант: author_id чужого тенанта → пустой список. Юнит на author_id. Регресс без author_id. grep `/manager/referrals/` = 0.
- **Риск:** Врач на `/manager/reports/referrals` → 403. `/referrals/` для франчайзи покажет его направления, а не врача. author_id не должен ослаблять tenant/clinic-скоуп (152-ФЗ). Алиас при неаккуратном выносе сломает response_model. Простоя нет.

### Тема: deps-cve

#### [8] python-multipart, Pillow, weasyprint, starlette НЕ обновлены до безопасных версий (high, M)

- **Где править:** `backend/requirements.txt:11` (python-multipart→>=0.0.27), `:14` (Pillow→>=11.3.1/12.x), `:31` (weasyprint→>=68.0 + pydyf :32), `:1` (fastapi→>=0.118 + явная строка starlette>=0.49.1); `requirements-dev.txt` (pip-audit); новый `.github/workflows/ci.yml`.
- **Корень:** Аудит заявил bump как выполненный, но фактический pin не менялся для 4 из 6: multipart==0.0.20, Pillow==11.3.0, weasyprint==66.0, starlette не запинен (приходит транзитивно через fastapi==0.115.14, которая держит starlette<0.42 → заявленный >=0.49.1 недостижим без подъёма FastAPI). Корректны только python-jose и jinja2. Нет CI (`.github` отсутствует) → откат версий ничем не ловится. Уязвимости реальны: multipart/starlette на каждом UploadFile (16 файлов), Pillow декодирует ввод (`profile.py:248 Image.open`), weasyprint рендерит PDF.
- **Как чинить:** 1) Обновить пины (Pillow→12.x если совместимо с qrcode[pil]==7.4.2, иначе >=11.3.1; weasyprint 68 + свежий pydyf). 2) Развязать starlette: поднять fastapi до >=0.118.x + явная строка starlette>=0.49.1 (fail-safe). 3) Проверить экосистему (pydantic 2.10.6, fastapi-limiter==0.1.6 со свежим starlette) в чистом venv, `import app.main`. 4) Не трогать корректные jose/jinja2. 5) CI-workflow со шагом `pip-audit --strict` (корень повторяемости — отсутствие CI). 6) Обновить отчёт/MEMORY.
- **Миграция:** —
- **Проверка:** Чистый venv `pip install` без конфликтов. `python -c "import app.main"`. `pip show` версий. `pip-audit` без CVE (негатив: вернуть multipart 0.0.20 → audit падает). Дымовой: аватар (Image.open), PDF (director_export/acts), multipart-аплоад. Прогон конвейера на SQLite (роутинг/middleware).
- **Риск:** Подъём starlette тянет fastapi 0.115→0.118+ — самый рискованный шаг: меняется поведение middleware/lifespan/обработки исключений/форматов валидации; возможны регрессии в auth-middleware/CORS/rate-limit (fastapi-limiter совместимость). Pillow 12.x ↔ qrcode (генерация QR). weasyprint 68 ↔ pydyf (рендер актов/экспортов). Неаккуратный апгрейд уронит старт в проде (простой всей МИС). Митигировать: отдельная ветка, поэтапно (multipart/Pillow/weasyprint отдельным коммитом, fastapi+starlette отдельным), полный прогон + стейдж.

---

## ⚠️ Не воспроизвелось при перепроверке

**Нет.** Все 20 находок имеют статус `reproduced: confirmed` — каждая подтверждена прямым чтением кода/Grep с указанием файлов и строк. Дополнительной ручной валидации перед началом работ не требуется (но рекомендации по runbook — стабильность SECRET_KEY, состояние head в `alembic heads`, проверка spam-тенантов — выполнить как операционные пред-проверки, см. соответствующие находки).

---

## Сводка усилий

| Effort | Находки (idx) | Кол-во |
|--------|---------------|--------|
| **S** | 6, 20, 19, 9, 10, 13, 14, 4 | 8 |
| **M** | 5, 12, 15, 8, 17, 16, 11, 3 | 8 |
| **L** | 7, 18 | 2 |
| **XL** | 2, 1 | 2 |

**Суммарная грубая оценка:**
- 8×S — быстрые точечные правки (часы–день каждая), большинство без зависимостей → Волна 0 закрывается быстро.
- 8×M — сервисный слой / шифрование / CVE-апгрейд (дни каждая, требуют тестов и стейджа).
- 2×L (#7, #18) — затрагивают много файлов + backfill, доменными волнами.
- 2×XL (#1, #2) — фундаментальные: системный RLS и центральная PHI-таблица; требуют миграций с backfill, синхронного внедрения частей и поэтапной выкатки под полным регрессом.

**Критический путь по времени:** `7 (L) → 2 (XL) → 1 (XL) → 18 (L)` — ось ПДн/изоляции определяет общую длительность; денежная ось (`9→10→5→16→11`) и быстрые победы параллелятся с ней.
