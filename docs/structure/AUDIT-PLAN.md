# Аудит clinika — план действий (по состоянию на 2026-06-07)

Полный аудит кодовой базы clinika (FastAPI + React, мультитенантная МИС/SaaS, ~263k строк, 7 кабинетов) силами 78 агентов по 7 направлениям: безопасность, баги бэкенда, битые меню/ссылки/фичи, контракт API, модели/БД, инфра/зависимости, корректность фронта.

- **Всего находок:** 104
- **Подтверждено (в план входят):** 89
- **Под вопросом (нужна ручная проверка):** 3
- **Опровергнуто (в план НЕ входят):** 12

**Как читать план.** Тяжесть указана ИТОГОВАЯ: если верификатор скорректировал severity (`adjustedSeverity`), берётся его оценка, и это помечено в строке «Тяжесть». Многие находки из направления «маршруты/меню» аудитор первично оценил как high, но верификатор понизил до low/info — это код-смелл и мёртвый код, а не дыры в безопасности. Реальные критичные риски (изоляция тенантов, медданные/ПДн, деньги, секреты в git, CVE) сосредоточены в разделах CRITICAL и HIGH. Для каждой находки: файл с координатами, категория/действие, краткая суть, что конкретно сделать, итоговая тяжесть. В конце — раздел «Под вопросом», «Опровергнуто» и рекомендованный порядок устранения (топ-10).

## Сводная таблица распределения

| Тяжесть | Кол-во | fix | improve | add | remove |
|---|---|---|---|---|---|
| 🔴 CRITICAL | 2 | 2 | — | — | — |
| 🟠 HIGH | 18 | 17 | — | 1 | — |
| 🟡 MEDIUM | 25 | 16 | 6 | 3 | — |
| 🟢 LOW | 33 | 15 | 13 | 2 | 3 |
| ⚪ INFO (в составе LOW) | 11 | 1 | 9 | — | 1 |
| **Итого подтверждено** | **89** | **51** | **28** | **6** | **4** |

Под вопросом — 3 (все понижены верификатором до low, доказательства частично ложные). Опровергнуто — 12.

---

## 🔴 CRITICAL

Обе находки — направление «Модели и БД», фундамент мультитенантной изоляции и хранения ПДн спец.категории.

### Изоляция тенантов на уровне БД почти отсутствует: RLS включён на 3 таблицах из 126
- **Файл:** `backend/alembic/versions/l2m3n4o5p6q7_rls_tenant_isolation.py:16`
- **Категория / действие:** security / fix
- **Суть:** RLS-политики созданы только для `referrals`, `bonuses`, `audit_log`. Ещё 123 таблицы с `tenant_id` (appointments, patient_documents, lab_*, telemedicine_*, clinic_payments, inventory_* и т.д.) политик не имеют, хотя инфраструктура RLS (`SET LOCAL app.tenant_id` в `get_db_for_tenant`) уже построена. Изоляция держится только на ручных `WHERE tenant_id` в прикладном коде — при 123 таблицах пропуск статистически неизбежен → межтенантная утечка медданных.
- **Что сделать:** Сгенерировать RLS-политики (`ENABLE`/`FORCE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation`) для ВСЕХ таблиц с `tenant_id` циклом по metadata. Добавить тест, падающий при появлении таблицы с `tenant_id` без политики.
- **Тяжесть:** critical (подтверждена как заявлено).

### appointments: tenant_id nullable + SET NULL, clinic_id FK без ondelete, ПДн пациента в plaintext
- **Файл:** `backend/app/models/doctor.py:91`
- **Категория / действие:** data-integrity / fix
- **Суть:** В самой нагруженной PHI-таблице `tenant_id` объявлен `nullable=True` с `ondelete=SET NULL` (обнуление принадлежности приёма делает его «бесхозным»), `clinic_id` — FK без `ondelete`, а `patient_phone`/`patient_name`/`notes` хранятся открытым текстом. Таблица также в списке без RLS.
- **Что сделать:** `tenant_id` → `NOT NULL` и `ondelete CASCADE/RESTRICT`; задать `ondelete` для `clinic_id`; зашифровать `notes`/`patient_name`; добавить RLS-политику.
- **Тяжесть:** critical (повышена верификатором с high — центральная PHI-таблица, сочетание потери принадлежности и plaintext ПДн).

---

## 🟠 HIGH

### Безопасность

### Системный bypass tenant-изоляции при NULL tenant_id (кросс-тенантный IDOR на медданные)
- **Файл:** `app/routers/patient_chat.py:396` (и medcard.py:102/119, patient_documents.py:81/109, patient_chat.py:183/436/470)
- **Категория / действие:** data-integrity / fix
- **Суть:** Повсеместный паттерн `if user.tenant_id and obj.tenant_id and obj.tenant_id != user.tenant_id: 404`. Если у записи `tenant_id IS NULL` — проверка пропускается, доступ разрешён. Любая запись без тенанта (seed/исторические/созданные при сессии без тенанта; `Clinic.tenant_id` nullable) видна и редактируема менеджером ЛЮБОГО тенанта — диагнозы, аллергии, документы, переписка. Нарушение 152-ФЗ.
- **Что сделать:** Строгая проверка `obj.tenant_id == user.tenant_id` (NULL ≠ разрешение); запретить запись с NULL `tenant_id` тенантным пользователям; миграция backfill существующих NULL-строк.
- **Тяжесть:** high (понижена верификатором с critical).

### Медданные спец.категории (диагнозы, аллергии, прививки, анализы) хранятся в plaintext
- **Файл:** `backend/app/models/medcard.py:26` (+ lab.py:117, patient_vital.py:48)
- **Категория / действие:** security / fix
- **Суть:** `PatientDiagnosis`, `PatientAllergy`, `PatientVaccination`, `LabResult`, `PatientVital` — все поля без шифрования, тогда как заметки/заключения/адрес/документы шифруются тем же `encryption_service`. Несогласованность указывает на пропущенные таблицы. Дамп БД раскрывает диагнозы и анализы пациентов.
- **Что сделать:** Применить паттерн `*_encrypted` + `encryption_service` к указанным полям; миграция шифрования существующих строк.
- **Тяжесть:** high (понижена верификатором с critical).

### PatientAccount без tenant_id — глобальные аккаунты пациентов по телефону
- **Файл:** `backend/app/models/patient_account.py:12`
- **Категория / действие:** security / fix
- **Суть:** `patient_accounts` имеет глобально уникальный `phone` и не имеет колонки `tenant_id`; `lab_orders`/`patient_documents` ссылаются на этот глобальный аккаунт. Клиники де-факто шарят справочник пациентов, RLS неприменим, ФИО/email видны вне границ клиники.
- **Что сделать:** Ввести связь many-to-many `tenant_patients` с `tenant_id` и фильтровать выдачу, либо явно задокументировать `patient_accounts` как намеренно-глобальную сущность с шифрованием ФИО/email и отдельным контролем доступа.
- **Тяжесть:** high (подтверждена как заявлено).

