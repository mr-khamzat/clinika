# routers [02] — админка платформы, реклама и AI-аналитика

Это срез из 15 роутеров `backend/app/routers/`. Содержательно он распадается на три кластера:

1. **Платформенная админка (`admin_*`)** — эндпоинты под `require_super_admin` / `require_franchise_owner` / `require_manager` для управления самой платформой и тенантами: feature-flags, tenant health, disaster-mode, тарифы подписок, программа лояльности, лаборатории, регламенты, live-логи. Это «бэк-офис» SaaS, а не клиническая логика.
2. **Реклама (`ads*`)** — четыре параллельных роутера с ОДНИМ префиксом `/ads`, написанных разными агентами по фазам: базовый CRUD (`ads.py`), AI/стоки (`ads_ai.py`), расширенная аналитика (`ads_analytics.py`), workflow approval/sharing (`ads_workflow.py`). Все три «дополнительных» переиспользуют `_ad_out` и `_mod` из `ads.py`.
3. **AI (`ai.py`, `ai_assistant.py`)** — AI-аналитика для менеджера (OpenAI-совместимый API, конфиг в файле) и AI-ассистент пациенту (Gemini, публичные + менеджерские эндпоинты).

Сквозные паттерны: всё на `async`/`await` + `AsyncSession`; жёсткая tenant-изоляция через `current_user.tenant_id`; gating платных фич через `require_module(...)` / `require_feature(...)`; денежные поля приводятся к `Decimal` при записи и к `float` при сериализации.

ВАЖНО про префиксы: все 15 роутеров подключаются в `main.py` БЕЗ дополнительного префикса (`app.include_router(...)` без аргумента `prefix`). Поэтому реальный путь = `prefix` из `APIRouter(...)` внутри файла. Docstring-и местами пишут `/api/...` — это путь со стороны фронта/реверс-прокси, который срезает `/api`. В таблицах ниже указан фактический FastAPI-путь.

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `admin_feature_flags.py` | CRUD feature-flags + tenant-override (super_admin) | 301 |
| `admin_lab.py` | CRUD провайдеров лабораторий тенанта | 164 |
| `admin_logs.py` | Live-tail логов backend (super_admin) | 77 |
| `admin_loyalty.py` | Админка лояльности: награды/заявки/баллы | 324 |
| `admin_regulations.py` | Конструктор регламентов: версии/назначения/прочтения | 523 |
| `admin_subscription_plans.py` | Тарифы подписок: глобальные/override/KPI | 314 |
| `admin_system.py` | Disaster-mode + расширенный health-check | 200 |
| `admin_tenant_health.py` | Снимки здоровья тенантов (super_admin) | 205 |
| `admins.py` | Профиль сотрудника, его статистика, заявки врачей | 468 |
| `ads.py` | Базовый CRUD рекламы + показ/события/A-B | 1132 |
| `ads_ai.py` | AI-картинки, стоки, bulk-драфты, шаблоны | 275 |
| `ads_analytics.py` | Аналитика рекламы: воронка/heatmap/forecast | 172 |
| `ads_workflow.py` | Approval + sharing между филиалами + теги | 236 |
| `ai.py` | AI-аналитика клиники (OpenAI-совместимый) | 932 |
| `ai_assistant.py` | AI-ассистент пациенту (Gemini) + менеджеру | 573 |

---

## `backend/app/routers/admin_feature_flags.py`

- **Назначение:** Управление платформенными feature-flags и их per-tenant override. Только `super_admin`. Каждое изменение инвалидирует кэш флага в `feature_flag_service`.
- **Ключевые элементы:** `router` (prefix `/admin/feature-flags`); helpers `_get_flag_by_key`, `_serialize_flag`; 7 эндпоинтов.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/feature-flags/` | super_admin | — | `List[FeatureFlagResponse]` | Все флаги + кол-во overrides (enabled) |
| POST | `/admin/feature-flags/` | super_admin | `FeatureFlagCreate` | `FeatureFlagResponse` 201 | Создать флаг (409 при дубле key) |
| PATCH | `/admin/feature-flags/{key}` | super_admin | `FeatureFlagUpdate` | `FeatureFlagResponse` | Изменить имя/дефолт/стратегию/value |
| DELETE | `/admin/feature-flags/{key}` | super_admin | — | 204 | Удалить флаг (каскад по overrides) |
| GET | `/admin/feature-flags/{key}/tenants` | super_admin | — | `List[TenantFeatureFlagResponse]` | Список tenant-override + имя/slug |
| PUT | `/admin/feature-flags/{key}/tenants/{tenant_id}` | super_admin | `TenantFeatureFlagSet` | `TenantFeatureFlagResponse` | Upsert override (404 если тенант не найден) |
| DELETE | `/admin/feature-flags/{key}/tenants/{tenant_id}` | super_admin | — | 204 | Снять override |

- **Зависимости:** `core.deps.require_super_admin`; модели `feature_flag` (`FeatureFlag`, `RolloutStrategy`, `TenantFeatureFlag`), `tenant.Tenant`, `user.User`; схемы `schemas.feature_flag` (+ `validate_rollout_value`); сервис `feature_flag_service as ffs` (`invalidate_flag_cache`, `invalidate_override_cache`).
- **Где менять для типовых задач:** новая стратегия раскатки — правь enum `RolloutStrategy` в модели + `validate_rollout_value`/`normalized_rollout_value` в схеме, тут код их просто вызывает. Добавить поле во флаг — модель, схема, `_serialize_flag`, ветки в `update_flag`.
- **Подводные камни:** стратегия и value валидируются ПАРОЙ в `update_flag` (строки 148-162): нельзя обновлять одно без согласования с другим. `created_at/updated_at` проставляются вручную через `datetime.utcnow()` (строки 113, 122-123) — не из server_default. После каждой мутации обязателен вызов `ffs.invalidate_*_cache` — если добавляешь новый мутирующий эндпоинт, не забудь инвалидацию, иначе фронт увидит старое значение.
- **Строк:** 301

## `backend/app/routers/admin_lab.py`

- **Назначение:** CRUD провайдеров внешних лабораторий (HIS-интеграция, Глава 10) в рамках одного тенанта. API-ключи шифруются и наружу отдаются только маской.
- **Ключевые элементы:** `router` (prefix `/admin/lab`); guard `_REQUIRE_MANAGER` (manager/franchise_owner/super_admin); схемы `ProviderIn`, `ProviderPatch`; `_serialize_provider`; 5 эндпоинтов.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/lab/providers` | manager+ | — | `{items: [...]}` | Список провайдеров тенанта |
| POST | `/admin/lab/providers` | manager+ | `ProviderIn` | provider dict 201 | Создать провайдера (ключ шифруется) |
| PATCH | `/admin/lab/providers/{id}` | manager+ | `ProviderPatch` | provider dict | Обновить (ключ перешифровывается, если задан) |
| DELETE | `/admin/lab/providers/{id}` | manager+ | — | 204 | Удалить провайдера |
| POST | `/admin/lab/providers/{id}/test-connection` | manager+ | — | result dict | Проверить связь, при ok обновить `last_sync_at` |

