# Пациенты ЛК (CRM-hub) — design spec

**Date:** 2026-05-18  
**Goal:** Раздел в кабинете admin / franchise_owner / director / deputy_director для работы с пациентами ЛК: метрики, сегменты, авто-подсказки push-кампаний, ручная отправка push, CRM-карточка с тегами/заметками/семьёй.

**Ключевое решение пользователя:** Push отправляется ТОЛЬКО вручную (с подтверждения человека). Авто-триггеры рождают _подсказки_ (suggestions), а не отправки.

## Архитектура

### Backend
- `routers/patient_engagement.py` — основной (`/api/engagement/*`)
- `routers/patient_engagement_suggestions.py` — подсказки и кампании
- `routers/patient_engagement_analytics.py` — funnel/churn/heatmap/cohort
- `routers/patient_engagement_crm.py` — теги, заметки, prefs, family
- `services/engagement_analytics.py` — SQL-функции
- `services/segment_service.py` — резолвинг сохранённых сегментов
- `services/suggestion_engine.py` — генерация suggestions
- `jobs/engagement_suggestions_job.py` — cron entry (раз в час)
- middleware: инкремент `login_count`, обновление `last_seen_at` при логине пациента

### Frontend
- `pages/admin/PatientEngagement.jsx` (mounted в AdminLayout)
- `pages/director/PatientEngagement.jsx` (mounted в DirectorLayout)
- В `FranchiseOwnerCabinet.jsx` — встроить тот же `<PatientEngagementHub />`
- Дочерние секции (общие для всех 3 layouts):
  - `sections/engagement/Dashboard.jsx` — топ-карточки + 3 графика
  - `sections/engagement/PatientsTable.jsx` — таблица с фильтрами и bulk
  - `sections/engagement/PatientCard.jsx` — модал-карточка (5 tabs)
  - `sections/engagement/SuggestionsBoard.jsx` — список pending suggestions с group-by-kind
  - `sections/engagement/CampaignsList.jsx` — история и запланированные кампании
  - `sections/engagement/SegmentEditorModal.jsx`
  - `sections/engagement/PushComposeModal.jsx` (A/B switch)
  - `sections/engagement/PushTemplatesModal.jsx`

## Миграция `ce01_patient_engagement`

- `patient_accounts`: +`login_count INT DEFAULT 0`, +`last_seen_at TIMESTAMP`, +`marketing_opt_in BOOL DEFAULT true`
- new `patient_tags` (id, tenant, patient, tag, color, created_by, created_at)
- new `patient_notes` (id, tenant, patient, body, author_user, pinned, created_at, updated_at)
- new `patient_comm_prefs` (patient_id PK, promo, reminders, loyalty, news, quiet_from, quiet_to)
- new `patient_segments` (id, tenant, name, filter_json, is_dynamic, snapshot_ids JSONB, last_resolved_count, created_by, created_at)
- new `push_templates` (id, tenant, name, category, title, body, link, variables_used JSONB, is_default)
- new `push_campaigns` (id, tenant, template_id, segment_id, title, body, ab_variant, sent_count, delivered_count, click_count, conversion_count, scheduled_at, sent_at, created_by, status)
- new `engagement_suggestions` (id, tenant, patient, kind, template_id, status, created_at, reviewed_by, reviewed_at, sent_campaign_id; UNIQUE on (patient, kind, DATE(created_at)))
- new `nps_responses` (id, tenant, patient, appointment_id, score, comment, source, created_at)

## Триггер-типы (хардкод в `suggestion_engine.py`)

| kind | условие | конфиг (default) |
|---|---|---|
| welcome | created_at == 1/3/7 дней назад | days_after = [1,3,7] |
| birthday | birth_date == сегодня ± N | days_before=3 |
| abandonment | service_viewed в последний час, нет appointment | hours=1 |
| nps | визит ≥24ч назад, NPS не отправлен | hours_after=24 |
| anniversary | 1-й визит ровно 365×N дней назад | yearly |
| churn_30d/60d/90d | last_seen ровно N дней назад | trigger_days=30/60/90 |

## Anti-spam guards (на этапе отправки)
- Max 1 push / 7 дней (настройка)
- quiet_hours respected (откладываются до утра)
- marketing_opt_in=false → не попадают в suggestions

## A/B push
- На кампанию можно подвязать 2 текста (A/B). 50/50 рандом. Метрики per variant.

## CRM-карточка (модал)
5 вкладок:
1. Профиль: phone/name/email/birth_date/last_seen/login_count/tags/notes/comm_prefs
2. История ЛК: timeline логинов, что открывал (страницы)
3. Записи и платежи: appointments + ledger
4. Семья: через `/patient/family` (уже есть API)
5. Push-история: что слали, статус delivery/click

## Аналитика
- Funnel: opens → records → visits
- Stuck-in-funnel: 3+ открытий услуги без записи
- Churn-list: last_seen>60d + ранее ≥3 визита/год
- Retention-cohorts: weekly
- Heatmap логинов 7×24

## Доступ
- read: require_manager (manager+)
- write/send: require_director_or_owner (director/deputy/franchise_owner/admin/super_admin)
- deputy_director — без массовых send (>10 за раз) и без удаления

## Финал
- Build backend + frontend
- Smoke по всем endpoint
- Отчёт в Telegram через `@stclinik_addmin_bot`