### /tenant/create без аутентификации при пустом onboarding_secret (fail-open)
- **Файл:** `app/routers/tenant.py:217`
- **Категория / действие:** security / fix
- **Суть:** Защита эндпоинта — `if expected and data.secret_key != expected: 403`, но `onboarding_secret` по умолчанию пустой (`config.py:65`). При незаданном `SECRET_ONBOARDING_KEY` условие ложно → эндпоинт публичный: любой может создавать тенантов с trial-лицензией и admin-пользователем (креды в ответе). DoS базы, спам-тенанты.
- **Что сделать:** Сделать fail-closed (пустой secret → 403/503). Лучше — навесить `Depends(require_super_admin)`, а secret оставить только для отдельного публичного self-service потока с rate-limit.
- **Тяжесть:** high (подтверждена как заявлено).

### IDOR в upsert конфига платёжного шлюза — поиск без фильтра tenant_id
- **Файл:** `app/routers/clinic_payments.py:396`
- **Категория / действие:** security / fix
- **Суть:** `PUT /clinics/{clinic_id}/payment-config` ищет существующий конфиг только по `clinic_id+gateway`, без `tenant_id` (в отличие от GET/list). Менеджер тенанта A, подставив `clinic_id` клиники тенанта B, перезапишет её секретный ключ/shop_id/is_active — компрометация или отключение чужого эквайринга. `require_manager` проверяет роль, не тенант.
- **Что сделать:** Добавить `PaymentGatewayConfig.tenant_id == tenant.id` в SELECT и проверять принадлежность `clinic_id` тенанту перед любой записью.
- **Тяжесть:** high (повышена верификатором с medium).

### Уязвимые версии зависимостей не подняты до заявленных безопасных (CVE открыты)
- **Файл:** `requirements.txt:11`
- **Категория / действие:** deps / fix
- **Суть:** Прошлый аудит заявил bump как выполненный, но в коде: `python-multipart==0.0.20` (нужно ≥0.0.27), `Pillow==11.3.0` (≥12.2.0), `weasyprint==66.0` (≥68.0), `starlette` не запинен вовсе. Открытые DoS/обработка изображений CVE при наличии загрузки картинок в support/документы. Ложное чувство закрытости. (Дубль этой же находки фигурирует в MEDIUM как `backend/requirements.txt:11,14,31`.)
- **Что сделать:** Применить заявленные версии, явно запинить `starlette>=0.49` с совместимым fastapi; внедрить `pip-audit` в CI, чтобы фиксы не откатывались молча.
- **Тяжесть:** high (повышена верификатором с medium).

### Реальный пароль БД захардкожен в обоих compose-файлах
- **Файл:** `docker-compose.yml:26` (+ docker-compose.monitoring.yml:41, .env.example:1)
- **Категория / действие:** security / fix
- **Суть:** `POSTGRES_PASSWORD: clinika_pass` прописан прямо в environment и продублирован в DSN мониторинга и в `.env.example`. Боевое значение в открытом виде в репозитории (и в git history — см. примечание о `.env` под git).
- **Что сделать:** Вынести пароль в `${POSTGRES_PASSWORD}` / secrets, в monitoring.yml — через `${}` или `DATA_SOURCE_PASS_FILE`. Сменить реальный пароль `clinika_pass`, раз он попал в git.
- **Тяжесть:** high (подтверждена как заявлено).

### Баги бэкенда — деньги и данные

### Per-clinic платёжный шлюз НИКОГДА не использует сохранённые ключи (фича сломана)
- **Файл:** `backend/app/services/acquiring/yookassa_adapter.py:84-90` (дубль: `app/services/acquiring/yookassa_adapter.py:85` в разделе «Безопасность», см. ниже)
- **Категория / действие:** broken-feature / fix
- **Суть:** Адаптер читает несуществующий атрибут `cfg.secret_key` (`getattr(...None)` → всегда None) и молча падает на ENV-ключи платформы. У модели есть только `secret_key_encrypted`; decrypt не вызывается нигде. Платежи всех клиник идут через ОДИН аккаунт платформы — деньги пациентов уходят не тому юрлицу; UI «Настройки→Онлайн-оплата» бесполезен.
- **Что сделать:** Читать `cfg.secret_key_encrypted` и расшифровывать через `encryption_service.decrypt()`; `shop_id` из `cfg.shop_id`; убрать молчаливый fallback на ENV при наличии активного конфига клиники.
- **Тяжесть:** high (понижена верификатором с critical).

### record_payment помечает счёт PAID при ЛЮБОЙ сумме платежа
- **Файл:** `backend/app/services/billing_service.py:201-235`
- **Категория / действие:** data-integrity / fix
- **Суть:** `record_payment` ставит `status=PAID` и реактивирует подписку из PAST_DUE без сверки `amount == invoice.amount`; роутер `billing.py:399` передаёт `amount` прямо из тела. Тенант может закрыть счёт на 49900₽ платежом в 1₽. Прямая потеря выручки + рассинхрон `billing_ledger`.
- **Что сделать:** Валидировать `amount` против `invoice.amount` (точное равенство либо накопление `paid_amount` с переходом в PAID только при `paid_amount >= amount`).
- **Тяжесть:** high (понижена верификатором с critical).

### _add_months падает ValueError для подписок, начатых 29-31 числа
- **Файл:** `backend/app/services/billing_service.py:27-36`
- **Категория / действие:** bug / fix
- **Суть:** `_add_months` возвращает `date(year, month, start.day)` — для дня 31 в 30-дневном месяце/феврале бросает ValueError. `create_subscription` и `generate_invoice` падают для любой подписки, оформленной 29/30/31 числа → пропуск биллинга.
- **Что сделать:** Кламп дня через `calendar.monthrange` (`day = min(start.day, monthrange(...)[1])`) или `dateutil.relativedelta`.
- **Тяжесть:** high (подтверждена как заявлено).

### update_clinic_payment_status доверяет webhook без сверки суммы и защиты от понижения статуса
- **Файл:** `backend/app/services/acquiring_service.py:125-154`
- **Категория / действие:** data-integrity / fix
- **Суть:** Статус ставится напрямую из webhook без повторной сверки через `adapter.get_status`, без проверки совпадения суммы и без запрета перехода `succeeded → pending`. Поздний/переигранный webhook перезапишет успешный платёж; заниженная сумма отметится succeeded; искажается выручка (`_sum_revenue`).
- **Что сделать:** Перед переходом в succeeded подтверждать статус и сумму через `adapter.get_status(gateway_payment_id)`; запретить понижение терминального статуса.
- **Тяжесть:** high (повышена верификатором с medium).

