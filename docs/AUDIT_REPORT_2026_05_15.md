# Аудит «КлиникСеть» — 2026-05-15

**Сервер:** 212.57.118.126 (Moscow, fvds.ru) · **Проект:** `/opt/clinika/`
**Версия:** 1.0.0 · **HEAD:** `14c81e3` (fix monitoring health)
**Тип аудита:** глубокий + smoke-тест взаимодействий + проверка готовности к
складскому модулю и Director-кабинету

---

## TL;DR

🟢 **Прод работает стабильно.** Все 9 контейнеров healthy. Бэкап делается
ежедневно. SSL валиден. coturn/WebRTC отзываются. Память/диск с запасом.

🔴 **3 P0-блокера для прода:** Offsite-бэкап не настроен (rclone), iptables в
ACCEPT (нет фильтра), FTP-21 открыт наружу.

🟠 **2 P1:** в `domain_router.py` 5 импортов `async_session` из несуществующего
модуля (ImportError в логах), LTV-polling валит внешний MIS клиники `arc` со
500-ками каждый запуск.

🟢 **Готовность к новым модулям:** `inventory_*` таблицы пустые (0 записей) —
идеальное состояние для первичной заливки из 1С через будущий импорт.
3 новых плана записаны в `docs/`.

---

## 1. Инфраструктура

| Параметр | Значение | Статус |
|---|---|---|
| Uptime | 3 дня 9 часов | ✅ |
| Load avg (1/5/15 min) | 0.03 / 0.12 / 0.15 | ✅ |
| Память (used / total) | 2.2 / 3.7 Gi (1.5 Gi free + 1.6 buff) | ✅ |
| Swap | 0 B (отсутствует) | ⚠ при пике может стать тесно |
| Диск `/` | 25 / 59 GB (44%) | ✅ |
| Docker disk | 7.27 GB images, 313 MB volumes | ✅ |
| Top CPU process | uvicorn 1% (backend), grafana 1.1% | ✅ |
| Top MEM process | mysqld 11.2% (legacy!), backend 7.3% | ⚠ mysqld — не наш, ISPmgr |

## 2. Docker-сервисы

| Контейнер | Статус | Порт |
|---|---|---|
| clinika-backend | ✅ healthy (41h) | 127.0.0.1:8900 |
| clinika-frontend | ✅ healthy (36h) | 127.0.0.1:8901 |
| clinika-db | ✅ healthy (3d) | 5432 |
| clinika-redis | ✅ healthy (3d) | 6379 |
| clinika-bot | ✅ healthy (3d) | – |
| clinika-docker-proxy | ✅ (3d) | – |
| grafana | ✅ healthy | 127.0.0.1:3002 |
| prometheus | ✅ healthy | 127.0.0.1:9090 |
| postgres-exporter | ✅ healthy | 9187 |

> Backend перезапущен 41h назад — нормально. Frontend 36h — после правок
> Landing/config.js (в git status видно uncommitted изменения).

## 3. База данных

| Параметр | Значение |
|---|---|
| Таблиц в `public` | 148 |
| Размер БД | 32 MB |
| Активных подключений | 1 |
| Alembic head | `franchisebonusfee01` (применён) |
| Активных тенантов | **6** |

**Тенанты:**
- `arc` — СклифЛаб (продакшен, реальный клиент)
- `arc-head` — АРЦ Грозный (главная)
- `ks-achkhoy` — КС Ачхой-Мартан
- `ks-sernovodsk` — КС Серноводск
- `ks-neomed` — КС НЕОМЕД (Грозный)
- `default` — КлиникаСеть (системный)

**Топ-5 таблиц по размеру:**
1. `services` — 8.0 MB / 7813 rows
2. `patient_ltv_snapshots` — 3.4 MB / 7089
3. `refresh_tokens` — 544 KB / 589
4. `wiki_pages` — 208 KB / 0
5. `audit_log` — 176 KB / 20

## 4. Inventory модуль — состояние

```
inventory_items     : 0
inventory_stocks    : 0
inventory_movements : 0
```

**REST API работает** (роутер `/inventory` зарегистрирован, требует
`require_module('inventory')`). Готов к расширению по плану
[INVENTORY_COST_PLAN.md](INVENTORY_COST_PLAN.md).

