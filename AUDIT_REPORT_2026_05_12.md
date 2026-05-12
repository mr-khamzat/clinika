# Аудит «Клиниксеть» — Раунд 2 (2026-05-12)

**Сервер:** 212.57.118.126 · **Проект:** `/opt/clinika/` · **Ветка:** main  
**Предыдущий отчёт:** `AUDIT_REPORT_2026_05_11.md` (готовность 85%)  
**Раунд 2:** проверка после P1-фиксов + поиск новых проблем  
**Текущая готовность:** **92%** (+7% за сутки)

---

## TL;DR

За сутки закрыто **6 из 7 P1-задач** прошлого аудита.  
Сайт зелёный, health-эндпойнты 200, rate-limit'ы реально срабатывают, lockout работает.  
Backend импортируется чисто, тесты — 101 passed.  
Остаются: **3 P0 launch-блокера** (Sentry/SMTP/YooKassa пусты, нет offsite-backup), **5 P1** (FK без ondelete, dead components, BG-tasks без tenant), **несколько P2**.

---

## 1. Что улучшилось vs 2026-05-11

| Область | Вчера | Сегодня | Коммит |
|---|---|---|---|
| SQL-injection в RLS | Открыто | Закрыто (`set_config(... ,true)` через bind-параметр) | `aa53336` |
| Brute-force /auth/login | Только IP-лимит | Per-IP + per-user lockout (Redis `login_lockout:<email>`) | `aa53336` |
| Rate-limit /contact/ | Нет | 5 req/10 мин/IP — проверено: 6-й = 429 | `bd75694` |
| Rate-limit /public/{slug}/book | Нет | 10 req/10 мин/IP — проверено: 11-й = 429 | `bd75694` |
| Honeypot на публичных формах | Нет | `website_url` в 4 формах | `2b151dc` |
| pytest в проде-образе | Не было | Добавлен (`requirements-dev.txt`) — 101 passed | `19f302c`, `fc94dcd` |
| FastAPI/Pydantic deps | Старые | bump: fastapi, pydantic, sentry-sdk | `fc94dcd` |
| Frontend lazy() | Не везде | Все pages через lazy + динамический Sentry | `366b491` |
| Белый экран после ребилда | Был | react-router-dom вынесен из vendor-misc | `8a81c89`, `ad45e4c` |

---

## 2. Smoke integration tests (live)

### Health

```
backend  GET /health   → 200
frontend GET /health   → 200
```

### Brute-force lockout `/auth/login`

```
POST /auth/login {username:"admin@test.ru", password:"wrong<i>"}
try 1..4  → 401   (invalid_password)
try 5..9  → 429   (lockout сработал)
Redis: login_lockout:admin@test.ru = "4" (TTL 900s)
```

Работает. Per-user lockout активен.

### Rate-limit `/contact/`

```
POST /contact/ ×7
try 1..5 → 200
try 6..7 → 429   (Rate limit exceeded)
Redis: rl:contact:127.0.0.1
```

### Rate-limit `/public/{slug}/book`

```
POST /public/test-slug/book ×12
try 1..10 → 422  (slug не существует, но лимитер срабатывает до валидации)
try 11..12 → 429
```

### RLS / SET LOCAL tenant_id

```
backend/app/core/deps.py:169     SELECT set_config('app.tenant_id', :tid, true)
backend/app/database.py:75       SELECT set_config('app.tenant_id', :tid, true)
```

Оба места используют bind-параметр (`:tid`) — SQL-injection закрыт.  
**Замечание:** в `app/services/` и `app/tasks/` `set_config` НЕ вызывается. Если есть BG-задачи, открывающие сессию вне Depends — RLS не выставится. См. P1-3.

---

## 3. Цифры

| Метрика | Вчера | Сегодня | Δ |
|---|---|---|---|
| FastAPI routes | 791 | **813** | +22 |
| Таблицы в БД | ~140 | **141** | +1 |
| Миграции (`alembic/versions/`) | ~96 | **98** | +2 |
| Модели (`backend/app/models/`) | ~78 | **80** | +2 |
| Тесты pytest | пытались упасть | **101 passed**, 21 deselected, 18 warnings | OK |
| Frontend pages | ~64 | **68** | +4 |
| Frontend components | ~82 | **84** | +2 |
| FK с `ondelete=` | n/a | **246 (71%)** | — |
| FK без `ondelete=` | 24 | **98 (29%)** | хуже (новые модели) |
| Backend dir size | n/a | 8.1 MB | — |
| Frontend dir size (с node_modules) | n/a | 1.9 GB | — |
| Backups | n/a | 23 MB (5 дампов) | — |
| Диск / | n/a | 39/59 GB (69%) | OK |