- **Зависимости:** `core.deps.get_current_user` + `require_role`; модель `lab.LabProvider`; сервис `lab_service` (`encrypt_api_key`, `mask_api_key`, `test_provider_connection`).
- **Где менять для типовых задач:** новый тип провайдера — добавляй в `lab_service.test_provider_connection` (роутер тип не разбирает, просто хранит `provider_type`). Новое поле провайдера — модель + `ProviderIn`/`ProviderPatch` + `_serialize_provider`.
- **Подводные камни:** двойная зависимость `user = _REQUIRE_MANAGER` И `current_user = Depends(get_current_user)` — фактически проверка роли идёт через `_REQUIRE_MANAGER`, а tenant-логика через `current_user`; параметр `user` не используется, это легаси-дубль. tenant-изоляция ручная: каждый объект проверяется `p.tenant_id != current_user.tenant_id` → 404. `api_key` в PATCH: пустая строка НЕ перезаписывает ключ (строки 118-121).
- **Строк:** 164

## `backend/app/routers/admin_logs.py`

- **Назначение:** Отладочный инструмент: чтение последних строк лог-файла backend и SSE-стрим `tail -f`. Только `super_admin`.
- **Ключевые элементы:** `router` (prefix `/admin/logs`); константа `LOG_PATH = /var/log/clinika/backend.log`; 2 эндпоинта; внутренний `event_generator` (subprocess `tail`).
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/logs/tail?lines=N` | super_admin | query `lines` (1..5000) | `{lines: [...]}` или `{warning}` | Последние N строк (одноразово) |
| GET | `/admin/logs/stream` | super_admin | — | `StreamingResponse` (SSE) | Live `tail -f`, закрывается клиентом |

- **Зависимости:** `core.deps.get_current_user`; `models.user` (проверка `role != SUPER_ADMIN` ВРУЧНУЮ, без отдельного guard'а); stdlib `os`, `asyncio`.
- **Где менять для типовых задач:** путь к логу — константа `LOG_PATH` (строка 21). Формат строки SSE — `event_generator` (строка 69).
- **Подводные камни:** роль проверяется руками `if current_user.role != UserRole.SUPER_ADMIN` (нет `Depends(require_super_admin)`) — при рефакторинге легко забыть. Зависит от того, что внутри контейнера есть бинарь `tail` и существует файл; иначе `tail` пишет в `/dev/null` и стрим бесконечно ждёт. Subprocess `tail` убивается в `finally`, но при разрыве соединения отлов не гарантирован. На Windows-хосте (не контейнере) пути не существуют — это прод-контейнерный инструмент.
- **Строк:** 77

## `backend/app/routers/admin_loyalty.py`

- **Назначение:** Админка расширенной программы лояльности (Bronze/Silver/Gold, Глава 8): каталог наград, заявки пациентов, ручная корректировка баланса, leaderboard, batch дней рождения. Весь роутер gated на модуль `loyalty_pro`.
- **Ключевые элементы:** `router` (prefix `/admin/loyalty`, `dependencies=[require_module("loyalty_pro")]`); guard `_REQUIRE_MANAGER`; схемы `RewardIn`, `RewardPatch`, `AdjustIn`, `ClaimStatusIn`; 8 эндпоинтов.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/loyalty/rewards` | manager+ (loyalty_pro) | — | `{items}` | Каталог наград тенанта |
| POST | `/admin/loyalty/rewards` | manager+ | `RewardIn` | `{id,status}` 201 | Создать награду |
| PATCH | `/admin/loyalty/rewards/{id}` | manager+ | `RewardPatch` | `{id,status}` | Обновить награду |
| DELETE | `/admin/loyalty/rewards/{id}` | manager+ | — | `{status}` | Удалить награду |
| GET | `/admin/loyalty/leaderboard` | manager+ | query `limit` | `{items}` | Топ пациентов по баллам |
| POST | `/admin/loyalty/manual-adjust` | manager+ | `AdjustIn` | `{event_id,delta,...}` | Ручная корректировка баллов |
| GET | `/admin/loyalty/claims` | manager+ | query `status`,`limit` | `{items}` | Заявки на награды |
| PATCH | `/admin/loyalty/claims/{id}/status` | manager+ | `ClaimStatusIn` | `{id,status}` | Сменить статус заявки (возврат баллов при cancel) |
| POST | `/admin/loyalty/birthday-bonus-batch` | manager+ | — | `{awarded,date}` | Начислить бонусы именинникам |