### reverse_writeoff не идемпотентен — цикл complete/uncomplete раздувает остатки склада
- **Файл:** `backend/app/services/inventory_fifo.py:213-274`
- **Категория / действие:** data-integrity / fix
- **Суть:** Реверс выбирает все движения с `appointment_id` и `quantity<0` и создаёт обратные INCOME, не маркируя оригиналы. Последовательность completed→in_progress→completed→in_progress множит физический остаток, искажает себестоимость, FIFO-партии и маржу. Эксплуатируется обычным переключением статуса приёма.
- **Что сделать:** Добавить флаг `reversed` на `InventoryMovement` (или реестр реверсов); обрабатывать только не-реверснутые движения, помечая их в той же транзакции.
- **Тяжесть:** high (подтверждена как заявлено).

### Награды лояльности: TOCTOU без блокировки — награда без баллов
- **Файл:** `backend/app/services/loyalty_ext_service.py:319-341`
- **Категория / действие:** bug / fix
- **Суть:** `can_claim` проверяет `points>=cost` отдельно от списания, без `with_for_update`. Два параллельных claim проходят проверку, баланс клампится в 0 вместо ухода в минус, но оба `LoyaltyClaim` создаются; `stock-=1` без блокировки → отрицательный остаток.
- **Что сделать:** Блокировать аккаунт и reward через `with_for_update` в одной транзакции; проверять достаточность баллов/стока внутри заблокированной транзакции перед списанием.
- **Тяжесть:** high (повышена верификатором с medium).

### Напоминания о приёме сравнивают локальное время с UTC-окнами (сдвиг 3 часа)
- **Файл:** `backend/app/jobs/appointment_reminders.py:72-101`
- **Категория / действие:** bug / fix
- **Суть:** `now=datetime.utcnow()` и окна t24/t2 считаются от UTC, а `apt_dt` — локальное (МСК) wall-clock время. Сравнение даёт ошибку ~3 часа: пуши «24ч/2ч до приёма» уходят рано или пропускаются (окно ±15 мин не накрывает момент). В `daily_digest_job.py` конверсия МСК→UTC сделана корректно.
- **Что сделать:** Привести `apt_dt` к UTC (вычесть смещение клиники, как в `_yesterday_msk_window`) перед сравнением, или сравнивать в едином TZ.
- **Тяжесть:** high (повышена верификатором с medium).

### Безопасность (платёжное шифрование)

### Fernet-шифрование платёжных секретов НЕ работает (write-only, фича сломана)
- **Файл:** `app/services/acquiring/yookassa_adapter.py:85`
- **Категория / действие:** broken-feature / fix
- **Суть:** Прошлый аудит заявил «Fernet-шифрование платёжных секретов ИСПРАВЛЕНО». По факту: роутер шифрует при записи (`secret_key_encrypted=_enc(...)`), но прочитать обратно невозможно — `decrypt()` не вызывается, у модели нет `secret_key`, докстринг всё ещё «Пока plain text». Per-clinic эквайринг из UI молча игнорируется, оплата падает в 503 или уходит на ENV-ключи. (Та же первопричина, что и в баге адаптера выше.)
- **Что сделать:** Добавить `@property secret_key` в `PaymentGatewayConfig`, возвращающий `encryption_service.decrypt(self.secret_key_encrypted)`, и читать его в адаптерах; удалить устаревший докстринг; покрыть e2e-тестом (конфиг через UI → `init_payment` использует именно его).
- **Тяжесть:** high (подтверждена как заявлено).

### Контракт API — мёртвые/несуществующие центральные эндпоинты

### Кабинет врача и франчайзи зовут несуществующий GET /manager/referrals/
- **Файл:** `frontend/src/pages/DoctorLayout.jsx:549` (+ :555, FranchiseOwnerCabinet.jsx:1381)
- **Категория / действие:** broken-feature / fix
- **Суть:** Фронт зовёт `/manager/referrals/`, а в бэке есть только `/manager/reports/referrals`. Список направлений в кабинете врача (основная рабочая страница) и у владельца франшизы не грузится (404). Направления между клиниками — центральная фича продукта.
- **Что сделать:** Заменить вызовы на `/manager/reports/referrals` или `/referrals/`, либо добавить маршрут-алиас `/manager/referrals/`.
- **Тяжесть:** high (подтверждена как заявлено).

### Вкладка «Атрибуция маркетинга» полностью нерабочая — нет эндпоинтов /marketing/attribution
- **Файл:** `frontend/src/components/marketing/AttributionTab.jsx:73` (+ :99/:399/:402)
- **Категория / действие:** broken-feature / add
- **Суть:** Фронт зовёт GET/POST/PATCH/DELETE `/marketing/attribution`, а `marketing_ads.py` (prefix `/marketing`) имеет только `/channels` и `/ad-spend`. CRUD-раздел атрибуции конверсий мёртв: список молча показывает «Нет атрибуций», создание/правка/удаление падают.
- **Что сделать:** Реализовать роутер `/marketing/attribution` (CRUD) либо скрыть вкладку до готовности backend.
- **Тяжесть:** high (понижена верификатором с critical/исходное high — деградация мягкая, но мёртв весь пользовательский CRUD-раздел).

### Корректность фронта

### Auth-store (zustand) рассинхронизирован с набором токенов в api/index.js
- **Файл:** `frontend/src/store/auth.js:5-15`
- **Категория / действие:** bug / fix
- **Суть:** Store хранит/чистит только `clinika_token_<SLUG>`, а `api/index.js` работает с четырьмя ключами (+ admin- и refresh-токены). После logout роли с admin-токеном (manager/franchise_owner/super_admin) валидный `clinika_admin_token_*` и refresh остаются в localStorage — пользователь остаётся частично залогинен / входит без пароля. Опасно на общем устройстве регистратуры.
- **Что сделать:** В `logout()` чистить все 4 ключа синхронно с `_getActiveTokenInfo`; вынести имена ключей в общий модуль, чтобы store и api не расходились.
- **Тяжесть:** high (повышена верификатором с medium).

---

## 🟡 MEDIUM

### Безопасность и инфра-безопасность

### RLS — мёртвая инфраструктура: get_tenant_db не используется ни в одном роутере
- **Файл:** `app/core/deps.py:169`
- **Категория / действие:** infra / improve
- **Суть:** `get_tenant_db` (ставит `app.tenant_id`) не используется ни в одном роутере; все ~175 эндпоинтов на `Depends(get_db)` без RLS-контекста. Заявленная защита «RLS tenant isolation» как defense-in-depth фактически отсутствует — любой пропущенный `WHERE tenant_id` = немедленный leak без страховочного слоя. (Тесно связано с CRITICAL про 3/126 политик.)
- **Что сделать:** Либо реально внедрить `get_tenant_db` во все тенантные роутеры + расширить RLS на все таблицы с `tenant_id`, либо удалить вводящую в заблуждение инфраструктуру. Минимум — централизованный helper для tenant-scoped запросов + линт-правило.
- **Тяжесть:** medium (подтверждена как заявлено).

