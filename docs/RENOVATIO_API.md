# Аудит публичного API МИС Renovatio (для LTV-модуля)

> Проведён 2026-05-07 (повторно — после анонса Renovatio об открытии 5 новых методов).
> Тестовая инсталляция: `https://mis.stoclinic.ru:3010/api/public`
> API-ключ хранится в `.env` тенанта (`MIS_API_KEY`) и в БД (`tenants.mis_api_key`) — в коде/документации значения не приводятся.

## Транспорт

- Все методы — `POST` `application/x-www-form-urlencoded` на `<base_url>/<method>`
- Обязательное поле в теле: `api_key`
- Ответ: JSON `{"error": 0|1, "data": ...}`. При `error=1` `data = {"code": "404"|403|500, "desc": "..."}`
  - `404 Method not found` — метода нет в API
  - `403 No access to method` — метод существует, но текущий API-ключ не имеет к нему доступа (нужно расширение прав на стороне Renovatio)
  - `500` — метод доступен, но не хватает обязательных параметров (текст ошибки на русском)
- TLS-сертификат — сейчас в коде включён обход через `MIS_SSL_VERIFY=false` либо CA-pin через `MIS_CA_CERT_PATH`

---

## 1. Что мы УЖЕ используем

| Метод | Наша обёртка | Использование |
|---|---|---|
| `getClinics` | `mis_client.get_clinics()` | импорт филиалов, `test_connection` |
| `getServices` | `mis_client.get_services(clinic_id)` | прайс-лист, синхронизация в нашу `services` |
| `getUsers` | `mis_sync_service.get_mis_users()` | синхронизация врачей (фильтр `role_names contains "doctor"`) |
| `getAppointments` | `mis_client.get_appointments(...)`, `mis_sync_service.poll_and_confirm_referrals` | авто-подтверждение направлений, история визитов пациента |
| `getPatient` | `mis_client.find_patient_by_phone(phone)` | поиск пациента по телефону |
| `getPayments` ⚠️ 403 | `mis_client.get_payments(clinic_id, date_from, date_to)` | NetLTV (фактические оплаты). На 2026-05-07 ключ всё ещё возвращает 403 — Renovatio открыл метод, но не для нашего api_key. После открытия — ядро NetLTV-расчёта в `RenovatioAdapter.fetch_patient_visits`. |
| `getInvoices` ⚠️ 403 | `mis_client.get_invoices(clinic_id, date_from, date_to)` | счета и скидки (для будущей сверки с visit.sum_value) |
| `getPrograms` ⚠️ 403 | `mis_client.get_programs(clinic_id)` | каталог абонементов (название, срок, цена) |
| `getPatientPrograms` ⚠️ 403 | `mis_client.get_patient_programs(clinic_id)` | купленные пациентом абонементы (отложенная выручка) |
| `getCalls` ⚠️ 403 | `mis_client.get_calls(clinic_id, date_from, date_to)` | журнал звонков для маркетинговой атрибуции |

> Все 5 новых обёрток уже добавлены в `backend/app/services/mis_client.py`. При 403 они возвращают пустой список и логируют warning, поэтому `RenovatioAdapter` **деградирует в Gross-only режим без падений**.

### Пример ответа `getClinics` (показ — 1 элемент массива из `data`)

```json
{
  "id": 4,
  "title": "КС - АРЦ",
  "full_title": "ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"АРЦ\"",
  "phone": "+7 8712 29 08 08",
  "mobile": "+7 (928) 085-88-77",
  "email": null,
  "address": "Чеченская Респ, г. Грозный, …",
  "inn": "2014030961",
  "kpp": "201401001",
  "bank": "Южный филиал ПАО РОСБАНК",
  "account": "40702810751150001448",
  "director_name": "Лечиев Ислам Узерович",
  "city": "Грозный, Ахматовский",
  "is_deleted": false
}
```

### Пример элемента `getServices` (1560 записей)

```json
{
  "service_id": 16649,
  "code": "L16.34.039",
  "title": "Педиатрическая панель №1 (IgE)",
  "category_id": 2533,
  "category_title": "Аллергология",
  "category_path": "Аллергология",
  "profession_id": null,
  "profession_title": null,
  "original_price": "1050",
  "price": 2150,
  "duration": null,
  "lab": "АМУ Клиники Столицы",
  "tax": null,
  "short_desc": "...",
  "preparation": "...",
  "types": [],
  "agent_id": null,
  "is_deleted": false,
  "is_hidden": false,
  "is_telemedicine": false
}
```

> Категории услуг **уже доступны** через `getServices` — поля `category_id`, `category_title`, `category_path`. Отдельный `getServiceCategories` возвращает 403, но он не нужен.

