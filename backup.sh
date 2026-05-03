#!/bin/bash
set -e
BACKUP_DIR=/opt/clinika/backups
DATE=$(date +%Y%m%d-%H%M)
FILE=$BACKUP_DIR/clinika-$DATE.sql.gz

mkdir -p "$BACKUP_DIR"
docker exec clinika-db pg_dump -U clinika clinika | gzip > "$FILE"
ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "[$(date)] Backup OK: $FILE ($(du -sh "$FILE" | cut -f1))"
