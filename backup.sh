#!/bin/bash
# КлиникСеть — резервное копирование с шифрованием и опциональным offsite.
#
# Что делает:
#   1. pg_dump БД clinika → gzip → опц. шифрование gpg
#   2. tar+gzip /opt/clinika/uploads/ (мед.документы пациентов)
#   3. tar /opt/clinika/.env, nginx-конфиг (для disaster recovery)
#   4. Ротация локальных копий: 14 дней daily, 12 месяцев monthly
#   5. Опциональная отправка offsite через rclone
#
# Конфигурация — переменные окружения (можно в /etc/clinika-backup.env):
#   BACKUP_DIR=/opt/clinika/backups            (где хранятся локальные копии)
#   ENCRYPT_PASSPHRASE=...                     (если задана — шифрование GPG)
#   RCLONE_REMOTE=yandex                        (имя rclone-remote для offsite)
#   RCLONE_PATH=clinika-backups                 (путь на удалённом)
#   RCLONE_RETENTION_DAYS=90                    (хранить N дней на offsite)
#   TG_BOT_TOKEN, TG_CHAT_ID                    (Telegram-уведомление о статусе)
#
# Если ENCRYPT_PASSPHRASE не задана — бэкапы НЕ шифруются (только gzip).
# Если RCLONE_REMOTE не задан — offsite пропускается (только локально).

set -eo pipefail

# Загрузка переменных окружения если файл существует
[ -f /etc/clinika-backup.env ] && source /etc/clinika-backup.env

BACKUP_DIR="${BACKUP_DIR:-/opt/clinika/backups}"
DATE=$(date +%Y%m%d-%H%M%S)
DOW=$(date +%u)            # 1=Mon, 7=Sun
DOM=$(date +%d)            # день месяца
LOG_FILE="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/monthly" "$BACKUP_DIR/files"

log() {
  local msg="[$(date +'%Y-%m-%d %H:%M:%S')] $1"
  echo "$msg" | tee -a "$LOG_FILE"
}

notify_telegram() {
  local status="$1"
  local message="$2"
  if [ -n "$TG_BOT_TOKEN" ] && [ -n "$TG_CHAT_ID" ]; then
    curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TG_CHAT_ID}" \
      -d text="🗄 КлиникСеть бэкап ${status}: ${message}" \
      -d parse_mode=HTML > /dev/null || true
  fi
}

# ── 1. Дамп БД ───────────────────────────────────────────────────────────────
log "Старт бэкапа"

DB_FILE_BASE="$BACKUP_DIR/daily/clinika-db-${DATE}.sql.gz"
log "Дамп БД..."

if ! docker exec clinika-db pg_dump -U clinika clinika 2>>"$LOG_FILE" | gzip > "$DB_FILE_BASE"; then
  log "ОШИБКА pg_dump"
  notify_telegram "❌" "pg_dump упал, см. $LOG_FILE"
  exit 1
fi

DB_FILE="$DB_FILE_BASE"
DB_SIZE=$(du -sh "$DB_FILE" | cut -f1)

# Шифрование если задан passphrase
if [ -n "$ENCRYPT_PASSPHRASE" ]; then
  log "Шифрование БД..."
  echo "$ENCRYPT_PASSPHRASE" | gpg --batch --yes --passphrase-fd 0 --symmetric --cipher-algo AES256 \
    --output "${DB_FILE_BASE}.gpg" "$DB_FILE_BASE"
  rm -f "$DB_FILE_BASE"
  DB_FILE="${DB_FILE_BASE}.gpg"
fi

log "БД сохранена: $(basename "$DB_FILE") ($DB_SIZE)"

# ── 2. Бэкап uploads (мед. документы пациентов) ──────────────────────────────
UPLOADS_FILE="$BACKUP_DIR/files/uploads-${DATE}.tar.gz"
if [ -d /opt/clinika/uploads ] && [ "$(ls -A /opt/clinika/uploads 2>/dev/null)" ]; then
  log "Архив uploads..."
  tar -C /opt/clinika -czf "$UPLOADS_FILE" uploads/ 2>>"$LOG_FILE"
  if [ -n "$ENCRYPT_PASSPHRASE" ]; then
    echo "$ENCRYPT_PASSPHRASE" | gpg --batch --yes --passphrase-fd 0 --symmetric --cipher-algo AES256 \
      --output "${UPLOADS_FILE}.gpg" "$UPLOADS_FILE"
    rm -f "$UPLOADS_FILE"
    UPLOADS_FILE="${UPLOADS_FILE}.gpg"
  fi
  UP_SIZE=$(du -sh "$UPLOADS_FILE" | cut -f1)
  log "uploads сохранены: $(basename "$UPLOADS_FILE") ($UP_SIZE)"
fi