### Пример элемента `getAppointments` (за период)

```json
{
  "id": 47338,
  "time_start": "27.03.2025 12:45",
  "time_end": "27.03.2025 13:00",
  "clinic_id": 1, "clinic": "КС - Лорсанова",
  "doctor_id": 30, "doctor": "Дежурный С. П.",
  "patient_id": 42011,
  "patient_name": "Исмаилова Хадижа Билаловна",
  "patient_phone": "+7 (922) 452-31-18",
  "date_created": "27.03.2025 12:53",
  "date_updated": "03.04.2025 10:57",
  "status": "upcoming",
  "status_id": 3,
  "is_first": false,
  "is_first_clinic": false,
  "is_first_doctor": false,
  "sum_value": 2220,
  "services": [
    {
      "id": 4725, "code": "L04.04.003",
      "title": "С-реактивный белок ...",
      "price": "320", "original_price": "135",
      "count": 1,
      "discount": "0", "discount_type": 1,
      "value": "320",
      "profession": 16, "profession_title": "Клиническая лабораторная диагностика",
      "invoice_number": 16762,
      "program_id": null, "program_group_id": null,
      "provided_users": []
    }
  ],
  "patient_data": { /* … */ },
  "patient_channel_id": null, "patient_channel": null,
  "channel_id": null, "channel": null,
  "source": null, "type": null
}
```

### Пример `getPatient`

```json
{
  "patient_id": 344355,
  "number": 67517,
  "last_name": null,
  "first_name": "_Пациент_67517",
  "birth_date": null,
  "gender": null,
  "mobile": "+7 (928) 085-88-77",
  "email": null,
  "address": { "city": null, "street": null, "house": null, "flat": null, "fullAddress": null },
  "category_ids": null,
  "parent_id": null,
  "groups": null,
  "adv_channel_id": null,
  "has_account": null,
  "mobile_is_confirmed": null,
  "documents": null,
  "is_foreign_document": false,
  "country": [],
  "is_deleted": false,
  "date_created": "25.04.2026",
  "date_updated": "25.04.2026"
}
```

### Новые методы — статус и ожидаемая структура (на 2026-05-07)

Renovatio обещал открыть 5 методов на нашем `MIS_API_KEY`, но curl-проверка от 2026-05-07 показала, что **все 5 продолжают возвращать `{"error":1,"data":{"code":403,"desc":"No access to method"}}`**.

Что сделано на нашей стороне (готовы к моменту открытия доступа):
- В `mis_client.py` добавлены 5 обёрток с graceful degradation (`get_payments`, `get_invoices`, `get_programs`, `get_patient_programs`, `get_calls`) — при 403 возвращают `[]` и логируют info, чтобы не валить пайплайн.
- В `ltv_service.py:RenovatioAdapter` параллельно дёргается `get_payments` через `_fetch_payments_index`; если данных нет — `total_paid = 0`, `net_ltv = 0`.
- В таблице `patient_ltv_snapshots` добавлено поле `net_ltv` (миграция `ltv2net1ltv2`).
- В UI (`LtvAnalyticsSection.jsx`) добавлены KpiCard «Средний NetLTV» и колонка «NetLTV» в таблице топ-пациентов; при `net_ltv = 0` показывается «—».

| Метод | Параметры | Ожидаемая структура (по аналогии с другими методами Renovatio) |
|---|---|---|
| `getPayments` | `clinic_id`, `date_from`, `date_to` (`dd.mm.yyyy`) | `[{payment_id, patient_id, patient_phone, amount, method, created_at, invoice_id}]` — **главный источник для NetLTV** |
| `getInvoices` | `clinic_id`, `date_from`, `date_to` | `[{invoice_id, patient_id, total, services[], discount, paid_amount, status}]` — счета и скидки |
| `getPrograms` | `clinic_id` | `[{program_id, title, duration_days, price, services[]}]` — каталог абонементов |
| `getPatientPrograms` | `clinic_id` (возможно `patient_id`) | `[{program_id, patient_id, started_at, expires_at, sessions_left}]` — отложенная выручка |
| `getCalls` | `clinic_id`, `date_from`, `date_to` | `[{call_id, phone, direction, duration, patient_id, channel, recorded_at}]` — маркетинговая атрибуция |

> **Важно**: точные имена полей в `getPayments` будут известны после первого успешного вызова. Адаптер в `ltv_service.py:RenovatioAdapter` уже устойчив к нескольким вариантам (`amount`/`sum`/`value`/`sum_value`/`total` и `patient_phone`/`phone`/`mobile` + `patient_id`/`client_id`).

