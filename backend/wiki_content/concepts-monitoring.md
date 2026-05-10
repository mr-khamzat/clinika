# Мониторинг модулей и алерты

## Module Monitoring System

Платформа автоматически проверяет работу каждого подключённого модуля у каждого tenant'а и пишет статус в `module_health_checks`.

### 20 health-check адаптеров

Каждый модуль имеет свою функцию `check_<module>(db, tenant_id)`:

| Модуль | Что проверяет |
|---|---|
| `telemedicine` | Активные сессии за 7 дней |
| `ads_basic` / `ads_agency` | Активные ads + impressions за 24ч |
| `inventory` | Items в каталоге + low-stock алерты |
| `loyalty_pro` | Loyalty accounts с балансом |
| `mis_sync` | Last sync + errors в TenantIntegration |
| `sms_marketing` | Last campaign + delivery rate |
| `cross_clinic_audio` | Call_logs за 24ч + success rate |
| `telephony_basic` | Calls за 24ч |
| `video_calls` / `video_conference` | Видео-сессии |
| `call_recording` | Recordings |
| `ai_analytics_basic` / `ai_analytics_pro` | AI queries |
| `ai_assistant` | Patient AI conversations |
| `fiscal_54fz_pro` | Last receipt sent + OFD errors |
| `online_payments_pro` | Успешные платежи |
| `ltv_pro` | LTV snapshots |
| `white_label` | TenantBranding активен |
| `webhooks` | Endpoint доступен + successful deliveries |
| `health_apple` | Syncs от Apple Health за 7 дней (без iOS-приложения → idle) |
| `health_google` | Syncs от Google Fit за 7 дней (без Android-приложения → idle) |

### Статусы
- ✅ **ok** — модуль работает
- ⚠️ **degraded** — есть проблемы (slow, warnings)
- ❌ **error** — упал, нужно вмешательство
- 💤 **idle** — не используется > N дней (informational)
- ❔ **unknown** — ещё не проверяли

## Cron-задачи

### `module_health_check_job` — каждые 30 минут
Обходит все active tenants → для каждого active модуля вызывает `check_<module>` → обновляет `module_health_checks` → при переходе ok→error/degraded отправляет Telegram-алерт.

### `module_daily_digest_job` — 09:00 МСК
Шлёт админу платформы эмодзи-сводку:
```
🏥 КлиникСеть — daily digest

ARC tenant:
✅ ads (7), ✅ ai (3), 💤 inventory (0), ⚠️ mis_sync, ✅ telemedicine

⚠️ 1 модуль degraded, 7 idle, 0 errors
```

### `integration_retest_job` — каждый час
Ре-тестирует все active `TenantIntegration` (МИС-подключения), обновляет `last_tested_at`. Без этого `mis_sync` показывает degraded при последнем тесте > 1 дня назад.

## Telegram-алерты

Через `alert_service.notify_admin`:
- При переходе модуля в `error` / `degraded` (дедуп 1 час)
- При сломанной cron-задаче
- При недоступности внешнего сервиса (МИС, ОФД, SMTP)
- При финансовых аномалиях

## UI мониторинга

### Для franchise_owner
Раздел «Мониторинг модулей» в FranchiseOwnerCabinet:
- Карточки на каждый модуль с цветным бейджем статуса
- Метрики (calls 24h, errors 24h, last error message)
- Кнопка «Проверить сейчас»
- Auto-refresh каждые 60 сек

### Для super_admin
Раздел «Модули по тенантам» в AdminLayout:
- Heatmap-таблица: строки = tenants, колонки = модули, ячейки = цветные точки
- Top-10 проблемных тенантов
- Фильтр по статусу

## Дополнительный мониторинг

### Uptime-Kuma
- 3 HTTP-монитора: /health, /arc/admin, /api/health
- Heartbeat каждые 60 секунд
- Отдельный сервис на 127.0.0.1:3001

### Prometheus + Grafana
- `postgres-exporter` → метрики БД
- Backend `/metrics` (запланировано prometheus-fastapi-instrumentator)
- Dashboards в Grafana

### Sentry
Код инициализации готов (`backend/app/main.py`). Нужен `SENTRY_DSN` в `.env`.

### pg_stat_statements
Активен в PostgreSQL. Топ slow queries через:
```sql
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC LIMIT 10;
```

## Текущие p-метрики (production)

- **p50**: 52 мс
- **p95**: 235 мс
- **p99**: 540 мс
- **5xx errors**: 0% (за 24 часа)
- **Total requests**: 17 184 / 24 часа
