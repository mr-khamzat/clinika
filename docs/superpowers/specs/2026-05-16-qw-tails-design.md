# Quick Wins хвосты — Spec

3 фичи в один батч.

## 1. Drag&drop файлов в чате клиники

**Backend (`backend/app/routers/clinic_chat.py`):**
- Новый `POST /clinic/chat/threads/{thread_id}/files` (multipart/form-data)
- Проверка прав через `_user_clinic_ids` (как в существующих endpoints)
- Лимит 50MB, сохранение в `/app/uploads/clinic-chat/{thread_id}/{uuid}.{ext}`
- Возвращает `{url, name, mime, size}`
- 24h TTL — расширение существующего cleanup job если есть, иначе не критично

**Frontend (`ClinicChatSection.jsx`):**
- onDragOver на `.chat-scroll` — показывать оверлей «Отпустите файл»
- onDrop — для каждого файла → `api.post('/clinic/chat/threads/{id}/files', formData)`
- Полученные `{url, name, mime, size}` накапливаются в state `pendingAttachments`
- При отправке сообщения — `attachments: pendingAttachments` в payload
- Очистка pendingAttachments после успешной отправки

## 2. Quoted reply

**Миграция `qw01_reply_to`:**
- `ChatMessage.reply_to_id UUID FK chat_messages SET NULL NULL`

**Backend:**
- POST `/messages` принимает `reply_to_id` (если есть — проверить что в этом же треде)
- `serialize_message` добавляет `reply_to: {id, body_preview, sender_type, sender_name?}` если `reply_to_id` задан

**Frontend (`MessageBubble.jsx`):**
- При hover показывать «↩ Ответить» (рядом с add_reaction)
- Если `msg.reply_to` — рендерить блок-цитату сверху бабла (серая полоса слева, body_preview, click = scroll к оригиналу)

**Frontend (`ClinicChatSection.jsx`):**
- State `replyingTo: {id, body_preview, sender_name}` или null
- Над textarea — preview-блок с ✕
- При send — `reply_to_id: replyingTo?.id` в payload
- Очистка после отправки

## 3. Web Push subscribe UI

Backend готов (push.py из push-сессии). Helper `enableWebPush()` готов.

**Frontend:**
- В шапке `ClinicChatSection` (рядом с sound toggle) — иконка `notifications`
- Состояние через `getPushPermissionState()`:
  - `default` → серая иконка «Включить»
  - `granted` + subscribed → синяя «Включено» (клик = `disableWebPush`)
  - `denied` → красная (toast «Разрешения отозваны в настройках браузера»)
  - `unsupported` → скрыть кнопку

## Тестирование

- Backend: 3 теста (upload endpoint 403/200/500, reply_to сохранение)
- Frontend: smoke build + HTTP 200

## Реализация

- 1 backend агент: миграция qw01_reply_to + endpoint files + reply_to extension + 3 теста
- 1 frontend агент: drag&drop + quoted reply + push button (1 файл ClinicChatSection.jsx + 1 файл MessageBubble.jsx)

~3-4 часа.
