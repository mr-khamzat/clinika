# КлиникСеть — дорожная карта переделок

**Версия:** 1.0 от 2026-05-06
**Цель:** довести систему до готовности к продаже франшиз (платящие клиники, мед-данные, 152-ФЗ).

---

## ПРИНЦИПЫ

1. **Ядро (free) изолировано** — без него ничего не работает, но оно бесплатное.
2. **Модули (paid) подключаются** — каждый имеет каталог, цену, биллинг-событие на включение/выключение, фича-гейт через `require_module(*keys)`.
3. **Тенанты изолированы** — каждый запрос проходит через `tenant_id` фильтр (на уровне ORM или RLS Postgres).
4. **Роль определяет вход** — каждая роль попадает только в свой кабинет, других не видит.
5. **Дизайн один на всю систему** — стиль `design-preview-2` (dark premium + cyan/teal). Никаких violet/purple/white-выбросов.
6. **1 бонус = 1 ₽** — внутри одно число, в UI разные подписи.

---

## РОЛИ — ФИНАЛЬНАЯ СХЕМА

```
super_admin (платформа)
  └── franchise_owner (тенант)
       ├── recruiter ──► partner_doctor (привязан к рекрутеру, направляет в N клиник тенанта)
       └── clinic
            ├── manager (главврач, создаёт сотрудников клиники + visiting_doctor)
            ├── doctor (штатный, лечит)
            ├── reg (регистратор, ex-admin)
            ├── nurse (только направления)
            └── visiting_doctor (приходящий, индив. %)

patient — отдельно, /{slug}/p
```

**Удалены:** supervisor, acquisition_manager, partner, accountant.
**Переименованы:** admin → reg, external_doctor → partner_doctor.

---

## ЭТАПЫ

### ✅ Этап 0 — этот документ
Финальное проектирование, единый источник правды.

### 🔲 Этап 1 — Безопасная чистка (1 день)
- [ ] Удалить .bak файлы фронта
- [ ] Удалить дубликат `pages/App.jsx`
- [ ] Удалить `backend/app/main.py.tmp/` и `routers/monitoring.py.bak`
- [ ] Удалить `.exe` из git-индекса (физически на диске для скачивания)
- [ ] `frontend/.dockerignore` исключает `public/downloads/`
- [ ] Логирование (`logger.exception`) вместо `except: pass` в финансах

### 🔲 Этап 2 — Безопасность (1 день, требует подтверждения)
- [ ] Убрать дефолт `SUPERADMIN_PASSWORD`, fail-fast
- [ ] Cross-tenant фикс в `auto_confirm` + MIS_CLINIC_IDS per-tenant
- [ ] HSTS + nginx rate-limit `/auth/login`
- [ ] **🚨 Ротация секретов в `.env`** — нужен момент даунтайма
- [ ] **🚨 `git filter-repo`** — чистка истории
- [ ] **🚨 SSH key-only + UFW** — нужен публичный ключ заранее
- [ ] Auth на CMS POST/PUT (только manager+)
- [ ] DOMPurify для wiki/AI Markdown

### 🔲 Этап 3 — Удаление и переименование ролей (1 день)
- [ ] Миграция Alembic: новый PG enum `userrole_v2` без 4 удалённых
- [ ] Перенос юзеров с `admin` → `reg`, `external_doctor` → `partner_doctor`
- [ ] Удалить старый enum
- [ ] Удалить кабинеты `SupervisorCabinet`, `AcquisitionManagerCabinet`, `AccountantCabinet`, `PartnerCreateReferral`
- [ ] Удалить роутеры `supervisor.py`, `acquisition_manager.py`
- [ ] Переименовать `ExternalDoctorCabinet` → `PartnerDoctorCabinet`
- [ ] Обновить `AdminRoot.jsx` маршруты
- [ ] Лейблы UI: «Внешний врач» → «Врач-партнёр», «Внешние врачи» в меню франшизы → «Партнёрские врачи»

### 🔲 Этап 4 — Дизайн-токены и UI-библиотека (3-4 дня)
- [ ] Извлечь токены из `design-preview-2/*.html` → `frontend/src/design/tokens.css`
- [ ] Создать базовые компоненты в стиле design-preview-2:
  - `<Page>`, `<PageHeader>`, `<Card>`, `<KpiCard>`, `<KpiRow>`
  - `<NavRail>`, `<TopBar>`, `<TabBar>`, `<Sidebar>`
  - `<Table>`, `<Chart>`, `<Sparkline>`, `<StatusChip>`
  - `<Avatar>`, `<RoleAvatar>`, `<Modal>`, `<BottomSheet>`
  - `<EmptyState>`, `<Spinner>`, `<Toast>` (заменить все `alert()`)
- [ ] Storybook для визуальной регрессии (опционально)
- [ ] Material Symbols subset (только используемые глифы)

### 🔲 Этап 5 — Миграция кабинетов на новый дизайн (2 недели по 1-2 дня на кабинет)
Порядок: от самых видимых клиенту к внутренним.

1. **PatientCabinet** — лицо системы для пациентов
2. **DoctorLayout** — врач это ключевой пользователь
3. **OperationalCabinet (reg)** — регистраторы массово сидят
4. **ManagerDashboard + Manager*** — много страниц, постепенно
5. **RecruiterCabinet** — целиком в стиле
6. **PartnerDoctorCabinet** — целиком в стиле
7. **VisitingDoctorCabinet** — целиком в стиле
8. **FranchiseOwnerCabinet** — целиком в стиле
9. **AdminLayout (super_admin)** — последний, самый сложный (7700 строк, бить на куски)