### CORS-дефолт всё ещё содержит http://localhost:5173 (фикс не применён)
- **Файл:** `backend/app/config.py:62`
- **Категория / действие:** security / fix
- **Суть:** В дефолте `allowed_origins` остался `http://localhost:5173`; `main.py:1486` отдаёт его без гейта по environment. Если `ALLOWED_ORIGINS` не переопределён в `.env`, localhost разрешён в проде → CSRF/credential-leak вектор. (Дубль той же находки в LOW: `app/config.py:62`.)
- **Что сделать:** Убрать localhost из дефолта; добавлять его условно при `environment != production` (поле environment уже есть).
- **Тяжесть:** medium (подтверждена как заявлено).

### TLS-верификация отключена (verify=False) при отправке API-ключа на tenant-URL + SSRF
- **Файл:** `app/routers/commercial.py:427` (+ monitoring.py:120)
- **Категория / действие:** security / fix
- **Суть:** `_do_test` шлёт `Bearer {api_key}` через `httpx.AsyncClient(verify=False)` на `base_url`, заданный тенантом без валидации схемы/хоста → MITM-перехват ключа + SSRF на internal/metadata. Эндпоинт под super_admin, но и он не должен сливать ключи через MITM.
- **Что сделать:** Убрать `verify=False`; валидировать `base_url` (только https, блок-лист приватных/loopback/metadata — SSRF-guard); для monitoring использовать пиннинг/доверенный CA.
- **Тяжесть:** medium (подтверждена как заявлено).

### Redis без пароля, доступен всем контейнерам в docker-сети
- **Файл:** `docker-compose.yml:38`
- **Категория / действие:** security / improve
- **Суть:** `clinika-redis` без `requirepass`; `REDIS_URL` без auth. Любой контейнер в сети (в т.ч. скомпрометированный exporter/docker-proxy) имеет полный доступ: чтение сессий/лимитов, FLUSHALL, потенциально RCE через модули. Redis хранит JWT-blacklist/rate-limit.
- **Что сделать:** Включить `--requirepass ${REDIS_PASSWORD}`, обновить `REDIS_URL`/`REDIS_ADDR` экспортёра; минимум — `rename-command FLUSHALL`.
- **Тяжесть:** medium (подтверждена как заявлено).

### node-exporter и cAdvisor дают полный доступ к хосту (privileged, pid:host, mount /)
- **Файл:** `docker-compose.monitoring.yml:97` (+ :78/:87)
- **Категория / действие:** security / improve
- **Суть:** `cadvisor: privileged: true` + mount `/` — фактически root на хосте при компрометации (escape тривиален); `node-exporter: pid: host` видит все процессы. Штатно для этих образов, но расширяет поверхность атаки.
- **Что сделать:** Запускать cAdvisor с точечными `cap_add` вместо `privileged` где позволяет ядро; ограничить доступ к дашборду; для node-exporter отключить лишние коллекторы.
- **Тяжесть:** medium (подтверждена как заявлено).

### Баги бэкенда — конкурентность и деньги

### Двойная бронь слота: book_slot делает SELECT-then-INSERT без блокировки
- **Файл:** `backend/app/services/scheduling_service.py:74-126`
- **Категория / действие:** bug / fix
- **Суть:** Проверка конфликта и INSERT без `pg_advisory_xact_lock` (в отличие от `slot_booking_service.py`) и без уникального индекса на `(doctor_id, appointment_date, start_time)`. Два параллельных запроса создают две записи → двойная бронь. Эксплуатируется из публичного `/public/{slug}/book`.
- **Что сделать:** Добавить `pg_advisory_xact_lock` перед проверкой и/или partial unique index на активные приёмы.
- **Тяжесть:** medium (понижена верификатором с high).

### refund_clinic_payment без идемпотентности и проверки статуса/суммы — двойной возврат
- **Файл:** `backend/app/services/acquiring_service.py:157-179`
- **Категория / действие:** data-integrity / fix
- **Суть:** Реверс проверяет лишь наличие `gateway_payment_id`; нет проверки `status==SUCCEEDED`, «уже refunded» и `amount<=оплачено`. Повторный `/payments/{id}/refund` инициирует второй возврат в шлюзе; сумму можно завысить. Прямые денежные потери.
- **Что сделать:** Проверять `status=succeeded` и отсутствие предыдущего успешного возврата (idempotency по `payment_id`), ограничивать `amount`, фиксировать REFUNDED атомарно.
- **Тяжесть:** medium (понижена верификатором с high).

### Контракт API — битые эндпоинты кабинетов (5 находок)

Все ниже — фронт зовёт несуществующий путь; пользователь получает 404/405 или молчаливо пустое состояние. Чинить однотипно: переключить фронт на реальный путь либо реализовать недостающий эндпоинт.

### Поиск пациента в форме лаб-заказа зовёт несуществующий /admin/patients/search
- **Файл:** `frontend/src/components/lab/LabOrderForm.jsx:69`
- **Категория / действие:** broken-feature / fix
- **Суть:** Реальный поиск — `GET /referrals/patients/search`. Автокомплит пациента в форме лаб-заказа врача не работает.
- **Что сделать:** Переключить на `/referrals/patients/search` или добавить `/admin/patients/search`.
- **Тяжесть:** medium.

### Подбор слотов пациентом зовёт несуществующие /patient/doctors и /patient/services
- **Файл:** `frontend/src/components/chat/PatientSlotRequestPicker.jsx:25` (+ :26)
- **Категория / действие:** broken-feature / fix
- **Суть:** Роутер `/patient` таких путей не имеет; списки врачей/услуг пусты, пациент не выбирает врача/услугу при запросе слота из чата.
- **Что сделать:** Перенаправить на `/public/{slug}/doctors` и услуги клиники, либо добавить `/patient/doctors` и `/patient/services`.
- **Тяжесть:** medium.

### PATCH /patient/subscription/my (автопродление) не существует — бэк только GET
- **Файл:** `frontend/src/sections/PatientSubscriptionSection.jsx:335`
- **Категория / действие:** broken-feature / fix
- **Суть:** Управление подпиской — через POST `/cancel` и `/resume`. Тумблер «автопродление» не сохраняется (404/405).
- **Что сделать:** Использовать POST `/cancel|/resume` либо реализовать PATCH `/patient/subscription/my`.
- **Тяжесть:** medium.

### DELETE /patient/documents/{id} не реализован
- **Файл:** `frontend/src/sections/PatientDocumentsSection.jsx:122`
- **Категория / действие:** broken-feature / fix
- **Суть:** DELETE определён на `/documents/{id}`, но не на `/patient/documents/{id}`. Кнопка удаления документа пациентом не работает.
- **Что сделать:** Добавить DELETE `/patient/documents/{doc_id}` или вызывать корректный путь.
- **Тяжесть:** medium.