**Что есть в фундаменте:**
- Модели: `InventoryItem`, `InventoryStock`, `InventoryMovement` + enum
  `InventoryCategory`, `InventoryMovementType`
- Эндпоинты: CRUD items + CSV-импорт, stocks с инвентаризацией, movements
  (income/outgoing/transfer/write-off), alerts (low-stock + expiring)
- Атрибуты item: `sku, name, category, unit, barcode, vendor, cost_per_unit,
  min_stock_threshold, expiry_tracked, photo_url`

## 5. Calls / WebRTC

| Проверка | Результат |
|---|---|
| coturn (TURN) | ✅ active |
| `/presence/ice-config` | HTTP 200, 8 мс |
| WebSocket `/presence/ws` | HTTP/2 200 (ответил handshake) |
| UDP 3478 | ✅ слушает (212.57.118.126:3478) |

Стек звонков работоспособен. Известный баг прокси WhatsApp в Calls 1.0.16
исправлен (текущая версия у клиента 1.0.28 — см. диалог по диагностике).

## 6. Безопасность

| Проверка | Результат | Статус |
|---|---|---|
| SSL `клиниксеть.рф` | до 6 июля 2026 | ✅ |
| HSTS | `max-age=31536000; includeSubDomains` | ✅ |
| CSP | настроена строго | ✅ |
| X-Frame-Options | `SAMEORIGIN` | ✅ |
| X-Content-Type-Options | `nosniff` | ✅ |
| Referrer-Policy | `strict-origin-when-cross-origin` | ✅ |
| **iptables INPUT** | **policy ACCEPT, нет фильтрации** | 🔴 P0 |
| **ufw** | `Status: inactive` | 🔴 P0 |
| **FTP-21 наружу** | `*:21` слушает на всех интерфейсах | 🔴 P0 |
| Открыты наружу | 22, 25, 80, 110, 143, 443, 465, 587, 993, 995, 1500, 1501, 3478, 18080 | ⚠ много (часть от ISPmgr) |

**Открытые порты — расшифровка:**
- 22 (SSH), 80/443 (web) — нужны
- 25/465/587/110/143/993/995 — почтовый сервер (ISPmgr)
- 1500/1501 — ISPmgr сам
- 3478 — TURN, нужен
- 18080 — Telegram proxy (используется ботом)
- **21 — FTP, скорее всего не используется → закрыть**

## 7. Бэкапы

| Параметр | Значение |
|---|---|
| Расписание | ежедневно 03:00 (cron) | 
| Последний бэкап | **2026-05-15 03:00** (1.0 MB БД, 252 KB uploads, 24 KB configs) |
| Шифрование | GPG ✅ |
| Глубина (видно в daily/) | 6 дней (10-15.05) |
| **Offsite (rclone)** | **❌ не настроен (RCLONE_REMOTE пуст)** |
| Restore-test | weekly (вс 04:00) — `test-restore.sh` |

> **Критично:** локальные бэкапы есть, но при потере сервера потеряем всё.
> Нужен rclone на Yandex Object Storage / S3 / Selectel.

## 8. Ошибки и логи

### Backend — реальные ошибки за 24h

🟠 **`ImportError: cannot import name 'async_session' from 'app.database'`**
- 5 импортов в `/opt/clinika/backend/app/core/domain_router.py`
  (строки 38, 45, 64, 71, 113)
- Должно быть `AsyncSessionLocal` или `get_async_session()` — нужно поправить
- При обращении к этим веткам кода → 500-я

🟠 **LTV polling `tenant=arc, mis_clinic=1`** → внешний MIS отдаёт 500:
```
https://mis.stoclinic.ru:3010/api/public/getAppointments
```
- Каждый запуск джоба пишет ошибку в лог за ~8 окон по 90 дней (= 8 ошибок)
- Внешняя проблема (не наш сервер), но засоряет логи и реальный LTV не считается
- Решение: либо чинить на стороне stoclinic.ru, либо ставить retry/circuit-breaker

### Nginx 5xx за 24h
- За последние сутки **значимых 5xx нет** (по выборке access.log)

## 9. Тестирование точек интеграции