### 🔲 Этап 6 — Лендинг (3-4 дня)
- [ ] Переписать `Landing.jsx` в стиле `design-preview-2/klinikset.html`
- [ ] Hero-секция, секция «Возможности» с премиум-карточками, секция «Тарифы», секция «Роли», CTA-секция, footer
- [ ] Добавить кнопку «Скачать Calls для Windows» (уже есть)
- [ ] Лендинг для франшизы (отдельная страница `/franchise` — почему стать франчайзи)

### 🔲 Этап 7 — Модули и биллинг (1 неделя)
- [ ] Аудит — какие фичи в core (free), какие — модуль (paid). Полная инвентаризация.
- [ ] Унифицировать `require_module` на всех платных endpoint'ах
- [ ] Каталог модулей — UI в кабинете franchise_owner с описанием/ценой/тестовым периодом
- [ ] Биллинг событий: каждое включение/выключение → запись в `BillingLedger`
- [ ] Настройка цен в `super_admin` (модули-каталог)

**Возможные модули** (предварительный список, дополним аудитом):
- Видео-звонки (`video_calls`) — 990₽/мес/тенант
- Аудио-звонки (`telephony_basic`) — 490₽/мес
- AI-аналитика basic / pro (`ai_analytics_basic`, `ai_analytics_pro`)
- AI-чат с пациентом (`ai_assistant`)
- МИС-интеграция Renovatio / BARS / etc — 1500₽/мес/клиника
- Реклама на кабинетах пациентов (`ads_basic`, `ads_agency`)
- White-label брендинг (`branding_pro`)
- Свой домен (`custom_domain`)
- Apple Health sync (`vitals_apple_health`)
- Loyalty-программы (`loyalty_pro`)
- Webhooks (`webhooks`) — для внешних интеграций
- API доступ (`api_access`)
- Расширенный аудит-лог (`audit_advanced`)
- Расширенные отчёты (`reports_advanced`)

### 🔲 Этап 8 — RBAC как данные (3-4 дня)
- [ ] Таблица `tenant_permission_override` (JSONB)
- [ ] Middleware `has_permission(user, action, resource, tenant)` читает из БД с fallback
- [ ] Кабинет franchise_owner → раздел «Роли и права»: матрица + флажки
- [ ] Удалить хардкоженные `if user.role == ...` где это было

### 🔲 Этап 9 — Функциональные доделки (1 неделя)
- [ ] SLA направлений per-service + дефолт 14 дней (фронт + бэк)
- [ ] Уведомление пациенту за 3 дня (cron job)
- [ ] Уведомление автору за 1 день (внутрикабинетное)
- [ ] Завершение приёма через QR — расширить flow visiting_doctor на штатных doctor (reg сканирует)
- [ ] Один сотрудник в N клиник — обобщить `DoctorClinicAccess`
- [ ] Кросс-МИС пациент (если в нескольких МИС эко-системы)

### 🔲 Этап 10 — Интеграции (по мере готовности)
- [ ] Max-мессенджер бот для уведомлений пациентов
- [ ] Telegram-бот для уведомлений сотрудников (уже частично)
- [ ] Push-уведомления на мобильные через VAPID
- [ ] Email-уведомления (важные события)

### 🔲 Этап 11 — Незавершённые фичи
- [ ] Loyalty-роутер + UI (модели уже есть)
- [ ] Patient AI bot endpoint (`/patient/ai/ask`)
- [ ] Apple Health bridge для iOS Calls приложения
- [ ] Code-signing для Windows .exe Calls
- [ ] macOS / Linux сборки Calls

### 🔲 Этап 12 — DevOps и стабильность (1 неделя)
- [ ] Offsite бэкапы БД + uploads через rclone в Яндекс.Диск/S3
- [ ] Тест восстановления бэкапа
- [ ] uptime-kuma + Telegram-алерты
- [ ] Sentry для ошибок
- [ ] Grafana дашборд
- [ ] Blue-green deploy (2 backend инстанса)
- [ ] RAM апгрейд 3.7→8 GB

### 🔲 Этап 13 — Тесты (фоном, постоянно)
- [ ] pytest + factory_boy + testcontainers (Postgres в Docker для тестов)
- [ ] Playwright E2E на 10 главных flows
- [ ] Pre-commit hooks
- [ ] GitHub Actions CI: lint → test → build

---

## ТЕКУЩИЙ СТАТУС

- **🟢 Работает в продакшне:** ядро (auth, тенанты, направления, бонусы, расписание, чат, билинг, видео-звонки), пациентский кабинет с медкартой/витальными/документами/назначениями, кабинет manager, doctor, reg, recruiter, частично partner_doctor/visiting_doctor.
- **🟡 Работает но требует переделки:** дизайн всех кабинетов (мешанина стилей), AdminLayout (7700 строк, надо бить).
- **🔴 Не работает / половинчато:** Loyalty (модели без UI), Patient AI bot, Apple Health bridge.
- **⚠️ Безопасность:** `.env` в git (КРИТИЧНО), SSH с паролем, бэкапы только локальные.

---

## ВЕХИ

| Веха | Условие | Кому показываем |
|------|---------|-----------------|
| **MVP-soft** | Этапы 1-3 завершены | Внутренний релиз для клиники `arc` |
| **MVP-hard** | + Этапы 4-7 | Первая платящая франшиза |
| **GA** | + Этапы 8-12 | Открытое привлечение франчайзи |

---

## ВЛАДЕЛЕЦ
**mr-khamzat** (mrevil9995@gmail.com), Telegram @RootkinG85
