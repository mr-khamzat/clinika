---
title: PSTN-провайдер · Zadarma
slug: telephony-zadarma
group: feature
updated: 2026-05-17
reading_time: 5
---

# PSTN-провайдер · Zadarma

Подключение Zadarma — недорогой международной VoIP-АТС с поддержкой российских и зарубежных DID. Подойдёт сетям с пациентами из СНГ или Европы.

## Зачем именно Zadarma

- Самые дешёвые исходящие на мобильные РФ среди трёх провайдеров.
- DID-номера в 100+ странах: можно дать клинике в Ингушетии «московский +495».
- Бесплатная виртуальная АТС, бесплатный SIP-аккаунт.
- Webhook + Open API без лицензионной платы.

## Как получить креды

1. Зарегистрировать аккаунт https://zadarma.com.
2. Личный кабинет → «Профиль» → «API» → создать пару ключей:
   - `user_key` — публичный (~20 символов);
   - `secret` — для подписи (HMAC-SHA1 + base64).

## Как настроить в КлиникСеть

1. `/manager/telephony` → «Подключить провайдера» → Zadarma.
2. Ввести `user_key` и `secret`.
3. Сохранить — webhook URL:

   ```
   https://клиниксеть.рф/api/telephony/webhook/zadarma
   ```

4. В Zadarma: «Настройки» → «PBX» → «Уведомления» → указать URL и включить:
   - `NOTIFY_START` — начало звонка;
   - `NOTIFY_END` — завершение;
   - `NOTIFY_RECORD` — готовность записи.
5. Привязать DID к клиникам.

## Подпись API-запросов

Zadarma использует HMAC-SHA1 в base64 от строки `path + query + md5(body)`:

```python
import hmac, hashlib, base64
md5body = hashlib.md5(body.encode()).hexdigest()
signed_str = f"{path}{sorted_query}{md5body}"
sig = base64.b64encode(
    hmac.new(secret.encode(), signed_str.encode(), hashlib.sha1).digest()
).decode()
headers = {"Authorization": f"{user_key}:{sig}"}
```

## Webhook verification

Каждый входящий webhook содержит параметр `signature`. Backend пересчитывает HMAC-SHA1 от всех query-параметров (отсортированных) и сравнивает.

> ⚠ Если signature не совпадает — backend возвращает 401 и не создаёт `PhoneCall`. Это защита от подмены.

## Исходящий звонок (callback)

```python
GET https://api.zadarma.com/v1/request/callback/
   ?from=<sip_number>
   &to=+79991234567
   &predicted=1
```

`predicted=1` включает callback-режим: сначала звонок регистратору, потом клиенту.

## FAQ

**Какая стоимость исходящих на РФ?** ~1,5 ₽/мин на мобильные, дешевле прочих.

**Поддерживается ли запись разговоров?** Да, через тариф «Стандарт» и выше. URL записи приходит во втором webhook через 1-3 минуты после завершения.

**Можно ли менять caller-id?** Да, любой DID, привязанный к аккаунту, можно использовать как caller-id для исходящих.