- **Зависимости:** `core.tenant.require_module`; модели `loyalty_ext` (`LoyaltyAccountExt`, `LoyaltyEvent`, `LoyaltyClaim`), `loyalty.LoyaltyReward`, `patient_account.PatientAccount`; сервисы `loyalty_ext_service as ls` (`get_or_create_account`, `adjust_points`, `run_birthday_batch`), `family_service as fs` (`get_account_by_phone`, `get_or_create_account_by_phone`).
- **Где менять для типовых задач:** правила начисления/списания баллов и тиры — в `loyalty_ext_service`, не тут. Поля награды (`min_tier`, `stock`) — модель + `RewardIn`/`RewardPatch` + сериализация в `list_rewards`.
- **Подводные камни:** `min_tier` и `stock` пишутся через `setattr` (строки 137-138) — это «поля новой миграции», в конструкторе `LoyaltyReward(...)` их нет; при чтении используется `getattr(rw, "min_tier", "bronze")`. `discount_percent` — `Decimal` в модели, наружу `float(...)`. При отмене заявки (`status==cancelled`) баллы возвращаются через `ls.adjust_points` ТОЛЬКО если `prev_status != cancelled` (защита от двойного возврата, строки 303-307). tenant-проверка заявки идёт через её account (строки 291-293).
- **Строк:** 324

## `backend/app/routers/admin_regulations.py`

- **Назначение:** Конструктор внутренних регламентов (Глава 7): регламент → версии (draft/published) → назначения (на пользователей/клиники/всех) → отметки прочтения + AI-генератор черновика. Доступ: `franchise_owner` (только свой tenant) + `super_admin` (везде).
- **Ключевые элементы:** `router` (prefix `/admin/regulations`); guard `_require_manage` + helpers `_filter_tenant`, `_get_reg_for_manage`; схемы `StepBody`, `CreateRegulationBody`, `UpdateRegulationBody`, `NewVersionBody`, `AssignmentBody`, `AiGenerateBody`; 11 эндпоинтов.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| POST | `/admin/regulations/ai-generate` | owner/sa | `AiGenerateBody` | dict-черновик | AI-черновик (НЕ сохраняется) |
| DELETE | `/admin/regulations/assignments/{aid}` | owner/sa | — | 204 | Снять точечное назначение |
| GET | `/admin/regulations` | owner/sa | query фильтры+пагинация | `{total,limit,offset,items}` | Список с фильтрами |
| POST | `/admin/regulations` | owner/sa | `CreateRegulationBody` | regulation dict 201 | Создать + draft v1 |
| GET | `/admin/regulations/{id}` | owner/sa | — | regulation dict + versions + assignments | Детали |
| PATCH | `/admin/regulations/{id}` | owner/sa | `UpdateRegulationBody` | regulation dict | Метаданные/статус |
| DELETE | `/admin/regulations/{id}` | owner/sa | — | 204 | Soft-delete (status=archived) |
| POST | `/admin/regulations/{id}/versions` | owner/sa | `NewVersionBody` | version dict 201 | Новая draft-версия |
| POST | `/admin/regulations/{id}/versions/{vid}/publish` | owner/sa | — | `{regulation,version}` | Публикация версии |
| POST | `/admin/regulations/{id}/assignments` | owner/sa | `AssignmentBody` | `[assignment]` 201 | Назначения (пусто = всем) |
| GET | `/admin/regulations/{id}/completions` | owner/sa | query `version_id`,пагинация | `{items,stats}` | Кто прочитал + покрытие % |

- **Зависимости:** `core.deps.get_current_user`; модели `regulation` (`Regulation`, `RegulationVersion`, `RegulationAssignment`, `RegulationCompletion`, `RegulationStatus`, `ALLOWED_STATUSES`); `regulation_ai_service.generate_regulation`; `regulation_service` (`can_manage_regulations`, `is_super_admin`, `create_initial_version`, `create_new_version`, `publish_version`, `count_target_audience`, `*_to_dict`).
- **Где менять для типовых задач:** логика публикации/версионирования — в `regulation_service`, роутер только оркестрирует. Новый статус — `ALLOWED_STATUSES` в модели. Новый тип шага — `StepBody` + рендер на фронте; роутер передаёт `content` как `list[dict]` насквозь.
- **Подводные камни:** ВАЖЕН ПОРЯДОК роутов: `/ai-generate` и `/assignments/{aid}` объявлены ДО `/{regulation_id}` (комментарий на строке 160), иначе FastAPI матчит `ai-generate` как `regulation_id`. tenant-фильтр: `_filter_tenant` для super_admin возвращает запрос без ограничения, для owner без tenant_id даёт заведомо пустой `tenant_id == uuid.UUID(int=0)` (строки 120-127). Публиковать пустую версию нельзя (422, строки 396-399). `updated_at` ставится вручную. Назначение «на всех» = одна запись с `user_id=None, clinic_id=None`.
- **Строк:** 523

## `backend/app/routers/admin_subscription_plans.py`

