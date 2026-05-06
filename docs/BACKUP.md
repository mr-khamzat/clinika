# Резервное копирование КлиникСеть

## Что бэкапится

| Что | Куда (локально) | Ротация |
|-----|-----------------|---------|
| **БД PostgreSQL** | `backups/daily/clinika-db-<timestamp>.sql.gz[.gpg]` | 14 копий |
| **БД (месячная)** | `backups/monthly/...` (1-го числа каждого месяца) | 12 копий |
| **uploads/** (мед-документы пациентов) | `backups/files/uploads-<timestamp>.tar.gz[.gpg]` | 7 копий |
| **Конфиги** (.env, docker-compose, nginx) | `backups/files/configs-<timestamp>.tar.gz[.gpg]` | 7 копий |

## Расписание

Cron: `0 3 * * * /opt/clinika/backup.sh`

Запуск каждый день в 03:00 МСК.

Лог пишется в `/opt/clinika/backups/backup.log`.

## Шифрование (рекомендуется)

В `/etc/clinika-backup.env` задать `ENCRYPT_PASSPHRASE` (надёжный пароль).
Все бэкапы будут зашифрованы GPG AES256.

⚠️ **ВАЖНО**: Пароль запиши в безопасное место (KeePass/1Password). Без него восстановление невозможно.

## Offsite (защита от смерти диска)

1. Установить rclone:
   ```bash
   apt install rclone
   ```

2. Настроить remote (Яндекс.Диск):
   ```bash
   rclone config
   # n) New remote
   # name: yandex
   # storage: yandex
   # client_id: (пусто, использовать дефолтный)
   # client_secret: (пусто)
   # Auto config? Yes — откроется браузер для OAuth
   ```

3. Тест:
   ```bash
   rclone ls yandex:
   ```

4. В `/etc/clinika-backup.env` раскомментировать:
   ```
   RCLONE_REMOTE=yandex
   RCLONE_PATH=clinika-backups
   RCLONE_RETENTION_DAYS=90
   ```

5. Запустить тест бэкапа:
   ```bash
   /opt/clinika/backup.sh
   ```

   Проверить: `rclone ls yandex:clinika-backups/db/`

## Telegram-уведомления

1. Создай бота через @BotFather, получи токен.
2. Напиши боту `/start`, узнай `chat_id` через @userinfobot.
3. В `/etc/clinika-backup.env`:
   ```
   TG_BOT_TOKEN=...
   TG_CHAT_ID=293633093
   ```

После каждого бэкапа в Telegram придёт уведомление со статусом.

## Восстановление

### БД из бэкапа

```bash
# По дате (находит автоматически)
/opt/clinika/restore.sh db 20260506

# Или явно файл
/opt/clinika/restore.sh db /opt/clinika/backups/daily/clinika-db-20260506-030000.sql.gz.gpg
```

Скрипт:
1. Спросит пароль (если файл .gpg)
2. Восстановит в **тестовую** БД `clinika_restore_test`
3. Спросит подтверждение для перезаписи боевой
4. При согласии: остановит backend → перезапишет → запустит обратно

### Uploads (медицинские документы)

```bash
/opt/clinika/restore.sh uploads 20260506
```

Текущие uploads переименуются в `uploads.backup-<timestamp>` (на случай отката).

### Конфиги

```bash
/opt/clinika/restore.sh configs 20260506
```

Распаковывается в `/tmp/clinika-configs-restore/` — переносить вручную (чтобы не сломать боевые конфиги).

### Всё сразу

```bash
/opt/clinika/restore.sh all 20260506
```

## Тест восстановления

Раз в месяц рекомендуется проверить что бэкапы целы:

```bash
# Восстановить БД в тестовую (без перезаписи боевой)
/opt/clinika/restore.sh db 20260506
# → создастся clinika_restore_test
# Когда спросит "Применить к боевой?" — отказаться (нет)
# Затем проверить через psql:
docker exec -it clinika-db psql -U clinika -d clinika_restore_test -c "\\dt"
docker exec -it clinika-db psql -U clinika -d clinika_restore_test -c "SELECT COUNT(*) FROM users"
# Удалить тест:
docker exec clinika-db psql -U clinika -d postgres -c "DROP DATABASE clinika_restore_test"
```

## Обратная совместимость

Старый скрипт `backup.sh.old.20260506` сохранён на случай отката. Старые бэкапы в формате `clinika-YYYYMMDD-HHMM.sql.gz` (без шифрования) лежат в `/opt/clinika/backups/` и восстанавливаются обычным `gunzip + psql`.

Новые бэкапы лежат в `/opt/clinika/backups/{daily,monthly,files}/`.

## Disaster Recovery (при полной потере сервера)

1. Поднять новый VPS, установить Docker + docker compose.
2. Скачать с offsite последние конфиги:
   ```bash
   rclone copy yandex:clinika-backups/configs/ /tmp/restore/
   tar -xzf /tmp/restore/configs-*.tar.gz -C /opt/clinika/
   ```
3. Запустить базовую инфру:
   ```bash
   cd /opt/clinika && docker compose up -d clinika-db clinika-redis
   ```
4. Восстановить БД:
   ```bash
   rclone copy yandex:clinika-backups/db/clinika-db-LATEST.sql.gz.gpg /tmp/restore/
   /opt/clinika/restore.sh db /tmp/restore/clinika-db-LATEST.sql.gz.gpg
   ```
5. Восстановить uploads:
   ```bash
   rclone copy yandex:clinika-backups/files/uploads-LATEST.tar.gz.gpg /tmp/restore/
   /opt/clinika/restore.sh uploads /tmp/restore/uploads-LATEST.tar.gz.gpg
   ```
6. Запустить остальное: `docker compose up -d`
7. Проверить: `https://клиниксеть.рф/`

RTO (recovery time objective): ~30 минут на свежем VPS.
RPO (recovery point objective): ≤24 часа (если бэкап 03:00 МСК).
