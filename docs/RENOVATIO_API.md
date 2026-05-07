# Аудит публичного API МИС Renovatio (для LTV-модуля)

> Проведён 2026-05-07. Тестовая инсталляция: `https://mis.stoclinic.ru:3010/api/public`
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
  "status": "upcoming",      // upcoming | completed | canceled | …
  "status_id": 3,
  "is_first": false,         // первичка vs повторка
  "is_first_clinic": false,
  "is_first_doctor": false,
  "sum_value": 2220,         // сумма приёма (выручка)
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
  "patient_channel_id": null, "patient_channel": null,  // канал привлечения
  "channel_id": null, "channel": null,
  "source": null, "type": null
}
```

> **Важно**: `services[].invoice_number`, `discount`, `value` и `appointment.sum_value` — это и есть «оплаты» на уровне визита. То есть **факт чека** мы можем восстановить из `getAppointments` без отдельного `getPayments`. **Но** настоящие фискальные чеки/возвраты/способы оплаты — нет (см. раздел 3).

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
  "category_ids": null,        // категории/сегменты пациента
  "parent_id": null,
  "groups": null,
  "adv_channel_id": null,      // канал привлечения
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

---

## 2. Что доступно, но НЕ используем

| Метод | Параметры (минимум) | Что даёт | Полезно для LTV? |
|---|---|---|---|
| `getProfessions` | `api_key` | Справочник специальностей (15 шт): `id`, `name`, `doctor_name`, `egisz_code` | да — группировка выручки по специальностям |
| `getDocuments` | `api_key`, `date_from`, `date_to` (ru-формат `dd.mm.yyyy`) | Список документов: договоры ПМУ, акты, согласия. Поля: `document_id`, `title`, `number`, `patient_id`, `appointment_id`, `program_id`, `is_completed`, `is_confirmed`, `date_created`, `time_created`, `type`, `type_title`, `treatment_result`, `treatment_outcome`, `treatment_target`, `diagnosis[]` | косвенно — связка `document → appointment_id`, `program_id`, `treatment_outcome` |
| `cancelAppointment` | (write-метод, возвращает `{error:0,data:false}` без параметров — нужен `appointment_id`) | Отмена записи в МИС | для синхронизации направлений из нашей системы |
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

### Метод `getUsers` (используется только для врачей — но возвращает всех сотрудников)

Ключевые поля: `id`, `name`, `gender`, `birth_date`, `role_names[]` (`doctor`, `admin`, …), `role_titles`, `profession[]`, `all_profession_titles`, `clinic[]`, `default_clinic`, `default_room`, `is_child_doctor`, `is_adult_doctor`, `is_telemedicine`, `is_outside`, `qualification`, `doctor_info`, `education`, `services[]`, `is_deleted`. Всего 47 пользователей.

> Подключение `services[]` к врачу мы **не импортируем** — а это явная связка «врач ↔ услуга», нужная для LTV-разреза (выручка по комбинации врач+услуга).

---

## 3. Чего НЕ ХВАТАЕТ для LTV-модуля — список запросов разработчику Renovatio

LTV (Lifetime Value) пациента = накопленная выручка за всё время отношений. Минимум, что нужно для аналитики:

1. сумма платежей пациента по периодам, способу оплаты, типу услуг;
2. возвраты (refunds) — иначе LTV завышен;
3. категория/сегмент пациента (VIP, постоянный, отток);
4. канал привлечения (откуда пришёл — реклама/направление/самозапись);
5. предсказание оттока (когда последний визит, динамика частоты);
6. абонементы/программы (предоплачено vs списано — отложенная выручка).

### 3.1. Методы, которые ВОЗВРАЩАЮТ 403 «No access to method» — нужны новые права

Эти методы существуют в API, но наш ключ их не видит. **Запросить у Renovatio расширение прав** для api_key тенанта Клиники:

| Метод | Зачем для LTV |
|---|---|
| `getInvoices` | Полный список счетов: пациент, услуги, скидки, итог. Базовая таблица для расчёта выручки. |
| `getPayments` | Фактические платежи (приход денег): дата, сумма, тип оплаты (наличные/карта/онлайн), привязка к invoice. **Главный источник для LTV.** |
| `getServiceCategories` | Дерево категорий услуг (хотя категории есть в `getServices`, отдельный справочник нужен для иерархии и переименований без полной перезагрузки прайс-листа) |
| `getPrograms` | Каталог абонементов/пакетов услуг |
| `getPatientPrograms` | Купленные пациентом программы (срок действия, остаток сеансов) — отложенная выручка |
| `getCalls` | Журнал звонков (CRM-аналитика, конверсия лида в пациента) |
| `createPatient` | Создание пациента из нашей системы перед записью (сейчас МИС автоматически плодит «`_Пациент_67517`» при первом обращении) |
| `changeAppointmentStatus` | Управление статусом записи (no-show, completed) → влияет на LTV-метрики посещаемости |

### 3.2. Методов НЕТ в API (`404 Method not found`) — запросить добавление

Эти методы вообще отсутствуют в API Renovatio. Нужно либо просить разработчика добавить, либо подтвердить, что данных нет:

| Желаемый метод | Что должен возвращать | Зачем для LTV |
|---|---|---|
| `getReceipts` / `getReceiptList` | Фискальные чеки: ФД-номер, дата, сумма, способ оплаты, ссылка на ОФД, признак возврата | Сверка с 54-ФЗ; revenue recognition |
| `getRefunds` | Возвраты денег пациенту: дата, сумма, причина, ссылка на исходный чек | Для корректного NetLTV (Gross − Refunds) |
| `getPaymentTypes` | Справочник способов оплаты (наличные/карта/онлайн/страховая) | Срез LTV по способу оплаты |
| `getMedicalCard` / `getMedicalRecords` | Электронная карта пациента: диагнозы, протоколы приёмов | Сегментация по нозологии (диабет → особый LTV-кластер) |
| `getInsurances` | Страховые компании, ДМС-полисы пациентов | Разделение касс (физлицо vs ДМС) |
| `getDiscounts` / `getDiscountReasons` | Скидки и их причины | Промо-эффективность, маржа |
| `getReviews` | Отзывы пациентов | Корреляция с LTV (лояльность) |
| `getReferrals` (in/out) | Внутренние направления между врачами | Cross-sell внутри клиники |
| `getDoctorSchedule` / `getFreeSlots` | Расписание и свободные интервалы | Онлайн-запись из нашей системы (косвенно — больше визитов → выше LTV) |

### 3.3. Webhook'и / push-уведомления — НЕТ совсем

Сейчас наша интеграция работает только через **polling** (`mis_sync_service.poll_and_confirm_referrals` опрашивает `getAppointments` каждые N минут). Это:
- даёт лаг 2 часа на авто-подтверждение направлений;
- грузит МИС (ежеминутный polling) и наш сервер;
- невозможно отловить отмену/перенос/оплату «в реальном времени».

**Запросить у Renovatio**:

1. **Webhook на изменение статуса записи** (`appointment.status_changed`): `appointment_id`, `old_status`, `new_status`, `changed_at`, `patient_id`. Триггеры: confirmed, completed, canceled, no_show.
2. **Webhook на новую оплату** (`payment.created`): `payment_id`, `appointment_id`, `patient_id`, `amount`, `method`, `created_at` — ядро для real-time LTV.
3. **Webhook на возврат** (`refund.created`).
4. **Webhook на нового пациента** (`patient.created`) — чтобы сразу отправить welcome-bonus / привязать к маркетинговому каналу.
5. **Подписка через REST**: `setWebhook` / `addWebhook` с `url`, `secret` (HMAC) и фильтром по `event_type[]`.

В качестве запасного варианта — пусть Renovatio добавит метод `getEvents` с курсором (`since_event_id` или `since_timestamp`), чтобы синхронизировать **только дельту** вместо полного скана `getAppointments`.

### 3.4. ТОП-5 запросов разработчику Renovatio (приоритетный)

1. **Открыть доступ к `getPayments` и `getInvoices`** для нашего api_key — без этого LTV считается криво (только по `appointment.sum_value`, без учёта частичных оплат, способа оплаты и возвратов).
2. **Открыть доступ к `getPrograms` + `getPatientPrograms`** — иначе абонементы (а у Клиники есть пакеты) не учитываются в LTV / частоте посещений.
3. **Добавить webhook-и `appointment.status_changed`, `payment.created`, `refund.created`** (или endpoint `getEvents` с курсором). Это убьёт polling и даст мгновенную реакцию.
4. **Добавить методы `getReceipts` (фискальные чеки) + `getRefunds`** — для корректного NetLTV и сверки с ОФД.
5. **Открыть доступ к `getCalls`** — для маркетинговой атрибуции (LTV по каналу привлечения, сейчас `patient_channel_id` в `getAppointments` пустой).

---

## 4. Backend — что обернуть в `mis_client.py` (план, БЕЗ КОДА)

При появлении прав / методов добавить в `backend/app/services/mis_client.py`:

| Функция | Renovatio-метод | Назначение |
|---|---|---|
| `get_professions(api_url, api_key)` | `getProfessions` | справочник специальностей (для UI выбора и для group-by в отчётах) |
| `get_documents(date_from, date_to, api_url, api_key)` | `getDocuments` | связь visit → договор / акт / согласие (для PDF-выгрузки) |
| `cancel_appointment(appointment_id, api_url, api_key)` | `cancelAppointment` | при отмене направления в нашей системе — отменять и в МИС |
| `confirm_appointment(appointment_id, api_url, api_key)` | `confirmAppointment` | заменить polling на прямое подтверждение |
| `get_payments(clinic_id, date_from, date_to, ...)` | `getPayments` ⚠️ 403 | **ядро LTV** — после открытия прав |
| `get_invoices(clinic_id, date_from, date_to, ...)` | `getInvoices` ⚠️ 403 | счета и скидки |
| `get_programs(clinic_id, ...)` | `getPrograms` ⚠️ 403 | каталог абонементов |
| `get_patient_programs(patient_id, ...)` | `getPatientPrograms` ⚠️ 403 | подписки пациента |
| `get_calls(clinic_id, date_from, date_to, ...)` | `getCalls` ⚠️ 403 | CRM-журнал, маркетинговая атрибуция |
| `register_webhook(url, events, secret)` | (отсутствует) | после реализации на стороне Renovatio |

В `mis_sync_service.py` добавить:
- `sync_payments(...)` → новая таблица `mis_payments` (id, patient_mis_id, appointment_mis_id, amount, method, created_at);
- `sync_patient_programs(...)` → таблица `mis_patient_programs`;
- materialized view `patient_ltv` (sum payments − refunds, last_visit_at, visits_count, avg_check, churn_score);
- nightly cron + delta-sync по `date_updated`.

### Уже есть в `getAppointments` (можно использовать без новых прав)

- `is_first`, `is_first_clinic`, `is_first_doctor` → конверсия в повторный визит
- `services[].discount`, `services[].value`, `appointment.sum_value` → выручка по визиту
- `services[].program_id`, `services[].program_group_id` → факт списания с абонемента (ID есть, но без `getPrograms` мы не знаем имя/тип программы)
- `services[].profession`, `services[].profession_title` → разрез по специальности
- `patient_channel_id`, `adv_channel_id` (в `getPatient`) → канал привлечения (если МИС заполняет)
- `status` + `status_id` → конверсия `upcoming → completed`

То есть **черновик LTV-модуля можно собрать уже сейчас**, ограничиваясь `getAppointments` + `getServices` + `getUsers` + `getPatient`. Это будет «GrossLTV без возвратов и абонементов» — пригодно для MVP.

---

## 5. Замечания по эксплуатации

- **SSL**: `mis.stoclinic.ru:3010` — самоподписанный сертификат. В `httpx` сейчас используется `verify=False` либо `MIS_CA_CERT_PATH`. На прод лучше pin'нуть CA.
- **Кодировка ошибок**: `desc` в ошибках на русском (`"Необходимо заполнить поле «дата создания документа (от)»"`) — нужно логировать UTF-8.
- **Формат дат**: `dd.mm.yyyy` (русский, не ISO). Параметры: `date_updated_from`/`date_updated_to` для `getAppointments`, `date_from`/`date_to` для `getDocuments`.
- **getPatient** возвращает один объект, не массив (наша обёртка `find_patient_by_phone` правильно нормализует).
- **Объёмы**: 1560 услуг на филиал, 502 записи за 2 недели на филиал → выгрузка в БД достаточно лёгкая, но при добавлении `getPayments` (поминутные платежи) понадобится delta-sync.
- **Пагинации не обнаружено** — все методы возвращают полный массив. При росте объёма попросить Renovatio добавить `limit` / `offset` или курсор.

---

## Источники

- `backend/app/services/mis_client.py` (текущие 5 обёрток)
- `backend/app/services/mis_sync_service.py` (sync clinics/doctors/services + polling)
- Эмпирическое тестирование `curl` против `https://mis.stoclinic.ru:3010/api/public` (тестовая БД, 7 мая 2026)
- Официальная документация Renovatio API на момент аудита недоступна — все эндпоинты выявлены методом «прозвона».
