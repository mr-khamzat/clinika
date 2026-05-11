# Changelog

История ключевых изменений платформы КлиникСеть. Минорные багфиксы сюда не попадают, только функциональные изменения.

## 2026-05

### 2026-05-10 — Региональный контроль (manual + IP allowlist)

- Региональная блокировка переведена в ручной режим (auto-403 по `region_strict` отключён).
- Добавлены поля `is_blocked`, `blocked_until` на `Franchise`.
- Таблица `franchise_ip_allowlist` для whitelisted CIDR с флагом `bypass_block`.
- UI: страница «Нарушения регионов» с кнопками «В whitelist» и «Заблокировать».

### 2026-05-08 — Здоровье+ supply cron + structured benefits

- Запущен monthly supply cron — каждый месяц 500 баллов подписчикам.
- Structured benefits в API — JSON массив с deep-link на чат.
- Chat unlimited снимает rate-limit для подписчиков.

## 2026-04 — Глава 9: подписка Здоровье+ и чат

- Запущена подписка Здоровье+ (модуль `health_plus`).
- Cash activation через manager.
- Override тарифа на уровне франшизы.
- Discount 15% в `appointments` для подписчиков.
- iCal feed календаря пациента.
- Document storage v2.

## 2026-03 — Глава 8: пациент-семья + лояльность

- Семейный профиль до 9 членов.
- Программа лояльности Bronze / Silver / Gold / Platinum.
- Расходник за год (PDF) для налогового вычета.

## 2026-02 — Главы 6-7: врач+AI и регламенты

### 2026-02-25 — Регламент-конструктор (Гл. 7)

- Wizard SOP с версионированием.
- AI-генератор черновика через Gemini.
- E-signature через OTP по SMS.
- Tracking прочтения и подписей.

### 2026-02-10 — Доктор + AI (Гл. 6)

- Pre-visit briefing — Gemini готовит резюме пациента.
- Treatment plan generator с проверкой аллергий.
- МКБ-10 подсказка top-3.
- Direct billing для visiting/partner врачей.
- Голосовой ввод протокола (Web Speech API).

## 2026-01 — Главы 4-5: manager + reg

### 2026-01-28 — Регистратор скорость (Гл. 5)

- Quick-actions с горячими клавишами.
- Печать направления PDF одним кликом.
- Mobile-First форма пациента.
- Универсальный поиск Cmd+K.

### 2026-01-15 — Manager продуктивность (Гл. 4)

- Kanban расписание с drag-and-drop.
- Heatmap загрузки врачей.
- Шаблоны направлений.
- Multi-clinic view.
- Cost forecast на 1-3 месяца.

## 2025-12 — Гл. 3: Аналитика франшизы

- KPI Dashboard с фильтрами.
- Когортный анализ удержания.
- Bulk plan override для клиник.
- AI insights через Gemini.

## 2025-11 — Гл. 1-2: Платформа и онбординг

### 2025-11-20 — Self-service onboarding (Гл. 2)

- 5-шаговый wizard регистрации франшизы.
- OTP-верификация телефона.
- 14-дневный триал автоматически.
- Welcome email с быстрым стартом.

### 2025-11-05 — Платформа (Гл. 1)

- Marketplace модулей (20+).
- Impersonation по RFC 8693.
- Аудит безопасности (audit_log) с дельтами.
- Tenant API Keys с scope.
- Public API v1 для агрегаторов.

## 2025-10 — Гл. 10: интеграции

### 2025-10-28 — Disaster Mode

- Автоматическое включение при N ошибках.
- Локальные fallback для платежей, AI, ОФД.
- Алерт super_admin в Telegram.

### 2025-10-15 — Лаборатории

- Подключение Gemotest, Invitro, KDL, CitiLab.
- Webhook для результатов.
- Биллинг с marup или agent моделью.

### 2025-10-05 — Wellness партнёры

- Каталог партнёрских услуг.
- Купоны с уникальным кодом.
- % attribution клинике.

## 2025-09 — Базовая платформа

### 2025-09-30 — WebRTC и телемедицина

- coturn 3478 как TURN/STUN.
- ICE config через `/presence/ice-config` (HMAC-SHA1 REST).
- WebSocket сигналинг.
- Модуль telemedicine 4 990 ₽/мес.

### 2025-09-15 — Бонусы и каскадный расчёт

- BonusLedger с advisory lock.
- Каскад: bonus_total − platform_fee_floor − recruiter_cut.
- 14-дневное удержание.

### 2025-09-01 — MVP

- Кабинеты для 10 ролей (super_admin, franchise_owner, manager, doctor, reg, nurse, recruiter, partner_doctor, visiting_doctor, patient).
- Направления с QR + 5-значный код.
- Запись на приём, расписание.
- Базовая медкарта-timeline.
- Биллинг подписки.
- JWT с PBKDF2.

## Roadmap (не выпущено)

### v2 (Q3 2026)

- Этап A: White-Label + CMS + Acts (готово, HEAD u3v4w5x6y7z8).
- Этап B: Acquisition Manager + External Doctors (в работе).
- Этап C: Supervisor роль и multi-region.
- Этап D: AI копирайтер для CMS.
- Этап E: B2B продажи.
- Этап F: Платформа-франшиза (продажа франшиз через платформу).

### Долгосрочное

- Mobile app iOS / Android
- 2FA через Telegram
- Embedded видеоконсультации в виджете на сайте клиники
- ЭЦП (КЭП) для критических документов
- ЭДО с ФНС

## Связанные статьи

- [О платформе](/wiki/intro-about)
- [Главы 1-10](/wiki/chapter-1-platform)
- [Гл. 9: Здоровье+](/wiki/chapter-9-health-plus)