# ── 3. Бэкап конфигов (.env + nginx) ─────────────────────────────────────────
CFG_FILE="$BACKUP_DIR/files/configs-${DATE}.tar.gz"
log "Архив конфигов..."
# Соберём только существующие пути (часть может отсутствовать в зависимости от инсталляции)
CFG_PATHS=()
[ -f /opt/clinika/.env ]                    && CFG_PATHS+=(-C /opt/clinika .env)
[ -f /opt/clinika/docker-compose.yml ]      && CFG_PATHS+=(-C /opt/clinika docker-compose.yml)
[ -d /etc/nginx ]                           && CFG_PATHS+=(-C /etc nginx)
[ -d /etc/letsencrypt ]                     && CFG_PATHS+=(--exclude='archive/*/[0-9][0-9].pem' -C /etc letsencrypt)
[ -f /etc/clinika-backup.env ]              && CFG_PATHS+=(-C /etc clinika-backup.env)
[ -f /etc/cron.d/clinika-backup ]           && CFG_PATHS+=(-C /etc/cron.d clinika-backup)
if [ ${#CFG_PATHS[@]} -gt 0 ]; then
  tar -czf "$CFG_FILE" "${CFG_PATHS[@]}" 2>>"$LOG_FILE" || true
  CFG_SIZE=$(du -sh "$CFG_FILE" 2>/dev/null | cut -f1)
  log "Конфиги сохранены: $(basename "$CFG_FILE") (${CFG_SIZE:-?})"
fi

if [ -n "$ENCRYPT_PASSPHRASE" ] && [ -f "$CFG_FILE" ]; then
  echo "$ENCRYPT_PASSPHRASE" | gpg --batch --yes --passphrase-fd 0 --symmetric --cipher-algo AES256 \
    --output "${CFG_FILE}.gpg" "$CFG_FILE"
  rm -f "$CFG_FILE"
  CFG_FILE="${CFG_FILE}.gpg"
fi

# ── 4. Месячная копия (1-го числа каждого месяца) ────────────────────────────
if [ "$DOM" = "01" ]; then
  cp "$DB_FILE" "$BACKUP_DIR/monthly/$(basename "$DB_FILE")"
  log "Создана месячная копия БД"
fi

# ── 5. Ротация ───────────────────────────────────────────────────────────────
log "Ротация локальных копий..."

# Хелпер: оставить только N последних (по mtime) файлов с заданным паттерном
rotate_keep() {
  local dir="$1"; local pattern="$2"; local keep="$3"
  [ -d "$dir" ] || return 0
  find "$dir" -maxdepth 1 -type f -name "$pattern" -printf "%T@ %p\n" 2>/dev/null \
    | sort -nr \
    | awk -v k="$keep" 'NR>k {print $2}' \
    | xargs -r rm -f || true
}

rotate_keep "$BACKUP_DIR/daily"   "*.gz"  14
rotate_keep "$BACKUP_DIR/daily"   "*.gpg" 14
rotate_keep "$BACKUP_DIR/monthly" "*.gz"  12
rotate_keep "$BACKUP_DIR/monthly" "*.gpg" 12
rotate_keep "$BACKUP_DIR/files"   "uploads-*" 7
rotate_keep "$BACKUP_DIR/files"   "configs-*" 7

# ── 6. Offsite через rclone ──────────────────────────────────────────────────
OFFSITE_OK=""
if [ -n "$RCLONE_REMOTE" ] && command -v rclone >/dev/null 2>&1; then
  log "Отправка offsite на $RCLONE_REMOTE:$RCLONE_PATH..."
  RCLONE_PATH="${RCLONE_PATH:-clinika-backups}"

  if rclone copy "$DB_FILE" "$RCLONE_REMOTE:$RCLONE_PATH/db/" --quiet 2>>"$LOG_FILE"; then
    OFFSITE_OK="db ✓"
  fi
  if [ -f "$UPLOADS_FILE" ]; then
    rclone copy "$UPLOADS_FILE" "$RCLONE_REMOTE:$RCLONE_PATH/files/" --quiet 2>>"$LOG_FILE" \
      && OFFSITE_OK="$OFFSITE_OK uploads ✓"
  fi
  if [ -f "$CFG_FILE" ]; then
    rclone copy "$CFG_FILE" "$RCLONE_REMOTE:$RCLONE_PATH/configs/" --quiet 2>>"$LOG_FILE" \
      && OFFSITE_OK="$OFFSITE_OK configs ✓"
  fi

  # Удаляем offsite файлы старше N дней
  RCLONE_RETENTION_DAYS="${RCLONE_RETENTION_DAYS:-90}"
  rclone delete "$RCLONE_REMOTE:$RCLONE_PATH/" --min-age "${RCLONE_RETENTION_DAYS}d" --quiet 2>>"$LOG_FILE" || true

  log "Offsite: $OFFSITE_OK"
else
  log "Offsite пропущен (RCLONE_REMOTE не задан или rclone не установлен)"
fi

# ── 7. Уведомление ───────────────────────────────────────────────────────────
SUMMARY="БД $DB_SIZE"
[ -f "$UPLOADS_FILE" ] && SUMMARY="$SUMMARY, uploads $(du -sh "$UPLOADS_FILE" | cut -f1)"
[ -n "$OFFSITE_OK" ] && SUMMARY="$SUMMARY, offsite [$OFFSITE_OK]"

log "Готово: $SUMMARY"
notify_telegram "✅" "$SUMMARY"
