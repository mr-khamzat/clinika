# Телефония PSTN ↔ КлиникСеть Calls — план интеграции

**Версия**: 1.0 от 2026-05-13
**Статус**: план, реализация после задачи «Чаты в Calls»
**Решение по мосту WebRTC↔SIP**: будет принято после прочтения этого документа

---

## 0. Цель

Внешний звонок (мобильный/городской) **в** Calls и **из** Calls.
Полное per-franchise управление: каждый франчайзи подключает свой
SIP-провайдер, свои DID-номера, свою тарификацию, свои IVR-правила.

Меню настроек живёт в платформе (`/admin/integrations/telephony`).
Полноценное управление под каждую франшизу через кабинет `franchise_owner`.

---

## 1. Текущее состояние

| Компонент | Что есть сейчас | Чего нет |
|---|---|---|
| `routers/calls.py` | История и аналитика **внутренних** WebRTC-звонков (CallLog) | Внешние номера, PSTN, CallerID |
| `models/presence.py::CallLog` | caller_id/callee_id как User UUID | external_number, direction in/out |
| Calls Electron app | Видеосвязь врач↔пациент, WhatsApp-боковая панель | Dialer, входящие, push с CallerID |
| `services/mis_client.py` (Renovatio) | Поллинг данных из МИС, в т.ч. `getCalls` | Это история звонков МИС, не транспорт |
| `modules/call_recording` | Запись + Whisper-транскрипция WebRTC-сессий | Запись внешних SIP-звонков |

**Итог**: PSTN-моста нет, всё придётся строить.

---

## 2. Три варианта моста WebRTC ↔ SIP

### Вариант A — WebRTC SDK провайдера (Mango / Sipuni) ⭐ MVP-кандидат

**Как работает**: Mango (или Sipuni) даёт готовый JS-SDK, который встраиваем
в Calls Electron + в веб-кабинет. Все звонки идут через инфраструктуру провайдера.
Мы только UI + бизнес-логика (поиск пациента по номеру, запись в нашу БД).

| Параметр | Значение |
|---|---|
| Срок до пилота | 1–2 недели |
| Срок до прод | 3–4 недели |
| Платформенная стоимость | 0 ₽ (нет своих серверов) |
| Стоимость для франчайзи | от 1 490 ₽/мес/АТС (Mango) + ~0.5–1.5 ₽/мин |
| **Pro** | минимум кода, провайдер сам решает NAT/codecs/quality |
| **Con** | lock-in (смена провайдера = переписать весь Calls), white-label ограничен |

**Mango Office Voice API**: https://www.mango-office.ru/support/api/
**Sipuni API**: https://sipuni.com/ru/api

### Вариант B — Свой FreeSWITCH

**Как работает**: поднимаем FreeSWITCH в Docker. К нему подключается ЛЮБОЙ
SIP-провайдер по SIP-trunk (Билайн, Mango, Zadarma, MTT и т.д.).
Calls общается с FS через WebRTC (mod_verto / WebRTC-SIP gateway).

| Параметр | Значение |
|---|---|
| Срок до пилота | 2–3 недели |
| Срок до стабильного прода | 1.5–2 месяца |
| Платформенная стоимость | +50–100 $/мес VPS под FreeSWITCH + 2–3 ч/нед SRE |
| Стоимость для франчайзи | только тариф SIP-trunk (~500–1500 ₽/мес) |
| **Pro** | независимость от провайдера, любой SIP-trunk, маржа на минутах |
| **Con** | нужна экспертиза по FS, NAT/TURN отдельно, codecs |

### Вариант C — MVP без браузерной трубки

**Как работает**: Calls/платформа НЕ переносит голос. Звонок физически
идёт через мобильный или IP-телефон оператора. В Calls — только:
1. Поп-ап с CallerID при входящем (через webhook провайдера)
2. Auto-search пациента по номеру в МИС
3. Click-to-call: клик по номеру в Calls → REST к провайдеру → провайдер
   звонит на физический телефон оператора, а оттуда соединяет с клиентом
4. Запись разговора берётся ИЗ провайдера (Mango/Zadarma сохраняют у себя)
5. История звонков синхронизируется через webhook + polling

| Параметр | Значение |
|---|---|
| Срок до пилота | 5–7 дней |
| Срок до прода | 2 недели |
| Платформенная стоимость | 0 ₽ |
| Стоимость для франчайзи | тариф SIP-провайдера (любой, ~990–1500 ₽/мес) |
| **Pro** | минимум кода, фокус на data/CRM, легко расширить до A |
| **Con** | трубка не в Calls, оператор держит физический телефон |

### Рекомендация

1. **MVP — вариант C** (2 недели разработки). Достаточно чтобы продавать.
2. **Через 2–3 месяца** — апгрейд до **A (Mango SDK)** для крупных франчайзи
   (видео+голос в одном окне).