### Скачивание PDF лаб-результатов пациентом не работает — нет GET /patient/lab-results/{id}/pdf
- **Файл:** `frontend/src/sections/PatientLabResultsSection.jsx:86`
- **Категория / действие:** broken-feature / add
- **Суть:** В `patient_lab.py` есть только список; маршрута `/{id}/pdf` нет. Кнопка «скачать PDF» отдаёт 404.
- **Что сделать:** Реализовать `GET /patient/lab-results/{order_id}/pdf` или убрать кнопку.
- **Тяжесть:** medium.

### Откат версии регламента зовёт несуществующие версии-эндпоинты
- **Файл:** `frontend/src/pages/admin` (AdminRegulations)
- **Категория / действие:** broken-feature / add
- **Суть:** Фронт зовёт `GET /admin/regulations/{id}/versions/{vid}` и `POST .../rollback`, которых нет (есть только `POST /{id}/versions` и `.../publish`). Просмотр и откат версии регламента не работают.
- **Что сделать:** Добавить `GET .../versions/{version_id}` и `POST .../rollback`.
- **Тяжесть:** medium.

### DELETE токена календаря зовёт /tokens/{id}, бэк ждёт POST .../revoke
- **Файл:** `frontend/src/sections/PatientCalendarSection.jsx:124`
- **Категория / действие:** bug / fix
- **Суть:** Отзыв iCal-токена — это `POST /patient/calendar/tokens/{id}/revoke`; DELETE-маршрута нет. Нельзя отозвать доступ к календарю.
- **Что сделать:** Заменить на `POST /patient/calendar/tokens/{id}/revoke`.
- **Тяжесть:** medium.

### Модели/БД и зависимости

### Семь merge-миграций при единственном head — риск рассинхрона модель↔схема
- **Файл:** `backend/alembic/versions/secmerge01_merge_heads.py:1`
- **Категория / действие:** infra / improve
- **Суть:** Head один (`piimed_03`), но в истории 7 multi-parent merge-узлов; параллельно зафиксированы расхождения index/ondelete (156/29). Признак, что модели менялись без `autogenerate`-сверки → будущая autogenerate-миграция выдаст большой неожиданный diff.
- **Что сделать:** Прогнать `alembic revision --autogenerate` в чистой БД, сверить diff, зафиксировать расхождения; в CI добавить проверку «autogenerate даёт пустую миграцию» и «ровно один head».
- **Тяжесть:** medium (подтверждена как заявлено).

### Зависимости не подняты до заявленных версий (дубль)
- **Файл:** `backend/requirements.txt:11,14,31`
- **Категория / действие:** deps / fix
- **Суть:** Та же находка, что в HIGH (`requirements.txt:11`): `python-multipart==0.0.20`, `Pillow==11.3.0`, `weasyprint==66.0`, `starlette` не закреплён. Часть security-фиксов Wave A/B по факту не применена.
- **Что сделать:** Поднять до заявленных версий, закрепить starlette явно, прогнать `pip-audit`. Закрывается вместе с HIGH-дублем.
- **Тяжесть:** medium (подтверждена как заявлено).

### Дрейф версий: 8 backend-пакетов через >= вместо точного пина
- **Файл:** `backend/requirements.txt:22`
- **Категория / действие:** deps / fix
- **Суть:** `apscheduler/structlog/prometheus-client/tenacity/holidays/anthropic` открыты вверх без потолка. При каждой пересборке (без lock) подтягиваются последние мажоры — `anthropic>=0.45.0` может уехать на ломающий мажор. Невоспроизводимые сборки.
- **Что сделать:** Запинить `==` или поставить потолок `>=X,<Y`; сгенерировать lock через `pip-compile`/`pip freeze`. Особенно критичен `anthropic`.
- **Тяжесть:** medium (подтверждена как заявлено).

### Инфра — мониторинг и сборка

### Все сервисы (БД, backend, мониторинг) без resource limits — риск OOM боевого backend/db
- **Файл:** `docker-compose.monitoring.yml:7` (+ docker-compose.yml)
- **Категория / действие:** infra / add
- **Суть:** Ни у одного сервиса нет `mem_limit`/`cpus`. Prometheus (retention 30d) или cAdvisor могут выесть память хоста и спровоцировать OOM-killer, который убьёт `clinika-backend`/`clinika-db` на том же сервере.
- **Что сделать:** Добавить `mem_limit`/`cpus` минимум для prometheus, cadvisor, clinika-db, clinika-backend (напр. prometheus 1g, cadvisor 512m).
- **Тяжесть:** medium (подтверждена как заявлено).

### redis-exporter healthcheck не проверяет работоспособность (distroless, -version)
- **Файл:** `docker-compose.monitoring.yml:61`
- **Категория / действие:** infra / fix
- **Суть:** `test: ["CMD","/redis_exporter","-version"]` на distroless-образе лишь печатает версию, не проверяя `:9121/metrics` и коннект к Redis; в части релизов даёт сбой → недостоверный healthy/unhealthy.
- **Что сделать:** Заменить на проверку самого `:9121/metrics` или убрать healthcheck и мониторить `up{job="redis-exporter"}` в Prometheus (blackbox-проба).
- **Тяжесть:** medium (подтверждена как заявлено).

### Плавающий тег :latest у Prometheus и большинства exporters
- **Файл:** `docker-compose.monitoring.yml:8` (+ :36/:55/:73/:114)
- **Категория / действие:** infra / fix
- **Суть:** `prometheus`, `postgres-exporter`, `redis_exporter`, `node-exporter`, `blackbox-exporter` на `:latest` (запинен только cadvisor). Непредсказуемые обновления: ломающиеся форматы метрик, новые флаги healthcheck, несовместимость с дашбордами.
- **Что сделать:** Запинить конкретные версии (prometheus:v2.x, redis_exporter:v1.62.0, postgres-exporter:v0.15.0, node-exporter:v1.8.x, blackbox-exporter:v0.25.x).
- **Тяжесть:** medium (подтверждена как заявлено).

### Dockerfile фронтенда: npm install вместо npm ci, lock не копируется
- **Файл:** `frontend/Dockerfile:9`
- **Категория / действие:** infra / fix
- **Суть:** Копируется только `package.json`, без `package-lock.json`; `npm install` резолвит `^`-диапазоны заново → невоспроизводимые сборки, supply-chain риск.
- **Что сделать:** `COPY package.json package-lock.json ./` и `RUN npm ci`.
- **Тяжесть:** medium (подтверждена как заявлено).

### Корректность фронта и маршруты

### Дубль кабинета пациента: PatientCabinet (3863) + PatientCabinetPreview (2373) — оба в проде
- **Файл:** `frontend/src/pages/PatientCabinetPreview.jsx:1983` (роут `App.jsx:650-659`)
- **Категория / действие:** dead-code / improve
- **Суть:** Живой публичный роут `/{slug}/p-new` рендерит «preview»-версию параллельно боевому `/{slug}/p`. 6200+ строк дублирующей логики; фиксы надо вносить в оба места; пользователь может застрять в недоделанной версии по угадываемому URL.
- **Что сделать:** Выбрать одну версию: завершить миграцию на preview и удалить старый, либо убрать `/p-new` из прод-роутинга (оставить за флагом для super_admin).
- **Тяжесть:** medium (подтверждена как заявлено).

