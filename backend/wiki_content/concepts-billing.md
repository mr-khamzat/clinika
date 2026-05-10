# Биллинг и финансы

## Каскадный расчёт бонусов

При подтверждении направления (`_apply_confirmation` в `referral_service.py`):

```
1. На услуге/враче: bonus_total = 300₽ (полная сумма)
2. Платформа удерживает:  platform_fee_floor = 100₽
3. Промежуточная сумма:    intermediate = 200₽
4. Если автор = партнёр-врач с рекрутером (10%):
   recruiter_cut = 200 × 10% = 20₽
   автор получает: 200 − 20 = 180₽
5. Если автор = штатный:   автор получает 200₽
```

### Защита от двойного начисления
- **`pg_advisory_xact_lock(hashtext(referral_id))`** — PG-level mutex
- **`SELECT FOR UPDATE`** на referral в начале транзакции
- **UNIQUE constraint** на `(bonus.referral_id, admin_id, bonus_type)`
- **Idempotent re-check**: если status уже CONFIRMED — выход без повторного начисления

## InterClinicInvoice (межклиничные счета)

Когда направление **между клиниками** одной франшизы (from_clinic ≠ to_clinic) подтверждается, **автоматически** создаётся `InterClinicInvoice`:
- Issuer: from_clinic (получатель оплаты)
- Recipient: to_clinic (плательщик)
- Amount: payout_amount
- Status: `sent`

При нажатии «Оплачено» — `mark_paid` создаёт reverse-entry в Ledger.

**UNIQUE(referral_id)** на ICI защищает от дубликатов.

## FranchiseInvoice (счета платформы → tenant)

Job `daily_invoices_job` в 00:00 МСК:
- Собирает все `BillingLedger.platform_fee_per_bonus` за период
- Группирует по tenant
- Создаёт `FranchiseInvoice` со статусом `pending`
- Отправляет уведомление в Telegram

После оплаты через `record_payment` — `status=paid`.

## BillingLedger

Universal двухсторонний реестр всех движений:
- `entry_type`: `platform_fee_per_bonus`, `ad_charge`, `ad_click_income`, `payment_received`, ...
- `direction`: `debit` / `credit`
- `tenant_id`, `clinic_id`, `reference_type`, `reference_id`
- `meta` — JSONB с деталями

## Отмена направления (approve_cancel)

При отмене (`/manager/cancel-requests/{id}/approve`):
1. Bonus → status=CANCELLED (через `bonus_service.mark_bonus_cancelled`)
2. В Ledger создаётся **reverse-entry** `BONUS_CANCELLED` с -amount
3. RecruiterBonus → CANCELLED
4. InterClinicInvoice → status=cancelled
5. BillingLedger.platform_fee → reverse-запись (refund франшизе)

## Подписки

`Subscription` хранит подписку tenant'а на платформу:
- `status`: trial / active / past_due / expired / cancelled
- `current_period_start/end`
- `trial_ends_at`
- `next_invoice_date`

Job `daily_invoices_job` создаёт инвойсы за следующий период.

## Эквайринг ЮKassa

Готовый адаптер в `app/services/acquiring/yookassa_adapter.py`:
- `init_payment()` — POST `/v3/payments` с Idempotence-Key
- `get_status()` — GET `/v3/payments/{id}`
- `refund()` — POST `/v3/refunds`
- `verify_webhook()` — проверка IP-allowlist ЮKassa

Webhook handler `/webhooks/payment/yookassa`:
- Проверка IP-whitelist
- При `payment.succeeded` → `record_payment()` → закрытие инвойса → активация подписки → пробитие чека через ОФД

Нужны переменные: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `YOOKASSA_RETURN_URL`.

## Фискализация 54-ФЗ (Платформа ОФД)

Адаптер `app/services/fiscal/platforma_ofd_adapter.py`:
- `send_receipt()` — POST `/lkapi/v3/receipts`
- `get_receipt_status()`
- `pull_receipts()` — synchronization

Нужны: `PLATFORMA_OFD_LOGIN`, `PASSWORD`, `COMPANY_INN`, `COMPANY_TAX_SYSTEM`.

Cron `cron_pull_all_receipts` подтягивает ФД/ФН/ФП/QR обратно.

## API публичный

Endpoint `/api/v1/finance/summary` (требует `read:finance` scope в API-key):
- Revenue за период
- Платформенная комиссия
- Bonuses (начислено / выплачено)
- Outstanding invoices
