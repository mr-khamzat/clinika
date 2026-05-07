# Платёжный каркас: online_payments_pro + fiscal_54fz_pro

Документ описывает архитектурный каркас двух коммерческих модулей и порядок
подключения нового шлюза/ОФД.

## 1. Обзор архитектуры

```
backend/app/
├── models/
│   └── payments_clinic.py         ← ClinicPayment, PaymentGatewayConfig,
│                                    FiscalReceipt, OFDConfig + константы
├── services/
│   ├── acquiring/                 ← пакет адаптеров шлюзов
│   │   ├── __init__.py            ← регистрирует все адаптеры
│   │   ├── base.py                ← BasePaymentGateway (ABC)
│   │   ├── registry.py            ← register_gateway / get_gateway
│   │   ├── yookassa_adapter.py    ← заглушки на 501
│   │   ├── tinkoff_adapter.py
│   │   ├── sber_adapter.py
│   │   ├── cloudpayments_adapter.py
│   │   └── robokassa_adapter.py
│   ├── fiscal/                    ← пакет адаптеров ОФД
│   │   ├── __init__.py
│   │   ├── base.py                ← BaseOfdProvider (ABC)
│   │   ├── registry.py
│   │   ├── platforma_ofd_adapter.py
│   │   ├── perv_ofd_adapter.py
│   │   ├── takskom_adapter.py
│   │   └── atol_online_adapter.py
│   ├── acquiring_service.py       ← фасад: init/update/refund платежей
│   ├── fiscal_service.py          ← фасад: pull чеков
│   └── seed_payment_modules.py    ← сид commercial_modules
└── routers/
    ├── clinic_payments.py         ← /payments/*, /clinics/{id}/payment-config
    └── fiscal_receipts.py         ← /clinics/{id}/receipts, /ofd-config

frontend/src/sections/payments/
├── PaymentSettingsSection.jsx     ← настройка шлюза (manager)
├── FiscalSettingsSection.jsx      ← настройка ОФД (manager)
├── PaymentsListSection.jsx        ← список платежей пациентов
└── ReceiptsListSection.jsx        ← список фискальных чеков
```

## 2. Модель данных

| Таблица | Назначение |
|---|---|
| `clinic_payments` | Платежи пациентов клиник через интернет-эквайринг (НЕ путать с `payments` — там подписки платформы) |
| `payment_gateway_configs` | Конфиг шлюза (Юкасса/Т-Банк/...) на конкретную клинику. Уникальность: `(clinic_id, gateway)` |
| `fiscal_receipts` | Чеки 54-ФЗ из ОФД. Связь с `clinic_payments` опциональная (matching по сумме/времени) |
| `ofd_configs` | Один ОФД-провайдер на клинику. Уникальность: `clinic_id` |

Шифрование `secret_key` / `api_key` пока plain text — стоит TODO под Fernet
(`cryptography.fernet`). Ключ должен лежать в `settings.payment_secret_fernet_key`,
ротация через миграцию + перешифрование.

## 3. Как подключить новый платёжный шлюз

Сценарий: «завтра подключаем реальную ЮKassa».

1. Установить SDK:
   ```bash
   pip install yookassa
   # обновить backend/requirements.txt
   ```
2. Открыть `backend/app/services/acquiring/yookassa_adapter.py` и заменить
   `raise NotImplementedError(...)` на реальный код:
   ```python
   from yookassa import Configuration, Payment as YkPayment

   class YookassaGateway(BasePaymentGateway):
       name = "yookassa"

       def _client(self):
           Configuration.account_id = self.config.shop_id
           Configuration.secret_key = self.config.secret_key   # TODO: расшифровать через Fernet
           return YkPayment

       async def init_payment(self, amount, description, return_url, metadata=None):
           Pmt = self._client()
           obj = Pmt.create({
               "amount": {"value": str(amount), "currency": "RUB"},
               "confirmation": {"type": "redirect", "return_url": return_url},
               "capture": True,
               "description": description,
               "metadata": metadata or {},
           }, idempotency_key=str(metadata.get("internal_payment_id")))
           return PaymentInitResult(
               payment_url=obj.confirmation.confirmation_url,
               payment_id=obj.id,
               raw=obj.json(),
           )
       # ... аналогично get_status / refund / verify_webhook
   ```
