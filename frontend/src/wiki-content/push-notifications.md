---
title: Web Push уведомления
slug: push-notifications
group: feature
updated: 2026-05-17
reading_time: 5
---

# Web Push уведомления

Браузерные push-уведомления о новых сообщениях в чате клиники, звонках, эскалациях. Работают даже когда вкладка КлиникСеть закрыта.

## Зачем это нужно

Регистратор не сидит постоянно на вкладке CRM — он переключается на 1С, Excel, мессенджеры. Push даёт «толчок» вернуться:

- 💬 Новое сообщение от пациента в чате;
- 📞 Входящий PSTN-звонок (когда Calls не запущен);
- 🆘 SLA-эскалация — тред «горит»;
- 🤖 Алёрт от CI-бота в StaffChat.

## Как работает

Используется стандартный **Web Push** (VAPID). Поток подписки:

```
1. UI: «Включить уведомления» → Notification.requestPermission()
2. Браузер регистрирует Service Worker (/sw.js)
3. SW.pushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY })
4. Получаем subscription = { endpoint, keys: { p256dh, auth } }
5. POST /api/push/subscribe { subscription }
6. Backend хранит в push_subscriptions(user_id, endpoint, keys, user_agent)
```

Отправка:

```python
from pywebpush import webpush
webpush(
    subscription_info=sub,
    data=json.dumps({"title": "Иванов написал", "body": "...", "url": "/chat/12"}),
    vapid_private_key=VAPID_PRIVATE_KEY,
    vapid_claims={"sub": "mailto:support@клиниксеть.рф"},
)
```

Service Worker (`public/sw.js`) ловит:

```js
self.addEventListener('push', e => {
  const data = e.data.json();
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon-192.png',
    data: { url: data.url },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data.url));
});
```

## VAPID-ключи

Генерируются один раз для всей платформы:

```bash
npx web-push generate-vapid-keys
# Public Key: BHk... (в .env как VAPID_PUBLIC_KEY)
# Private Key: ... (как VAPID_PRIVATE_KEY)
```

Public ключ embed'ится во frontend через `VITE_VAPID_PUBLIC_KEY`. Private — только в backend.

## UI

В шапке CRM кнопка-колокольчик:

```
🔔  — push отключён, клик → запрос разрешения
🔔✓ — подписан
🔕  — отказался от разрешения; включается через настройки браузера
```

При клике система проходит шаги 1-5 выше. Если пользователь нажал «Block» — кнопка превращается в «🔕» с подсказкой «Разрешите уведомления в настройках браузера».

## Эндпоинты

- `POST   /api/push/subscribe` — добавить подписку
- `DELETE /api/push/subscribe` — удалить (logout, отказ)
- `GET    /api/push/vapid-public-key` — public ключ
- `POST   /api/push/test` — отправить тестовое (только для self)

## Жизненный цикл подписки

- Подписка хранится **по `endpoint`**, а не по `user_id` — у одного юзера может быть несколько браузеров.
- При отписке через `DELETE` — запись удаляется.
- При получении `410 Gone` от push-сервера (Chrome FCM) — backend автоматически удаляет «протухший» endpoint.

## FAQ

**Работает ли в Safari?** С macOS 13+ и iOS 16.4+ — да, но требует установки PWA на главный экран.

**Push не приходит, но подписка зарегистрирована.** Проверьте: 1) разрешения уведомлений в OS; 2) DND-режим; 3) логи backend на `pywebpush` errors.

**Шифруются ли данные?** Да, по протоколу Web Push: payload зашифрован публичным ключом подписки, расшифровывает только браузер.