### Монолит AdminLayout.jsx — 9004 строки, ~90 компонентов в одном файле
- **Файл:** `frontend/src/pages/AdminLayout.jsx:1`
- **Категория / действие:** infra / improve
- **Суть:** ~35 крупных `*Section` в одном файле: тяжёлый редактор/линтер, конфликты при параллельной работе, медленный HMR, сложное тестирование. Главный риск поддержки во всём фронте.
- **Что сделать:** Вынести каждую `*Section` в `sections/admin/*.jsx` через `lazy()` (как уже сделано для NetworkDashboard/ChurnDashboard); AdminLayout оставить оболочкой.
- **Тяжесть:** medium (подтверждена как заявлено).

### Production ErrorBoundary показывает пользователю сырой stack trace
- **Файл:** `frontend/src/main.jsx:30-39`
- **Категория / действие:** ux / fix
- **Суть:** `LocalErrorBoundary` выводит `error.message` + весь `error.stack` в `<pre>` без гейта по `MODE` — пациент/сотрудник видит технический стектрейс. Плохой UX + утечка деталей реализации; для 152-ФЗ-системы выглядит непрофессионально.
- **Что сделать:** В проде (`import.meta.env.PROD`) показывать дружелюбный экран с кнопкой «Обновить» и контактом поддержки; stack — только в DEV; ошибку логировать в Sentry (уже подключён).
- **Тяжесть:** medium (подтверждена как заявлено).

### Секции AdminLayout не восстанавливаются по deep-link (неполный ADMIN_SECTIONS)
- **Файл:** `frontend/src/pages/AdminLayout.jsx:8011-8018`
- **Категория / действие:** bug / fix
- **Суть:** `ADMIN_SECTIONS` (Set) не содержит ~16 ключей, реально рендеримых в `renderSection` и присутствующих в NAV (sa_users, security, feature_flags, franchise_*, churn и др.). При F5 или переходе по ссылке на такие секции пользователя сбрасывает на `home`. Затронуто ~16-17 из ~50 секций.
- **Что сделать:** Синхронизировать `ADMIN_SECTIONS` с фактическим списком ключей NAV/renderSection (snake_case согласовать).
- **Тяжесть:** medium (подтверждена как заявлено).

---

## 🟢 LOW

Преимущественно техдолг, мёртвый код и понижённые маршрутные находки. В конце раздела — блок INFO (наблюдения и подтверждения уже применённых фиксов).

### Баги бэкенда и data-integrity

### Webhook платежа выбирает конфиг шлюза первого попавшегося тенанта
- **Файл:** `backend/app/routers/clinic_payments.py:228-235`
- **Категория / действие:** bug / fix
- **Суть:** `cfg = SELECT ... WHERE gateway AND is_active LIMIT 1` без `tenant_id/clinic_id`. Для HMAC-шлюзов (tinkoff/cloudpayments) подпись проверяется чужим секретом. Сейчас латентно (реален только yookassa с IP-allowlist), станет критично при включении HMAC.
- **Что сделать:** Определять платёж по `metadata.internal_payment_id` ДО verify, затем брать cfg по его `tenant_id+clinic_id+gateway`.
- **Тяжесть:** low (понижена верификатором с high).

### Заявленное шифрование API-ключей лабораторий не работает (импорт несуществующего модуля)
- **Файл:** `app/services/lab_service.py:39`
- **Категория / действие:** data-integrity / fix
- **Суть:** `encrypt/decrypt_api_key` импортируют несуществующий `secrets_service`; ImportError ловится `except: return f'plain:{raw}'` → `api_key_encrypted` всегда хранится как `plain:<ключ>`. Дамп БД = слив ключей лабораторий (проверить также OFD/telephony).
- **Что сделать:** Исправить импорт на `app.services.encryption_service` во всех местах; миграция повторного шифрования существующих `plain:`-значений.
- **Тяжесть:** low.

### record-уровневые гонки и точность денег
- **Файлы:** `backend/app/routers/auth.py:519-538` (register-invite check-then-increment без блокировки → превышение `max_uses`); `backend/app/services/billing_service.py:132-138` (номер счёта через `COUNT(*)+1` — дубли/переиспользование номеров, нарушение 54-ФЗ); `backend/app/services/bonus_service.py:23,98` (денежные суммы через `float()` в Decimal-реестр — потеря копеек).
- **Категория / действие:** bug / data-integrity / fix + improve
- **Суть:** Три отдельные находки одного класса — неатомарные операции и потеря точности в финансовых потоках.
- **Что сделать:** Инвайты — атомарный `UPDATE ... SET uses_count=uses_count+1 WHERE uses_count<max_uses RETURNING`; номер счёта — БД-`Sequence` + unique-индекс на `invoice_number`; бонусы — передавать `Decimal` напрямую без `float()`.
- **Тяжесть:** low (все три).

### Два параллельных чат-движка (PatientChat vs ChatThread) сосуществуют
- **Файл:** `backend/app/routers/patient_chat.py:1`
- **Категория / действие:** dead-code / improve
- **Суть:** Смонтированы две независимые подсистемы чата (AI-ассистент на `PatientChat` и async-треды на `ChatThread`); разные сервисы используют разные. Поддержка двух хранилищ, расхождение SLA/непрочитанных.
- **Что сделать:** Зафиксировать целевой движок, второй пометить deprecated, спланировать миграцию/удаление.
- **Тяжесть:** low.

### Безопасность

### CORS: localhost:5173 в prod-дефолте (дубль MEDIUM-находки)
- **Файл:** `app/config.py:62`
- **Категория / действие:** security / fix
- **Суть:** То же, что MEDIUM `backend/app/config.py:62`. Закрывается тем же фиксом (убрать localhost из дефолта, гейт по environment).
- **Тяжесть:** low.

### Загрузка файлов support: serve_file без проверки владельца
- **Файл:** `app/routers/support.py:191`
- **Категория / действие:** security / improve
- **Суть:** `GET /support/files/{filename}` отдаёт файл по UUID-имени без проверки `msg.user_id == current_user.id`. Эксплуатация низкая (UUID практически неперебираемо), но утечка имени через логи возможна.
- **Что сделать:** Привязать загрузку к `SupportMessage` и проверять владельца/оператора того же тенанта перед отдачей.
- **Тяжесть:** low.

### Инфра — зависимости и compose-гигиена