3. Никаких других правок не требуется — модели, endpoints, UI, миграции
   остаются нетронутыми. Пользователь увидит что 501-ответ исчез и
   получит payment_url для редиректа.

Аналогично для `tinkoff_adapter.py`, `sber_adapter.py`, `cloudpayments_adapter.py`,
`robokassa_adapter.py`.

## 4. Как подключить новый ОФД

Та же логика: открываем `services/fiscal/<name>_adapter.py`, заменяем заглушки
реальными HTTP-запросами через `httpx.AsyncClient`. DTO — `FiscalReceiptData`.

## 5. Регистрация нового адаптера (другой провайдер)

Если потребуется добавить новый шлюз/ОФД, не входящий в текущий список:

```python
# backend/app/services/acquiring/<new>_adapter.py
class NewGateway(BasePaymentGateway):
    name = "new"
    # реализация...

# backend/app/services/acquiring/__init__.py
from app.services.acquiring.new_adapter import NewGateway
register_gateway("new", NewGateway)
```

Никаких миграций не нужно — `gateway` это просто `String(40)` в БД.

## 6. ENV-переменные

Сейчас не требуется. После реализации Fernet добавить в `.env`:

```
PAYMENT_SECRET_FERNET_KEY=<base64 32-byte key from Fernet.generate_key()>
```

Конкретные API-ключи шлюзов хранятся в БД (`payment_gateway_configs.secret_key`)
и настраиваются через UI каждой клиникой.

## 7. Сид модулей в каталоге

```bash
docker exec clinika-backend python -m app.services.seed_payment_modules
```

Идемпотентно. Создаст в `commercial_modules`:
- `online_payments_pro` — 2990 ₽/мес (категория `finance`)
- `fiscal_54fz_pro` — 2990 ₽/мес (категория `finance`)

После этого модули появятся в каталоге `ModulesCatalogSection.jsx`. Клиника
может активировать пробный период — UI/endpoints уже работают, реальные
платежи начнут проходить только после реализации адаптера (см. §3).

## 8. Endpoints (краткий справочник)

### online_payments_pro
- `POST   /payments/init`                     — старт платежа (auth)
- `GET    /payments/{id}`                     — статус (manager+)
- `POST   /payments/{id}/refund`              — возврат (manager+)
- `POST   /webhooks/payment/{gateway}`        — webhook без auth
- `GET    /clinics/{id}/payments`             — список (manager+)
- `GET    /clinics/{id}/payment-config`       — текущий конфиг (manager+)
- `PUT    /clinics/{id}/payment-config`       — обновить (manager+)

### fiscal_54fz_pro
- `GET    /clinics/{id}/receipts`             — список чеков (manager+)
- `GET    /receipts/{id}/qr`                  — QR ФНС
- `POST   /clinics/{id}/ofd/pull`             — принудительный pull (manager+)
- `GET    /clinics/{id}/ofd-config`           — текущий конфиг (manager+)
- `PUT    /clinics/{id}/ofd-config`           — обновить (manager+)

Все защищены `require_module(...)` кроме чтения конфигов (чтобы UI мог показать
«Подключите модуль» вместо 402).

## 9. Webhook URL для шлюзов

При реальной интеграции прописать в личных кабинетах провайдеров:

```
POST https://<your-domain>/webhooks/payment/yookassa
POST https://<your-domain>/webhooks/payment/tinkoff
POST https://<your-domain>/webhooks/payment/sber
POST https://<your-domain>/webhooks/payment/cloudpayments
POST https://<your-domain>/webhooks/payment/robokassa
```

Адаптер сам валидирует подпись через `verify_webhook(headers, body)`.
