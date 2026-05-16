# StaffChat Slack-fundament — Design

**Дата:** 2026-05-16
**Сессия:** brainstorming-3
**Зависимости:** Quick Wins + Workflow батчи завершены

---

## 1. Контекст

StaffChat — внутренний чат сотрудников Клиники. Текущее состояние:
- ✅ Модели: `StaffChatRoom`, `StaffChatMember`, `StaffChatMessage`, `StaffChatFile`
- ✅ Поле `StaffChatMessage.reply_to_id` (threads готовы в БД, нет UI)
- ✅ WebSocket `/staff-chat/ws`, presence, mute, files (50MB/48h), unread tracking
- ✅ В БД 5 `direct` rooms, channels не используются

Не хватает «Slack-like» функциональности — рост команды требует каналы (по
отделам/клиникам), быстрые реакции, упоминания и закреплённые сообщения.

## 2. Цели и не-цели

**Цели:**
- Создание каналов (открытых и закрытых)
- Реакции на сообщения (быстрый ответ без печати)
- @mention с TG-нотификацией
- Pin сообщений в канале

**Не-цели (этой сессии):**
- ❌ Threads UI (reply_to_id уже в БД — отдельный батч)
- ❌ Global search — следующий батч
- ❌ Polls — следующий батч
- ❌ CI/мониторинг бот endpoint — следующий батч

## 3. Архитектура

### 3.1 Channels

**Поля `StaffChatRoom`** (расширить):
- `type` — уже есть, начинаем использовать `'channel'` и `'group'` (+ существующий `'direct'`)
- `description TEXT NULL` — новое поле

**Семантика `type`:**
- `direct` — 1-на-1, два member'а, нет name
- `group` — закрытый, только по invite от admin'а, есть name
- `channel` — открытый, любой сотрудник тенанта может войти, есть name

**Endpoints:**
- `POST /staff-chat/channels {name, type: 'channel'|'group', clinic_id?, description?}`
  → создаёт room, делает creator'а `member_role='admin'`
- `GET /staff-chat/channels/public?q=` — список public channels тенанта (для browse)
- `POST /staff-chat/channels/{id}/join` — войти в public channel (для group — 403)
- `POST /staff-chat/channels/{id}/invite {user_ids: [uuid, …]}`
  → требует `member_role='admin'`; создаёт `StaffChatMember` для каждого; system-сообщение «Иванов добавил Петрова»
- `POST /staff-chat/channels/{id}/leave` — удаляет StaffChatMember (если последний admin — 409)
- `PATCH /staff-chat/channels/{id} {name?, description?}` — только admin

**Расширение `GET /staff-chat/rooms`:** возвращать все room'ы где user — member (как сейчас) + новое поле `type` для UI-группировки.

### 3.2 Reactions

**Новая таблица `staff_chat_message_reactions`:**
- `id uuid PK`
- `message_id uuid FK staff_chat_messages CASCADE`
- `user_id uuid FK users SET NULL`
- `emoji varchar(16) NOT NULL`
- `created_at timestamp DEFAULT now()`
- UNIQUE `(message_id, user_id, emoji)`