- **Назначение:** Управление каталогом тарифов подписки пациентов (модуль «Здоровье+»). Глобальные шаблоны immutable после seed; реальное управление — через per-tenant override. Плюс эффективные планы и KPI (MRR/ARPU/churn).
- **Ключевые элементы:** `router` (prefix `/admin/subscription-plans`); module-gate `_require_module` (402 если `health_plus_module` не активен); схемы `PlanFeatures`, `PlanCreateIn`, `PlanPatchIn`, `OverrideIn`; helpers `_count_active`, `_serialize_with_count`, `_global_plans_exist`; 9 эндпоинтов.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/subscription-plans/global` | super_admin | — | `{plans}` | Глобальные шаблоны + кол-во подписчиков |
| POST | `/admin/subscription-plans/global` | super_admin | `PlanCreateIn` | plan dict 201 | Создать ТОЛЬКО до seed (иначе 403) |
| PATCH | `/admin/subscription-plans/global/{id}` | super_admin | `PlanPatchIn` | — | Всегда 403 (immutable) |
| DELETE | `/admin/subscription-plans/global/{id}` | super_admin | — | — | Всегда 403 (immutable) |
| GET | `/admin/subscription-plans/effective` | любой авторизованный | query `tenant_id` | `{tenant_id,plans}` | Эффективные планы (не-sa видит только свой) |
| GET | `/admin/subscription-plans/overrides` | super_admin | query `tenant_id` | `{overrides}` | Все override |
| POST | `/admin/subscription-plans/override` | owner/sa (gated) | `OverrideIn` | plan dict 201 | Upsert override (owner — только свой tenant) |
| PATCH | `/admin/subscription-plans/override/{id}` | owner/sa (gated) | `PlanPatchIn` | plan dict | Изменить override |
| DELETE | `/admin/subscription-plans/override/{id}` | owner/sa | — | 204 | Удалить override |
| GET | `/admin/subscription-plans/kpi` | любой авторизованный | query `tenant_id` | KPI dict | count/MRR/ARPU/churn |

- **Зависимости:** `core.deps` (`require_super_admin`, `get_current_user`; `require_franchise_owner` импортируется, но не используется напрямую — проверка роли ручная); модели `subscription.PatientSubscription`, `subscription_plan.SubscriptionPlan`; сервисы `subscription_plan_service as sps` (`serialize_plan`, `list_global_plans`, `get_effective_plans`, `list_overrides`, `upsert_global/override`, `update_plan`, `delete_plan`), `subscription_module_service.health_plus_module_active`.
- **Где менять для типовых задач:** новый признак тарифа — `PlanFeatures` + рендер; денежные/мерж-операции глобал↔override — в `sps`. Снять immutable с глобальных — `patch_global`/`delete_global` (сейчас хардкод 403). KPI-формулы (ARPU/churn) — внутри `kpi_for_tenant`.
- **Подводные камни:** `price_monthly/annual` — `float` в схемах (НЕ Decimal) — расхождение с остальным кодом; будь осторожен при складывании с Decimal-полями БД. owner может править только `tenant_id == user.tenant_id` (строки 202-203, 231-232, 309-310) — проверка ручная, при добавлении эндпоинта не забудь. Override-операции дополнительно gated через `_require_module` (402). Глобальные планы — `tenant_id IS NULL`; override — `tenant_id IS NOT NULL`.
- **Строк:** 314

## `backend/app/routers/admin_system.py`

- **Назначение:** Системная админка (Глава 10): ручной disaster-mode (super_admin), расширенный health-check (БД/Redis/диск/миграция/подписки/ошибки) БЕЗ авторизации для мониторинга, и cron-функция авто-включения disaster-mode. Экспортирует ДВА роутера.
- **Ключевые элементы:** `router` (prefix `/admin/system`) — disaster-mode; `detailed_router` (БЕЗ prefix, tag `health`) — `/health/detailed`; функция `disaster_health_check()` (cron, не эндпоинт); схема `EnableDisasterIn`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/system/status` | super_admin | — | `{disaster_mode,flag_info,last_migration,timestamp}` | Состояние системы для UI |
| POST | `/admin/system/enable-disaster-mode` | super_admin | `EnableDisasterIn` | `{ok,info}` | Включить disaster-mode |
| POST | `/admin/system/disable-disaster-mode` | super_admin | — | `{ok,info}` | Выключить disaster-mode |
| GET | `/health/detailed` | ПУБЛИЧНО (без auth) | — | health dict | Полный health-check (degraded/ok) |

- **Зависимости:** `core.deps.require_super_admin`; `core.disaster_middleware` (`get_flag_info`, `enable_disaster_mode`, `disable_disaster_mode`, `is_disaster_mode`); `database.AsyncSessionLocal`; `config.settings.redis_url`; stdlib `shutil`/`os`. Cron-функция регистрируется в `main.py` (импорт `disaster_health_check` на строке 194).
- **Где менять для типовых задач:** новая проверка в health — добавляй блок в `health_detailed()` (каждая подсистема в своём `try`, при fail ставит `status="degraded"`). Условия авто-disaster — `disaster_health_check()` (DB unreachable / disk ≥98%). Сам флаг disaster хранится в `disaster_middleware`, не здесь.
- **Подводные камни:** `/health/detailed` ПУБЛИЧНЫЙ — не добавляй сюда чувствительные данные. Health-check читает `/` (диск) и `/app/VERSION` — контейнерные пути, на dev-Windows вернут fail/unknown. `disaster_health_check` авто-снимает флаг ТОЛЬКО если он был поставлен с reason содержащим `"auto:"` (строки 196-199) — ручной disaster сам не снимется. Использует отдельные сессии `AsyncSessionLocal()`, а не DI `get_db`, т.к. часть вызывается из cron.
- **Строк:** 200

## `backend/app/routers/admin_tenant_health.py`

