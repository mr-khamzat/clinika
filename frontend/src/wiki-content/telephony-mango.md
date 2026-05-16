---
title: PSTN-провайдер · Mango Office
slug: telephony-mango
group: feature
updated: 2026-05-17
reading_time: 5
---

# PSTN-провайдер · Mango Office

Интеграция с Mango Office (VPBX) — крупнейшим российским провайдером облачных АТС для B2B. Подойдёт сетям с несколькими офисами и развитой маршрутизацией.

## Зачем именно Mango

- Многоуровневое IVR, очереди, голосовая почта прямо из админки Mango.
- VPBX commands API позволяет инициировать звонок, перевести, повесить трубку программно.
- Подробная аналитика и интеграция с amoCRM/Bitrix24 (можно держать параллельно).
- Поддержка SIP-устройств и софтфонов из коробки.

## Как получить креды

1. Зарегистрировать аккаунт https://www.mango-office.ru.
2. Заказать тариф ВАТС.
3. В разделе «Интеграции» → «API» → создать приложение:
   - `api_key` (32 символа) — публичный ключ;
   - `api_salt` (32 символа) — секрет для HMAC-SHA256.

## Как настроить в КлиникСеть

1. Открыть `/manager/telephony` → «Подключить провайдера» → Mango.
2. Ввести `api_key` и `api_salt`.
3. Сохранить — webhook URL:

   ```
   https://клиниксеть.рф/api/telephony/webhook/mango
   ```

4. В Mango: «Настройки» → «Уведомления» → указать URL и подписаться на события:
   - `call_events` — статусы звонков;
   - `recording` — готовность записи.
5. Привязать DID-номера к клиникам.

## VPBX commands

Backend делает исходящий звонок через:

```python
POST https://app.mango-office.ru/vpbx/commands/callback
Headers:
  X-MANGO-API-Key: <api_key>
  X-MANGO-API-Sign: <hmac_sha256(salt, body)>
Body:
  {
    "command_id": "<uuid>",
    "from": {"extension": "101"},
    "to_number": "+79991234567"
  }
```

## Webhook events

Mango шлёт `application/x-www-form-urlencoded` с полем `json`, внутри:

```json
{
  "entry_id": "...",
  "call_state": "Appeared|Connected|Disconnected",
  "from": {"number": "+7..."},
  "to": {"number": "+7...", "extension": "101"},
  "timestamp": 1716800000
}
```

Адаптер `mango_adapter.py` маппит `call_state` → `PhoneCall.status`.

## Проверка подписи

```python
import hmac, hashlib
sign = hmac.new(api_salt.encode(), api_key.encode() + body.encode(), hashlib.sha256).hexdigest()
```

## FAQ

**Можно ли использовать SIP-телефон вместо софтфона CRM?** Да, Mango выдаёт SIP-креды на каждое внутреннее DEXT, регистратор может одновременно использовать SIP-трубку и поп-ап в CRM.

**Кто платит за минуты?** Mango. КлиникСеть только отображает CDR.

**Лимит на webhook RPS?** Mango не лимитирует, но backend имеет rate-limit 50/sec на endpoint.
