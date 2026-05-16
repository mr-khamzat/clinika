---
title: StaffChat · Опросы и CI-бот
slug: staffchat-polls-and-bot
group: feature
updated: 2026-05-17
reading_time: 5
---

# StaffChat · Опросы и CI-бот

Два расширения внутреннего чата: интерактивные опросы (для смен, обедов, отпусков) и системный бот для технических алёртов от Grafana/CI.

## Опросы

### Зачем

Управляющему регулярно нужно собирать «кто за что» среди сотрудников:

- Кто выходит в субботнюю смену?
- Куда заказываем обед?
- Согласны ли с новым графиком?

Раньше — Google Forms или голосовалки в Telegram. Теперь — внутри StaffChat, без выноса данных наружу.

### Как создать

В канале → нажать иконку «📊» → форма:

```
Вопрос: Кто выходит в субботу 23 мая?
Варианты:
  ○ Иду
  ○ Не иду
  ○ Подменюсь с Ивановым
☐ Множественный выбор
☐ Анонимно
☐ Закрыть голосование 2026-05-22 23:59
```

POST в `/api/staff-chat/polls`:

```json
{
  "channel_id": "...",
  "question": "Кто выходит в субботу 23 мая?",
  "options": ["Иду", "Не иду", "Подменюсь"],
  "multi_select": false,
  "anonymous": false,
  "closes_at": "2026-05-22T23:59:00Z"
}
```

### Голосование

В UI рендерится карточка с прогресс-барами:

```
Иду                ████████░░  8 / 14 (57%)
Не иду             ████░░░░░░  4 / 14 (29%)
Подменюсь          ██░░░░░░░░  2 / 14 (14%)
```

Сотрудник нажимает на вариант → `POST /api/staff-chat/polls/{id}/vote {option_id}`. Если `multi_select=true`, можно отметить несколько.

### Закрытие

Опрос автоматически закрывается по `closes_at` либо вручную через `POST /api/staff-chat/polls/{id}/close` (только создателем или менеджером). После закрытия голоса не принимаются, виден итог.

## CI-бот (системные алёрты)

### Зачем

Grafana, Uptime-Kuma, GitHub Actions должны кидать предупреждения о падении сервиса в нужный канал — например `#alerts`. CI-бот — один HTTP-endpoint, который любой внешний сервис может вызвать с секретом.

### Endpoint

```bash
POST /api/staff-chat/bot/post
Content-Type: application/json
{
  "channel_name": "alerts",
  "body": "🔥 Backend p95 > 1s в последние 5 минут (Grafana)",
  "secret": "<STAFF_CHAT_BOT_SECRET>"
}
```

`secret` берётся из `.env`:

```bash
STAFF_CHAT_BOT_SECRET=<random 32 chars>
```

При несовпадении — 401. При неизвестном `channel_name` — 404.

### Пример Grafana webhook

```json
{
  "url": "https://клиниксеть.рф/api/staff-chat/bot/post",
  "httpMethod": "POST",
  "body": "{\"channel_name\":\"alerts\",\"body\":\"{{ .CommonAnnotations.summary }}\",\"secret\":\"<secret>\"}"
}
```

### Пример GitHub Actions

```yaml
- name: Notify StaffChat
  if: failure()
  run: |
    curl -X POST https://клиниксеть.рф/api/staff-chat/bot/post \
      -H 'Content-Type: application/json' \
      -d "{\"channel_name\":\"ci\",\"body\":\"❌ Build failed: ${{ github.sha }}\",\"secret\":\"${{ secrets.STAFF_CHAT_BOT_SECRET }}\"}"
```

### Иконка автора

Сообщения от бота отображаются с иконкой 🤖 и именем «Bot». Сотрудник может ответить на сообщение бота — это создаст обычное сообщение в канале (бот его игнорирует).

## FAQ

**Можно ли тегать @user в сообщении бота?** Да, в `body` указать `@username` — система подменит на упоминание с уведомлением.

**Есть ли rate-limit на бота?** 100 запросов/мин на канал. После лимита — 429.

**Можно ли несколько ботов?** Пока один глобальный. Если нужны отдельные — заведите несколько каналов и используйте `channel_name`.
