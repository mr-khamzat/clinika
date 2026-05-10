# Активация модулей

## Каталог модулей

22+ модуля в `commercial_modules`:

| Категория | Модули |
|---|---|
| **Реклама** | `ads_basic`, `ads_agency` |
| **Связь** | `telephony_basic`, `cross_clinic_audio`, `video_calls`, `video_conference`, `call_recording` |
| **AI** | `ai_analytics_basic`, `ai_analytics_pro`, `ai_assistant` |
| **Финансы** | `fiscal_54fz_pro`, `online_payments_pro`, `ltv_pro` |
| **Маркетинг** | `sms_marketing` |
| **Операционка** | `inventory`, `loyalty_pro` |
| **Интеграции** | `mis_sync`, `white_label`, `webhooks` |
| **Здоровье** | `telemedicine`, `health_apple`, `health_google` |

## Marketplace

В кабинете franchise_owner — раздел **«Маркетплейс»**:
- Сетка карточек со скриншотами, описаниями, фичами
- Кнопки «Начать триал 14 дней» / «Купить» / «Отписаться»
- Фильтры по категории и статусу

## Триал-период

При нажатии «Начать триал»:
- Создаётся `TenantModuleSubscription` со `status=trial`
- `trial_ends_at = now() + default_trial_days` (обычно 14)
- За 3 дня до окончания — Telegram-алерт
- При окончании — `module_expiry` cron переводит в `expired`

Повторный триал на тот же модуль **запрещён**.

## Активация

После триала или оплаты:
- `POST /marketplace/tenant/{id}/modules/{key}/activate`
- `status=active`
- В `BillingLedger` ежемесячное списание подписки

## Health-check

Каждые 30 минут `module_health_check_job` проверяет работу подключённых модулей. См. [Мониторинг модулей и алерты](concepts-monitoring).

## RBAC

В коде модуль защищается через `require_module("module_key")` Depends:
```python
@router.get("/something", dependencies=[Depends(require_module("ads_basic", "ads_agency"))])
async def list_ads(...): ...
```

Если у tenant'а нет активной подписки → 403.

## Кросс-tenant фичи

Некоторые модули требуют активации у обоих tenants (например `cross_clinic_audio` для звонков между разными tenants). Для этого `require_module` проверяет `tenant_module_subscriptions` каждого участника.

## UI gating

Frontend узнаёт о доступных модулях через `GET /tenant/modules-status`:
- Возвращает list of {module_key, status, expires_at, trial_ends_at, grace_until}
- VitalsTab показывает кнопку Apple Health только если `health_apple` активен
- AdminLayout/FranchiseOwnerCabinet навигация фильтруется по активным модулям