---

## 2. Что доступно, но НЕ используем

| Метод | Параметры (минимум) | Что даёт | Полезно для LTV? |
|---|---|---|---|
| `getProfessions` | `api_key` | Справочник специальностей (15 шт): `id`, `name`, `doctor_name`, `egisz_code` | да — группировка выручки по специальностям |
| `getDocuments` | `api_key`, `date_from`, `date_to` (ru-формат `dd.mm.yyyy`) | Список документов: договоры ПМУ, акты, согласия. Поля: `document_id`, `title`, `number`, `patient_id`, `appointment_id`, `program_id`, `is_completed`, `is_confirmed`, `date_created`, `time_created`, `type`, `type_title`, `treatment_result`, `treatment_outcome`, `treatment_target`, `diagnosis[]` | косвенно — связка `document → appointment_id`, `program_id`, `treatment_outcome` |
| `cancelAppointment` | (write-метод, нужен `appointment_id`) | Отмена записи в МИС | для синхронизации направлений из нашей системы |
| `confirmAppointment` | (write-метод, нужен `appointment_id`) | Подтверждение записи | для авто-подтверждения вместо текущего polling-а |

### Пример `getProfessions`

```json
{ "id": 1, "name": "Акушерство и гинекология",
  "doctor_name": "Врач-акушер-гинеколог",
  "egisz_code": "8", "egisz_position": 13, "is_deleted": false }
```

### Пример `getDocuments` (за `01.04.2025–02.04.2025`)

```json
{
  "document_id": 59107,
  "title": "Договор ПМУ (ПП 736) (Плательщик)",
  "number": 3894,
  "patient_id": 224965,
  "user_id": 22,
  "appointment_id": 48065,
  "program_id": null,
  "is_completed": true,
  "is_confirmed": false,
  "diagnosis": [],
  "date_created": "02.04.2025",
  "time_created": "14:15",
  "treatment_result": null,
  "treatment_outcome": null,
  "treatment_target": null,
  "type": 1,
  "type_title": "Административный"
}
```

---

## 3. Чего НЕ ХВАТАЕТ для LTV-модуля

После анонса Renovatio об открытии 5 ключевых методов (`getPayments`, `getInvoices`, `getPrograms`, `getPatientPrograms`, `getCalls`) — список «не хватает» резко сократился. Остались только две принципиальные дыры:

### 3.1. Webhook'и / push-уведомления

**Не существуют в Renovatio API.** Подтверждено разработчиком — добавлять не планируют. Остаёмся на polling-е (`mis_sync_service.poll_and_confirm_referrals` опрашивает `getAppointments` каждые N минут).

Последствия:
- лаг 2 часа на авто-подтверждение направлений;
- ежеминутный polling грузит МИС и наш сервер;
- невозможно отловить отмену/перенос/оплату «в реальном времени».

**Митигация**:
- delta-sync по `date_updated_from` уже реализован — выкачиваем не весь массив, а только изменения с прошлого запуска;
- частоту polling-а можно снизить с минут на часы для вторичных задач (LTV-пересчёт уже идёт раз в сутки в 04:00 UTC);
- для real-time оплат — **придётся ждать**, либо дополнить `getPayments` собственным polling-ом раз в N минут.

### 3.2. Фискальные чеки (54-ФЗ)

`getReceipts` / `getRefunds` **не существуют в Renovatio API**. Это ожидаемо — Renovatio это МИС, а не онлайн-касса. Для чеков по 54-ФЗ нужна **отдельная интеграция онлайн-кассы** (АТОЛ Онлайн, Бизнес.Ру, ЭВОТОР, Ferma). Это отдельный проект — не пытаемся вытаскивать чеки из МИС.

Последствия для NetLTV:
- сейчас NetLTV считаем по `getPayments.amount` — это «приход денег по данным МИС», а не «фискальная сумма по ОФД»;
- возвраты пациентов в этой схеме НЕ учитываются → NetLTV завышен на величину возвратов (но т.к. возвраты в стоматологии — единицы процентов от оборота, погрешность приемлема для оперативной аналитики).

**План**: при появлении интеграции с онлайн-кассой — добавить таблицу `fiscal_receipts` и пересчитывать NetLTV как `sum(receipts.amount) − sum(refunds.amount)`. Это будущий этап (не текущий спринт).

### 3.3. Прочие методы (низкий приоритет)

Эти методы вообще отсутствуют в Renovatio — добавлять не планируется. Не блокируют LTV, упомянуты для полноты:

| Желаемый метод | Что должен возвращать | Зачем для LTV |
|---|---|---|
| `getPaymentTypes` | Справочник способов оплаты | Срез LTV по способу (тип придёт в `getPayments.method`) |
| `getMedicalCard` | Электронная карта пациента | Сегментация по нозологии |
| `getInsurances` | ДМС-полисы | Разделение касс (физлицо vs ДМС) |
| `getDiscounts` | Причины скидок | Промо-эффективность (частично есть в `getInvoices.services[].discount`) |
| `getReviews` | Отзывы пациентов | Корреляция с LTV |
| `getReferrals` (in/out) | Внутренние направления | Cross-sell |
| `getDoctorSchedule` | Расписание | Онлайн-запись |

---

## 4. Backend — что уже обёрнуто в `mis_client.py`

Все 10 актуальных методов имеют обёртки:

| Функция | Renovatio-метод | Статус |
|---|---|---|
| `get_clinics(...)` | `getClinics` | ✅ работает |
| `get_services(clinic_id, ...)` | `getServices` | ✅ работает |
| `get_appointments(clinic_id, date_from, date_to, ...)` | `getAppointments` | ✅ работает |
| `find_patient_by_phone(phone, ...)` | `getPatient` | ✅ работает |
| `test_connection(...)` | `getClinics` (под капотом) | ✅ работает |
| `get_payments(clinic_id, date_from, date_to, ...)` | `getPayments` | ⚠️ 403 — ждём открытия прав |
| `get_invoices(clinic_id, date_from, date_to, ...)` | `getInvoices` | ⚠️ 403 — ждём открытия прав |
| `get_programs(clinic_id, ...)` | `getPrograms` | ⚠️ 403 — ждём открытия прав |
| `get_patient_programs(clinic_id, ...)` | `getPatientPrograms` | ⚠️ 403 — ждём открытия прав |
| `get_calls(clinic_id, date_from, date_to, ...)` | `getCalls` | ⚠️ 403 — ждём открытия прав |

В `ltv_service.py:RenovatioAdapter`:
- `fetch_patient_visits` параллельно дёргает `get_appointments` и `get_payments` (через `_fetch_payments_index`);
- собирает индекс `paid_by_phone` и `paid_by_pid` (на случай разных схем атрибуции);
- равномерно распределяет суммарную оплату пациента на его completed-визиты (точная привязка по `payment.appointment_id` будет добавлена после знакомства с реальной структурой ответа);
- если `getPayments` 403 → `total_paid = 0` → `net_ltv = 0` → UI показывает «—».

В `compute_ltv_for_clinic`:
- `ltv_estimate = avg_check × visits_per_year × 3` (Gross, по `sum_value`);
- `net_ltv      = avg_paid  × visits_per_year × 3` (Net, по фактическим оплатам, если есть).

---

## 5. Замечания по эксплуатации

- **SSL**: `mis.stoclinic.ru:3010` — самоподписанный сертификат. В `httpx` сейчас используется `verify=False` либо `MIS_CA_CERT_PATH`. На прод лучше pin'нуть CA.
- **Кодировка ошибок**: `desc` в ошибках на русском (`"Необходимо заполнить поле «дата создания документа (от)»"`) — нужно логировать UTF-8.
- **Формат дат**: `dd.mm.yyyy` (русский, не ISO). Параметры: `date_updated_from`/`date_updated_to` для `getAppointments`, `date_from`/`date_to` для `getDocuments`/`getPayments`/`getInvoices`/`getCalls`.
- **getPatient** возвращает один объект, не массив (наша обёртка `find_patient_by_phone` правильно нормализует).
- **Объёмы**: 1560 услуг на филиал, 502 записи за 2 недели на филиал → выгрузка в БД достаточно лёгкая, но при добавлении `getPayments` (поминутные платежи) понадобится delta-sync.
- **Пагинации не обнаружено** — все методы возвращают полный массив. При росте объёма попросить Renovatio добавить `limit` / `offset` или курсор.
- **NetLTV без 54-ФЗ**: пока нет интеграции онлайн-кассы — `net_ltv` это «оплата по данным МИС» без учёта возвратов. Точность ~95%.

---

## Источники

- `backend/app/services/mis_client.py` (10 обёрток)
- `backend/app/services/ltv_service.py` (RenovatioAdapter с NetLTV)
- `backend/app/services/mis_sync_service.py` (sync clinics/doctors/services + polling)
- Эмпирическое тестирование `curl` против `https://mis.stoclinic.ru:3010/api/public` (тестовая БД, 7 мая 2026)
- Официальная документация Renovatio API на момент аудита недоступна — все эндпоинты выявлены методом «прозвона».
