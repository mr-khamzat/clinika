# Настройка платежей и фискализации

## Эквайринг ЮKassa

### Регистрация
1. Создать аккаунт https://yookassa.ru
2. Зарегистрировать магазин → получить `shopId` и `Secret key`
3. В личном кабинете ЮKassa указать **webhook URL**: `https://домен/webhooks/payment/yookassa`
4. Подписаться на события: `payment.succeeded`, `payment.canceled`, `refund.succeeded`

### Настройка в КлиникСеть
Добавить в `/opt/clinika/.env`:
```bash
YOOKASSA_SHOP_ID=<shopId>
YOOKASSA_SECRET_KEY=Live_<secret>
YOOKASSA_RETURN_URL=https://клиниксеть.рф/billing/return
```

Перезапустить backend:
```bash
docker compose restart clinika-backend
```

### Что заработает
- `POST /payments/init` создаст реальный платёж и вернёт redirect URL
- Webhook автоматически закроет invoice → активирует подписку
- Чек авто-пробьётся через ОФД (если настроен)

### IP-allowlist
Webhook проверяет IP отправителя (ЮKassa whitelist):
- 185.71.76.0/27, 185.71.77.0/27
- 77.75.153.0/25, 77.75.156.11, 77.75.156.35
- 77.75.154.128/25, 2a02:5180::/32

## Фискализация Платформа ОФД (54-ФЗ)

### Регистрация
1. Создать аккаунт https://lk.platformaofd.ru
2. Зарегистрировать кассу с ФН
3. Получить `login` и `password` для API

### Настройка
```bash
PLATFORMA_OFD_LOGIN=<login>
PLATFORMA_OFD_PASSWORD=<password>
PLATFORMA_OFD_API_BASE=https://lkapi.platformaofd.ru
COMPANY_INN=<ИНН>
COMPANY_TAX_SYSTEM=usn_income  # general | usn_income | usn_income_outcome | envd | esn | patent
```

### Что заработает
- При успешной оплате (любая) → `fiscal_service.send_receipt()` → POST `/lkapi/v3/receipts`
- В `FiscalReceipt` записываются `ofd_id`, `fiscal_doc_number`, `fiscal_sign`, `qr_code`
- Cron `cron_pull_all_receipts` подтягивает статусы (sent → registered)
- Пациент видит QR-чека в ЛК

### Способы оплаты в чеке
- `cash` — наличные
- `card` — банковская карта (терминал)
- `online` — онлайн-оплата (ЮKassa)
- `bank_transfer` — банковский перевод

## Тестирование без ключей

Без настроенных ENV-переменных:
- `POST /payments/init` → 503 «эквайринг не настроен» (не 500)
- `send_receipt` → 503 «Платформа ОФД не настроена»

12 pytest-тестов проверяют адаптеры с MockTransport (без реальной сети).

## Биллинг подписок

При первой регистрации tenant'а:
- Создаётся `Subscription` со `status=trial`, `trial_ends_at = now() + 14`
- Job `daily_invoices_job` (00:00 МСК) создаёт `Invoice` за следующий месяц
- При оплате через ЮKassa webhook → `record_payment` → `status=active`, `current_period_end = now + 30 дней`

Если оплата не пришла:
- `mark_invoice_overdue` job переводит `status=past_due`
- При `grace_until < now()` → `expired`
- `require_active_subscription` Depends отказывает в write-операциях

## Отчёты в ФНС

Для отчётности в `FiscalReceipt` хранится:
- `receipt_number`, `fn_serial`, `fd_number`, `fp`
- `total`, `vat_amount`, `payment_method`
- `customer_email` (для отправки чека пациенту)
- `qr_code` (для проверки в личном кабинете ФНС)

Экспорт за период:
```sql
SELECT * FROM fiscal_receipts
WHERE created_at >= '2026-05-01' AND created_at < '2026-06-01'
ORDER BY created_at;
```

## Production readiness checklist

Перед запуском платных операций тенанта:

**Юр-лицо и счета:**
- [ ] ИП или ООО зарегистрировано (ФНС / госуслуги).
- [ ] Расчётный счёт открыт в банке.
- [ ] Договор с ЮKassa подписан, магазин подтверждён (см. [Настройка ЮKassa](/wiki/setup-yookassa#production-readiness-checklist)).
- [ ] Договор с ОФД подписан, ФН установлен и зарегистрирован в ФНС.

**Технически:**
- [ ] `YOOKASSA_SHOP_ID` и `YOOKASSA_SECRET_KEY` сохранены в БД (Fernet-шифрование).
- [ ] Webhook ЮKassa указывает на боевой `https://домен/webhooks/payment/yookassa` (валидный HTTPS, без VPN).
- [ ] IP-allowlist ЮKassa подтверждён в nginx (включая 2a02:5180::/32).
- [ ] `PLATFORMA_OFD_LOGIN`/`PASSWORD` + `COMPANY_INN` + `COMPANY_TAX_SYSTEM` заполнены.
- [ ] `cron_pull_all_receipts` запущен, подтягивает статусы чеков (sent → registered).
- [ ] Тестовая оплата 1 ₽ прошла: payment.succeeded webhook → BillingLedger → FiscalReceipt с `qr_code`.
- [ ] Возврат протестирован (`POST /billing/refunds` → refund.succeeded → ledger -).
- [ ] Email чека пациенту работает (зависит от SMTP — см. [Настройка SMTP](/wiki/setup-smtp#production-readiness-checklist)).

**Бэкап и DR:**
- [ ] `rclone` настроен на удалённый S3, ежедневный pg_dump шифруется GPG.
- [ ] Test-restore прошёл хотя бы один раз вручную.
- [ ] Telegram-алерты super_admin на `payment.failed`, `ofd.fail`, `subscription.past_due`.
