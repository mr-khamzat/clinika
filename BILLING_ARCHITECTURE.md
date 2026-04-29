# 📊 Полная схема взаимодействия модулей биллинга КлиникСеть

## Оглавление
1. [Архитектура биллинга](#1-архитектура-биллинга)
2. [Модуль подписок (SaaS)](#2-модуль-подписок-saas)
3. [Модуль платных плагинов](#3-модуль-платных-плагинов)
4. [Модуль рекламы](#4-модуль-рекламы)
5. [Модуль направлений и бонусов](#5-модуль-направлений-и-бонусов)
6. [Финансовый реестр (Billing Ledger)](#6-финансовый-реестр-billing-ledger)
7. [Полные цепочки событий](#7-полные-цепочки-событий)
8. [Схема базы данных](#8-схема-базы-данных)

---

## 1. Архитектура биллинга

### Уровни системы

```
┌─────────────────────────────────────────────────────────────────┐
│                    API Layer (FastAPI Routers)                  │
│  /billing/*  │  /ads/*  │  /referrals/*  │  /plugins/*         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Service Layer (Business Logic)                 │
│  billing_service.py  │  referral_service.py  │  ledger_service │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   Data Models (SQLAlchemy ORM)                  │
│  billing.py │ billing_ledger.py │ referral.py │ bonus.py       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL Database                        │
└─────────────────────────────────────────────────────────────────┘
```

### Ключевые принципы

| Принцип | Описание |
|---------|----------|
| **Append-only** | Все финансовые записи только добавляются, никогда не изменяются |
| **Revenue Split** | Автоматическое разделение дохода: платформа / тенант / франшиза |
| **Идемпотентность** | Повторный вызов операции не создаёт дубликатов |
| **152-ФЗ** | IP хешируется, PII данные не хранятся в логах |

---

## 2. Модуль подписок (SaaS)

### Сущности

#### `Subscription` — Подписка тенанта
```python
{
  id: UUID,
  tenant_id: UUID,
  plan: "basic" | "professional" | "enterprise",
  billing_cycle: "monthly" | "quarterly" | "semi_annual" | "nine_months" | "annual",
  status: "trial" | "active" | "past_due" | "paused" | "cancelled",
  trial_ends_at: datetime,
  current_period_start: date,
  current_period_end: date,
  next_invoice_date: date,
  amount_per_period: Decimal,  # например 9900.00
  auto_renew: bool
}
```

#### `Invoice` — Счёт на оплату
```python
{
  id: UUID,
  subscription_id: UUID,
  tenant_id: UUID,
  invoice_number: "INV-2026-00001",  # человекочитаемый
  status: "draft" | "sent" | "paid" | "overdue" | "void",
  amount: Decimal,
  period_start: date,
  period_end: date,
  due_date: date,  # через 14 дней от start
  paid_at: datetime,
  paid_amount: Decimal,
  line_items: JSONB  # [{"description": "...", "amount": 9900, "quantity": 1}]
}
```

#### `Payment` — Платёж
```python
{
  id: UUID,
  invoice_id: UUID,
  tenant_id: UUID,
  amount: Decimal,
  status: "pending" | "completed" | "failed" | "refunded",
  method: "card" | "bank" | "cash" | "crypto",
  gateway: "stripe" | "yookassa" | "manual",
  transaction_id: str,  # ID транзакции платёжной системы
  processed_at: datetime
}
```

### Цепочка: Создание подписки

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Tenant     │     │  Billing Service  │     │  Billing Ledger │
│  (Admin UI)  │     │                   │     │                 │
└──────┬───────┘     └─────────┬────────┘     └────────┬────────┘
       │                       │                        │
       │ POST /billing/        │                        │
       │ subscription          │                        │
       │ {plan: "professional",│                        │
       │  cycle: "monthly"}    │                        │
       ├──────────────────────►│                        │
       │                       │                        │
       │                       │ 1. Проверяет PLAN_PRICES│
       │                       │    professional/monthly │
       │                       │    = 24900₽            │
       │                       │                        │
       │                       │ 2. Создаёт Subscription│
       │                       │    status=TRIAL        │
       │                       │    trial_ends=+14 дней │
       │                       ├───────────────────────►│
       │                       │                        │ record_billing_ledger()
       │                       │                        │ entry_type=SUBSCRIPTION_TRIAL
       │                       │                        │ amount=0 (для аудита)
       │                       │◄───────────────────────┤
       │                       │                        │
       │                       │ 3. Commit DB           │
       │◄──────────────────────┤                        │
       │                       │                        │
       │ 200 OK {             │                        │
       │   id: "...",         │                        │
       │   status: "trial",   │                        │
       │   trial_ends: "..."  │                        │
       │ }                    │                        │
       │                       │                        │
```

### Цепочка: Выставление счёта

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Scheduler  │     │  Billing Service  │     │  Billing Ledger │
│  (Cron Job)  │     │                   │     │                 │
└──────┬───────┘     └─────────┬────────┘     └────────┬────────┘
       │                       │                        │
       │ Ежедневно в 00:00     │                        │
       │ Проверка:             │                        │
       │ next_invoice_date ≤ today│                     │
       ├──────────────────────►│                        │
       │                       │                        │
       │                       │ 1. generate_invoice()  │
       │                       │    - Invoice.status=SENT│
       │                       │    - amount=24900      │
       │                       │    - due_date=+14 дней │
       │                       │                        │
       │                       │ 2. Обновляет Subscription│
       │                       │    current_period_*    │
       │                       │    next_invoice_date   │
       │                       │    status=ACTIVE       │
       │                       ├───────────────────────►│
       │                       │                        │ record_billing_ledger()
       │                       │                        │ entry_type=SUBSCRIPTION_CHARGE
       │                       │                        │ direction=DEBIT
       │                       │                        │ amount=24900
       │                       │                        │ reference_id=invoice.id
       │                       │◄───────────────────────┤
       │                       │                        │
       │                       │ 3. Commit DB           │
       │◄──────────────────────┤                        │
       │                       │                        │
       │ Отправка email tenant │                        │
       │ "Счёт INV-2026-00001" │                        │
       │                       │                        │
```

### Цепочка: Оплата счёта

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Tenant     │     │  Billing Service  │     │  Billing Ledger │
│  (Admin UI)  │     │                   │     │                 │
└──────┬───────┘     └─────────┬────────┘     └────────┬────────┘
       │                       │                        │
       │ POST /invoices/{id}/pay│                       │
       │ {amount: 24900,       │                        │
       │  method: "card",      │                        │
       │  gateway: "yookassa"} │                        │
       ├──────────────────────►│                        │
       │                       │                        │
       │                       │ 1. record_payment()    │
       │                       │    Payment.status=COMPLETED│
       │                       │    Invoice.status=PAID │
       │                       │    Invoice.paid_at=now │
       │                       │                        │
       │                       │ 2. Если sub.status=PAST_DUE│
       │                       │    → sub.status=ACTIVE │
       │                       ├───────────────────────►│
       │                       │                        │ record_billing_ledger()
       │                       │                        │ entry_type=PAYMENT_RECEIVED
       │                       │                        │ direction=CREDIT
       │                       │                        │ amount=24900
       │                       │◄───────────────────────┤
       │                       │                        │
       │                       │ 3. Commit DB           │
       │◄──────────────────────┤                        │
       │                       │                        │
       │ 200 OK {payment}     │                        │
       │ Email "Оплата получена"│                       │
       │                       │                        │
```

### Прайс-лист (PLAN_PRICES)

| План | Monthly | Quarterly | Semi-annual | Nine months | Annual |
|------|---------|-----------|-------------|-------------|--------|
| **basic** | 9 900₽ | 28 200₽ | 53 400₽ | 77 500₽ | 99 000₽ |
| **professional** | 24 900₽ | 70 900₽ | 134 400₽ | 194 900₽ | 249 000₽ |
| **enterprise** | 49 900₽ | 142 200₽ | 269 400₽ | 390 700₽ | 499 000₽ |

**Скидка при оплате за год:** ~17%

---

## 3. Модуль платных плагинов

### Сущности

#### `TenantPluginSubscription` — Подписка на плагин
```python
{
  id: UUID,
  tenant_id: UUID,
  feature_key: "ai_assistant" | "sms_notifications" | ...,
  status: "trial" | "active" | "expired" | "cancelled",
  billing_cycle: "monthly",
  price: Decimal,  # например 5000₽/мес
  trial_ends_at: datetime,
  expires_at: datetime,
  last_charged_at: datetime,
  auto_renew: bool
}
```

#### `PluginFeature` — Каталог фич
```python
{
  key: "ai_assistant",
  name: "AI Ассистент",
  is_paid: true,
  price_monthly: 5000,
  price_annual: 50000
}
```

### Цепочка: Включение плагина

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Tenant     │     │  Billing Service  │     │  Billing Ledger │
│  (Settings)  │     │                   │     │                 │
└──────┬───────┘     └─────────┬────────┘     └────────┬────────┘
       │                       │                        │
       │ POST /plugins/        │                        │
       │ ai_assistant/enable   │                        │
       │ {trial_days: 7}       │                        │
       ├──────────────────────►│                        │
       │                       │                        │
       │                       │ 1. enable_plugin()     │
       │                       │    Проверка: фича платная│
       │                       │    PluginFeature.price │
       │                       │                        │
       │                       │ 2. Создаёт PluginSub   │
       │                       │    status=TRIAL        │
       │                       │    trial_ends=+7 дней  │
       │                       ├───────────────────────►│
       │                       │                        │ record_billing_ledger()
       │                       │                        │ entry_type=SUBSCRIPTION_TRIAL
       │                       │                        │ amount=0 (аудит)
       │                       │◄───────────────────────┤
       │                       │                        │
       │                       │ 3. Commit DB           │
       │◄──────────────────────┤                        │
       │                       │                        │
       │ 200 OK {plugin_sub}  │                        │
       │                       │                        │
       
       ─── Через 7 дней (trial закончился) ─────────────────────────
       
       │                       │                        │
       │ Scheduler: charge_plugin_subscription()        │
       │                       │                        │
       │                       │ 1. Создаёт PLUGIN_RENEWAL│
       │                       │    amount=5000         │
       │                       ├───────────────────────►│
       │                       │                        │ _apply_revenue_split()
       │                       │                        │ gross=5000
       │                       │                        │ split=30% platform / 70% tenant
       │                       │                        │                        │
       │                       │                        │ 1. PLATFORM_INCOME: 1500 (credit)
       │                       │                        │ 2. TENANT_INCOME: 3500 (credit)
       │                       │                        │ 3. FRANCHISE_FEE: если >0% (debit)
       │                       │◄───────────────────────┤
       │                       │                        │
       │                       │ 2. PluginSub.status=ACTIVE│
       │                       │    expires_at=+30 дней │
       │                       │    last_charged_at=now │
       │◄──────────────────────┤                        │
       │                       │                        │
```

### Revenue Split (разделение дохода)

**Настройки по умолчанию (`TenantPricingRules`):**
- `plugin_split_percent`: 30% (доля платформы)
- `ad_split_percent`: 20% (доля платформы)
- `franchise_fee_percent`: 0% (для прямых тенантов)

**Пример расчёта для плагина 5000₽:**

| Запись | Actor | Direction | Amount | Описание |
|--------|-------|-----------|--------|----------|
| PLUGIN_RENEWAL (gross) | tenant | DEBIT | 5000 | Списано с тенанта |
| PLATFORM_INCOME | platform | CREDIT | 1500 | 30% платформе |
| TENANT_INCOME | tenant | CREDIT | 3500 | 70% тенанту |
| FRANCHISE_FEE | franchise | DEBIT | 0 | 0% франшиза (если есть) |

---

## 4. Модуль рекламы

### Сущности

#### `Ad` — Рекламное объявление
```python
{
  id: UUID,
  tenant_id: UUID,
  title: "Акция на чистку зубов",
  body: "Скидка 20% до конца месяца",
  ad_type: "banner" | "push" | "interstitial",
  status: "draft" | "active" | "paused" | "completed",
  start_date: date,
  end_date: date,
  pricing_model: "flat" | "cpc" | "cpm",
  price: Decimal,  # 10000₽ flat или 50₽/клик или 100₽/1000 показов
  impressions_limit: int | null,
  clicks_limit: int | null,
  impressions_count: int,  # денормализовано
  clicks_count: int,
  conversions_count: int
}
```

#### `AdEvent` — Событие взаимодействия
```python
{
  id: UUID,
  ad_id: UUID,
  tenant_id: UUID,
  event_type: "impression" | "click" | "conversion",
  ip_hash: str,  # SHA-256(ip + date) — без PII
  user_id: UUID | null,
  created_at: datetime
}
```

### Цепочка: Создание рекламы (Flat)

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Tenant     │     │  Billing Service  │     │  Billing Ledger │
│  (Ads UI)    │     │                   │     │                 │
└──────┬───────┘     └─────────┬────────┘     └────────┬────────┘
       │                       │                        │
       │ POST /ads/            │                        │
       │ {title: "...",        │                        │
       │  pricing_model:"flat",│                        │
       │  price: 10000,        │                        │
       │  start: 2026-01-01,   │                        │
       │  end: 2026-01-31}     │                        │
       ├──────────────────────►│                        │
       │                       │                        │
       │                       │ 1. create_ad()         │
       │                       │    Ad.status=DRAFT     │
       │                       │                        │
       │                       │ 2. AD_CHARGE (flat)    │
       │                       ├───────────────────────►│
       │                       │                        │ record_billing_ledger()
       │                       │                        │ entry_type=AD_CHARGE
       │                       │                        │ direction=DEBIT
       │                       │                        │ amount=10000
       │                       │                        │                        │
       │                       │                        │ _apply_revenue_split()
       │                       │                        │ gross=10000
       │                       │                        │ split=20% platform / 80% tenant
       │                       │                        │                        │
       │                       │                        │ 1. PLATFORM_INCOME: 2000 (credit)
       │                       │                        │ 2. TENANT_INCOME: 8000 (credit)
       │                       │◄───────────────────────┤
       │                       │                        │
       │                       │ 3. Ad.status=ACTIVE    │
       │◄──────────────────────┤                        │
       │                       │                        │
       │ 200 OK {ad}          │                        │
       │                       │                        │
```

### Цепочка: CPC/CPM биллинг

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User       │     │  Frontend/App     │     │  Billing Service │
│  (Клиент)    │     │                   │     │                 │
└──────┬───────┘     └─────────┬─────────┘     └────────┬────────┘
       │                       │                        │
       │ Клик по баннеру       │                        │
       ├──────────────────────►│                        │
       │                       │                        │
       │                       │ POST /ads/{id}/event   │
       │                       │ {type: "click", ip: "..."}│
       │                       ├───────────────────────►│
       │                       │                        │
       │                       │ 1. record_ad_event()   │
       │                       │    AdEvent создан      │
       │                       │    Ad.clicks_count++   │
       │                       │                        │
       │                       │ 2. Если CPC:           │
       │                       │    price=50₽ за клик   │
       │                       ├───────────────────────►│
       │                       │                        │ record_billing_ledger()
       │                       │                        │ entry_type=AD_CLICK_INCOME
       │                       │                        │ direction=DEBIT
       │                       │                        │ amount=50
       │                       │                        │                        │
       │                       │                        │ _apply_revenue_split()
       │                       │                        │ 1. PLATFORM_INCOME: 10 (20%)
       │                       │                        │ 2. TENANT_INCOME: 40 (80%)
       │                       │◄───────────────────────┤
       │                       │                        │
       │◄──────────────────────┤                        │
       │                       │                        │
```

### Модели ценообразования

| Модель | Когда списывается | Пример |
|--------|------------------|--------|
| **FLAT** | При создании объявления | 10 000₽ за месяц размещения |
| **CPC** | При каждом клике | 50₽ за клик |
| **CPM** | При каждом показе (price/1000) | 100₽ за 1000 показов = 0.1₽/показ |

---

## 5. Модуль направлений и бонусов

### Сущности

#### `Referral` — Направление пациента
```python
{
  id: UUID,
  from_clinic_id: UUID,  # кто направил
  to_clinic_id: UUID,    # куда направили
  service_id: UUID,
  patient_phone: str,
  patient_name: str | null,
  status: "created" | "confirmed" | "expired" | "cancelled",
  created_by_admin_id: UUID,
  confirmed_by_admin_id: UUID | null,
  qr_code: str,  # base64 QR для админа
  patient_qr_code: str,  # QR для пациента
  short_code: int,  # 5-значный код
  expires_at: datetime,  # +7 дней
  appointment_at: datetime | null,
  mis_appointment_id: int | null
}
```

#### `Bonus` — Бонус сотруднику
```python
{
  id: UUID,
  tenant_id: UUID,
  admin_id: UUID,  # кому начислен
  referral_id: UUID,
  bonus_type: "regular" | "commission",
  amount: float,  # например 500₽
  status: "pending" | "paid",
  created_at: datetime,
  paid_at: datetime | null
}
```

#### `LedgerEntry` — Запись в финансовом реестре (клиентский)
```python
{
  id: UUID,
  user_id: UUID,  # сотрудник
  amount: Decimal,  # +500 или -500
  operation_type: "bonus_accrued" | "bonus_paid" | "bonus_cancelled" | "manual_credit" | "manual_debit",
  reference_id: UUID,  # referral.id
  reference_type: "referral",
  description: str,
  created_at: datetime
}
```

### Цепочка: Создание направления

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Admin      │     │  Referral Service │     │  MIS (Renovatio) │
│  (Dashboard) │     │                   │     │                 │
└──────┬───────┘     └─────────┬────────┘     └────────┬────────┘
       │                       │                        │
       │ POST /referrals/      │                        │
       │ {from_clinic: "...",  │                        │
       │  to_clinic: "...",    │                        │
       │  service: "...",      │                        │
       │  patient_phone: "+7...",│                      │
       │  appointment_at: "..."}│                       │
       ├──────────────────────►│                        │
       │                       │                        │
       │                       │ 1. create_referral()   │
       │                       │    Referral.status=CREATED│
       │                       │    short_code=12345    │
       │                       │    qr_code=base64...   │
       │                       │                        │
       │                       │ 2. (async) Найти пациента│
       │                       │    в МИС по телефону   │
       │                       ├───────────────────────►│
       │                       │    GET /patients?phone=│
       │                       │◄───────────────────────┤
       │                       │    {patient_id: 456}   │
       │                       │                        │
       │                       │ 3. (async) Создать запись│
       │                       │    в расписании МИС    │
       │                       ├───────────────────────►│
       │                       │    POST /appointments  │
       │                       │◄───────────────────────┤
       │                       │    {appointment_id: 789}│
       │                       │                        │
       │                       │ 4. Referral.mis_patient_id=456│
       │                       │    mis_appointment_id=789│
       │◄──────────────────────┤                        │
       │                       │                        │
       │ 200 OK {             │                        │
       │   id: "...",         │                        │
       │   short_code: 12345, │                        │
       │   qr_code: "...",    │                        │
       │   patient_qr_code: "..."│                     │
       │ }                    │                        │
       │                       │                        │
       │ Печать QR / отправка SMS пациенту│             │
       │                       │                        │
```

### Цепочка: Подтверждение направления (QR)

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Admin      │     │  Referral Service │     │  Ledger Service │
│  (Сканер QR) │     │                   │     │                 │
└──────┬───────┘     └─────────┬────────┘     └────────┬────────┘
       │                       │                        │
       │ POST /referrals/      │                        │
       │ confirm               │                        │
       │ {qr_data: "..."}      │                        │
       ├──────────────────────►│                        │
       │                       │                        │
       │                       │ 1. confirm_referral()  │
       │                       │    Проверка подписи QR │
       │                       │    Проверка статуса    │
       │                       │    Проверка срока (7 дн)│
       │                       │                        │
       │                       │ 2. Referral.status=CONFIRMED│
       │                       │    confirmed_at=now    │
       │                       │                        │
       │                       │ 3. Получить услугу     │
       │                       │    Service.bonus_amount│
       │                       │    = 500₽              │
       │                       │                        │
       │                       │ 4. Commission?         │
       │                       │    Если включена комиссия│
       │                       │    rate=10%, receiver=UUID│
       │                       │    → 2 бонуса:         │
       │                       │    - автору: 450₽      │
       │                       │    - получателю: 50₽   │
       │                       │    Иначе: 1 бонус 500₽ │
       │                       │                        │
       │                       │ 5. Bonus создан        │
       │                       ├───────────────────────►│
       │                       │                        │ add_entry()
       │                       │                        │ user_id=admin_id
       │                       │                        │ amount=+500
       │                       │                        │ operation_type=BONUS_ACCRUED
       │                       │                        │ reference_id=referral.id
       │                       │◄───────────────────────┤
       │                       │                        │
       │                       │ 6. Recruiter bonus?    │
       │                       │    Если у автора есть рекрутер│
       │                       │    bonus_percent=20%   │
       │                       │    → RecruiterBonus:   │
       │                       │    500 * 20% = 100₽    │
       │                       │                        │
       │                       │ 7. (async) Confirm в МИС│
       │                       ├───────────────────────►│
       │                       │    POST /appointments/confirm│
       │                       │◄───────────────────────┤
       │                       │                        │
       │◄──────────────────────┤                        │
       │                       │                        │
       │ 200 OK {             │                        │
       │   referral: {...},   │                        │
       │   bonuses: [...]     │                        │
       │ }                    │                        │
       │                       │                        │
```

### Цепочка: Выплата бонуса

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Admin/HR   │     │  Ledger Service   │     │  Payroll System │
│  (Dashboard) │     │                   │     │                 │
└──────┬───────┘     └─────────┬────────┘     └────────┬────────┘
       │                       │                        │
       │ POST /ledger/         │                        │
       │ payout                │                        │
       │ {user_id: "...",      │                        │
       │  amount: 5000}        │                        │
       ├──────────────────────►│                        │
       │                       │                        │
       │                       │ 1. Проверка баланса    │
       │                       │    get_balance(user_id)│
       │                       │    = SUM(amount)       │
       │                       │    = 15000₽            │
       │                       │                        │
       │                       │ 2. LedgerEntry:        │
       │                       │    operation_type=BONUS_PAID│
       │                       │    amount=-5000        │
       │                       │                        │
       │                       │ 3. Bonus.status=PAID   │
       │                       │    paid_at=now         │
       │                       │                        │
       │                       │ 4. Commit DB           │
       │◄──────────────────────┤                        │
       │                       │                        │
       │ 200 OK {             │                        │
       │   new_balance: 10000 │                        │
       │ }                    │                        │
       │                       │                        │
       │ Экспорт в 1С / ЗУП   │                        │
       │                       │                        │
```

### Типы операций LedgerEntry

| Operation Type | Direction | Описание |
|---------------|-----------|----------|
| `bonus_accrued` | + | Начисление бонуса за направление |
| `bonus_paid` | - | Выплата бонуса (перевод в payroll) |
| `bonus_cancelled` | - | Отмена бонуса (возврат) |
| `manual_credit` | + | Ручное пополнение (админ) |
| `manual_debit` | - | Ручное списание (админ) |

---

## 6. Финансовый реестр (Billing Ledger)

### Назначение

**BillingLedger** — это append-only журнал ВСЕХ финансовых операций платформы:
- Подписки тенантов
- Платные плагины
- Реклама
- Revenue split (разделение дохода)
- Платежи и возвраты

### Ключевые правила

1. **Никогда не изменять/удалять записи**
2. **Все суммы положительные**, направление определяет `direction`
3. **Revenue split**: 1 gross запись → 2-3 child записи

### Структура записи

```python
{
  id: UUID,
  tenant_id: UUID | null,  # null = операция платформы
  clinic_id: UUID | null,
  entry_type: str,  # см. типы ниже
  direction: "credit" | "debit",  # кредит / дебет
  amount: Decimal,  # всегда > 0
  currency: "RUB",
  reference_id: UUID | null,  # ссылка на исходный объект
  reference_type: "invoice" | "plugin_subscription" | "ad" | ...,
  description: str,
  meta: JSONB,  # дополнительные данные
  
  # Revenue split поля
  is_split: bool,  # является ли частью разбивки
  split_parent_id: UUID | null,  # ссылка на gross запись
  split_actor: "platform" | "tenant" | "franchise",
  
  created_at: datetime
}
```

### Типы записей (EntryType)

#### Подписки
- `subscription_charge` — списание за подписку (DEBIT)
- `subscription_credit` — возврат / кредит (CREDIT)
- `subscription_trial` — начало trial (amount=0, аудит)

#### Плагины
- `plugin_charge` — первичное включение (DEBIT)
- `plugin_renewal` — автопродление (DEBIT)
- `plugin_refund` — возврат (CREDIT)

#### Реклама
- `ad_charge` — размещение (flat) (DEBIT)
- `ad_click_income` — доход CPC (DEBIT)
- `ad_impression_income` — доход CPM (DEBIT)

#### Revenue Split (дочерние)
- `platform_income` — доля платформы (CREDIT)
- `tenant_income` — доля тенанта (CREDIT)
- `franchise_fee` — франшизный сбор (DEBIT)

#### Платежи
- `payment_received` — получение платежа (CREDIT)
- `refund` — возврат тенанту (DEBIT)

### Пример Revenue Split

**Сценарий:** Тенант оплатил плагин 5000₽, split 30%/70%, франшиза 5%

```sql
-- Gross запись (списание с тенанта)
INSERT INTO billing_ledger VALUES (
  id='gross-uuid',
  tenant_id='tenant-uuid',
  entry_type='plugin_renewal',
  direction='debit',
  amount=5000.00,
  is_split=false
);

-- Platform income (30%)
INSERT INTO billing_ledger VALUES (
  id='platform-uuid',
  tenant_id=NULL,  -- доход платформы
  entry_type='platform_income',
  direction='credit',
  amount=1500.00,
  is_split=true,
  split_parent_id='gross-uuid',
  split_actor='platform'
);

-- Tenant income (70%)
INSERT INTO billing_ledger VALUES (
  id='tenant-uuid',
  tenant_id='tenant-uuid',
  entry_type='tenant_income',
  direction='credit',
  amount=3500.00,
  is_split=true,
  split_parent_id='gross-uuid',
  split_actor='tenant'
);

-- Franchise fee (5% от tenant_income)
INSERT INTO billing_ledger VALUES (
  id='franchise-uuid',
  tenant_id='tenant-uuid',
  entry_type='franchise_fee',
  direction='debit',
  amount=175.00,  -- 3500 * 5%
  is_split=true,
  split_parent_id='gross-uuid',
  split_actor='franchise'
);
```

**Запросы для аналитики:**

```sql
-- Доход платформы за месяц
SELECT SUM(amount) 
FROM billing_ledger 
WHERE entry_type='platform_income' 
  AND direction='credit'
  AND created_at >= '2026-01-01' 
  AND created_at < '2026-02-01';

-- Выручка тенанта
SELECT SUM(amount) 
FROM billing_ledger 
WHERE tenant_id='...' 
  AND entry_type IN ('tenant_income', 'franchise_fee')
  AND direction='credit';

-- Полный аудит по транзакции
SELECT * FROM billing_ledger 
WHERE split_parent_id='gross-uuid' 
ORDER BY split_actor;
```

---

## 7. Полные цепочки событий

### Сценарий 1: Онбординг нового тенанта

```
1. Регистрация тенанта
   └─> Tenant создан (slug="clinic-happy-smile")
   └─> TenantPricingRules создан (split=30%/20%, franchise=0%)
   
2. Создание подписки (Trial 14 дней)
   └─> POST /billing/subscription {plan: "professional", cycle: "monthly"}
   └─> Subscription создан (status=TRIAL, trial_ends=+14d)
   └─> BillingLedger: SUBSCRIPTION_TRIAL (amount=0)
   
3. Trial активен
   └─> Все функции Professional доступны
   └─> Лимиты: 5 клиник, 200 пользователей
   
4. День 14: Trial заканчивается
   └─> Scheduler: generate_invoice()
   └─> Invoice создан (amount=24900, status=SENT, due_date=+14d)
   └─> BillingLedger: SUBSCRIPTION_CHARGE (DEBIT 24900)
   └─> Subscription.status=ACTIVE
   └─> Email тенанту: "Счёт INV-2026-00001"
   
5. Оплата счёта
   └─> POST /invoices/{id}/pay {amount: 24900, gateway: "yookassa"}
   └─> Payment создан (status=COMPLETED)
   └─> Invoice.status=PAID
   └─> BillingLedger: PAYMENT_RECEIVED (CREDIT 24900)
   
6. День 44: Следующий цикл
   └─> Scheduler: generate_invoice()
   └─> ... (повтор шага 4)
```

### Сценарий 2: Монетизация плагина

```
1. Тенант включает AI Ассистента
   └─> POST /plugins/ai_assistant/enable {trial_days: 7}
   └─> TenantPluginSubscription создан (status=TRIAL, price=5000)
   └─> BillingLedger: SUBSCRIPTION_TRIAL (amount=0)
   
2. День 7: Trial закончился
   └─> Scheduler: charge_plugin_subscription()
   └─> BillingLedger: PLUGIN_RENEWAL (DEBIT 5000)
   └─> _apply_revenue_split():
       - PLATFORM_INCOME: 1500 (30%)
       - TENANT_INCOME: 3500 (70%)
   └─> PluginSub.status=ACTIVE, expires=+30d
   
3. День 37: Автопродление
   └─> Scheduler: charge_plugin_subscription()
   └─> ... (повтор шага 2)
   
4. Тенант отменяет плагин
   └─> POST /plugins/ai_assistant/cancel
   └─> PluginSub.status=CANCELLED
   └─> auto_renew=false
```

### Сценарий 3: Рекламная кампания (CPC)

```
1. Тенант создаёт рекламу
   └─> POST /ads {title: "Акция", pricing_model: "cpc", price: 50}
   └─> Ad создан (status=DRAFT)
   
2. Активация
   └─> PATCH /ads/{id} {status: "active"}
   └─> Ad.status=ACTIVE
   
3. Пользователь видит баннер
   └─> POST /ads/{id}/event {type: "impression", ip: "1.2.3.4"}
   └─> AdEvent создан
   └─> Ad.impressions_count++
   └─> (CPM только если pricing_model=cpm)
   
4. Пользователь кликает
   └─> POST /ads/{id}/event {type: "click", ip: "1.2.3.4"}
   └─> AdEvent создан
   └─> Ad.clicks_count++
   └─> BillingLedger: AD_CLICK_INCOME (DEBIT 50)
   └─> _apply_revenue_split():
       - PLATFORM_INCOME: 10 (20%)
       - TENANT_INCOME: 40 (80%)
   
5. Конец кампании
   └─> Scheduler проверяет end_date
   └─> Ad.status=COMPLETED
```

### Сценарий 4: Направление → Бонус → Выплата

```
1. Админ создаёт направление
   └─> POST /referrals {from: A, to: B, service: "MRI", patient: "+7..."}
   └─> Referral создан (status=CREATED, short_code=12345)
   └─> (async) Пациент найден в МИС
   └─> (async) Запись создана в МИС
   └─> QR сгенерирован, SMS отправлено
   
2. Пациент приходит в клинику B
   └─> Админ B сканирует QR
   └─> POST /referrals/confirm {qr_data: "..."}
   └─> Referral.status=CONFIRMED
   └─> Service.bonus_amount=1000₽
   └─> Bonus создан (admin_id=автор, amount=1000)
   └─> LedgerEntry: BONUS_ACCRUED (+1000)
   
3. Комиссия включена (10%)
   └─> system_settings.commission_enabled=true
   └─> system_settings.commission_rate=10
   └─> system_settings.commission_receiver_id=UUID
   └─> 2 бонуса:
       - автору: 900₽
       - получателю: 100₽
   └─> 2 LedgerEntry: BONUS_ACCRUED (+900, +100)
   
4. Рекрутерская доля (20%)
   └─> Автор имеет recruiter_id с bonus_percent=20%
   └─> RecruiterBonus создан: 900 * 20% = 180₽
   
5. Выплата в конце месяца
   └─> HR: POST /ledger/payout {user_id: "...", amount: 5000}
   └─> LedgerEntry: BONUS_PAID (-5000)
   └─> Bonus.status=PAID
   └─> Экспорт в 1С
```

---

## 8. Схема базы данных

### ER-диаграмма (основные сущности)

```
┌─────────────────┐       ┌─────────────────┐
│    Tenant       │       │    Clinic       │
│─────────────────│       │─────────────────│
│ id (PK)         │       │ id (PK)         │
│ slug            │       │ tenant_id (FK)  │
│ name            │       │ name            │
└────────┬────────┘       └─────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────┐       ┌─────────────────┐
│  Subscription   │       │    User         │
│─────────────────│       │─────────────────│
│ id (PK)         │       │ id (PK)         │
│ tenant_id (FK)  │◄──────│ tenant_id (FK)  │
│ plan            │       │ role            │
│ status          │       └─────────────────┘
│ amount_per_period│
└────────┬────────┘
         │ 1:N
         ▼
┌─────────────────┐       ┌─────────────────┐
│    Invoice      │       │    Payment      │
│─────────────────│       │─────────────────│
│ id (PK)         │       │ id (PK)         │
│ subscription_id │       │ invoice_id (FK) │
│ tenant_id (FK)  │       │ amount          │
│ invoice_number  │       │ status          │
│ status          │       │ gateway         │
│ amount          │       └─────────────────┘
└─────────────────┘

┌─────────────────┐       ┌─────────────────┐
│    Ad           │       │   AdEvent       │
│─────────────────│       │─────────────────│
│ id (PK)         │       │ id (PK)         │
│ tenant_id (FK)  │───────│ ad_id (FK)      │
│ title           │       │ event_type      │
│ pricing_model   │       │ ip_hash         │
│ price           │       └─────────────────┘
└─────────────────┘

┌─────────────────┐       ┌─────────────────┐
│    Referral     │       │    Bonus        │
│─────────────────│       │─────────────────│
│ id (PK)         │       │ id (PK)         │
│ from_clinic_id  │       │ referral_id (FK)│
│ to_clinic_id    │       │ admin_id (FK)   │
│ service_id (FK) │       │ amount          │
│ patient_phone   │       │ status          │
│ status          │       └─────────────────┘
│ short_code      │
└─────────────────┘

┌─────────────────────────────────────────┐
│         BillingLedger                   │
│─────────────────────────────────────────│
│ id (PK)                                 │
│ tenant_id (FK)                          │
│ entry_type                              │
│ direction (credit/debit)                │
│ amount                                  │
│ reference_id                            │
│ is_split                                │
│ split_parent_id (self-FK)               │
│ split_actor                             │
└─────────────────────────────────────────┘
```

### Индексы для производительности

```sql
-- BillingLedger: быстрые отчёты по тенанту
CREATE INDEX ix_billing_ledger_tenant_type 
ON billing_ledger(tenant_id, entry_type);

-- BillingLedger: временные ряды
CREATE INDEX ix_billing_ledger_created_tenant 
ON billing_ledger(created_at, tenant_id);

-- Ads: выборка активных
CREATE INDEX ix_ads_tenant_status 
ON ads(tenant_id, status);

-- Ads: планировщик
CREATE INDEX ix_ads_dates 
ON ads(start_date, end_date);

-- Referrals: поиск по коду
CREATE UNIQUE INDEX ix_referrals_short_code 
ON referrals(short_code);

-- Subscriptions: активные подписки
CREATE INDEX ix_subscriptions_status 
ON subscriptions(status, next_invoice_date);
```

---

## Приложение: API Endpoints

### Подписки

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/billing/plans` | Список тарифов |
| GET | `/billing/summary` | Сводка биллинга |
| GET | `/billing/subscription` | Текущая подписка |
| POST | `/billing/subscription` | Создать подписку |
| POST | `/billing/subscription/{id}/change-plan` | Сменить тариф |
| POST | `/billing/subscription/{id}/cancel` | Отменить |
| GET | `/billing/invoices` | Список счетов |
| GET | `/billing/invoices/{id}` | Детали счёта |
| POST | `/billing/invoices/{id}/pay` | Оплатить счёт |
| POST | `/billing/invoices/generate` | Выставить счёт |

### Плагины

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/plugins` | Каталог плагинов |
| POST | `/plugins/{key}/enable` | Включить плагин |
| POST | `/plugins/{key}/cancel` | Отменить плагин |
| GET | `/plugins/subscriptions` | Мои подписки |

### Реклама

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/ads` | Список объявлений |
| POST | `/ads` | Создать объявление |
| PATCH | `/ads/{id}` | Обновить |
| POST | `/ads/{id}/event` | Событие (impression/click) |
| GET | `/ads/{id}/stats` | Статистика |

### Направления

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/referrals` | Список направлений |
| POST | `/referrals` | Создать направление |
| POST | `/referrals/confirm` | Подтвердить по QR |
| POST | `/referrals/confirm-by-code` | Подтвердить по коду |
| GET | `/referrals/{id}` | Детали |

### Ledger

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/ledger/balance` | Баланс сотрудника |
| GET | `/ledger/history` | История операций |
| POST | `/ledger/payout` | Выплата бонуса |

---

## Глоссарий

| Термин | Определение |
|--------|-------------|
| **Tenant** | Клиент SaaS (сеть клиник) |
| **Subscription** | Подписка тенанта на тарифный план |
| **Invoice** | Счёт на оплату подписки |
| **Revenue Split** | Разделение дохода между платформой и тенантом |
| **Plugin** | Платное расширение функционала |
| **Ad** | Рекламное объявление тенанта |
| **Referral** | Направление пациента между клиниками |
| **Bonus** | Вознаграждение сотруднику за направление |
| **Ledger** | Финансовый реестр (append-only) |
| **Franchise Fee** | Процент от дохода тенанта → головной офис |

---

*Документ актуален для версии платформы КлиникСеть 2026.Q1*
