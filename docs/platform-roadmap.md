# Platform Roadmap — кабинет super_admin (Платформа)

Документ описывает фичи, которые планируется добавить в кабинет **Платформа** (super_admin)
в КлиникСети. Источник запроса — cleanup-проход 2026-05-22; этот файл — не план реализации,
а зафиксированный backlog для последующего планирования.

---

## 1. MRR / ARR + Cohort LTV

Финансовые метрики платформенного бизнеса: Monthly/Annual Recurring Revenue, разбивка по
планам подписки, когортный LTV по месяцу регистрации тенанта. Источник данных — Stripe
(или ручной billing-ledger из `/admin/billing`), агрегация по `tenants.plan` и
`subscriptions.amount`.

## 2. Churn Dashboard

Дашборд оттока тенантов: помесячный churn rate, разбивка по причинам (downgrade,
не-продление, hard-delete, неоплата), доля voluntary vs involuntary. Нужен поля
`tenants.churned_at` и `tenants.churn_reason` (enum), плюс отчётный endpoint
`/admin/churn/summary`.

## 3. Tenant Health Score (composite metric)

Композитный показатель «здоровья» тенанта — взвешенная сумма: активность пользователей
за 7/30 дней, объём записей в `booking`/`audit_log`, доля оплаченных счетов, time-to-first-value
после онбординга. Выводится светофором (🟢/🟡/🔴) в таблице тенантов (см. mock-колонку
«Активность» в AdminLayout.jsx) и численно в TenantDrawer.

## 4. Feature Flags per Tenant (A/B testing)

Гранулярные флаги для отдельного тенанта: включить/выключить экспериментальные модули
без редеплоя. Нужна таблица `tenant_feature_flags(tenant_id, key, enabled, payload jsonb)`
и UI-страница со списком флагов + bulk-toggle по плану. Используется для постепенного
roll-out новых разделов (например, telemed, lab_ct).

## 5. API Quotas / Rate Limits per Tenant

Лимиты на API-вызовы и фоновые задачи для каждого тенанта — защита от шумных соседей и
fair-use enforcement. Хранение: `tenant_quotas(tenant_id, scope, limit_per_minute, limit_per_day)`,
enforcement на уровне middleware (Redis-counter). UI: настройка лимитов, графики usage vs limit,
алерт при приближении к 80%.

## 6. Cost Attribution (CPU / Memory / Storage per Tenant)

Атрибуция инфраструктурных затрат на конкретного тенанта: CPU-секунды на запросы, объём
данных в PostgreSQL (по schema/tenant_id), S3/MinIO-storage для файлов и PACS. Источник —
Prometheus + ручной парсинг `pg_total_relation_size`. Нужно для unit-economics и решений
о тарифной сетке.

---

_Файл создан автоматически при cleanup-проходе "кабинет Платформа" 2026-05-22._