### Устаревшие версии пакетов (без активных CVE)
- **Файлы:** `frontend/package.json:35` (vite ^5.4.20 — 5.4.21 уже пропатчен, плановый апгрейд до 6); `package.json:22` (react 18.3 / react-router 6 / tailwind 3 — техдолг); `package.json:18` (jspdf 4.2.1 — выше уязвимых 2.x/3.0.0, оставить); `backend/requirements.txt:5` (psycopg2-binary 2.9.9, asyncpg 0.29.0, redis 5.0.4 — плановое обновление).
- **Категория / действие:** deps / improve
- **Суть:** Группа находок «устаревший мажор без эксплуатируемых CVE» — технический долг, не безопасность. Срочности нет.
- **Что сделать:** Запланировать апгрейды отдельными задачами (react-router 6→7, tailwind 3→4, vite→6, psycopg2/asyncpg/redis до текущих); держать `npm audit`/`pip-audit` в поле зрения.
- **Тяжесть:** low (все).

### Compose: healthcheck/depends_on/persistence гигиена (6 находок)
- **Файлы:** `.env.example:69` (GRAFANA_ADMIN_PASSWORD без сервиса grafana / дефолт admin/admin); `docker-compose.yml:45` (redis healthcheck `ping` сломается при включении пароля); `docker-compose.yml:80` (backend depends_on redis `service_started`, не `service_healthy`); `docker-compose.yml:125` (bot depends_on backend без `service_healthy`); `docker-compose.monitoring.yml:41` (postgres-exporter `sslmode=disable`).
- **Категория / действие:** infra/security / fix + improve
- **Суть:** Мелкие дефекты оркестрации: ложные unhealthy/рестарт-петли при включении Redis-пароля, старт до готовности зависимостей, незашифрованный метрик-коннект, рассинхрон `.env.example` vs compose (потенциальный admin/admin Grafana вне репо).
- **Что сделать:** Привести depends_on к `condition: service_healthy`; в redis healthcheck учесть будущий `-a $REDIS_PASSWORD`; убрать или подключить переменную Grafana (`GF_SECURITY_ADMIN_PASSWORD=${...:?required}`), проверить что внешняя Grafana не на admin/admin; при выносе мониторинга включить `sslmode=require`.
- **Тяжесть:** low (все).

### Контракт API — битые эндпоинты вторичных страниц (7 находок)

Однотипны находкам из MEDIUM (фронт зовёт несуществующий путь), но на менее критичных экранах. Чинить так же: переключить на реальный путь или реализовать эндпоинт.

- **AdminChurn** (`frontend/src/pages/AdminChurn.jsx:33`, fix) — зовёт `/admin/analytics/churn-rate` и `/churn-reasons`; реальны `/admin/analytics/churn` и `/admin/churn/summary`. В коде есть признание «endpoint будет реализован». Дашборд оттока super_admin пуст.
- **PatientFamilySection** (`:252`, fix) — PATCH `/patient/family` для переименования семьи нет (есть только GET/POST на коллекции).
- **DoctorLabOrdersSection** (`:132`, add) — нет `GET /doctor/lab-orders/{id}/pdf`; есть только `/results`.
- **FranchiseOwnerCabinet** (`:1760`, fix) — PATCH `/integrations/mis/settings` не реализован (сам код помечает TODO).
- **PatientChatHub** (`:207`/`:246`, fix) — зовёт mock `/patient/support/messages`; реальны `/support/patient/thread` и `/support/patient/send`.
- **PatientSubscriptionSection** (`:254`, fix) — `GET /patient/subscription/history` не существует, блок истории не грузится.
- **Тяжесть:** low (все). Действие: переключить фронт на существующие пути либо реализовать недостающие.

### Маршруты, меню и мёртвый код фронта (понижено верификатором)

Группа маршрутных находок, изначально оценённых как high/medium, понижена до low: это мёртвый код, недостижимые роуты и UX-деградация, не баги безопасности.