| Сценарий | Результат |
|---|---|
| GET `https://клиниксеть.рф/` (Landing) | 200, ~240 мс |
| GET `/monitoring/health` | 200 (но возвращает SPA, нужно проверить как точно настроен endpoint) |
| GET `/presence/ice-config` | 200, 8 мс |
| WS `/presence/ws` handshake | 200 |
| API `/arc/api/auth/login` | работает (по логам клиентов) |
| TG-бот `clinika-bot` (контейнер) | healthy 3 дня |

## 10. Незакоммиченные изменения в Git

```
 M .env
 M frontend/src/config.js
 M frontend/src/pages/Landing.jsx
?? docs/DIRECTOR_CABINET_PLAN.md      (новый)
?? docs/INVENTORY_COST_PLAN.md         (новый)
?? docs/ONEC_INTEGRATION_PLAN.md       (новый)
```

→ Рекомендуется закоммитить с явными сообщениями (`.env` — отдельно как
секрет, не пушить).

---

## 11. План работ (3 новых документа)

В рамках сессии разработаны и положены в `docs/`:

1. **[DIRECTOR_CABINET_PLAN.md](DIRECTOR_CABINET_PLAN.md)** — кабинет директора
   (read-only финансовая отчётность сети). 5 этапов, ~12-18 дней.
2. **[INVENTORY_COST_PLAN.md](INVENTORY_COST_PLAN.md)** — складской учёт с FIFO,
   нормативы услуг, автосписание при `appointment.completed`, себестоимость
   приёма, ФОТ. 6 этапов, ~14-20 дней.
3. **[ONEC_INTEGRATION_PLAN.md](ONEC_INTEGRATION_PLAN.md)** — двухсторонняя
   синхронизация с 1С. **Этап 0 — импорт Excel/CSV из 1С** (3-5 дней,
   self-contained). Дальнейшие этапы 1-3 — экспорт и реалтайм-обмен.

> **Все три плана базируются на существующих моделях/таблицах** — не
> дублируют функционал, расширяют. Особенно важно для inventory: построим
> поверх готовых `inventory_items`, `inventory_stocks`, `inventory_movements`.

---

## 12. Сводный список задач

### 🔴 P0 (блокеры прода)
1. Настроить **offsite-бэкап** (rclone → Yandex Object Storage)
2. Включить **ufw / iptables** с whitelist (22 / 80 / 443 / 3478 / 18080 / 25 / 465 / 587)
3. **Закрыть FTP-21** (или подтвердить нужду)

### 🟠 P1
4. Починить `domain_router.py` — `async_session` → `AsyncSessionLocal`
5. Добавить retry/circuit-breaker для LTV-poll'a `stoclinic.ru` или связаться с их IT
6. Закоммитить uncommitted изменения (.env — отдельно, не пушить)

### 🟢 Запуск разработки новых модулей
7. Стартовать **Этап 0 ONEC_INTEGRATION** — импорт Excel из 1С (immediate value)
8. Стартовать **Этап 1 INVENTORY_COST** — партии + FIFO (фундамент)
9. Параллельно **Этап 1 DIRECTOR_CABINET** — каркас роли + миграция

---

## 13. Метрики (для сравнения с прошлым аудитом 2026-05-12)

| Параметр | 12.05 | 15.05 | Δ |
|---|---|---|---|
| Готовность к прода | 92% | ~93% | +1% |
| Таблицы БД | 141 | **148** | +7 |
| Размер БД | n/a | 32 MB | – |
| Активные тенанты | n/a | 6 | – |
| Backups в daily/ | 5 | 6 | +1 |
| Open P0 | 3 (Sentry/SMTP/YooKassa) | 3 (rclone/firewall/FTP) | ~ |

---

## 14. Что НЕ проверял в этом аудите

- Скорость SQL-запросов (`EXPLAIN ANALYZE` тяжёлых)
- Полный pytest (тесты не запускал — затронуло бы прод)
- Frontend Lighthouse (нужен браузер)
- Сертификаты подписи мобильных приложений (Calls)
- Stress-test (есть отдельные STRESS_REPORT)
- Sentry-quota (нет ключей)

---

**Аудит выполнил:** Claude (Opus 4.7) совместно с Khamzat
**Дата:** 2026-05-15 08:10 MSK
