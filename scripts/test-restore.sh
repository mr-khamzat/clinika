#!/bin/bash
# Phase 3: тест восстановления зашифрованного бэкапа на временную PG-инстансу.
# Запускать раз в неделю чтобы проверить что бэкап действительно восстанавливается.
set -eo pipefail
[ -f /etc/clinika-backup.env ] && source /etc/clinika-backup.env

LATEST=$(ls -t /opt/clinika/backups/daily/clinika-db-*.sql.gz.gpg 2>/dev/null | head -1)
[ -z "$LATEST" ] && { echo 'Encrypted backup not found, нет файлов .sql.gz.gpg'; exit 1; }

echo "Testing restore of: $LATEST"

# Расшифровка и распаковка во временный файл
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR; docker rm -f clinika-restore-test 2>/dev/null" EXIT

gpg --batch --yes --passphrase "$ENCRYPT_PASSPHRASE" --decrypt "$LATEST" 2>/dev/null | gunzip > $TMPDIR/dump.sql
echo "Decrypted: $(wc -l < $TMPDIR/dump.sql) lines"

# Поднимаем временный postgres
docker run -d --name clinika-restore-test \
  -e POSTGRES_PASSWORD=test123 \
  -e POSTGRES_DB=clinika_test \
  postgres:16-alpine > /dev/null
sleep 5

# Применяем dump
docker exec -i clinika-restore-test psql -U postgres -d clinika_test < $TMPDIR/dump.sql > /tmp/restore.log 2>&1
RESULT=$?

# Проверяем что таблицы восстановились
TABLES=$(docker exec clinika-restore-test psql -U postgres -d clinika_test -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
USERS=$(docker exec clinika-restore-test psql -U postgres -d clinika_test -t -c "SELECT count(*) FROM users" 2>/dev/null || echo 0)

echo "Tables: $TABLES, Users: $USERS"
[ "$RESULT" -eq 0 ] && [ "$TABLES" -gt 50 ] && echo "✓ Restore OK" || { echo "✗ Restore FAILED"; tail /tmp/restore.log; exit 1; }
