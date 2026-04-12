#!/bin/bash
# Импорт БД на новом сервере (запускать ПОСЛЕ deploy.sh)
# Запуск: bash migrate-db-import.sh /path/to/backup-migrate-ДАТА.tar.gz

set -e
BACKUP="${1}"

if [ -z "$BACKUP" ] || [ ! -f "$BACKUP" ]; then
    echo "Использование: bash migrate-db-import.sh /path/to/backup.tar.gz"
    exit 1
fi

TMPDIR=$(mktemp -d)
tar -xzf "$BACKUP" -C "$TMPDIR"

echo "[1/4] Ждём базы данных..."
sleep 5

echo "[2/4] Восстановление clinika DB..."
if [ -f "$TMPDIR/clinika.sql" ]; then
    # Очищаем и восстанавливаем
    docker exec -i clinika-db psql -U clinika -d clinika < "$TMPDIR/clinika.sql"
    echo "  ✓ clinika DB восстановлена"
fi

echo "[3/4] Восстановление clinika-hub DB..."
if [ -f "$TMPDIR/clinikahub.sql" ]; then
    docker exec -i clinika-hub-db psql -U hub -d clinikahub < "$TMPDIR/clinikahub.sql"
    echo "  ✓ clinika-hub DB восстановлена"
fi

echo "[4/4] Применение .env файлов..."
if [ -f "$TMPDIR/clinika.env" ]; then
    # Обновляем только секреты, URL оставляем от deploy.sh
    echo "  → Проверь /opt/clinika/.env — возможно нужно обновить TELEGRAM_BOT_TOKEN"
fi

rm -rf "$TMPDIR"

echo ""
echo "✓ Импорт завершён!"
echo ""
echo "Перезапускаем контейнеры..."
docker compose -f /opt/clinika/docker-compose.yml restart
docker compose -f /opt/clinika-hub/docker-compose.yml restart 2>/dev/null || true
echo "✓ Готово!"
