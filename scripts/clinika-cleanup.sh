#!/bin/bash
# /opt/clinika/scripts/clinika-cleanup.sh
# Ежедневная очистка диска. Запускается из cron.
# Без этого скрипта /var/lib/docker растёт на ~3-5 GB за rebuild.
# 1. Build cache > 24 часа — удаляется (пересоздаётся при следующем build)
# 2. ВСЕ неиспользуемые images (не только dangling) — удаляются
# 3. Backup pg_dump > 30 дней — удаляются
# 4. journalctl > 200MB — обрезается

set -e
LOG=/var/log/clinika-cleanup.log
echo "=== $(date -Iseconds) clinika-cleanup START ===" >> "$LOG"

# 1. Build cache > 24 часа (раньше было 7 дней — слишком долго при частых rebuild'ах)
docker builder prune -af --filter "until=24h" 2>&1 | tail -2 >> "$LOG"

# 2. Все неиспользуемые images (не только dangling — `-a` флаг) > 24 часа
# Активные не трогаем (они нужны контейнерам). Старые версии — в мусор.
docker image prune -af --filter "until=24h" 2>&1 | tail -1 >> "$LOG"

# 3. Старые pg_dump (> 30 дней)
BKP_DIR=/opt/clinika/backups/daily
if [ -d "$BKP_DIR" ]; then
  REMOVED=$(find "$BKP_DIR" -name "clinika-db-*.sql.gz" -type f -mtime +30 -delete -print | wc -l)
  echo "removed old daily backups: $REMOVED" >> "$LOG"
fi
# Migration-бэкапы (> 60 дней — они для истории миграций)
MIG_DIR=/opt/clinika/backups/migrations
if [ -d "$MIG_DIR" ]; then
  REMOVED_MIG=$(find "$MIG_DIR" -name "*.dump" -type f -mtime +60 -delete -print | wc -l)
  echo "removed old migration dumps: $REMOVED_MIG" >> "$LOG"
fi

# 4. journalctl
if command -v journalctl >/dev/null; then
  journalctl --vacuum-size=200M >> "$LOG" 2>&1 || true
fi

# 5. apt cache (если есть)
if command -v apt-get >/dev/null; then
  apt-get clean >> "$LOG" 2>&1 || true
fi

# 6. Disk usage отчёт
df -h / | tail -1 >> "$LOG"
echo "=== $(date -Iseconds) clinika-cleanup END ===" >> "$LOG"
