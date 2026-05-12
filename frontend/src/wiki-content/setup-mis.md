# Подключение МИС Renovatio

## Архитектура: МИС per clinic

Каждая клиника может иметь свою МИС-инстанцию через поля в `Clinic`:
- `mis_api_url` — URL API (например `http://mis.stoclinic.ru:3010`)
- `mis_api_key` — API ключ
- `mis_type` — тип МИС (`renovatio`)
- `mis_id` — внешний ID клиники в МИС (для cross-reference)

Если поля у клиники не заданы — fallback на tenant settings (`SystemSettings.mis_api_url`, `mis_api_key`).

## Helper для resolver

```python
from app.services.mis_resolver import resolve_mis_creds

api_url, api_key, mis_type = await resolve_mis_creds(
    db, clinic_id=clinic.id, tenant_id=tenant.id
)
```

Resolver сначала смотрит в `Clinic`, при отсутствии — берёт с tenant.

## Endpoints МИС Renovatio

Через `app/services/mis_client.py`:

| Метод | Что делает |
|---|---|
| `find_patient_by_phone(phone)` | Поиск по телефону (нормализуется) |
| `getPatient(last_name, first_name, third_name)` | Поиск по ФИО |
| `addPatient(mobile, last_name, first_name, third_name)` | Создание пациента |
| `getServices(clinic_id)` | Список услуг клиники |
| `getAppointments(clinic_id, date_from, date_to, patient_id)` | Расписание |
| `createAppointment(mobile, clinic_id, doctor_id, time_start, time_end)` | Создание записи |
| `confirmAppointment(appointment_id)` | Подтверждение |
| `getClinics()` | Список клиник |
| `getPrograms(clinic_id)` | Программы лояльности |
| `getPatientPrograms(patient_id)` | Программы пациента |
| `getPayments(...)` | Платежи |
| `getInvoices(...)` | Счета |
| `getCalls(...)` | Звонки |
| `test_connection()` | Тест соединения (используется в auto-retest job) |

## NO_PROXY

`mis.stoclinic.ru` обязательно в `NO_PROXY` в `.env`, иначе запросы идут через Telegram-туннель и получают 403:

```
NO_PROXY=localhost,127.0.0.1,clinika-db,clinika-redis,clinika-backend,...,mis.stoclinic.ru,.stoclinic.ru
```

## Cross-clinic операции

При **создании направления** между клиниками тенанта:
- Если у `to_clinic` задан `mis_doctor_id` и `appointment_at` — auto `createAppointment` в МИС
- Сохраняется `referral.mis_appointment_id`

При **подтверждении направления** (QR-скан):
- Auto-create пациента в МИС если ещё не было (`addPatient`)
- Сохраняется `referral.mis_patient_id`
- `confirmAppointment(mis_appointment_id)`

## Sync пациентских данных

В ЛК пациента `_load_mis_data`:
- Получает `mis_patient_id` по телефону
- Для каждой клиники tenant'а с `mis_id` дёргает `getAppointments(patient_id=mis_pid)`
- Возвращает `mis_info` + `mis_visits` (до 50 последних)

## Семья из МИС

Endpoint `/patient/family/mis-suggestions`:
- По `parent_id` находит родителя пациента
- По `last_name` находит однофамильцев → фильтр `parent_id == self.id` (дети) или `parent_id == self.parent_id` (братья/сёстры)
- Помечает уже добавленных как `already_added=true`

## Auto-retest job

Каждый час `integration_retest_job` пингует `_do_test()` для всех активных `TenantIntegration` и обновляет `last_tested_at` + `test_status`. Без этого `mis_sync` помечается degraded после 1 дня бездействия.