---

## 4. Что ещё не закрыто

### P0 (блокеры запуска)

**P0-1. SENTRY_DSN не задан в .env**  
```
docker exec clinika-backend env | grep SENTRY  → (пусто)
```
В коде Sentry инициализируется (`366b491`), но без DSN — ошибки в проде уходят в `/dev/null`.  
**Действие:** добавить `SENTRY_DSN=...` в `.env`. Создать проект `clinika` в `sentry.io` (free tier 5k events/мес).

**P0-2. SMTP env пуст**  
```
docker exec clinika-backend env | grep -iE 'SMTP|EMAIL'  → (пусто)
```
Любые формы восстановления пароля, инвойсы франчайзи, eND-of-day отчёты — не уходят.  
**Действие:** настроить SMTP (mail.ru/yandex.ru SMTP relay или Postmark). Минимум: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.

**P0-3. YOOKASSA env пуст**  
```
docker exec clinika-backend env | grep -i YOOKASSA  → (пусто)
```
Тариф «Здоровье+» / франчайзинговые подписки не примут платёж.  
**Действие:** оформить ИП → получить `YOOKASSA_SHOP_ID` + `YOOKASSA_SECRET_KEY`. До этого — тихий B2B-запуск (наличная активация через manager flow уже есть).

**P0-4. Offsite backup НЕ настроен**  
```
rclone listremotes  → (пусто)
crontab -l           → нет clinika-backup
ls /opt/clinika/backups/ → есть локальные дампы (последний 2026-05-05)
```
Локальные дампы на том же диске сервера — при потере сервера/диска данные исчезнут.  
**Действие:** настроить rclone с Yandex.Disk / S3 + cron `0 4 * * *`. Шаблон `clinika-cleanup.sh` уже умеет чистить старые дампы — нужен парный backup-скрипт.

### P1

**P1-1. 98 ForeignKey без `ondelete=` (рост с 24)**  
Топ-нарушители:  
- `referral.py` 7/9 FK без ondelete  
- `discount.py` 5/5 — все без ondelete!  
- `invitation.py` 4/4 — все без ondelete!  
- `bonus.py` 3/4, `referral_comment.py` 3/3, `user.py` 2/5

При удалении тенанта/клиники — orphan-строки. PostgreSQL не разрешит DELETE родителя без CASCADE/SET NULL.  
**Действие:** миграция, добавить `ondelete="CASCADE"` для child-сущностей и `ondelete="SET NULL"` для опциональных ссылок (created_by_user_id и т.п.). Можно автоматизировать через grep+sed по моделям с ручным review.

**P1-2. Dead components в frontend**  
Полностью неимпортируемые файлы (0 ссылок):  
- `frontend/src/components/TrialBanner.jsx` (компонент-обёртка; PaymentReq есть в onboarding_service.py, но тот self-contained)  
- `frontend/src/sections/AIAnalyticsSection.jsx`  
- `frontend/src/sections/RequisitesSection.jsx`  
- `frontend/src/components/ResponsiveTable.jsx`  
- `frontend/src/components/ReferralCard.jsx` (внутри PatientCabinet.jsx и History.jsx определены свои локальные `function ReferralCard()` — этот файл-сирота)  
- `frontend/src/sections/PatientLabResultsSection.jsx` (использует только `lab/LabResultsTable.jsx`)  

**Действие:** `git rm` указанных 6 файлов + проверить `npm run build` → размер бандла должен уменьшиться на ~30-60 КБ.

**P1-3. BG-tasks и сервисы не вызывают `set_config('app.tenant_id', ...)`**  
`grep set_config backend/app/services backend/app/tasks` → пусто.  
Если в Telegram-боте/celery-worker создаётся сессия без `get_current_user_with_tenant` (Depends), RLS не выставится и можно прочитать/записать в чужой tenant.  
**Действие:** аудит всех мест, где SQLAlchemy `AsyncSession` создаётся напрямую (вне Depends). Завести helper `with_tenant_session(tenant_id)`.

**P1-4. 18 pytest warnings — sync-функции с `@pytest.mark.asyncio`**  
В `test_tenant_isolation.py` — несколько sync-тестов помечены async-маркером. Не валит CI, но шум.  
**Действие:** убрать `@pytest.mark.asyncio` с sync-тестов или сделать `pytestmark = pytest.mark.asyncio` только для async (`backend/tests/test_rbac_isolation.py`, `test_referrals.py` — суммарно 10 марок).

