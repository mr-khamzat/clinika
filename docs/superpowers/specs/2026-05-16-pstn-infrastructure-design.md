# PSTN Infrastructure — Design

**Дата:** 2026-05-16
**Сессия:** brainstorming-5
**Источник:** базируется на `docs/TELEPHONY_INTEGRATION_PLAN.md` (303 строки)

---

## 1. Контекст

Внешние звонки (городской/мобильный ↔ Calls) — не реализованы. Этот батч
создаёт инфраструктуру под будущую интеграцию с любым SIP-провайдером.
В этой сессии **только инфраструктура** — реальный провайдер (Mango/Zadarma/
Sipuni) подключается отдельной сессией после выбора.

В Calls Electron 1.0.30 уже добавлен Dialpad UI, который шлёт POST
`/calls/dial`. После этого батча endpoint существует и возвращает осмысленный
ответ (503 «провайдер не настроен» пока провайдер не выбран).

## 2. Цели и не-цели

**Цели:**
- 3 модели в БД: `telephony_configs`, `did_numbers`, `phone_calls`
- API: CRUD конфига телефонии, CRUD DID-номеров, история звонков, dial endpoint
- Pluggable provider-абстракция (фабрика `get_provider(tenant_id)`)
- UI настроек `/manager/telephony` (3 таба: провайдер, DID, история)
- Заглушка `NullProvider` для всех методов

