# Партнёрский прайс и бонусы за наружные направления

**Дата:** 2026-05-20
**Автор:** mr-khamzat + Claude
**Статус:** design / approved by user
**Целевой релиз:** TBD

## Контекст и проблема

Сейчас в Clinika при создании любого направления (`POST /referrals`) с услугой, у которой `service.referral_payout > 0` (или fallback `bonus_amount > 0`), функция `_finalize_bonus_and_ledger` (`backend/app/services/referral_service.py:286`) автоматически создаёт `Bonus` автору направления. Проверки "своя клиника / чужая клиника" нет — staff клиники может получить бонус, выписав направление внутри собственной клиники.

Дополнительно UI выбора услуг сейчас плоский — все услуги клиники (после синхронизации МИС Renovatio это тысячи позиций) показываются единым списком, что неудобно для оператора, особенно когда речь идёт о направлении в другую клинику франшизы — там должен быть только короткий «партнёрский прайс».

## Цели

1. Бонусы начислять **только за наружные направления** (`from_clinic_id ≠ to_clinic_id`).
2. Дать владельцу клиники-получателя возможность собрать **партнёрский прайс** — подмножество услуг МИС с собственными выплатами и своими категориями.
3. Сделать UI выбора услуг **зависимым от типа направления** (внутри клиники → весь каталог; в другую клинику → партнёрский прайс этой клиники).
4. Сохранить иммутабельность бонусов: изменение прайса задним числом не должно ретроактивно менять суммы по уже созданным направлениям.

## Не-цели

- Между разными tenant-ами (разные франшизы) видимость партнёрских офферов: пока **не открываем**. Решение отложено до этапа B (cross-franchise marketplace).
- Доработка `external_doctor` flow (внешний врач-агент): остаётся как есть, не пересекается.
- Удаление legacy-полей `Service.visible_for_referrals` / `bonus_amount` / `referral_payout` — будет отдельным cleanup-PR после стабилизации.

## Архитектура

### Модель данных

#### Новая таблица `partner_categories`

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | UUID PK | — |
| `tenant_id` | UUID FK tenants | NOT NULL |
| `clinic_id` | UUID FK clinics | NOT NULL, категория принадлежит клинике-получателю |
| `name` | String(120) | напр. «Премиум-анализы», «УЗИ-комплекс» |
| `sort_order` | Integer | default 0 |
| `is_active` | Boolean | default true |
| `created_at` / `updated_at` | DateTime | — |

**Constraints:** `UNIQUE(clinic_id, name)`.

#### Новая таблица `partner_service_offers`

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | UUID PK | — |
| `tenant_id` | UUID FK tenants | NOT NULL, для франшиз-скоупа |
| `clinic_id` | UUID FK clinics | NOT NULL, клиника-получатель |
| `service_id` | UUID FK services | NOT NULL, исходная услуга из МИС |
| `category_id` | UUID FK partner_categories | NULL допустим |
| `payout_amount` | Numeric(10,2) | сколько получит источник за подтверждённое направление |
| `price_override` | Numeric(10,2) | NULL = взять `service.price`; иначе перебить |
| `is_active` | Boolean | default true |
| `created_by_id` | UUID FK users | — |
| `created_at` / `updated_at` | DateTime | — |

**Constraints:** `UNIQUE(clinic_id, service_id)` — одна услуга = один оффер от клиники.

#### Изменения в `Referral`

Добавить два поля:

| Колонка | Тип | Описание |
|---------|-----|----------|
| `partner_offer_id` | UUID FK partner_service_offers | NULL, ссылка на оффер, по которому начислялся бонус |
| `bonus_snapshot_amount` | Numeric(10,2) | NULL, копия `payout_amount` на момент создания (защита от ретроактивных изменений) |

### Не трогаем

- `Service.bonus_amount`, `Service.referral_payout`, `Service.visible_for_referrals` — остаются как fallback для legacy-данных и обратной совместимости. Удалим отдельным релизом.
- `Service.category` (синхронизируется из МИС) — продолжает быть источником категоризации для внутреннего выбора услуг.

### Видимость партнёрских офферов

Staff клиники A видит партнёрские прайсы всех клиник внутри **того же tenant** (одной франшизы). Cross-tenant visibility закрыта (HTTP 403).

## Логика бонусов

### Охрана при подтверждении направления

В `_finalize_bonus_and_ledger` (`backend/app/services/referral_service.py`) — в самом начале:

```python
is_external = bool(
    referral.from_clinic_id
    and referral.to_clinic_id
    and referral.from_clinic_id != referral.to_clinic_id
)
if not is_external:
    return  # внутреннее направление — Bonus / InterClinicInvoice / RecruiterBonus не создаём
```

