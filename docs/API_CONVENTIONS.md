# API Conventions — клиниксеть.рф

> Единые правила для проектирования и сопровождения REST API платформы.
> Документ — нормативный: новые endpoints **обязаны** соответствовать; старые перечислены в секции «TODO Refactor» и приводятся к стандарту по плану.

**Базовый URL:** `https://клиниксеть.рф/api`
**Swagger UI:** `https://клиниксеть.рф/api/docs`
**OpenAPI JSON:** `https://клиниксеть.рф/api/openapi.json` (или `backend/openapi.json` локально)

---

## Содержание

1. [URL paths](#1-url-paths)
2. [Параметры запроса (query)](#2-параметры-запроса-query)
3. [ID types](#3-id-types)
4. [Response shapes](#4-response-shapes)
5. [HTTP status codes](#5-http-status-codes)
6. [Auth](#6-auth)
7. [Naming](#7-naming)
8. [Pagination для будущего](#8-pagination-для-будущего)
9. [TODO Refactor — список несоответствий](#9-todo-refactor--список-несоответствий)
10. [Process для добавления нового endpoint](#10-process-для-добавления-нового-endpoint)

---

## 1. URL paths

### 1.1. Plural для коллекций

Endpoints, возвращающие список ресурсов или создающие новый ресурс — во множественном числе:

| Хорошо | Плохо |
|---|---|
| `GET /users` | `GET /user` |
| `POST /clinics` | `POST /clinic` |
| `GET /appointments` | `GET /appointment` |

### 1.2. Singular ID для одного ресурса

Один ресурс получаем по path-параметру `{<resource>_id}` после имени коллекции:

```
GET    /users/{user_id}
PATCH  /users/{user_id}
DELETE /users/{user_id}
GET    /clinics/{clinic_id}
GET    /appointments/{appointment_id}
```

Path-параметр **именуется явно** (`{user_id}`, не `{id}`) — это упрощает чтение OpenAPI и уменьшает конфликты при вложенных путях.

### 1.3. Под-ресурсы вложены

Если ресурс существует только в контексте родителя — путь вложенный:

```
GET  /clinics/{clinic_id}/services
POST /clinics/{clinic_id}/services
GET  /users/{user_id}/bonuses
GET  /doctors/{doctor_id}/schedule
GET  /doctors/{doctor_id}/slots
```

Глубина вложенности — **не более 2 уровней**. Если ресурс может жить независимо — лучше отдельная коллекция и фильтр через query.

### 1.4. Действия (RPC-style) — POST `/{resource}/{id}/{action}`

Для операций, которые не укладываются в CRUD (отмена, подтверждение, генерация PDF, сброс пароля и т.п.):

```
POST /appointments/{appointment_id}/cancel
POST /appointments/{appointment_id}/confirm
POST /users/{user_id}/reset-password
POST /acts/{act_id}/sign-electronic
POST /clinic-invoices/{invoice_id}/send
```

Правила для actions:
- Метод — **всегда POST** (даже если идемпотентно: семантика «выполнить действие»).
- Имя действия — глагол в инфинитиве, kebab-case (`reset-password`, `mark-paid`, `sign-electronic`).
- Возвращает обновлённый ресурс (`200 {...}`) или `204 No Content` если фронту нечего показывать.

### 1.5. Префиксы роутеров — единый стиль

| Сегмент | Семантика |
|---|---|
| `/auth` | login, refresh, logout, recovery |
| `/admin/*` | super_admin (платформа) — тенанты, биллинг платформы, AI-настройки, гейтвеи |
| `/manager/*` | manager (тенант) — клиники тенанта, KPI, отчёты, настройки тенанта |
| `/franchise-owner/*` | franchise_owner — свои тенанты в франшизе |
| `/patient/*` | patient — личный кабинет пациента |
| `/portal/*` | publicly accessible patient portal (PWA) |
| `/public/*` | unauthenticated публичные ресурсы (booking-виджеты, лендинг) |
| `/{resource}` | бизнес-ресурсы тенанта (referrals, bonuses, appointments, …) |

**Не смешивать префиксы по роли с префиксами по ресурсу.** Если endpoint доступен нескольким ролям — путь именуется по ресурсу, доступ контролируется `require_role()`.

---

## 2. Параметры запроса (query)

### 2.1. Даты

- **Период:** `from` и `to` в ISO 8601 (`YYYY-MM-DD` для дат, `YYYY-MM-DDTHH:MM:SSZ` для timestamps).
- **Альтернативно:** `period_days=30` — последние N дней (от сегодняшнего дня).
- Не использовать локальные форматы (`12.05.2026`).

```
GET /analytics/summary?from=2026-01-01&to=2026-03-31
GET /reports/daily?period_days=30
```

### 2.2. Пагинация

```
GET /referrals?limit=50&offset=0
GET /audit?limit=100&offset=200
```

- `limit` — default `50`, max `500`. Запросы с `limit > 500` возвращают `422`.
- `offset` — default `0`.
- Ответ — либо чистый список (когда total не нужен), либо `{items: [...], total: N}`.

### 2.3. Фильтры

Имя query-параметра = имя поля. Значение — точное совпадение или CSV для множественного выбора.

```
GET /appointments?status=confirmed&clinic_id=5a07...c486
GET /referrals?status=pending,confirmed
GET /reviews?type=video&clinic_id=UUID
```

### 2.4. Сортировка

```
GET /audit?sort=-created_at        # DESC по created_at
GET /users?sort=last_name          # ASC по last_name
GET /referrals?sort=-amount,date   # multi-key
```

Префикс `-` = DESC. Без префикса — ASC.

### 2.5. Поиск

Полнотекстовый/частичный поиск — отдельный параметр `search`:

```
GET /users?search=Иванов
GET /clinics?search=стоматолог
```

Бэкенд решает, по каким полям искать (имя, фамилия, телефон, email…). На фронт это деталь имплементации.

---

## 3. ID types

### 3.1. Внутренние ресурсы — UUID v4

Все основные таблицы (`users`, `clinics`, `tenants`, `appointments`, `referrals`, `bonuses`, …) используют UUID v4:

```
5a07f8d2-1c3b-4e9a-b3a2-2f8c34a4c486
```

В URL — без кавычек, в JSON — строка.

### 3.2. МИС/внешние — integer

ID из внешних систем (МИС-провайдер, ЮKassa transaction, Stripe customer) хранятся как они есть — обычно integer:

```json
{
  "mis_id": 12345,
  "mis_clinic_id": 7
}
```

### 3.3. ВАЖНО: `clinic_id` — два разных мира

| Контекст | Тип | Пример |
|---|---|---|
| Наше API (response, query, body) | UUID v4 | `5a07f8d2-...-c486` |
| `mis_client.py` / sync с МИС | integer | `7` |

Имя поля **одинаковое**, тип **разный**. При интеграции:
- В Pydantic-схемах для МИС — `mis_clinic_id: int`.
- Внутри собственных схем — `clinic_id: UUID`.
- Никогда не передавать сырой `mis_id` во внешний API под именем `clinic_id`.

---

## 4. Response shapes

### 4.1. Один ресурс

```json
{
  "id": "5a07...c486",
  "name": "Доктор Иванов",
  "created_at": "2026-05-07T10:23:00Z"
}
```

### 4.2. Список без пагинации

```json
[
  {"id": "...", "name": "..."},
  {"id": "...", "name": "..."}
]
```

Используется когда total всегда мал (≤ 500 элементов): справочники, недельное расписание одного врача и т.п.

### 4.3. Список с пагинацией

```json
{
  "items": [
    {"id": "...", "name": "..."}
  ],
  "total": 1234,
  "limit": 50,
  "offset": 0
}
```

Используется для коллекций неограниченного размера: audit, referrals, appointments, billing entries.

### 4.4. Ошибка — FastAPI default

Бизнес-ошибки и неавторизованные запросы:

```json
{"detail": "Direction not found"}
```

```json
{"detail": "Insufficient permissions"}
```

Validation-ошибка (Pydantic, 422):

```json
{
  "detail": [
    {
      "loc": ["body", "amount"],
      "msg": "ensure this value is greater than 0",
      "type": "value_error.number.not_gt"
    }
  ]
}
```

### 4.5. Действие без content

- `204 No Content` — DELETE и большинство actions без полезного ответа.
- `{"ok": true}` — если фронт ожидает JSON-ответ (например, для toast-уведомления):

```json
{"ok": true}
```

Не возвращать `{"success": true}`, `{"status": "ok"}`, `{"result": "ok"}` — выбран один формат.

---

## 5. HTTP status codes

| Code | Значение | Когда использовать |
|---|---|---|
| **200** | OK | успех с body (GET, PATCH с response, POST action возвращающий ресурс) |
| **201** | Created | POST создал ресурс. В body — созданный ресурс. |
| **202** | Accepted | задача принята в очередь, обработается асинхронно (отчёты, экспорт) |
| **204** | No Content | успех без body (DELETE, PATCH без response) |
| **400** | Bad Request | бизнес-валидация: «слот в прошлом», «нельзя отменить оплаченный счёт» |
| **401** | Unauthorized | нет токена / истёк / невалидный |
| **402** | Payment Required | `require_module(...)` — модуль не подключён у тенанта |
| **403** | Forbidden | auth есть, но прав нет (не та роль, чужой тенант) |
| **404** | Not Found | ресурс не существует или скрыт от tenant_id |
| **409** | Conflict | дубликат, гонка (слот уже занят) |
| **422** | Unprocessable Entity | Pydantic / FastAPI validation |
| **429** | Too Many Requests | SlidingWindowRateLimiter (200 req/min) |
| **500** | Internal Server Error | баг сервера, необработанное исключение |

### 5.1. Различие 401 / 403 / 404

- **401** — браузер должен показать форму логина или сделать refresh.
- **403** — пользователь залогинен, но не должен видеть этот endpoint. UI скрывает кнопку.
- **404** — ресурс не существует **или** принадлежит чужому тенанту. Возвращаем 404 (не 403), чтобы не подтверждать факт существования.

### 5.2. 402 Payment Required — фирменный сигнал

Семантически означает: «модуль не активирован у тенанта». Фронт может показать кнопку «Подключить модуль».

```python
@router.post("/calls/start", dependencies=[require_module("p2p_calls")])
```

### 5.3. Не использовать

- 200 на ошибку с `{"error": "..."}` — нарушает HTTP.
- 500 на бизнес-ошибки — это 400 или 409.

---

## 6. Auth

### 6.1. Заголовок

Все защищённые endpoints требуют:

```
Authorization: Bearer <jwt_access_token>
```

### 6.2. JWT payload

```json
{
  "sub": "5a07...c486",
  "role": "manager",
  "tid": "8f1c...d042",
  "type": "access",
  "exp": 1715000000,
  "jti": "..."
}
```

| Поле | Назначение |
|---|---|
| `sub` | user_id (UUID) |
| `role` | enum: `super_admin`, `franchise_owner`, `manager`, `supervisor`, `admin`, `nurse`, `doctor`, `recruiter`, `accountant`, `acquisition_manager`, `external_doctor`, `visiting_doctor`, `patient` |
| `tid` | tenant_id (UUID), `null` для super_admin |
| `type` | `access` или `refresh` |
| `exp` | Unix timestamp истечения |
| `jti` | UUID токена (для blacklist) |

### 6.3. Refresh

```
POST /auth/refresh
Content-Type: application/json

{"refresh_token": "<refresh_jwt>"}
```

Ответ:

```json
{
  "access_token": "<new_access>",
  "refresh_token": "<new_refresh>",
  "token_type": "bearer",
  "expires_in": 900
}
```

Старый access можно не отзывать (мало живёт), но `jti` старого refresh попадает в blacklist.

### 6.4. Логин

```
POST /auth/login
{"login": "...", "password": "...", "tenant_slug": "..."}
```

`tenant_slug` обязателен для всех ролей кроме `super_admin`.

---

## 7. Naming

### 7.1. snake_case везде

- Query params: `?clinic_id=...&from=...&period_days=30`
- Body keys: `{"first_name": "...", "tenant_id": "..."}`
- Response keys: `{"created_at": "...", "is_active": true}`
- Path params: `/users/{user_id}`

### 7.2. camelCase **запрещён**

В части старого кода были замечены поля типа `firstName`, `clinicId`. Это нарушает консистентность фронта, который ожидает snake_case везде. **Стандартизировать в snake_case при касании любого endpoint.**

### 7.3. Enum — английские ключи

В response отдавать машиночитаемый ключ; перевод — на фронте.

```json
{"status": "confirmed"}
```

**Не делать:**

```json
{"status": "Подтверждено"}
```

Это ломает:
- сравнения в JS-коде (`if (s === 'Подтверждено')` хрупко);
- мультиязычность (когда добавим английский UI);
- логи и метрики Prometheus (русские лейблы → проблемы с экранированием).

Список enum-ов фиксирован в `app/models/enums.py` и `app/schemas/enums.py`.

### 7.4. Имена полей — устоявшиеся соглашения

| Поле | Тип | Назначение |
|---|---|---|
| `id` | UUID | первичный ключ ресурса |
| `tenant_id` | UUID | тенант-владелец (всегда есть в multi-tenant таблицах) |
| `clinic_id` | UUID | клиника-владелец (там где есть) |
| `created_at` | timestamp | когда создан |
| `updated_at` | timestamp | когда обновлён |
| `is_active` | bool | мягкое удаление / отключение |
| `deleted_at` | timestamp\|null | для soft-delete |
| `status` | enum string | основной статус ресурса |

---

## 8. Pagination для будущего

### 8.1. Сейчас: offset + limit

Работает на всех существующих коллекциях. Простая семантика для фронта.

### 8.2. Потом: cursor-based

Когда коллекция превысит ~10M записей (audit_log, ledger_entries — кандидаты первой очереди), `OFFSET` начнёт лагать (PostgreSQL прокручивает все строки до offset). Переходим на курсоры:

```
GET /audit?limit=100&cursor=eyJjcmVhdGVkX2F0IjoiMjAy...
```

Ответ:

```json
{
  "items": [...],
  "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAy...",
  "has_more": true
}
```

Курсор — base64 от `{created_at, id}` последнего элемента. Поддержку добавляем **рядом** с offset (не вместо), чтобы не ломать клиентов.

### 8.3. Триггеры миграции

- `audit_log` > 5M записей
- p95 latency `GET /audit?offset=N` > 500ms при N > 100k
- `ledger_entries` > 10M записей

---

## 9. TODO Refactor — список несоответствий

Endpoints, нарушающие конвенции выше. Рефакторим постепенно, **сохраняя обратную совместимость** (старый путь остаётся как deprecated 6 месяцев).

### 9.1. `/admins/*` — путаница «роль vs ресурс»

**Сейчас:**
```
GET    /admins/                       # список администраторов
GET    /admins/me                     # текущий пользователь
GET    /admins/{admin_id}/stats       # статистика
GET    /admins/doctor-requests        # заявки врачей (зачем здесь?)
GET    /admins/external-doctors       # внешние врачи (зачем здесь?)
```

Проблемы:
- `/admins/me` — но эндпоинт работает для любой роли, не только admin.
- Под `/admins` живут заявки врачей и список внешних врачей — это другие ресурсы.

**Цель:**
```
GET   /users?role=admin               # вместо /admins/
GET   /users/me                       # вместо /admins/me
GET   /users/{user_id}/stats          # вместо /admins/{admin_id}/stats
GET   /doctor-requests                # отдельный ресурс
GET   /external-doctors               # отдельный ресурс
```

### 9.2. `/manager/admins/*` vs `/admin/tenants/*` — manager vs admin

**Сейчас:**
```
POST   /manager/admins/                          # menager создаёт администратора
PATCH  /manager/admins/{admin_id}/assign-clinic  # менеджер привязывает админа к клинике
GET    /admin/tenants                            # super_admin смотрит тенантов
POST   /admin/tenants/{tenant_id}/reset-password # super_admin сбрасывает пароль
```

Проблемы:
- `/manager/*` (менеджер тенанта) и `/admin/*` (super_admin платформы) — слишком похожи. Легко перепутать в коде.
- `/manager/admins/*` правильнее `/manager/staff/*` или просто `/staff?role=admin` с `require_role(MANAGER)`.

**Цель:**
```
GET    /staff?role=admin                              # вместо /manager/admins/
PATCH  /staff/{user_id}                               # вместо /manager/admins/{admin_id}/assign-clinic (clinic_id в body)
                                                      # /admin/tenants/* остаётся (super_admin platform-level)
```

### 9.3. `/recruiter/doctors` vs `/manager/recruiter-doctors` — дубль

**Сейчас:**
```
GET  /recruiter/doctors                              # рекрутер видит своих врачей
GET  /manager/recruiter-doctors                      # менеджер видит врачей всех рекрутёров
GET  /manager/all-external-doctors                   # менеджер видит всех внешних
```

Проблемы:
- Один и тот же ресурс «рекрутёр-врачи» имеет 3 разных пути в зависимости от роли.
- `/manager/recruiter-doctors` и `/manager/all-external-doctors` — смешение терминов.

**Цель:**
```
GET  /external-doctors                  # все внешние врачи, фильтр по recruiter_id если нужен
GET  /external-doctors?recruiter_id=me  # для роли recruiter — только свои
GET  /external-doctors?type=visiting    # фильтр по типу
```

### 9.4. `/contact/admin/unread-count` — роль в URL

**Сейчас:**
```
GET    /contact/admin/list
GET    /contact/admin/unread-count
PATCH  /contact/admin/{contact_id}/read
DELETE /contact/admin/{contact_id}
POST   /contact/admin/settings
```

Проблема: `/admin/` в середине пути — это роль, а не ресурс. Endpoint доступен только super_admin (через `require_super_admin`), но это контролируется dependencies, а не URL.

**Цель:**
```
GET    /contact?status=unread           # фильтр через query
GET    /contact/unread-count            # короче, без роли в URL
PATCH  /contact/{contact_id}/read       # action на ресурсе
DELETE /contact/{contact_id}
GET    /contact/settings
PUT    /contact/settings                # PUT, поскольку это конфиг
```

### 9.5. `/visiting/admin/*` — структура странная

**Сейчас:**
```
GET    /visiting/my-queue                       # для visiting_doctor
GET    /visiting/my-visits
POST   /visiting/admin/complete-visit           # для admin, который подтверждает визит
POST   /visiting/admin/book-appointment
GET    /visiting/admin/appointments/{doctor_user_id}
PATCH  /visiting/admin/update-doctor/{doctor_user_id}
GET    /visiting/admin/all-appointments
PATCH  /visiting/admin/appointments/{apt_id}/edit
DELETE /visiting/admin/appointments/{apt_id}
PATCH  /visiting/admin/suspend-doctor/{doctor_user_id}
PATCH  /visiting/admin/resume-doctor/{doctor_user_id}
```

Проблемы:
- `my-queue`, `my-visits` — endpoints без коллекции (должно быть `/visiting-doctors/me/queue`).
- `/visiting/admin/...` — снова роль в URL.
- `update-doctor/{doctor_user_id}`, `suspend-doctor/{doctor_user_id}`, `resume-doctor/{doctor_user_id}` — три отдельных endpoint вместо одного PATCH с полем `status`.

**Цель:**
```
GET    /visiting-doctors/me/queue
GET    /visiting-doctors/me/visits
GET    /visiting-doctors/me/income
POST   /visiting-doctors/{doctor_id}/visits/{visit_id}/complete
POST   /visiting-doctors/{doctor_id}/appointments     # вместо /admin/book-appointment
GET    /visiting-doctors/{doctor_id}/appointments     # вместо /admin/appointments/{doctor_user_id}
PATCH  /visiting-doctors/{doctor_id}                  # update-doctor, suspend, resume → один PATCH
PATCH  /appointments/{appointment_id}                 # вместо /visiting/admin/appointments/{apt_id}/edit
DELETE /appointments/{appointment_id}                 # вместо /visiting/admin/appointments/{apt_id}
```

### 9.6. Бонусы (дополнительно)

**Сейчас:**
```
PATCH  /manager/bonuses/{bonus_id}/mark-paid
POST   /manager/bonuses/mark-paid-all/{admin_id}
```

Проблемы:
- `mark-paid-all/{admin_id}` — id в URL после действия (нечитаемо).
- PATCH vs POST для одного смыслового действия.

**Цель:**
```
POST  /bonuses/{bonus_id}/mark-paid
POST  /users/{user_id}/bonuses/mark-paid-all
```

### 9.7. Trailing slash — не консистентно

Часть endpoint-ов работает с `/`, часть без:
- `GET /admins/` (с слешем)
- `GET /clinics` (без слеша)
- `GET /manager/clinics/` (с слешем)
- `GET /audit` (без слеша)

**Цель:** все коллекции без trailing slash. FastAPI настроить `redirect_slashes=False` после миграции, чтобы случайные `/` возвращали 404 (а не 307).

### 9.8. Префиксы без слеша — `tags=[...]` без `prefix=`

Несколько роутеров не имеют `prefix=` и пишут полный путь в декораторах: `clinic_payments`, `inter_clinic_invoices`, `medcard`, `scheduling`, `patient_chat`, `patient_documents`, `prescriptions`, `public_clinic`, `push`, `fiscal_receipts`, `manager/*` (большинство).

Это:
- мешает увидеть «корень» роутера в одном месте,
- усложняет смену префикса,
- порождает дубли между файлами.

**Цель:** каждый роутер имеет `prefix="/..."`, пути в декораторах относительные.

---

## 10. Process для добавления нового endpoint

### 10.1. Чек-лист (обязательно)

Перед merge нового PR с endpoint-ом проверить:

- [ ] **URL-pattern по конвенциям** (см. §1): plural collection, singular id, kebab-case actions.
- [ ] **Query-параметры** именуются по §2 (`from`, `to`, `limit`, `offset`, `sort`, `search`).
- [ ] **Docstring** — есть, описывает что делает, ожидаемые статусы, для какой роли.
- [ ] **HTTP status code** правильный (см. §5). POST для создания → 201, DELETE без body → 204.
- [ ] **Pydantic schemas**:
  - `response_model=...` указан
  - request-body — отдельный класс в `app/schemas/`
  - не возвращать `dict` из роутера (кроме legacy)
- [ ] **Tag** в `tags=["..."]` — для группировки в Swagger UI, единый стиль.
- [ ] **Auth/Role**:
  - `Depends(get_current_user)` в подписи или в `dependencies=`
  - `require_role(...)` если ограничение по роли
  - `require_module(...)` если требует модуля → 402
- [ ] **Tenant isolation** — фильтр `WHERE tenant_id = current_tenant_id` обязательен. Использовать `assert_tenant_owns(obj, tenant_id)` перед операцией над сущностью.
- [ ] **Пагинация** — если возвращает список, поддерживать `limit`/`offset`.
- [ ] **Тесты** — хотя бы happy-path + 401 + 403 + 404.
- [ ] **OpenAPI пересобран** — `python backend/scripts/dump_openapi.py` (либо обновится автоматически).

### 10.2. Шаблон endpoint

```python
from fastapi import APIRouter, Depends, HTTPException, status
from app.deps import get_current_user, require_role
from app.models import User, UserRole
from app.schemas import AppointmentResponse, AppointmentCreate

router = APIRouter(prefix="/appointments", tags=["appointments"])


@router.post(
    "",
    response_model=AppointmentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать запись на приём",
)
async def create_appointment(
    payload: AppointmentCreate,
    user: User = Depends(get_current_user),
    _: None = Depends(require_role(UserRole.ADMIN, UserRole.NURSE)),
):
    """
    Создаёт запись на приём.

    Бизнес-правила:
    - Слот должен быть свободен (иначе 409).
    - Время не в прошлом (иначе 400).
    - Доктор и пациент — в одном тенанте (проверяется автоматически).
    """
    # ...
    return appointment
```

### 10.3. Migration plan для устаревших endpoints

Когда меняем старый endpoint на новый:

1. **Добавить новый** path рядом со старым (оба работают).
2. **Старый помечаем `deprecated=True`** — `@router.get("/old", deprecated=True)`.
3. **Логировать использование** старого через middleware.
4. Через **6 месяцев** (или когда логи покажут 0 хитов) — удалить старый.

Никогда не ломать клиентов одномоментно.

### 10.4. Где спросить

- Сомнения по конвенциям — этот документ + `BILLING_ARCHITECTURE.md` для биллинга.
- Сомнения по multi-tenancy — `app/core/security_utils.py`, `assert_tenant_owns`.
- Sample endpoints следующих конвенциям — `app/routers/auth.py`, `app/routers/clinics.py`.

---

## Связанные документы

- [`API_REFERENCE.md`](./API_REFERENCE.md) — текущий список endpoints с описаниями
- [`API_CONTRACT.md`](./API_CONTRACT.md) — контракты для интеграций
- [`BILLING_ARCHITECTURE.md`](../BILLING_ARCHITECTURE.md) — правила биллинговых endpoints
- [`SECURITY_HEADERS.md`](./SECURITY_HEADERS.md) — security headers и CORS
- Swagger UI: <https://клиниксеть.рф/api/docs>

---

*Поддерживается: backend team. Изменения — через PR с обоснованием в описании.*