**Не-цели (отдельные сессии):**
- ❌ Реализация конкретных провайдеров (Mango/Zadarma/Sipuni)
- ❌ Webhook handlers (входящие)
- ❌ IVR-конструктор
- ❌ Запись звонков (используется provider'ская)

## 3. Архитектура

### 3.1 Backend модели (`backend/app/models/telephony.py` — новый)

```python
class TelephonyConfig(Base):
    __tablename__ = "telephony_configs"
    id: UUID PK
    tenant_id: UUID FK tenants UNIQUE  # одна конфигурация на тенант
    provider: str(20)  # 'null' | 'mango' | 'sipuni' | 'zadarma' | 'onlinepbx' | 'custom'
    api_url: str(300) NULL
    api_key_encrypted: TEXT NULL
    api_secret_encrypted: TEXT NULL
    is_active: bool DEFAULT false
    features: JSONB DEFAULT '{}'
        # {record_calls: bool, ivr_enabled: bool, voicemail: bool, callback: bool}
    created_at, updated_at

class DidNumber(Base):
    __tablename__ = "did_numbers"
    id: UUID PK
    tenant_id: UUID FK tenants
    clinic_id: UUID FK clinics NULL  # NULL = ловит вся франшиза
    number: str(20)  # +7XXXXXXXXXX
    display_name: str(200)  # "Регистратура Назрань"
    default_assignee_id: UUID FK users NULL
    ivr_config: JSONB NULL  # placeholder для будущего IVR
    record_calls: bool DEFAULT true
    is_active: bool DEFAULT true
    created_at, updated_at
    UNIQUE (tenant_id, number)

class PhoneCall(Base):
    __tablename__ = "phone_calls"
    id: UUID PK
    tenant_id: UUID FK tenants
    clinic_id: UUID FK clinics NULL
    direction: str(3)  # 'in' | 'out'
    external_number: str(20)  # номер клиента
    internal_did: str(20) NULL  # наш DID (для in)
    operator_id: UUID FK users NULL
    patient_id: UUID FK patient_accounts NULL  # auto-link по номеру
    started_at: timestamp DEFAULT now()
    answered_at: timestamp NULL
    ended_at: timestamp NULL
    duration_sec: int NULL
    status: str(20)  # 'initiated'|'ringing'|'answered'|'missed'|'rejected'|'failed'|'completed'
    recording_url: str(500) NULL
    provider_call_id: str(100) NULL  # cross-ref в провайдере
    notes: TEXT NULL
    created_at, updated_at
```

**Шифрование** `api_key_encrypted` / `api_secret_encrypted` — через существующий
`encryption_service` (Fernet, уже используется для других секретов).

### 3.2 Provider-абстракция

`backend/app/services/telephony/__init__.py` — экспорт фабрики
`backend/app/services/telephony/base.py`:
```python
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class CallInitiateResult:
    success: bool
    provider_call_id: str | None = None
    error: str | None = None

@dataclass
class CallStatusResult:
    status: str  # 'ringing'|'answered'|'completed'|'failed'
    duration_sec: int | None = None
    recording_url: str | None = None

class TelephonyProvider(ABC):
    @abstractmethod
    async def initiate_call(self, *, from_user_phone: str, to_number: str) -> CallInitiateResult: ...
    @abstractmethod
    async def get_call_status(self, provider_call_id: str) -> CallStatusResult: ...
    @abstractmethod
    async def fetch_recording(self, provider_call_id: str) -> bytes | None: ...
    @abstractmethod
    async def handle_incoming_webhook(self, payload: dict) -> dict: ...
```

`backend/app/services/telephony/null.py`:
```python
class NullProvider(TelephonyProvider):
    """Заглушка когда провайдер не настроен. Все методы возвращают 503-like."""
    async def initiate_call(self, **kw) -> CallInitiateResult:
        return CallInitiateResult(success=False, error="Провайдер телефонии не настроен")
    # ...прочие методы возвращают пустоту
```

`backend/app/services/telephony/factory.py`:
```python
async def get_provider(db, tenant_id) -> TelephonyProvider:
    cfg = await db.execute(select(TelephonyConfig).where(...))
    cfg = cfg.scalar_one_or_none()
    if not cfg or not cfg.is_active or cfg.provider == "null":
        return NullProvider()
    # TODO: pluggable real providers (отдельная сессия)
    return NullProvider()
```

### 3.3 API endpoints

**Конфиг:** `backend/app/routers/tenant_telephony.py` (новый)
- `GET /tenant/settings/telephony` → возвращает (без секретов) `{provider, api_url, is_active, features}`
- `PATCH /tenant/settings/telephony` → принимает `{provider, api_url, api_key, api_secret, is_active, features}`, шифрует и сохраняет (manager/franchise_owner)

**DID:**
- `GET /tenant/did-numbers` → список
- `POST /tenant/did-numbers` → создать (валидация телефона +7XXXXXXXXXX)
- `PATCH /tenant/did-numbers/{id}` → обновить
- `DELETE /tenant/did-numbers/{id}` → удалить

**Dial:**
- `POST /calls/dial {to_number, from_user_id?}` (для Calls Dialpad)
  - Загружает provider для текущего тенанта user'а
  - Вызывает `provider.initiate_call(from_user_phone=..., to_number=...)`
  - Если NullProvider — возвращает 503 «не настроено»
  - Иначе — создаёт `PhoneCall(direction='out', status='initiated', provider_call_id=...)`
  - Returns `{call_id, provider_call_id, status}`

**История:**
- `GET /telephony/calls?from=&to=&direction=&page=` → paginated list

### 3.4 Frontend

**Новая страница `/manager/telephony`** (`frontend/src/pages/ManagerTelephony.jsx`):

3 таба:

**Tab 1: Провайдер**
- Dropdown «Провайдер» (None/Mango/Sipuni/Zadarma/OnlinePBX/Custom — пока только None работает)
- Поля api_url, api_key, api_secret (password input, не показываем сохранённые)
- Toggle is_active
- 4 чекбокса features
- Кнопка «Сохранить»

**Tab 2: DID-номера**
- Таблица с номерами + кнопка «+ Добавить»
- Модал создания: номер +7XXX, имя, клиника (опционально), default assignee, чекбоксы

**Tab 3: История звонков**
- Таблица: дата, направление (in/out), номер, оператор, длительность, статус
- Фильтры: даты, direction, status
- Поиск по номеру

**В `_ManagerShell.jsx`:** добавить пункт меню «Телефония» (icon `phone`, group `integrations`).

## 4. Безопасность

- `api_key`/`api_secret` шифруются через encryption_service перед сохранением
- GET endpoints НЕ возвращают расшифрованные секреты — только `has_credentials: bool`
- Все endpoints — только manager/franchise_owner (через `_require_settings_role`)
- DID-номер уникален в пределах тенанта (UNIQUE constraint)
- `phone_calls.external_number` храним как ввёл оператор; маскирование в логах

## 5. Тестирование

**Backend (pytest, 8 тестов):**
- `test_null_provider_returns_503_on_dial`
- `test_telephony_config_upsert_encrypts_secrets`
- `test_did_number_create_validates_phone_format`
- `test_did_number_unique_per_tenant`
- `test_dial_endpoint_without_config_returns_503`
- `test_dial_endpoint_creates_phone_call_record`
- `test_get_telephony_config_hides_secrets`
- `test_did_crud_requires_manager_role`

**Smoke endpoints:** 5 endpoint'ов → 403 без auth, /calls/dial → 401/403/503 (зависит от настроек тенанта).

**Frontend:** vite build + HTTP 200.

## 6. Миграция

`backend/alembic/versions/2026_05_16_tel01_telephony_models.py`:
- Создаёт 3 таблицы (telephony_configs, did_numbers, phone_calls)
- Индексы: `did_numbers (tenant_id, number)`, `phone_calls (tenant_id, started_at DESC)`
- down_revision = текущий head `sf04_pinned` (или новый head после Workflow/StaffChat)

## 7. Реализация

**2 параллельных агента:**
- **Backend агент:** модель + миграция + 3 router'а + provider абстракция + 8 тестов
- **Frontend агент:** ManagerTelephony.jsx (3 таба) + route + меню + API helpers

~5-6 часов через агентов.

## 8. Open questions

Нет — все решения зафиксированы. Реальные provider'ы — отдельные сессии
после выбора (Mango/Sipuni/Zadarma).
