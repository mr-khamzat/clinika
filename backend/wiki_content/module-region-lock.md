# Модуль «Region Lock — географический контроль франшиз»

Бесплатный встроенный модуль географического контроля франшиз: алерты + ручная блокировка франшизы + IP allowlist при работе из неразрешённого региона. Реализован в `app/services/region_lock_service.py` и `app/core/region_lock.py`.

## Что это даёт платформе

- Защита эксклюзивности территорий франчайзи: «Ингушетия не выходит в Осетию без оплаты».
- Алерты владельцу платформы о попытках работы вне разрешённого региона.
- Audit-trail нарушений в `audit_log`.
- Ручная блокировка франшизы через `franchise.is_blocked = true` (Phase 2).

## Что входит технически

- **GeoIP**: библиотека `geoip2` + база `GeoLite2-City.mmdb`. Резолвит регион пользователя по IP-адресу.
- **Сравнение регионов**: `_normalize` (lower + strip non-alnum) + `_matches` (substring match). Поддерживает форматы "Ingushetia", "RU-IN", "Республика Ингушетия".
- **Audit-событие** `region.violation`: при несовпадении geo_region пользователя и `franchise.allowed_region`.
- **Дедуп Telegram-алертов**: одна франшиза × один регион = не чаще раза в 30 минут.
- **Phase 1 (текущая)**: только мониторинг (audit + alert).
- **Phase 2 (планируется)**: ручная блокировка через `franchise.is_blocked` + кнопки в UI + IP allowlist.

## Архитектура

```
HTTP-запрос → middleware → GeoIP → resolve(franchise) → 
  matches(geo_region, allowed_region) ?
    yes → продолжить
    no  → audit("region.violation") + telegram_alert (dedup 30min)
```

Логика реализована в `region_lock_service.py`:
- `check_region_violation(db, user_ip, tenant_id, action)` — главный entrypoint.
- `_load_franchise_for_tenant(db, tenant_id)` — получить Franchise для тенанта.
- `_matches(geo_region, allowed_region)` — нормализованное сравнение.

## Как настроить

1. Убедиться, что `GeoLite2-City.mmdb` лежит в `/opt/clinika/data/geoip/`.
2. В `.env` — путь к базе: `GEOIP_DB_PATH=/app/data/geoip/GeoLite2-City.mmdb`.
3. В super-admin: `/admin/franchises/{id}` — задать `allowed_region` (например `RU-IN`).
4. (Опционально, Phase 2) `franchise.region_strict = true` — auto-block при нарушении.
5. Telegram-алерты приходят owner-у платформы (ID в `.env` `TELEGRAM_OWNER_CHAT_ID`).

## Как пользоваться

### Сценарий-пример

1. Франшизи купил регион "Ингушетия".
2. `franchise.allowed_region = "RU-IN"`.
3. Менеджер франшизи логинится из Москвы — geo резолвится как "RU-MOW".
4. `_matches("RU-MOW", "RU-IN") == False` → audit + Telegram-алерт владельцу платформы.
5. Если алертов много → блокировка вручную: `franchise.is_blocked = true`.

### Алерт владельца

> Region violation: Franchise "Ingush Med" (region RU-IN), user X tried action /admin/users/create from RU-MOW. Audit ID: a1b2c3.

### IP allowlist (Phase 2)

Для исключений — `franchise.ip_allowlist = ["1.2.3.0/24", "5.6.7.8"]`. Запросы с этих IP не считаются нарушением.

## API endpoints

Region Lock — это service-layer, не отдельный роутер. Используется в middleware всех защищённых endpoints. Управление франшизой и её настройками — через:

- `GET /admin/franchises/{id}` — детали (включая allowed_region, is_blocked).
- `PATCH /admin/franchises/{id}` — обновить allowed_region.
- `POST /admin/franchises/{id}/block` (Phase 2) — заблокировать.
- `POST /admin/franchises/{id}/unblock` (Phase 2) — разблокировать.
- `GET /admin/audit-log?action=region.violation` — все нарушения.

## Известные ограничения

- GeoLite2 не идеален: при использовании VPN/прокси геолокация может ошибаться. Поэтому только мониторинг + ручная блокировка.
- Phase 2 (auto-block по `region_strict`) выпилен из активной версии: только ручной режим (см. memory note `feedback_region_lock_manual.md`).
- IP allowlist хранится в JSONB, но UI-редактора пока нет — только через DB.
- Дедуп алертов 30 минут — не настраивается per-tenant.

## Смотрите также

- [Концепт · Region Lock](concepts-region-lock.md)
- [Концепт · Безопасность и 152-ФЗ](concepts-security.md)
- [Концепт · Мониторинг и алерты](concepts-monitoring.md)