**Endpoint `POST /staff-chat/messages/{id}/reactions {emoji}`** — toggle
(добавить если нет, удалить если есть для этого user'а).

**Сериализатор сообщения** добавляет `reactions: [{emoji, count, by_me}]`
(агрегация на стороне БД).

**Frontend** — Reaction-picker идентичен clinic chat (компонент уже есть в
`MessageBubble`). 6 быстрых: `👍 ❤️ ✅ 🙏 😂 🔥`.

### 3.3 @Mention

**Парсер** при `POST /staff-chat/rooms/{id}/messages` — regex `@(\w+)`
по тексту body, лукап в `users` по `username` или `telegram_username`
(только в пределах тенанта). Резолвенные user'ы → `mentioned_user_ids`.

**Поле `StaffChatMessage.mentioned_user_ids`** — JSONB array of uuid strings,
default `[]`.

**Side-effects:**
1. Каждому upmentioned user'у — TG-нотификация через @stclinik_addmin_bot:
   `«@Иванов вас упомянул в канале #разработка: ...»` (если у user есть
   `telegram_chat_id` в профиле)
2. В таблице нет отдельной mentions-таблицы — используем `mentioned_user_ids`
   на сообщении + last_read_at у member'а для определения непрочитанных
   mentions.

**Endpoint `GET /staff-chat/mentions/unread`** — список room_id где меня
упомянули после моего `last_read_at` (для badge-индикатора в UI).

**Frontend:**
- Автокомплит после `@` в textarea (как `/` для шаблонов в clinic chat):
  - При вводе `@text` показываем dropdown с user'ами тенанта
  - Стрелки/Enter — вставка `@username `
- В баббле сообщения — подсветка `@username` синим (регекс-замена на `<span>`)
- В Sidebar — рядом с unread-бейджем (если есть mention) показываем «@»

### 3.4 Pin сообщений

**Поля `StaffChatMessage`** (расширить):
- `pinned_at timestamp NULL`
- `pinned_by_user_id uuid FK users SET NULL NULL`

**Endpoints:**
- `POST /staff-chat/messages/{id}/pin` — toggle. Требует
  `member_role='admin'` в этом room'е ИЛИ глобальную роль
  `manager` / `franchise_owner`
- `GET /staff-chat/rooms/{room_id}/pinned` — список pinned сообщений
  (по `pinned_at DESC`)

**Frontend:**
- В баббле — иконка `push_pin` справа от времени если pinned
- В шапке room'а — бейдж `📌 N` (счётчик) → клик открывает модал
  «Закреплённые сообщения»
- В модале — лента pinned-сообщений с кнопкой «открепить» (admin only)

## 4. Безопасность

- `clinic_id` в channels опционален (NULL = тенант-уровень, доступен всем),
  иначе — только member'ам клиники
- Invite — только admin'ы room'а
- Pin — admin room'а ИЛИ глобальные роли (manager/franchise_owner/super_admin)
- @Mention TG-нотификация шлётся только если у пользователя есть TG-привязка
  (поле `telegram_chat_id` в `users` — если есть; иначе пропускаем)
- Cross-tenant защита через `tenant_id` на room и членов

## 5. Тестирование

**Backend (pytest):**

Channels (4 теста):
- `test_create_channel_makes_creator_admin`
- `test_join_public_channel_creates_member`
- `test_join_group_channel_forbidden`
- `test_leave_last_admin_returns_409`

Reactions (3 теста):
- `test_reaction_toggle_add_then_remove`
- `test_reaction_serializer_aggregates_count`
- `test_reaction_by_me_flag`

Mentions (4 теста):
- `test_mention_resolves_username_to_uuid`
- `test_mention_skips_unknown_username`
- `test_mention_cross_tenant_ignored`
- `test_mentioned_user_ids_stored_on_message`

Pin (3 теста):
- `test_pin_toggle_admin_can`
- `test_pin_toggle_member_cannot`
- `test_pinned_list_returns_only_pinned`

Итого 14 unit tests. + smoke endpoints (403 без auth).

**Frontend (smoke):** vite build + HTTP 200.

## 6. Миграции (alembic)

- `sf01_channels` — `description` на staff_chat_rooms
- `sf02_reactions` — таблица `staff_chat_message_reactions`
- `sf03_mentions` — `mentioned_user_ids JSONB` на staff_chat_messages
- `sf04_pinned` — `pinned_at`, `pinned_by_user_id` на staff_chat_messages

Все 4 от head `wf03_templates`.

## 7. План реализации (укрупнённо)

1. Backend модели + 4 миграции (30 мин)
2. Backend Channels endpoints + тесты (1.5 ч)
3. Backend Reactions endpoint + serializer + тесты (45 мин)
4. Backend Mentions parser + endpoint + TG-нотификация + тесты (1.5 ч)
5. Backend Pin endpoints + тесты (45 мин)
6. Frontend Sidebar split (Каналы / DM) + модал создания канала (1 ч)
7. Frontend Reactions UI (переиспользуем MessageBubble onReact) (30 мин)
8. Frontend @-автокомплит + подсветка mentions в баббле (1.5 ч)
9. Frontend Pin: иконка в баббле + бейдж в шапке + модал pinned (1 ч)
10. Smoke + интеграция (30 мин)

**Итого:** ~9 ч. С 2 параллельными агентами — ~5 ч.

## 8. Риски

| Риск | Митигация |
|------|-----------|
| Парсер @username собирает много false-positive | regex `@(\w{3,30})` + явная резолв в users, неизвестные имена игнор |
| TG-нотификация спамит | Нотификация только если user не в room'е сейчас (не сидит в WS), но это сложно проверить — упростим: всегда (если есть TG) |
| Каналы заполнят список тредов | UI делит на 2 секции — DM и каналы. В каналах своя сортировка |
| Pinned-сообщения растут бесконечно | Лимит — не более 20 pinned на канал. При попытке закрепить 21-е — 409 |

## 9. Open questions

Нет — все решения зафиксированы.
