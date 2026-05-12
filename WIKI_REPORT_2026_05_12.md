# WIKI REPORT — Раунд 2 (2026-05-12)

Обновление wiki после P1-фиксов security/rate-limit/deps/lockout + frontend lazy() оптимизации (коммиты `aa53336` … `366b491`).

## Изменённые файлы (Wiki)

### Дополнены (изменения в frontend + backend копиях):

| Файл | Что добавлено |
|---|---|
| `changelog.md` | Новый раздел **2026-05-12** — security hardening, lockout, rate-limit, honeypot, CVE-bumps, frontend lazy()/TDZ fix |
| `concepts-security.md` | Раздел **Per-user brute-force lockout** (15 мин, 423 Locked, Redis `login_lockout:`); **Защита публичных форм** (rate-limit /contact/ + /public/{slug}/book + honeypot `website_url`); параметризация `set_config()` в Tenant isolation; **Supply-chain hygiene** с таблицей CVE-bumps |
| `api-auth-detailed.md` | Полностью переписан раздел **Brute-force защита**: per-IP лимит + per-user lockout (5/15 мин) + пример 423-ответа + Redis fallback |
| `api-reference.md` | Код **423 Locked** в таблицу ошибок; точечные **rate-limits на /contact/ (5/10мин) и /public/{slug}/book (10/10мин)**; раздел **Honeypot защита** с описанием `website_url`; ссылка на per-user lockout |
| `concepts-multi-tenancy.md` | Обновлён раздел **Механика фильтрации** — параметризованный `set_config('app.tenant_id', :tid, true)` вместо f-string `SET LOCAL`; примечание об SQL-injection fix |
| `faq.md` | 3 новых вопроса в категории «Безопасность»: «Что происходит при 5 неудачных входах подряд?», «Как защищены формы от спама?», «Какие CVE закрыты в последней версии?» |
| `setup-smtp.md` | Раздел **Production readiness checklist** (10 пунктов: SPF/DKIM/DMARC, webhook bounces, mail-tester ≥8/10, white-label, алерты) |
| `setup-yookassa.md` | Раздел **Production readiness checklist** (11 пунктов: ИП/ООО, расчётный счёт, тест-платёж, webhook, ОФД, refunds, disaster-mode) |
| `setup-payments.md` | Расширенный **Production readiness checklist** по трём блокам: Юр-лицо/счета, Технически, Бэкап/DR |

### Новые (синхронизация frontend ↔ backend):

| Файл | Описание |
|---|---|
| `frontend/src/wiki-content/concepts-security.md` | Скопирован из backend — был ссылкой в _index.json, но физически отсутствовал во frontend |
| `frontend/src/wiki-content/concepts-billing.md` | Аналогично |
| `frontend/src/wiki-content/concepts-medcard.md` | Аналогично |
| `frontend/src/wiki-content/concepts-monitoring.md` | Аналогично |
| `frontend/src/wiki-content/setup-mis.md` | Аналогично |
| `frontend/src/wiki-content/setup-modules.md` | Аналогично |
| `frontend/src/wiki-content/setup-payments.md` | Аналогично + расширен Production checklist |

> Backend `wiki_content/` уже содержал эти файлы — `_index.json` ссылается на них, но frontend-копии не было. Теперь обе копии синхронны.

## Расширенные категории

- **concepts**: `concepts-security` существенно расширен (lockout + rate-limit + honeypot + supply-chain), `concepts-multi-tenancy` уточнён по RLS.
- **api**: `api-reference` и `api-auth-detailed` отражают новый код 423 и точечные лимиты.
- **setup**: 3 файла получили Production readiness checklist (smtp / yookassa / payments).
- **faq**: +3 вопроса в блоке «Безопасность».
- **changelog**: новый блок 2026-05-12 с группировкой security / CVE / frontend.

## FAQ — что добавлено

1. **Что происходит при 5 неудачных входах подряд?** — описание 423 Locked, 15 мин TTL, сброс при успехе, как разблокироваться вручную.
2. **Как защищены формы от спама?** — три слоя (rate-limit, honeypot, audit log).
3. **Какие CVE закрыты в последней версии?** — Starlette CVE-2024-47874, pydantic DoS, минорные патчи.

## Роли

Сверил `backend/app/models/user.py:UserRole` с `concepts-security.md` — 10 значений enum (`super_admin`, `franchise_owner`, `manager`, `doctor`, `reg`, `nurse`, `recruiter`, `partner_doctor`, `visiting_doctor`, `patient`) + `acquisition_manager` в wiki как план. Изменений ролей в коде нет, новых `role-*.md` создавать не требуется.

## Технические заметки

- `_index.json` идентичен в frontend и backend — не менялся в этом раунде.
- Обе копии (`frontend/src/wiki-content/` и `backend/wiki_content/`) синхронизированы.
- Wiki .md-файлы импортируются через `import.meta.glob` → **rebuild required** для отображения изменений во frontend UI. Backend читает .md напрямую, изменения видны сразу.

## Не тронуто (по запрету)

`.env`, `vite.config.js`, `App.jsx`, `main.jsx`, `frontend/public/sw.js`, `nginx/`, `docker-compose.yml`.

## Коммит

`docs(wiki): round 2 — отражение P1 фиксов + security` — hash будет проставлен после `git commit`.
