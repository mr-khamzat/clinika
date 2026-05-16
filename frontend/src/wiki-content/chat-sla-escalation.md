---
title: SLA-эскалация чата клиники
slug: chat-sla-escalation
group: feature
updated: 2026-05-17
reading_time: 5
---

# SLA-эскалация чата клиники

Автоматическая передача необработанных обращений в чате клиники регистратору → управляющему → владельцу франшизы. Не даёт повисшим тредам потеряться и роняет KPI «среднее время ответа».

## Зачем это нужно

Сценарий, который ломал клиники до этой фичи:

- Пациент пишет в чат клиники.
- Регистратор отвлечён или ушёл на обед.
- Через 30 минут пациент уже ушёл к конкуренту.

SLA-эскалация решает это автоматически:

- Через 15 мин без ответа — тред подсвечивается оранжевым, всплывает у всех регистраторов.
- Через 30 мин — тред автоматически передаётся управляющему.
- Через 60 мин — управляющему отправляется Telegram-уведомление, тред эскалируется на владельца франшизы.

## Как работает

Background-job в backend (`app/jobs/chat_sla_job.py`) запускается каждые 60 секунд:

```python
async def check_sla_breaches():
    threads = await get_pending_threads()
    settings = await get_tenant_chat_settings(tenant_id)
    for t in threads:
        idle = now - t.last_client_message_at
        if idle > settings.escalate_to_owner_after:
            await escalate(t, role="franchise_owner")
        elif idle > settings.escalate_to_manager_after:
            await escalate(t, role="manager")
        elif idle > settings.warn_after:
            await mark_warning(t)
```

Пороги настраиваются в `/manager/chat-settings` (или `/tenant/settings/chat` для owner). По умолчанию: 15 / 30 / 60 мин.

При каждой эскалации запись добавляется в `Thread.reassigned_history` (JSONB):

```json
[
  {"from": "reg_4", "to": "manager_2", "at": "2026-05-17T10:15:00Z", "reason": "sla_breach_30m"},
  {"from": "manager_2", "to": "owner_1", "at": "2026-05-17T10:45:00Z", "reason": "sla_breach_60m"}
]
```

## Как настроить

1. Зайти в `/manager/chat-settings` (управляющий) или `/tenant/settings/chat` (владелец).
2. Установить пороги в минутах:
   - «Предупреждать через» — N минут (подсветка треда);
   - «Передать управляющему через» — M минут;
   - «Передать владельцу через» — K минут.
3. Сохранить — backend обновит `tenant_chat_settings`.

> 💡 Рекомендуемые значения для регистратуры с двумя сотрудниками: 10 / 20 / 45 мин. Для клиники с одним регистратором — 15 / 30 / 60.

## Команды и API

- `GET  /api/chat/sla/settings` — текущие пороги
- `PATCH /api/chat/sla/settings` — обновить
- `GET  /api/chat/threads?sla=breach` — отфильтровать просроченные
- `GET  /api/chat/threads/{id}/history` — история переходов

## FAQ

**Что если регистратор всё-таки ответил после эскалации?** Тред остаётся за управляющим, но регистратор может ответить — это считается «совместный ответ» в KPI.

**Можно ли отключить эскалацию для конкретного треда?** Да, кнопкой «Закрепить за мной» в UI — тогда SLA-таймер сбрасывается.

**Считается ли время в нерабочие часы?** По умолчанию да, но есть флажок «Только в рабочие часы клиники» в настройках.