### Источник payout

Приоритет:
1. `partner_service_offers.payout_amount` для пары `(referral.to_clinic_id, referral.service_id, is_active=true)` — основной путь.
2. `service.referral_payout` — fallback для legacy.
3. `service.bonus_amount` — крайний fallback.

### Снапшот

При создании Referral (`POST /referrals`):
- Если это cross-clinic направление, ищем `partner_service_offers` по `(to_clinic_id, service_id, is_active=true)`.
- Заполняем `referral.partner_offer_id` и `referral.bonus_snapshot_amount = offer.payout_amount`.

При подтверждении (`PATCH /referrals/{id}/confirm`):
- `_finalize_bonus_and_ledger` берёт сумму бонуса из `referral.bonus_snapshot_amount`, если он не NULL. Иначе — из текущего `service.referral_payout` / `bonus_amount` (для legacy-направлений).

Результат: владелец прайса может задним числом менять payout, ранее созданные направления получают изначальный бонус.

## API

Новый роутер `backend/app/routers/partner_offers.py`.

### Партнёрские офферы

| Метод | Path | Доступ | Описание |
|-------|------|--------|----------|
| `GET` | `/clinics/{clinic_id}/partner-offers` | staff внутри tenant | список активных офферов клиники-получателя; для UI Picker |
| `GET` | `/clinics/me/partner-offers` | owner/manager | свои офферы (вкл. неактивные) для админки |
| `POST` | `/clinics/me/partner-offers` | owner/manager | создать оффер (или bulk: список service_id с общим payout/category) |
| `PATCH` | `/clinics/me/partner-offers/{id}` | owner/manager | payout, category, is_active, price_override |
| `DELETE` | `/clinics/me/partner-offers/{id}` | owner/manager | soft delete (`is_active=false`) если есть ссылающиеся referrals; иначе hard delete |

### Категории

| Метод | Path | Доступ | Описание |
|-------|------|--------|----------|
| `GET` | `/clinics/me/partner-categories` | owner/manager | список своих категорий |
| `POST` | `/clinics/me/partner-categories` | owner/manager | создать |
| `PATCH` | `/clinics/me/partner-categories/{id}` | owner/manager | name / sort_order / is_active |
| `DELETE` | `/clinics/me/partner-categories/{id}` | owner/manager | hard delete; офферы внутри сохраняются с `category_id=NULL` |

### Изменения существующих endpoints

`POST /referrals`:
- `to_clinic_id` становится обязательным.
- Если `from_clinic_id == to_clinic_id` (внутреннее) — создаём Referral со статусом CREATED, **без** `partner_offer_id`, без `bonus_snapshot_amount`.
- Если cross-clinic + `service_id` не имеет активного `partner_offer` для `to_clinic_id` → **HTTP 422** `"Услуга не входит в партнёрский прайс этой клиники"`.
- Если cross-clinic + оффер есть → заполняем `partner_offer_id`, `bonus_snapshot_amount`.

## UI

### Админка владельца клиники — раздел «Партнёрский прайс»

Новый пункт меню `Управление → Партнёрский прайс` с двумя вкладками:

**Вкладка «Категории»** — простой CRUD:
- Таблица: название / sort_order / активна (toggle) / 🗑️.
- Кнопка `+ Категория`.

**Вкладка «Услуги в прайсе»** — таблица офферов:
- Колонки: услуга (название + МИС-код), категория (dropdown), выплата ₽, цена пациенту (override или fallback `service.price`), активна (toggle), 🗑️.
- Кнопка `+ Добавить` → модалка с поиском по каталогу МИС (multi-select до 50 услуг сразу) → bulk-присваивание категории и payout.

### Создание направления — мастер 2 шагов

Заменяет текущую плоскую форму. Можно держать под feature flag для постепенного rollout.

**Шаг 1 — Куда направить:**
- Radio: `🏥 В свою клинику` / `🏢 В другую клинику франшизы`.
- Если выбрана «чужая» → dropdown выбора клиники (только клиники того же tenant).
- Подсказка: «Бонус начисляется только за направления в другие клиники».

**Шаг 2 — Выбор услуги:**

Если «своя клиника»:
- Поиск + Tabs (Услуга / Анализ / Врач).
- Группировка по `service.category` (МИС-категории).
- Показ всех активных услуг клиники (тысячи позиций, поэтому виртуализированный список).

Если «чужая клиника»:
- Поиск по партнёрскому прайсу выбранной клиники.
- Группировка по `partner_categories` этой клиники.
- На карточке услуги: название, цена пациенту, **зелёная плашка «💰 Ваш бонус: +X ₽»**.

