# План выката security-remediation-wave0 на прод (212.57.118.126)

> Ветка `security-remediation-wave0` закрывает в коде **все 20 critical+high** и **45 из 69 medium+low** аудита (24 medium+low — обоснованные пропуски: ops/архитектурные/дубли). Прод НЕ тронут. Этот документ — порядок безопасного выката.

## ⚠️ Главные правила
1. **Роль приложения в БД ОБЯЗАНА быть `NOSUPERUSER` без `BYPASSRLS`** — иначе RLS (#1) молча обходится (суперпользователь игнорирует политику). Проверить: `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='clinika';` → оба `f`. Если `t` — создать отдельную app-роль и переключить `DATABASE_URL` на неё.
2. **Сначала снять полный бэкап прод-БД** (`pg_dump`) — это необратимые миграции на данных пациентов.
3. **`SECRET_KEY` должен быть задан и СТАБИЛЕН** до шифр-бэкфиллов (Fernet derive из него; при пустом → `plain:`-маркировка, при смене → старые `enc:` нечитаемы).
4. Выкат — в **maintenance-окно**.

## Точки отката
- Тег `backup/pre-remediation-2026-06-08` → `357cd5b` (origin).
- Локальный bundle `C:\Users\bitva\clinika-backups\clinika-FULL-backup-20260608.bundle`.
- Откат кода: `git reset --hard backup/pre-remediation-2026-06-08`.
- Откат БД: `alembic downgrade chatslot01` (снимает все 6 миграций ветки) + при необходимости restore из pg_dump.

## Цепочка миграций (порядок строгий)
`chatslot01` (прод-head) → **invrev01** (reversed) → **tenantbf01** (backfill NULL tenant_id) → **apptphi01** (appointments PHI shadow + FK RESTRICT + условный NOT NULL) → **rlsall01** (RLS на 118 таблиц) → **medenc01** (медданные shadow) → **tpat01** (TenantPatient M2M + RLS на неё).

Все проверены на одноразовом PostgreSQL (Docker): backfill, условный NOT NULL (обе ветки), RLS-изоляция под не-суперюзером, обратимость.

## Последовательность выката
1. **Бэкап БД + проверка роли** (правила выше).
2. **Деплой кода ветки** (backend+frontend). На этом этапе:
   - guard'ы изоляции (#7) уже fail-closed — НО до backfill ниже исторические `tenant_id IS NULL` строки спрячутся от тенантных юзеров. Поэтому backfill в том же окне, сразу.
   - `pii_sync` listener и RLS-контекст (`get_tenant_db`) подключены только в части доменов; остальное permissive — не ломается.
3. **`alembic upgrade head`** (применит invrev01..tpat01). Проверить лог: `apptphi01` либо `SET NOT NULL` (0 NULL), либо WARNING (остались сироты — разобрать data-скриптом).
4. **Data-скрипты шифрования** (отложены из миграций намеренно), при стабильном `SECRET_KEY`, построчно:
   - appointments: `patient_phone/patient_name/notes` → `*_encrypted` + `*_hash` (#2)
   - медданные: diagnoses/allergies/vaccinations/lab/vitals → `*_encrypted` (#17)
   - patient_accounts.name → `name_encrypted/name_hash` (#18)
5. **Cutover чтений на `*_plain`/`*_hash`** (помечены `TODO(#2 PHI)` в ~15 файлах; критично `patient_lab_dynamics.py`, `patient_medical_record.py`, `engagement_analytics.py` — сырые SQL мимо property). Выкатывать ВМЕСТЕ с шагом 4.
6. **Включить `install_pii_sync()` в main.py** — ТОЛЬКО после шагов 3-4 (иначе INSERT в отсутствующие колонки).
7. **Финальный `SET NOT NULL`** на appointments.tenant_id (отдельной миграцией) — после зачистки сирот (`COUNT(*) WHERE tenant_id IS NULL = 0`).

## Ops-задачи (кодом не закрываются)
- **#20:** ротация пароля БД `clinika_pass` на проде (`ALTER ROLE clinika WITH PASSWORD '<новый>'`, volume НЕ пересоздавать), прописать `POSTGRES_PASSWORD` + согласованный `DATABASE_URL` в `/opt/clinika/.env`; `git rm --cached .env` + чистка git-истории от `clinika_pass` (BFG/filter-repo).
- **#30:** отозвать/перевыпустить Telegram support-токен в BotFather (старый в истории git).
- **#8 (хвост):** скоординированный апгрейд starlette+FastAPI и weasyprint — отдельной веткой с прогоном CI.

## Остаточные доменные волны (не блокируют выкат)
- **RLS Часть B:** перевести `Depends(get_db)` → tenant-aware зависимость в остальных ~170 файлах (доменными волнами: lab/appointments/telemedicine/clinic_payments/...). До этого они permissive (на ручных фильтрах, без поломки).
- Архитектурные (medium, пропущены осознанно): дубль чат-движков (#40), монолит AdminLayout 9004 строки (#46), дубль кабинетов пациента (#47), backend-эндпоинты регламентов/MIS (#21/#22), мажорные dep-апгрейды (#61-63).

## Пост-деплой проверка
- `SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='clinika'` → `f,f`.
- Кросс-тенант smoke: менеджер тенанта A не видит медкарту/документы/чат тенанта B (раньше видел при NULL).
- `/health` 200; bot healthcheck зелёный; платежи идут на юрлицо клиники (не ENV платформы).
- `COUNT(*) WHERE tenant_id IS NULL` по chat/medcard/documents/appointments = 0.
- Дамп: ФИО/телефон/медтекст в `*_encrypted` — без plaintext.

---

# Обновление 2026-06-08 — волны R1/R2/R3 (ветка дополнена до 16 коммитов)

## Дозакрыто в коде
- **R1 #21/#22:** реализованы недостающие эндпоинты — регламенты `GET version`/`POST rollback` (admin_regulations) и `PATCH /integrations/mis/settings` (шифр `mis_api_key`). Tenant-скоуп.
- **R1 cutover ПДн:** ВСЕ 16 `TODO(#2 PHI)` + #17-чтения переведены на `*_plain`/`patient_phone_hash` в 17 файлах (включая сырые text()-SQL в engagement/lab-dynamics). После backfill-шифрования аналитика/отображение читают корректно.
- **R2 RLS Часть B:** 64 аутентифицированных tenant-эндпоинта переведены `Depends(get_db)→get_tenant_db` (RLS реально изолирует, defense-in-depth). `get_tenant_db` теперь permissive и для `franchise_owner` (кросс-тенантная роль — иначе RLS срезал бы франшиза-видимость).
- **R3 #40:** легаси чат-движок PatientChat помечен DEPRECATED + план миграции на ChatThread (без удаления данных).
- **R3 #25:** проверено — мёртвых admin-роутов нет (все группы вызываются фронтом; `/admin/arr-ltv` не существует).

## Data-скрипт шифрования (заменяет «шаг 4» выше)
`backend/scripts/encrypt_pii_backfill.py` (+ README) — идемпотентный батч-скрипт. Запуск В MAINTENANCE-ОКНО после миграций, при заданном и СТАБИЛЬНОМ `SECRET_KEY`:
```
python -m scripts.encrypt_pii_backfill --dry-run   # сначала счёт
python -m scripts.encrypt_pii_backfill             # шифрует appointments/medcard/lab/vitals/patient_accounts
```
Идемпотентен (пропускает уже `enc:`), безопасен для повторного запуска.

## Остаток RLS Части B (не блокирует, permissive → не ломается)
~77 эндпоинтов на `Depends(get_db)` осознанно: публичные/pre-auth/webhook/super_admin + роутеры, где tenant берётся из path (franchise-управление). Их изоляция — на ручных фильтрах + permissive RLS. Доводятся доменными волнами при желании.

## Осознанно отложено (НЕ баги — tech-debt/продукт/несрочные upgrade'ы, так пометил сам аудит)
- **#46** split AdminLayout.jsx (9004 строки) — крупный рефакторинг, риск регрессии без браузерного теста; «improve», не баг.
- **#47** дубль кабинетов пациента — осознанный preview-роллаут премиум-дизайна (продуктовое решение).
- **Мажор-апгрейды:** FastAPI/starlette (#8-хвост), react-router 6→7, tailwind 3→4, vite 5→6 — ЛОМАЮЩИЕ, аудит пометил «отдельными задачами с CI/staging». Security-CVE в этих стеках уже закрыты патч-версиями (vite 5.4.21, Pillow 11.3, python-multipart 0.0.18).
- **6 companion admin-эндпоинтов** (#25) — живые фичи под super_admin, не мёртвые.
- **Удаление легаси чат-движка** (#40) — требует data-миграции истории (отдельная задача).
