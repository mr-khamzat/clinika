#!/bin/bash
# Экспорт БД перед переносом на новый сервер
# Запуск: bash migrate-db-export.sh
# Результат: backup-migrate-ДАТА.tar.gz в текущей папке

set -e
DATE=$(date +%Y%m%d-%H%M)
BACKUP="backup-migrate-${DATE}.tar.gz"
TMPDIR=$(mktemp -d)

echo "[1/4] Дамп clinika PostgreSQL..."
docker exec clinika-db pg_dump -U clinika clinika > "$TMPDIR/clinika.sql"

echo "[2/4] Дамп clinika-hub PostgreSQL..."
docker exec clinika-hub-db pg_dump -U hub clinikahub > "$TMPDIR/clinikahub.sql" 2>/dev/null || echo "  Hub DB пропущен (нет контейнера)"

echo "[3/4] Копирование .env файлов..."
cp /opt/clinika/.env "$TMPDIR/clinika.env" 2>/dev/null || true
cp /opt/clinika-hub/.env "$TMPDIR/clinikahub.env" 2>/dev/null || true

echo "[4/4] Упаковка архива..."
tar -czf "$BACKUP" -C "$TMPDIR" .
rm -rf "$TMPDIR"

echo ""
echo "✓ Бэкап готов: $BACKUP ($(du -sh $BACKUP | cut -f1))"
echo ""
echo "Перенос на новый сервер:"
echo "  scp $BACKUP root@NEW_SERVER_IP:/root/"
echo "  ssh root@NEW_SERVER_IP 'bash /opt/clinika/migrate-db-import.sh /root/$BACKUP'"
