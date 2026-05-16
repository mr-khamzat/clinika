# Workflow батч — SLA-auto-escalate + Шаблоны + Автозакрытие

**Дата:** 2026-05-16
**Сессия:** brainstorming-2
**Зависимости:** Quick Wins батч завершён (commits 9c976a3 … 751b9dd)

---

## 1. Контекст

Чат клиники с пациентами уже работает (треды, сообщения, реакции, pin, labels,
typing, sound). Quick Wins добавил визуальную полировку. Теперь нужны
operational-фичи, чтобы клиника не теряла обращения и менеджер мог управлять
загрузкой.

3 укрупнённые фичи:
- **SLA-auto-escalate** — таймеры передачи треда более старшей роли при простое
- **Шаблоны быстрых ответов** — `/анализы` → готовый текст в input
- **Автозакрытие** — старые молчаливые треды закрываются сами

«Convert-to-task» и «передача» из исходного списка покрыты этими фичами:
ручная передача = частный случай reassign из SLA-механизма.

## 2. Цели и не-цели

**Цели:**
- Гарантированный отклик клиники в течение N минут (SLA)
- Снижение нагрузки на менеджера через шаблоны (быстрые типовые ответы)
- Чистый список тредов — старые автоматически уходят в архив

**Не-цели (out-of-scope):**
- ❌ Email/Push нотификации (только TG-бот для эскалаций)
- ❌ Сложные SLA-правила (рабочие часы, VIP, праздники) — будут в v2
- ❌ Convert-to-task — это appointment, уже сделано через quick-action

## 3. Архитектура

### 3.1 SLA-auto-escalate

**Новые поля в `ChatThread`:**
- `last_inbound_message_at TIMESTAMP NULL` — обновляется в `add_message`
  если `sender_type == 'patient'`. Сброс в NULL при ответе клиники.
- `sla_breached_level VARCHAR(20) NULL` — текущий уровень эскалации
  (`reg` / `manager` / `owner`) или NULL если нарушений нет
- `sla_breached_at TIMESTAMP NULL` — когда сработал текущий уровень
- `reassigned_history JSONB DEFAULT '[]'` — лог реассайнов
  `[{at: iso, from_user_id, to_user_id, reason: 'sla'|'manual', note}]`

**Новые tenant-настройки** (`tenant_settings` JSONB на `Tenant`):
```json
{
  "chat_sla_enabled": false,
  "chat_sla_minutes_reg":     15,
  "chat_sla_minutes_manager": 30,
  "chat_sla_minutes_owner":   60,
  "chat_autoclose_days":       7
}
```

**Endpoint:** `POST /clinic/chat/threads/{id}/reassign`
```json
{"to_user_id": "uuid", "note": "string|optional"}
```
Логика:
1. Проверка прав (manager / franchise_owner / текущий assigned)
2. Загружает thread, проверяет что `to_user_id` принадлежит тому же tenant
3. Меняет `assigned_doctor_id`
4. Добавляет запись в `reassigned_history`
5. Создаёт system-message в треде: `«Тред передан: Иванов И.И. → Петров П.П. (заметка: ...)»`
6. Сбрасывает `sla_breached_level=NULL` (новый цикл)
7. Опционально TG-нотификация (если у `to_user` есть TG)

**Background job** `chat_sla_checker_job` (apscheduler, interval=60s):
- `SELECT * FROM chat_threads WHERE status='open' AND last_inbound_message_at IS NOT NULL`
- Для каждого треда:
  - Считает `mins = (now - last_inbound_message_at).total_seconds() / 60`
  - Определяет целевой уровень:
    - `mins >= minutes_owner` → `'owner'`
    - `mins >= minutes_manager` → `'manager'`
    - `mins >= minutes_reg` → `'reg'`
    - иначе → NULL
  - Если целевой уровень > текущего `sla_breached_level`:
    - Найти свободного user'а нужной роли в тенанте (тот, у кого меньше всего open тредов)
    - Сделать reassign на него (reason='sla')
    - Обновить `sla_breached_level` и `sla_breached_at`
    - Если в тенанте нет user'а такой роли — пропустить, не падать
- Если тред автозакрытие: `now - last_message_at > chat_autoclose_days days` И `status='open'` →
  закрыть + system-message «Тред автоматически закрыт после N дней неактивности»

**Endpoint** `GET /tenant/settings/chat`, `PATCH /tenant/settings/chat`
(управление настройками выше; только `manager` / `franchise_owner`).

### 3.2 Шаблоны быстрых ответов

**Новая модель** `MessageTemplate`:
- `id uuid PK`
- `tenant_id uuid FK tenants NOT NULL` — tenant-scope
- `created_by_user_id uuid FK users NULL` — NULL = «общий шаблон клиники»
- `shortcut VARCHAR(50) NOT NULL` — короткая команда `/анализы`, `/мрт`, и т.п.
- `title VARCHAR(100) NOT NULL` — описание для UI
- `body TEXT NOT NULL` — текст шаблона (поддерживает Markdown)
- `category VARCHAR(50) NULL` — `greeting|price|procedure|farewell|...`
- `usage_count INT DEFAULT 0`
- `created_at`, `updated_at`
- Unique: `(tenant_id, shortcut)` для общих + `(tenant_id, created_by_user_id, shortcut)`
  для личных (через partial-index или application-level check)