- **/admin/* в MiniApp недостижимы** (`frontend/src/App.jsx:448-455`, fix) — 6 роутов перехватываются AdminRoot раньше; 4 фичи реально доступны через секции AdminLayout, 2 (Supervisor, Announcements) — нет.
- **AdminSupervisor и PlatformAnnouncements осиротевшие** (`AdminSupervisor.jsx:170`, `PlatformAnnouncements.jsx:19`, fix) — готовые super_admin-страницы (мониторинг сервисов с рестартом, рассылка объявлений) без единой входящей ссылки. Решить: добавить в NAV/ADMIN_SECTIONS/renderSection либо удалить.
- **Logout бухгалтера ведёт на несуществующий /{slug}/login** (`_AccountantShell.jsx:53`, fix) — заменить на `/{slug}/` или `/{slug}/admin`.
- **Dashboard.jsx — осиротевший компонент** (две находки: `App.jsx:26` и `pages/Dashboard.jsx:1`, remove) — `lazy`-импорт без `<Route>`, внутри битая ссылка `/partner/create`. Удалить файл и импорт.
- **BottomNav «Персонал» менеджера → удалённый /admin-panel** (`BottomNav.jsx:25`, remove) — мёртвый `managerItems` (не рендерится, role==='manager' → null). Удалить массив.
- **Director: /director/engagement и /director/network без пункта меню** (`App.jsx:434-435`, fix) — orphan-роуты, на них нет ни одной ссылки из UI. Добавить в DIR_NAV либо убрать роуты.
- **Нет catch-all (path="*")** (`App.jsx:308-458`, add) — несовпавшие пути дают пустой/белый экран вместо 404. Добавить `<Route path="*">` в каждый `<Routes>`.
- **Ролевые роуты без guard/редиректа** (`App.jsx:336-456`, improve) — чужой роли белый экран без «нет доступа» (данные защищены бэком). Ввести `<RequireRole>` wrapper/fallback в RootRedirect.
- **Region-lock 403 деградирует до alert()** (`api/index.js:65-82`, improve) — возможен двойной alert поверх модалки либо дешёвый нативный alert. Сделать явное подтверждение обработки слушателем.
- **Тяжесть:** low (все).

### ⚪ Блок INFO (наблюдения и подтверждения, в составе LOW)

Ниже порога low — частью наблюдения, частью положительные подтверждения, что прошлые фиксы реально применены (действий не требуют).

**Требуют внимания (improve/fix):**
- **fire-and-forget asyncio.create_task для TG-нотификаций** (`staff_chat_mentions.py:150-153`) — задача может быть собрана GC до завершения, исключения проглатываются. Хранить ссылки на задачи + логировать исключения.
- **~523 backend-эндпоинта без вызова из фронта** (`admin.py:433`) — группы `/admin/billing/*`, `/admin/arr-ltv/*`, `/admin/franchises/*`, `/admin/modules/health/*` могут быть мёртвыми или с разрывом UI↔API. Пройтись по группам, подключить UI или удалить.
- **docker-proxy и monitoring-конфиги отсутствуют в аудит-копии** (`docker-compose.yml:55`) — убедиться, что `docker-proxy/Dockerfile`, `monitoring/prometheus.yml`, `monitoring/blackbox.yml` есть в основном репо и не в `.gitignore` (иначе деплой мониторинга/прокси невозможен).
- **Дублирующий роут design-preview-2** (`App.jsx:319`, remove) — вложенный в Layout Route недостижим (публичный обработчик покрывает всё). Удалить.
- **BottomNav «Записать» партнёра → /partner/create** (`BottomNav.jsx:6`, fix) — мёртвый код (partner_doctor редиректится на /admin до Layout). Удалить `partnerItems`.

**Подтверждения применённых фиксов (действий не требуют):**
- Хардкод-токен Telegram в `support.py:26` — удалён (читается из env/DB). NB: отозвать/ротировать старый токен в BotFather — он остался в git history.
- Refresh-token rotation с reuse-detection (`auth.py:318`) — реализован корректно (OAuth best practice).
- `python-multipart 0.0.20` (CVE-2024-53981), `Pillow 11.3.0`, `jinja2 3.1.6`, `weasyprint 66.0` — CVE закрыты, версии безопасны. NB: в HIGH/MEDIUM зафиксировано требование поднять multipart/Pillow/weasyprint ещё выше до заявленных в Wave A/B значений — это про несоответствие заявленному, а не про открытую CVE; решать единым bump-ом.

---

## ⚠️ Под вопросом (3)

Все три понижены верификатором до low: доказательства частично ложные, требуют ручной проверки в реальной БД/окружении.

| Title | File | Почему требует ручной проверки |
|---|---|---|
| 156 ForeignKey без index=True (массовые seq scan) | `backend/app/models/inventory.py:79` | AST-скан аудитора не учёл table-level `Index()` в `__table_args__`: все 8 цитат по inventory.py — ложные (tenant_id там проиндексирован), число 156 завышено (реально <142). НО часть пропусков реальна: `user.py:52 clinic_id`, `referral.py:22/23`, `telephony.py:35/56 clinic_id`, ряд `tenant_id` в низкочастотных таблицах. Проверить вручную фактический список непроиндексированных FK с учётом миграций. |
| tenant_id без FK/индекса в patient_session/patient_family | `backend/app/models/patient_session.py:18` | Подтверждено: нет FK на `tenants.id` (отклонение от конвенции, риск висячих ссылок). Опровергнуто: `patient_sessions.tenant_id` проиндексирован миграцией (композит phone+tenant_id), а «медленный scope-lookup» недостижим — запросов по `tenant_id` для этих таблиц нет. Решить, добавлять ли FK ради целостности. |
| Starlette не запинен явно (DoS CVE) | `backend/requirements.txt:1` | Подтверждено: нет явного пина и lockfile. Опровергнуто: версионное обоснование аудитора неверно (не 0.41.x). Соседний аудит-док указывает реально установленную 0.46.2 → CVE-2025-54121 (фикс в 0.47.2) вероятно ОТКРЫТА (multipart spooling до route-level проверок). Подтвердить `pip freeze` в реальном окружении; пин starlette всё равно нужен (см. HIGH про deps). |

---

## ❌ Опровергнуто (12)

Отброшены верификацией, в план действий НЕ входят:

- Перепривязка чата (ReassignModal) зовёт несуществующий `/users/clinic-staff`
- ClinicChatSection зовёт несуществующий `GET /clinic/doctors`
- SMS-кампания может зависнуть в SENDING / дублировать: DISTINCT+LIMIT без ORDER BY
- RLS-политика «tenant_id IS NULL → видна всем» в связке с SET NULL → глобальная утечка
- 29 ForeignKey без ondelete
- OTP-коды входа пациентов хранятся в plaintext
- 52 колонки tenant_id объявлены nullable=True
- InternalReferral.tenant_id = SET NULL (контейнер медицинского направления)
- postgres-exporter healthcheck бьёт по неверному порту / без shell на distroless
- Опасные дефолты-заглушки секретов в .env.example (SECRET_KEY/QR_SECRET=change-me)
- xlsx (SheetJS) tarball-URL 0.20.3 — Prototype Pollution / ReDoS CVE
- python-jose 3.4.0 — ecdsa-зависимость уязвима к Minerva

---

## 🎯 Рекомендованный порядок устранения (топ-10)

Приоритизация с учётом контекста 2026-06-07: **`.env` отслеживается git → секреты (включая `clinika_pass`) уже в истории приватного репо**, поэтому ротация секретов выходит на первое место.

1. **Сменить и ротировать все секреты, попавшие в git** — пароль БД `clinika_pass` (docker-compose × 2 + .env.example), токен Telegram-бота в BotFather (остался в history), любые ключи из `.env`. Вынести в secrets/`${}`. *(HIGH: docker-compose.yml:26; INFO: support.py)*
2. **Закрыть кросс-тенантный IDOR при NULL tenant_id** — строгая проверка `obj.tenant_id == user.tenant_id` в patient_chat/medcard/patient_documents + backfill NULL. Прямой обход изоляции медданных. *(HIGH: patient_chat.py:396)*
3. **Включить RLS на всех 123 таблицах с tenant_id** + тест на отсутствие политики. Страховочный слой БД против любого пропущенного `WHERE tenant_id`. *(CRITICAL: l2m3n4o5p6q7; связано MEDIUM: deps.py:169)*
4. **Починить appointments-модель** — `tenant_id` NOT NULL + ondelete, ondelete для clinic_id, шифрование ПДн, RLS. *(CRITICAL: doctor.py:91)*
5. **Закрыть fail-open /tenant/create** — fail-closed при пустом onboarding_secret + `require_super_admin`. Публичное создание тенантов = DoS. *(HIGH: tenant.py:217)*
6. **Поднять уязвимые зависимости** — python-multipart≥0.0.27, Pillow≥12, weasyprint≥68, явный pin starlette≥0.49 (закрывает и CVE-2025-54121 из «под вопросом») + pip-audit в CI. *(HIGH: requirements.txt:11; uncertain: starlette)*
7. **Платёжка — деньги:** валидация суммы в `record_payment` (HIGH: billing_service.py:201), идемпотентность `refund_clinic_payment` (MEDIUM: acquiring_service.py:157), сверка webhook-статуса/суммы (HIGH: acquiring_service.py:125). Прямые денежные потери.
8. **Починить расшифровку платёжных секретов и эквайринг клиник** — `@property secret_key` + decrypt в адаптере; устранить молчаливый fallback на ENV. Деньги пациентов уходят не тому юрлицу. *(HIGH: yookassa_adapter.py:84-90 / :85)*
9. **IDOR в upsert payment-config** — добавить фильтр `tenant_id` + проверку принадлежности clinic_id. Перехват/отключение чужого эквайринга. *(HIGH: clinic_payments.py:396)*
10. **Зашифровать медданные спец.категории** (диагнозы/аллергии/анализы/витал) — согласовать с уже шифруемыми полями; миграция. 152-ФЗ. *(HIGH: medcard.py:26)*

После топ-10 — устранение зависших фич с битыми эндпоинтами (HIGH: `/manager/referrals/`, `/marketing/attribution`), затем MEDIUM по контракту API и инфра-гигиене, далее LOW/техдолг.