3. **B (свой FreeSWITCH)** — отложить до года 2 (когда нужна независимость
   и >100 клиник для экономии на минутах).

---

## 3. Архитектура (общая для всех вариантов)

### 3.1. Backend — модели

**`app/models/telephony.py`** (новый):

```python
class TelephonyConfig(Base):
    """Настройка телефонии на уровне tenant (франшизы)."""
    id: UUID
    tenant_id: UUID FK -> tenants
    provider: str  # mango | sipuni | zadarma | onlinepbx | custom
    api_url: str
    api_key_encrypted: str  # Fernet через encryption_service
    api_secret_encrypted: str
    is_active: bool
    features: JSONB  # {record_calls, ivr_enabled, voicemail, callback}
    created_at, updated_at

class DidNumber(Base):
    """DID-номер (внешний номер, на который звонят клиенты)."""
    id: UUID
    tenant_id: UUID FK
    clinic_id: UUID FK -> clinics  # маршрутизация: какая клиника получает
    number: str  # +7XXXXXXXXXX
    display_name: str  # "Регистратура Назрань"
    default_assignee_id: UUID FK -> users  # дефолтный оператор (reg)
    ivr_config: JSONB | None  # многоуровневое меню
    record_calls: bool
    is_active: bool

class PhoneCall(Base):
    """История внешних звонков (PSTN ↔ платформа)."""
    id: UUID
    tenant_id, clinic_id: UUID FK
    direction: str  # in | out
    external_number: str  # номер клиента
    internal_did: str | None  # на какой наш DID звонили
    operator_id: UUID FK -> users  # кто из персонала
    patient_id: UUID FK -> patient_accounts | None  # auto-link по номеру
    started_at, answered_at, ended_at: datetime
    duration_sec: int
    status: str  # missed | answered | rejected | failed
    recording_url: str | None  # ссылка от провайдера или из call_recording
    provider_call_id: str  # id у провайдера для cross-ref
    notes: str | None  # оператор может приписать
```

**Migration**: `alembic revision -m "telephony_models"`.

### 3.2. Backend — роутер

**`app/routers/telephony.py`** (новый):

```
GET    /telephony/config                — текущая конфигурация tenant
PUT    /telephony/config                — обновить (только franchise_owner/admin)
POST   /telephony/test-connection       — проверка кредов провайдера

GET    /telephony/did                   — список DID-номеров
POST   /telephony/did                   — добавить DID
PATCH  /telephony/did/{id}              — обновить (routing, IVR, assignee)
DELETE /telephony/did/{id}              — удалить

POST   /telephony/click-to-call         — инициация исходящего {from, to}
POST   /telephony/webhook/{provider}    — приём событий от провайдера
GET    /telephony/calls                 — история звонков (расширяет /calls/log)
GET    /telephony/calls/{id}/recording  — proxied recording URL
```

**RBAC**:
- `franchise_owner`, `admin`, `super_admin` → CRUD config + DID
- `manager` → read config + статистика звонков
- `reg`, `doctor` → видят только СВОИ звонки (где они operator_id)

### 3.3. Backend — адаптеры провайдеров

**`app/services/telephony/`** (новый пакет):

```python
class TelephonyAdapter(ABC):
    """Унифицированный интерфейс для всех SIP-провайдеров."""
    async def test_connection(self) -> bool
    async def click_to_call(self, from_ext: str, to: str) -> str  # provider_call_id
    async def fetch_call_record(self, call_id: str) -> CallRecord
    async def list_did_numbers(self) -> list[DID]
    async def parse_webhook(self, body: dict) -> WebhookEvent
    async def verify_webhook(self, body: bytes, signature: str) -> bool

class MangoAdapter(TelephonyAdapter): ...
class SipuniAdapter(TelephonyAdapter): ...
class ZadarmaAdapter(TelephonyAdapter): ...
```

Это позволяет добавлять провайдеров в одну фабрику без правок роутера.

### 3.4. Frontend — платформа

**`/admin/integrations/telephony`** (новая страница, доступна franchise_owner+):

- Карточка «Провайдер»: dropdown выбора + поля кредов + кнопка «Тест соединения»
- Таблица DID-номеров: number, display_name, clinic, assignee, IVR-кнопка, ON/OFF
- Кнопка «+ Добавить DID»
- Свитч «Запись разговоров» + retention (30/90/365 дней)
- Свитч «IVR голосовое меню» — модалка с tree-builder
- Последние 50 звонков в виде таблицы (live preview)
- Ссылка на полный лог в `/admin/calls`

### 3.5. Frontend — Calls Electron app

**Вариант C (MVP)**:
- Push-уведомление при входящем звонке (CallerID + ФИО пациента если найден)
- Виджет в шапке Calls «История звонков» с быстрыми кнопками «Перезвонить»
- В карточке пациента — кнопка «Позвонить» (click-to-call через провайдера)
- Заметки к звонку (operator notes)