**Endpoints:**
- `GET /chat/templates?q=&category=&limit=20` — список (свои + общие тенанта)
  - Сортировка: `usage_count DESC, title ASC`
- `POST /chat/templates {shortcut, title, body, category, is_global}` —
  `is_global=true` доступно только manager/owner, иначе `created_by_user_id=current_user.id`
- `PUT /chat/templates/{id}` — редактирование (только автор или manager)
- `DELETE /chat/templates/{id}` — удаление
- `POST /chat/templates/{id}/use` — инкремент `usage_count`, возвращает `{body}`

**Frontend:**
- В `ClinicChatSection` textarea — детект `/` в начале строки → открыть dropdown
- Dropdown с фильтрацией по shortcut/title, стрелки/Enter — вставка
- При вставке: фронт зовёт `/chat/templates/{id}/use`, в textarea подставляется `body`
- `/manager/chat-templates` — CRUD страница (только manager/owner)
- В шапке `/manager/settings` — раздел «SLA и шаблоны» с настройками SLA

### 3.3 Автозакрытие

Уже описано в 3.1 (общий background job).

## 4. Безопасность и валидация

- Reassign endpoint проверяет:
  - Текущий user — manager / franchise_owner / текущий assigned_doctor
  - `to_user_id` принадлежит тому же `tenant_id` что и тред
- Settings endpoint — только manager / franchise_owner
- Шаблоны:
  - Tenant-scope (`tenant_id == current_user.tenant_id`)
  - `is_global` (без `created_by_user_id`) может создавать только manager/owner
  - Удалять/править — автор или manager+
- Body шаблона — Markdown-санитизация на стороне клиента (Quick Wins уже)
- Background job логирует все эскалации в `reassigned_history`, аудит-сервис
  получает событие `chat.thread.escalated`

## 5. Тестирование

**Backend (pytest, в контейнере):**
- `test_reassign_changes_assigned_doctor`
- `test_reassign_creates_system_message`
- `test_reassign_logs_history`
- `test_reassign_rejects_cross_tenant`
- `test_sla_job_escalates_to_reg_at_15min`
- `test_sla_job_escalates_to_manager_at_30min`
- `test_sla_job_skips_if_no_user_of_role`
- `test_autoclose_after_7_days`
- `test_template_crud_personal`
- `test_template_crud_global_requires_manager`
- `test_template_use_increments_counter`
- `test_settings_get_returns_defaults_for_new_tenant`
- `test_settings_patch_requires_manager`

**Frontend (smoke):**
- Сборка vite без ошибок
- Кнопка reassign открывает модал
- Автокомплит `/анализы` показывает варианты
- Бейдж SLA в шапке при `sla_breached_level != null`

## 6. Миграции (alembic)

- `wf01_chat_sla_fields` — добавляет 4 поля в chat_threads
- `wf02_tenant_chat_settings` — добавляет/использует `settings` JSONB на `tenants`
  (если уже есть `settings`/`config` JSONB — расширить, не плодить колонку)
- `wf03_message_templates` — таблица `message_templates`

Все 3 миграции с `down_revision` от текущего head (`chatqw04_color`).

## 7. План реализации (по укрупнённым задачам)

1. Backend модели + миграции (3 миграции, 30 мин)
2. Backend Reassign endpoint + тесты (1 час)
3. Backend SLA-job + autoclose-job + тесты (2 часа)
4. Backend Settings endpoints + тесты (45 мин)
5. Backend Templates модель + endpoints + тесты (1.5 часа)
6. Frontend Reassign UI (модал) (45 мин)
7. Frontend SLA-бейдж в шапке + ThreadListItem (30 мин)
8. Frontend Settings page (вкладка в /manager/settings) (1 час)
9. Frontend Templates автокомплит в input (1.5 часа)
10. Frontend `/manager/chat-templates` страница CRUD (2 часа)
11. Smoke + интеграционные проверки (30 мин)

**Итого:** ~12 часов. Параллельно 2 агентами (backend + frontend) — ~7 часов.

## 8. Риски

| Риск | Митигация |
|------|-----------|
| Scheduler-job спамит DB при больших объёмах | Запрос ограничен `status='open'` и индексом по `last_inbound_message_at` |
| Нет user'а нужной роли в тенанте | Логировать в audit-service, не падать, не реассайнить |
| Пересечение с существующими шаблонами `referral_templates` | Это РАЗНЫЕ сущности (для направлений vs для сообщений); namespace отдельный |
| `tenant.settings` уже используется другим модулем | Проверить перед миграцией; если есть — добавить namespace `chat.*` внутри JSONB |

## 9. Open questions

Нет — все решения зафиксированы выше.