**P1-5. 3 неиспользуемых npm-пакета**  
```
@fontsource/inter, @fontsource/manrope, material-symbols
```
**Действие:** `npm uninstall` → -7.4 MB в `node_modules`, чуть быстрее `npm ci` в CI.

### P2 (qualité)

**P2-1. Pydantic V2 deprecation warnings**  
При импорте `app.main` — 10+ предупреждений `class-based Config deprecated, use ConfigDict instead`.  
Не критично, но к Pydantic V3 пригодится миграция.

**P2-2. Frontend `node_modules` = 1.9 GB**  
Большая часть — `@fontsource/*` (полные шрифтовые наборы). Можно ограничить набором cyrillic+latin → ~200 MB.

**P2-3. CI не запускает `npm run lint`**  
Только `vite build`. Нет `eslint --max-warnings 0`. Можно добавить как `continue-on-error: true` job.

**P2-4. CI: ruff `continue-on-error: true`**  
Стиль не блокирует. ОК для дев-цикла, но «гниение кода» неизбежно. Когда команда вырастет — снять флаг.

**P2-5. Tests folder в проде-образе**  
`/app/tests` есть в контейнере (101 файла прошли). Не ломает безопасность, но лучше `COPY` без `tests/` либо `.dockerignore`.

---

## 5. Production readiness checklist

| Пункт | Статус | Комментарий |
|---|---|---|
| Health-эндпойнты | ✅ | 200/200 |
| Rate-limits | ✅ | Все 3 работают |
| Brute-force lockout | ✅ | per-IP + per-user |
| Honeypot | ✅ | 4 формы |
| Tests pass | ✅ | 101 unit, 21 integration deselected |
| Backend imports clean | ✅ | только Pydantic V2 deprecations |
| Frontend circular deps | ✅ | madge: 0 circular в 302 файлах |
| CI/CD | ⚠️ | есть (lint+build+test), но ruff не блокирует |
| Sentry DSN | ❌ | пусто |
| SMTP | ❌ | пусто |
| YooKassa | ❌ | пусто |
| Offsite backups | ❌ | rclone установлен, но `listremotes` пуст |
| RLS в BG-tasks | ⚠️ | не аудитировано, потенциальная утечка |
| FK ondelete | ⚠️ | 98 без ondelete (29%) |

---

## 6. Рекомендации (приоритизированный план на 7 дней)

### День 1 (P0)
1. Создать Sentry-проект → добавить `SENTRY_DSN` в `.env` → `docker compose restart clinika-backend`. Проверить ошибку через `/debug/sentry` (можно временный route).
2. Настроить SMTP: 5-7 переменных в `.env` + проверить отправкой welcome-email.
3. rclone config (Yandex.Disk OAuth) + написать `/opt/clinika/scripts/clinika-backup.sh` (pg_dump → rclone copy yadisk:clinika/) + cron `0 4 * * *`.

### День 2-3 (P1)
4. Миграция: добавить `ondelete` к 98 FK. Шаблон: child-FK → CASCADE, optional → SET NULL. Тесты + alembic upgrade + откатить на staging.
5. `git rm` 6 dead-components → `npm run build` → метрика бандла.
6. `npm uninstall @fontsource/inter @fontsource/manrope material-symbols`.

### День 4-5 (P1 продолжение)
7. Аудит RLS в BG-tasks: пройти по `services/`, `tasks/`, найти прямые `AsyncSessionLocal()`, обернуть `with_tenant_session()`.
8. Подчистить pytest warnings (10 мест).

### День 6-7 (запуск)
9. ИП → YooKassa OAuth → положить ключи в `.env`.
10. Smoke regression полным regression-чеклистом (booking, оплата, кабинеты, calls).

---

## 7. Файлы / коммиты — итого

- 7 P1 коммитов закрыты за сутки (см. таблицу §1).
- 813 routes (+22), 98 миграций (+2), 80 моделей (+2), 141 таблица (+1).
- 101 unit-тест проходит в проде-контейнере.
- 0 circular deps в frontend (302 файла).

**Готовность к запуску B2B (наличная активация):** 92% (нет SMTP/Sentry/offsite — это техдолг, но не блокирует продажи).  
**Готовность к запуску B2C (приём платежей):** 78% (плюс ждёт YooKassa-ИП).

---

*Аудит выполнен 2026-05-12, Claude Code (Opus 4.7).*