- **Назначение:** Просмотр снимков «здоровья» тенантов (score + alert_level + factors) для super_admin: текущее состояние всех, только алёрты, история по тенанту, пересчёт по запросу.
- **Ключевые элементы:** `router` (prefix `/admin/tenant-health`); helpers `_serialize_snapshot`, `_latest_for_each_tenant`; 4 эндпоинта.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/tenant-health/` | super_admin | — | `List[dict]` | Последний snapshot каждого активного тенанта |
| GET | `/admin/tenant-health/alerts` | super_admin | — | `List[dict]` | Только yellow/red, сортировка red→yellow |
| GET | `/admin/tenant-health/{tenant_id}` | super_admin | — | `{...,current,history[90]}` | Детали + история |
| POST | `/admin/tenant-health/{tenant_id}/recompute` | super_admin | — | snapshot dict 201 | Пересчитать и записать snapshot |

- **Зависимости:** `core.deps.require_super_admin`; модели `tenant.Tenant`, `tenant_health` (`TenantHealthSnapshot`, `TenantHealthAlertLevel`); сервис `tenant_health_service as ths` (`snapshot_tenant`).
- **Где менять для типовых задач:** формула score / факторы / пороги alert_level — в `tenant_health_service.snapshot_tenant`, роутер только читает/сериализует. Поле в snapshot — модель + `_serialize_snapshot`.
- **Подводные камни:** `_latest_for_each_tenant` делает N+1 запросов (по одному snapshot на тенант, цикл строки 58-66) — на большом числе тенантов медленно; кандидат на оптимизацию через `DISTINCT ON`/оконную функцию. `alert_level` может быть как Enum, так и строкой — везде `hasattr(..., "value")`-проверка. История ограничена 90 записями.
- **Строк:** 205

## `backend/app/routers/admins.py`

- **Назначение:** Сборный роутер вокруг сотрудника: личный профиль (`/me`), личная статистика и KPI по направлениям/бонусам, manager-only список сотрудников и их статистика, и модерация заявок на привлечённых врачей.
- **Ключевые элементы:** `router` (prefix `/admins`); эндпоинты `get_me`/`update_me`/`get_my_stats`/`get_my_kpi`/`list_admins`/`get_admin_stats` + блок doctor-requests; локальные хелперы `count_refs`, `sum_bonuses` внутри `get_my_stats`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admins/me` | авторизованный | — | dict профиля + `redirect_url`,`trial_status`,`is_super` | Профиль текущего юзера для шапки/роутинга |
| PATCH | `/admins/me` | авторизованный | `UserUpdate` | `UserResponse` | Обновить свой профиль |
| GET | `/admins/me/stats` | авторизованный | — | dict (this/last/all/today) | Личная статистика по направлениям/бонусам |
| GET | `/admins/me/kpi` | авторизованный | — | dict KPI | Прогресс KPI за текущий месяц |
| GET | `/admins/` | manager | — | `list[UserResponse]` | Список сотрудников тенанта/клиники |
| GET | `/admins/{admin_id}/stats` | manager | — | dict статистики | Статистика конкретного сотрудника |
| GET | `/admins/doctor-requests` | manager | query `status_filter` | `list` | Заявки на привлечённых врачей |
| POST | `/admins/doctor-requests/{id}/approve` | manager | — | `{status,user_id,username,temp_password}` | Одобрить → создать `partner_doctor` |
| POST | `/admins/doctor-requests/{id}/reject` | manager | — | `{status}` | Отклонить заявку |
| GET | `/admins/external-doctors` | manager | — | `list` | External/visiting врачи тенанта |

