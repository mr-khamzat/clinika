#!/bin/bash
# /opt/clinika/scripts/clinika-cleanup.sh
# Еженедельная очистка диска. Запускается из cron.
# 1. Удаляет docker build cache старше 7 дней (build cache пересоздаётся при build)
# 2. Удаляет старые pg_dump > 30 дней (бэкапы в /opt/clinika/backups/daily/)
# 3. НЕ трогает активные images/contairners/volumes — только мусор.

set -e
LOG=/var/log/clinika-cleanup.log
echo "=== $(date -Iseconds) clinika-cleanup START ===" >> "$LOG"

# 1. Build cache
docker builder prune -af --filter "until=168h" 2>&1 | tail -2 >> "$LOG"

# 2. Dangling images
docker image prune -f 2>&1 | tail -1 >> "$LOG"

# 3. Старые pg_dump
BKP_DIR=/opt/clinika/backups/daily
if [ -d "$BKP_DIR" ]; then
  REMOVED=$(find "$BKP_DIR" -name "clinika-db-*.sql.gz" -type f -mtime +30 -delete -print | wc -l)
  echo "removed old backups: $REMOVED" >> "$LOG"
fi

# 4. Если /var/log/journal больше 500MB — обрезать
if command -v journalctl >/dev/null; then
  journalctl --vacuum-size=200M >> "$LOG" 2>&1 || true
fi

# 5. Disk usage отчёт
df -h / | tail -1 >> "$LOG"
echo "=== $(date -Iseconds) clinika-cleanup END ===" >> "$LOG"