**Шаг 3 — Пациент, заметки:** без изменений от текущего флоу.

### Индикатор бонуса в шапке мастера

Зелёный бейдж «Бонус будет начислен» при выборе «чужая клиника». Серый «Без бонуса» при «своя клиника». Помогает оператору понимать, что произойдёт.

### Frontend-компоненты

| Компонент | Тип | Назначение |
|-----------|-----|------------|
| `PartnerOffersAdmin.jsx` | новый, ~300 строк | две вкладки CRUD в админке |
| `CreateReferralWizard.jsx` | рефактор существующего | 2-step wizard |
| `PartnerOfferPicker.jsx` | новый | выбор услуги из партнёрского прайса |
| `InternalServicePicker.jsx` | рефактор существующего ServicePicker | выбор из каталога своей клиники |

## Error handling

| Ситуация | Поведение |
|----------|-----------|
| Cross-clinic referral с service_id вне партнёрского прайса | HTTP 422, текст ошибки на русском |
| Удаление partner_offer, на который ссылается активный Referral | автоматический soft delete (`is_active=false`); hard delete только если ссылок нет |
| Изменение `payout_amount` оффера → старые Referral | не затрагиваются (используется `bonus_snapshot_amount`) |
| Staff клиники A читает `/clinics/B/partner-offers`, B в другом tenant | HTTP 403 |
| Дубликат `partner_categories.name` внутри одной клиники | HTTP 422 (UNIQUE constraint) |
| Дубликат `partner_service_offers (clinic_id, service_id)` | HTTP 422 |
| Бонус за внутреннее направление случайно создан (legacy данные) | не трогаем существующие; охрана работает только для новых подтверждений |

## Тесты (pytest, существующая инфра)

1. `test_bonus_not_created_internal_referral` — `from_clinic_id == to_clinic_id` ⇒ нет Bonus, нет ICI.
2. `test_bonus_created_cross_clinic_with_partner_offer` — payout берётся из `partner_service_offer.payout_amount`.
3. `test_bonus_uses_snapshot_after_offer_payout_changed` — изменение оффера post-factum не меняет начисленный бонус.
4. `test_referral_rejected_if_service_not_in_partner_offers` — HTTP 422.
5. `test_partner_offers_visibility_within_tenant` — staff другой клиники того же tenant видит.
6. `test_partner_offers_visibility_across_tenants_blocked` — HTTP 403.
7. `test_partner_offer_soft_delete_when_referenced` — `is_active=false` вместо физического удаления.
8. `test_partner_categories_crud` + `test_unique_category_name_per_clinic`.
9. `test_bulk_create_partner_offers` — POST со списком service_id.
10. `test_legacy_fallback_when_no_partner_offer` — service.referral_payout используется, если оффера нет (для backward-compat).

## Миграция данных

Alembic migration `partneroffers01`:

1. Создать таблицы `partner_categories`, `partner_service_offers` с indexes.
2. Добавить колонки `partner_offer_id`, `bonus_snapshot_amount` в `referrals`.
3. Одноразовая data migration — перенести существующие услуги с включённым реф-флагом:

```sql
INSERT INTO partner_service_offers (id, tenant_id, clinic_id, service_id, payout_amount, is_active, created_at, updated_at)
SELECT gen_random_uuid(), s.tenant_id, s.clinic_id, s.id,
       COALESCE(s.referral_payout, s.bonus_amount, 0),
       true, NOW(), NOW()
FROM services s
WHERE s.visible_for_referrals = true
  AND COALESCE(s.referral_payout, s.bonus_amount, 0) > 0
  AND s.clinic_id IS NOT NULL
ON CONFLICT (clinic_id, service_id) DO NOTHING;
```

После проверки в production — отдельным cleanup-PR можно дропнуть `visible_for_referrals`, обнулить `bonus_amount` / `referral_payout` (out of scope текущей фичи).

## Rollout plan

1. Backend: миграция + модели + endpoints + охрана бонусов + тесты.
2. Backend: data migration на staging, проверка количества созданных офферов соответствует ожиданиям.
3. Frontend: админка `PartnerOffersAdmin` + Picker-ы; новый Wizard под feature flag.
4. Прод-миграция, прод-релиз backend.
5. Включить feature flag для wizard у тестовой клиники, собрать фидбек.
6. Раскатать на все клиники.
7. Cleanup-PR (отдельно): удаление legacy полей в `services`.

## Открытые вопросы (на будущее)

- Cross-franchise marketplace (между разными tenant-ами) — отдельный дизайн.
- Гибкие правила бонусов («доплачивать только если врач из топа», сезонные кампании) — out of scope.
- Импорт партнёрского прайса из Excel — nice to have, не блокер.