- **Зависимости:** `core.deps` (`get_current_user`, `require_manager`); модели `user` (`User`, `UserRole`), `referral`, `bonus`, `external_doctor.DoctorRequest`, `kpi_target.KpiTarget`, `tenant.Tenant`, `billing.Subscription`; схемы `user` (`UserResponse`, `UserUpdate`); `services.onboarding_service.trial_status_for`; `core.security.get_password_hash` (с двумя fallback'ами).
- **Где менять для типовых задач:** логика редиректа после логина по роли — `get_me` (строки 45-54). Поля, которые видит фронт в шапке (avatar, email, password_must_change, trial) — добавлять в `get_me`, т.к. `UserResponse` их исторически не сериализует. Создание аккаунта врача при одобрении — `approve_doctor_request`.
- **Подводные камни:** МНОГО локальных `import` внутри функций (datetime, модели) — следствие склейки фич, легко словить теневые импорты (`from datetime import datetime` повторяется). `get_my_stats` использует сырой SQL с `date_trunc('month', ...)` (строки 162-172) — Postgres-специфично, на SQLite-тестах упадёт. `approve_doctor_request` генерит временный пароль `secrets.token_urlsafe(8)` и хэширует с тройным fallback на `get_password_hash` (security→auth→sha256) — sha256-ветка небезопасна, это легаси-страховка. tenant-изоляция в `list_admins` ручная, + доп. фильтр по `clinic_id` если менеджер привязан к клинике.
- **Строк:** 468

## `backend/app/routers/ads.py`

- **Назначение:** Базовый и самый большой роутер рекламы (API v3): CRUD объявлений, публичная выдача активной рекламы с таргетингом по аудитории/расписанию/праздникам, запись событий (impression/click/conversion) с idempotency и frequency-capping, статистика, A/B-варианты, health-check мёртвой рекламы, bulk-операции, AI-генерация текста (Claude), шаблоны.
- **Ключевые элементы:** `router` (prefix `/ads`); общие DI `_feat`/`_mod`/`_mgr`; сериализатор `_ad_out` и `_apply_meta_update` (ПЕРЕИСПОЛЬЗУЮТСЯ другими ads-роутерами); схемы `CreateAdRequest`, `UpdateAdRequest`, `AdEventRequest`, `BulkActionRequest`, `AiGenerateRequest`; хелперы таргетинга `_audience_match`, `_load_viewer_profile`.
- **Эндпоинты (основные):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/ads` | manager | query `status`,`limit` | `[ad]` | Список объявлений тенанта |
| POST | `/ads` | manager (+module) | `CreateAdRequest` | ad dict 201 | Создать объявление |
| GET | `/ads/active` | ПУБЛИЧНО | query `ad_type`,`slug`,`phone`,`session_token` | `[ad]` | Активная реклама для показа (таргетинг) |
| GET | `/ads/{id}/stats` | manager | query `days` | `{ad,series,totals}` | Статистика по дням |
| GET | `/ads/{id}` | manager | — | ad dict | Одно объявление |
| PATCH | `/ads/reorder` | manager (+module) | `[{id,sort_order}]` | `{ok}` | Порядок в карусели |
| PATCH | `/ads/{id}` | manager (+module) | `UpdateAdRequest` | ad dict | Обновить |
| POST | `/ads/{id}/event` | ПУБЛИЧНО | `AdEventRequest` | `{ok,event_id}` | Записать impression/click/conversion |
| POST | `/ads/{id}/duplicate` | manager (+module) | — | ad dict 201 | Дублировать (draft) |
| POST | `/ads/{id}/variant` | manager (+module) | `CreateAdRequest` | `{variant,parent_variant}` 201 | Создать A/B-вариант |
| GET | `/ads/{id}/variants` | manager | — | `[ad]` | Все варианты A/B |
| POST | `/ads/{id}/declare-winner` | manager (+module) | — | `{winner_id,...}` | Определить победителя по CTR |
| GET | `/ads/health-check` | manager | — | `{issues,total}` | Мёртвая реклама |
| POST | `/ads/health-check/auto-pause` | manager (+module) | — | `{paused}` | Авто-пауза мёртвой рекламы |
| POST | `/ads/bulk` | manager (+module) | `BulkActionRequest` | `{affected,action}` | pause/activate/delete пачкой |
| POST | `/ads/ai-generate` | manager | `AiGenerateRequest` | `{variants}` | LLM-генерация текста (Claude) |
| GET | `/ads/templates` | manager | — | `[ad]` | Шаблоны тенанта |
| POST | `/ads/{id}/use-template` | manager (+module) | — | ad dict 201 | Создать из шаблона |

- **Зависимости:** `core.deps.require_manager`; `core.tenant` (`require_feature("billing")`, `require_module("ads_basic","ads_agency")`); модель `advertising` (`Ad`,`AdEvent`,`AdStatus`,`AdType`,`PricingModel`); `services.billing_service` (`create_ad`, `record_ad_event`); `utils.geo.get_client_ip`; для таргетинга — `patient_account`, `mis_client.find_patient_by_phone`, `settings_service.get_setting`, сырой SQL по `ltv_snapshots`/`appointments`; `holidays` (lazy).
- **Где менять для типовых задач:** новое поле объявления — реши, это колонка `Ad` или ключ в `meta`; добавь в `CreateAdRequest`/`UpdateAdRequest`, в создание (строки 218-252), в `_apply_meta_update`-вызовы и в `_ad_out`. Логика таргетинга — `_audience_match` + `_load_viewer_profile`. Биллинг/списание бюджета — частично тут (`/event`, строки 738-752), частично в `billing_service`.
- **Подводные камни:** `_ad_out` и `_mod` ИМПОРТИРУЮТСЯ тремя другими роутерами (`ads_ai`, `ads_analytics`, `ads_workflow`) — менять сигнатуру опасно. В `CreateAdRequest`/`UpdateAdRequest` ДУБЛИРУЮТСЯ поля (`image_data`, `banner_height` объявлены дважды — строки 56-60, 92-96) — pydantic берёт последнее, это копипаст-баг, но безвреден. Деньги: `price`/`budget_total`/`spent_total` — `Decimal`, при записи `Decimal(str(...))`, наружу `float(...)`; CPM-списание делит на `Decimal("1000")`. Idempotency и frequency-cap в `/event` через сырой SQL по `meta->>'idempotency_key'` и `ip_hash` (sha256 ip+date) — Postgres-специфично. `/active` и `/event` ПУБЛИЧНЫЕ (без auth) — фильтрация по `approval_status=="approved"` и расписанию идёт в коде. Праздники РФ через lazy-import `holidays` с кэшем по году.
- **Строк:** 1132

## `backend/app/routers/ads_ai.py`

- **Назначение:** Дополнительный ads-роутер (Phase C): AI-генерация картинок по prompt, поиск стоков (Unsplash), безопасное превью подстановки переменных, bulk-создание draft-объявлений разной тональности, посев стартовых шаблонов. Тот же prefix `/ads`.
- **Ключевые элементы:** `router` (prefix `/ads`, tag `ads-ai`); схемы `AIImageRequest`, `SubstitutePreviewRequest`, `BulkGenerateRequest`; константы `_TONE_TITLES`, `DEFAULT_TEMPLATES`; хелпер `_tone_body`; 5 эндпоинтов.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| POST | `/ads/ai-image` | manager (+module) | `AIImageRequest` | image url dict | URL картинки по prompt |
| GET | `/ads/stock-search` | manager (+module) | query `q`,`page` | `{items}` | Поиск стоков Unsplash |
| POST | `/ads/substitute-preview` | manager (+module) | `SubstitutePreviewRequest` | `{text,allowed_vars}` | Превью подстановки (ctx ограничен ALLOWED_VARS) |
| POST | `/ads/bulk-generate` | manager (+module) | `BulkGenerateRequest` | `{items,count}` | N draft-объявлений по услуге |
| POST | `/ads/templates/seed` | manager (+module) | — | `{created,skipped,items}` | Посев стартовых шаблонов (идемпотентно) |

- **Зависимости:** `core.deps.require_manager`; `app.routers.ads._ad_out`, `app.routers.ads._mod` (ПРЯМОЙ импорт из ads.py — строка 21); `services.ads_ai` (`BULK_CTA_VARIANTS`, `bulk_variant_prompts`, `generate_image_url`, `stock_search`); `services.ads_substitute` (`ALLOWED_VARS`, `substitute`); модель `service.Service` (lazy import для резолва имени/цены).
- **Где менять для типовых задач:** тональности и заготовки текста — `_TONE_TITLES` + `_tone_body` (тут, серверные шаблоны вместо LLM, чтобы не таймаутить). Стартовые шаблоны — `DEFAULT_TEMPLATES`. Логика Unsplash/картинок — в `services.ads_ai`.
- **Подводные камни:** жёстко связан с `ads.py` через импорт `_ad_out`/`_mod` (явно отмечено в докстринге «не трогаем его»). `bulk-generate` СОЗНАТЕЛЬНО не вызывает LLM (заготовки), чтобы избежать таймаутов без `ANTHROPIC_API_KEY` — за AI-текстом фронт идёт отдельно в `/ads/ai-generate`. Шаблон = `Ad(status=DRAFT, meta.is_template=true)` — та же конвенция, что в `ads.py`. `templates/seed` идемпотентен: если шаблоны уже есть, ничего не создаёт.
- **Строк:** 275

## `backend/app/routers/ads_analytics.py`

- **Назначение:** Дополнительный ads-роутер (Phase A): расширенная аналитика по объявлениям — сравнение нескольких ads по метрике, воронка, heatmap по часам/дням, прогноз, список последних конверсий с time-to-convert. Тот же prefix `/ads`.
- **Ключевые элементы:** `router` (prefix `/ads`, tag `ads-analytics`); helper `_get_ad_or_404`; 5 эндпоинтов; делегирование в `services.ads_analytics`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/ads/compare` | manager (+module) | query `ids`,`metric`,`days` | `{metric,days,series}` | Сравнить до 8 ads по метрике |
| GET | `/ads/{id}/funnel` | manager (+module) | — | funnel dict | Воронка по объявлению |
| GET | `/ads/{id}/heatmap` | manager (+module) | query `event_type`,`days` | `{cells}` | Heatmap активности |
| GET | `/ads/{id}/forecast` | manager (+module) | — | forecast dict | Прогноз |
| GET | `/ads/{id}/conversions` | manager (+module) | query `limit` | `{items,count}` | Последние конверсии + days_to_convert |

- **Зависимости:** `core.deps.require_manager`; `app.routers.ads._mod`; модели `advertising` (`Ad`,`AdEvent`,`AdEventType`), `referral.Referral`; `services.ads_analytics` (`funnel_for_ad`, `heatmap_for_ad`, `forecast_for_ad`).
- **Где менять для типовых задач:** новая метрика в `/compare` — добавь в whitelist (строка 43) и в маппинг типа события (строки 63-69). Алгоритмы воронки/heatmap/forecast — в `services.ads_analytics`, тут только валидация + вызов.
- **Подводные камни:** `/compare` строго проверяет, что найдено РОВНО столько ads, сколько передано id (строка 58) — иначе 404. `days_to_convert` в `/conversions` считается через корреляцию по `ip_hash` (первый click ≤ время конверсии, строки 143-156) — может быть None если нет ip_hash. `revenue` агрегируется как `float`. tenant-изоляция через `_get_ad_or_404`.
- **Строк:** 172

## `backend/app/routers/ads_workflow.py`

- **Назначение:** Дополнительный ads-роутер (Phase D): workflow согласования объявлений (approve/reject), список ожидающих, шаринг объявлений между филиалами одной франшизы, фильтр по тегам. Тот же prefix `/ads`.
- **Ключевые элементы:** `router` (prefix `/ads`, tag `ads-workflow`); helper `_get_ad_in_tenant`; схемы `ApproveRequest`, `RejectRequest`, `ShareRequest`; 6 эндпоинтов.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| POST | `/ads/{id}/approve` | director/owner+ | `ApproveRequest` | ad dict | Одобрить объявление |
| POST | `/ads/{id}/reject` | director/owner+ | `RejectRequest` (note обязателен) | ad dict | Отклонить (active→paused) |
| GET | `/ads/pending-approval` | manager (+module) | query `limit` | `[ad]` | Объявления на согласовании |
| GET | `/ads/franchise-siblings` | manager (+module) | — | `[{id,name,slug}]` | Филиалы той же франшизы |
| POST | `/ads/{id}/share` | manager (+module) | `ShareRequest` | ad dict | Копировать в другой филиал |
| GET | `/ads/by-tags` | manager (+module) | query `tags` | `[ad]` | Объявления по тегам |

- **Зависимости:** `core.deps` (`get_current_user`, `require_manager`, `require_director_or_owner`); модели `advertising` (`Ad`,`AdStatus`), `tenant.Tenant`, `user`; `app.routers.ads._mod`, `app.routers.ads._ad_out`.
- **Где менять для типовых задач:** статусы согласования (`approved`/`rejected`/`pending`) — строковые поля `Ad.approval_status`; логика перевода статуса при reject — `ad_reject`. Правила «филиал той же франшизы» — через `Tenant.franchise_id` в `franchise_siblings`/`share_ad`.
- **Подводные камни:** approve/reject требуют `require_director_or_owner` (строже, чем manager). share работает ТОЛЬКО внутри одной `franchise_id` (двойная проверка: текущий тенант в франшизе + target — sibling, строки 164-173); копия получает `share_origin_ad_id=src.id`. При `activate=True` копия становится `active`+`pending` (требует повторного approval в новом филиале). `/by-tags` использует postgres-специфичный JSONB-оператор `?|` (`Ad.tags.op("?|")(tag_list)`, строка 229) — на SQLite не работает.
- **Строк:** 236

## `backend/app/routers/ai.py`

- **Назначение:** AI-аналитика клиники для менеджера через OpenAI-совместимый API. 11 типов анализа (обзор, услуги, сотрудники, клиники, бонусы, прогноз, аномалии, нагрузка, оптимизация, ROI), произвольный вопрос, история в БД, управление конфигом/моделями (super_admin), баланс провайдера.
- **Ключевые элементы:** `router` (prefix `/ai`); DI `_feat`/`_mod`/`_mgr`; конфиг-файл `/app/uploads/ai_config.json` (`_load_config`/`_save_config`/`_get_provider_settings`); `_openai_call`; сборщики статистики `_gather_*` (base/service/staff/clinic/bonus/daily/bonus_roi); словарь `ANALYSIS_PROMPTS`; история `_save_to_history_db`/`_load_history_db`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/ai/config` | super_admin | — | `{config,configured}` | Прочитать конфиг провайдера |
| POST | `/ai/config` | super_admin | `AIConfigRequest` | `{ok,message}` | Сохранить конфиг |
| GET | `/ai/models` | super_admin | — | `{models,selected,provider}` | Список моделей провайдера |
| GET | `/ai/history` | manager (feat+mod) | query `limit` | `{history}` | История анализов тенанта |
| GET | `/ai/balance` | manager | — | balance dict | Баланс/использование провайдера |
| GET | `/ai/analyze` | manager (feat+mod) | query `type`,`days` | анализ dict | Запустить анализ выбранного типа |
| POST | `/ai/ask` | manager (feat+mod) | `AskRequest` | `{question,answer,model}` | Произвольный вопрос по данным |
| GET | `/ai/types` | авторизованный | — | `{types}` | Метаданные типов анализа для фронта |

- **Зависимости:** `core.deps` (`get_current_user`, `require_manager`, `require_super_admin`); `core.tenant` (`require_feature("analytics")`, `require_module("ai_analytics_basic","ai_analytics_pro")`); `httpx`; модели `referral`, `user`, `clinic`, `ai_history.AIAnalysisHistory` (lazy-импорты внутри функций); много СЫРОГО SQL по `referrals/services/users/clinics/bonuses`.
- **Где менять для типовых задач:** новый тип анализа — добавь ключ в `ANALYSIS_PROMPTS` (title/icon/system/user_tmpl) + при необходимости ветку формирования `user_msg` в `analyze` + сборщик `_gather_*`; `ALL_ANALYSIS_TYPES` и regex query соберутся автоматически из ключей словаря. Сменить провайдера/модель — через `/ai/config` (хранится в файле, НЕ в БД).
- **Подводные камни:** конфиг провайдера — ФАЙЛ `/app/uploads/ai_config.json` (volume-mounted), не БД и не env — на dev-Windows пути нет. `_openai_call` бьёт в `{base_url}/chat/completions` с `Authorization: Bearer` — это generic OpenAI-формат, не Anthropic (в отличие от `ads.py`, который зовёт Anthropic напрямую). История ограничена `HISTORY_MAX=30` записями на тенант, старые удаляются при сохранении. Все `_gather_*` — сырой SQL с `date_trunc`/`EXTRACT(DOW...)`/`status::text` → Postgres-специфично, на SQLite упадёт. `/ai/analyze` использует `regex=` в Query (deprecated в новых pydantic, но работает). Если AI не настроен — 501 `ai_not_configured`.
- **Строк:** 932

## `backend/app/routers/ai_assistant.py`

- **Назначение:** AI-ассистент пациенту через Gemini (W6): публичные эндпоинты для PatientCabinet (по session-токену, gated модулем `ai_assistant`) и менеджерские (просмотр/перехват диалогов). Эскалация диалога создаёт сообщение в Support Chat. Экспортирует ДВА роутера.
- **Ключевые элементы:** `router` (БЕЗ prefix — публичные пути `/patient-portal/ai/...`); `admin_router` (БЕЗ prefix, `dependencies=[require_module("ai_assistant")]`, пути `/admin/ai/...`); дефолты `DEFAULT_MODEL`/`DEFAULT_MAX_PER_DAY`/`DEFAULT_SYSTEM_PROMPT`; схемы `StartConversationBody`/`SendMessageBody`/`ConversationOut`/`MessageOut`; хелперы `_tenant_by_slug`, `_module_config`, `_ensure_module_active`, `_patient_session_or_401`, `_history_for_llm`, `_create_support_chat_message`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| POST | `/patient-portal/ai/conversations` | пациент (session `t`) | `StartConversationBody` | conv dict | Создать/вернуть активный диалог |
| POST | `/patient-portal/ai/conversations/{id}/messages` | пациент (session `t`) | `SendMessageBody` | `{text,escalated,conversation_id}` | Сообщение → ответ Gemini |
| GET | `/patient-portal/ai/conversations/{id}/messages` | пациент | query `limit`,`offset` | `{conversation,messages}` | История (для рендера чата) |
| POST | `/patient-portal/ai/conversations/{id}/escalate` | пациент | — | `{ok,status}` | Перевести на менеджера |
| GET | `/admin/ai/conversations` | manager (module) | query фильтры | `{items,total}` | Список диалогов тенанта |
| GET | `/admin/ai/conversations/{id}/messages` | manager (module) | — | `{conversation,messages}` | Полная история (менеджер) |
| POST | `/admin/ai/conversations/{id}/take` | manager (module) | — | `{ok,status}` | Менеджер берёт диалог в работу |

- **Зависимости:** `core.deps` (`get_current_user`, `require_manager`); `core.tenant.require_module`; модели `ai_assistant` (`AiConversation`,`AiMessage`), `commercial` (`CommercialModule`,`ModuleStatus`,`TenantModuleSubscription`), `tenant.Tenant`, `patient_chat.*` (lazy); `services.gemini_service.chat_completion`; `utils.phone.normalize_phone`; `app.routers.patient._restore_session` (валидация сессии).
- **Где менять для типовых задач:** модель/лимит/системный промпт ассистента — берутся из `config_schema` модуля `ai_assistant` через `_module_config`, иначе из `DEFAULT_*` (строки 49-57). Логика вызова LLM — `services.gemini_service`. Эскалация в Support Chat — `_create_support_chat_message`.
- **Подводные камни:** ОБА роутера БЕЗ prefix — реальные пути берутся целиком из декораторов; докстринг пишет `/api/...`, это фронтовый путь. **БАГ:** в `list_messages_public` (строка 409) и `escalate_public` (строка 439) вызывается `_patient_session_or_401(t, db)`, но параметр `t` НЕ объявлен в сигнатуре функции → `NameError` при вызове (в `list_messages_public` нет `t: str = Query(...)`, в `escalate_public` нет ни `t`, ни body). Эти два эндпоинта в текущем виде упадут — кандидат на фикс. Дневной лимит сообщений считается по `role=='user'` за сегодня (429 при превышении). Безопасность: phone из body/conv сверяется с phone из session (403 при расхождении). Активность модуля проверяется по `TenantModuleSubscription` со статусами ACTIVE/TRIAL/GRACE (402 иначе).
- **Строк:** 573