**Вариант A (когда апгрейдимся)**:
- Полноценный dialer (numpad + поле ввода)
- Входящий звонок открывает full-screen popup с пациентом
- Mute/Hold/Transfer/Conference
- Видео+голос в одном окне (поверх существующего WebRTC для пациента)

---

## 4. Безопасность и compliance

| Аспект | Решение |
|---|---|
| API-секреты | Шифрование через существующий `encryption_service` (Fernet) |
| Webhook integrity | HMAC-подпись + IP-allowlist на провайдеров (как для ЮKassa) |
| Запись разговоров | Уведомление пациенту в начале звонка (IVR-сообщение) + опт-ин по 152-ФЗ |
| Хранение записей | S3-compatible с GPG (по аналогии с backup), retention из настроек |
| Per-tenant изоляция | Все запросы фильтруются по `tenant_id` (как и весь остальной API) |

---

## 5. Биллинг и unit-экономика

**Новый платный модуль в каталоге** (вписать в [`module_catalog`](../backend/app/models/module_catalog.py)):

| Тариф | Цена платформе/мес/клиника | Что входит |
|---|---|---|
| **Telephony Lite** | **1 990 ₽** | Вариант C: история + CallerID + click-to-call |
| **Telephony Pro** | **3 990 ₽** | Вариант A: dialer в Calls + видео/голос вместе |
| **Telephony Enterprise** | **9 990 ₽** | Вариант B: свой FS + микс провайдеров + маржа на минутах |

Тариф провайдера (Mango/Sipuni и т.д.) платится франчайзи **напрямую** провайдеру —
мы не реселлеры.

**Расчёт при 50 клиниках** (год 1, реалистичный сценарий):
- 30 на Lite × 1 990 = 59 700 ₽/мес
- 18 на Pro × 3 990 = 71 820 ₽/мес
- 2 на Enterprise × 9 990 = 19 980 ₽/мес
- **Итого ~151 500 ₽/мес дополнительной выручки** при 0 операционных затратах (Lite/Pro).
- Pro/Enterprise суммарно ~91 800 ₽/мес → запас на FreeSWITCH-инфру даже на Enterprise.

---

## 6. План реализации MVP (вариант C)

### Неделя 1 — Backend foundation
| День | Задача | Файлы |
|---|---|---|
| 1 | Модели `TelephonyConfig`, `DidNumber`, `PhoneCall` + alembic | `models/telephony.py`, `alembic/versions/XXX_telephony.py` |
| 2 | CRUD endpoints `/telephony/config` + `/telephony/did` | `routers/telephony.py` |
| 3 | Базовый адаптер + Mango Office как pilot | `services/telephony/{base,mango}.py` |
| 4 | Click-to-call + webhook receive | `routers/telephony.py`, `services/telephony/mango.py` |
| 5 | Тесты + миграция на staging | `tests/test_telephony.py` |

### Неделя 2 — Frontend + Calls + пилот
| День | Задача | Файлы |
|---|---|---|
| 1-2 | UI `/admin/integrations/telephony` | `frontend/src/pages/admin/IntegrationsTelephony.jsx` |
| 3 | Виджет «История звонков» в Calls + incoming popup | `clinikset-calls/src/components/CallHistory.tsx` |
| 4 | Click-to-call с карточки пациента | `frontend/src/components/PatientCard.jsx` (расширить) |
| 5 | Пилот на одной клинике + документация | `wiki_content/module-telephony.md` |

---

## 7. Open questions (требуют решения до старта)

1. **Выбор pilot-провайдера**: Mango Office или Sipuni? (Mango дороже но богаче API)
2. **Recording storage**: использовать существующий S3-бакет call_recording или отдельный?
3. **CallerID source**: показывать имя пациента **сразу** в popup или только после ручного клика? (UX vs. perceived stalking)
4. **Mobile**: нужен ли веб-кабинет «телефон» для мобильного браузера или только Calls Desktop?

---

## 8. Что НЕ входит в MVP (отложено)

- Многоуровневые IVR-меню (tree-builder UI)
- Очередь звонков / распределение между операторами по нагрузке
- Видеосвязь PSTN ↔ платформа (звонящий с городского видео не получит)
- Конференц-связь >2 участников
- Интеграция с CRM-сценариями (auto-call back на пропущенный)
- AI-резюме разговора (отдельный модуль `call_recording` это закроет)

---

## 9. Следующий шаг

После реализации задачи «Чаты сотрудник↔сотрудник в Calls»:
1. Финальный выбор pilot-провайдера и варианта моста
2. Регистрация тестового аккаунта Mango/Sipuni
3. Начало разработки по плану из §6
