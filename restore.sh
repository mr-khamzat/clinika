#!/bin/bash
# КлиникСеть — восстановление из бэкапа.
#
# Использование:
#   ./restore.sh <db|uploads|configs|all> <путь_к_бэкапу_или_дате>
#
# Примеры:
#   ./restore.sh db /opt/clinika/backups/daily/clinika-db-20260506-030000.sql.gz
#   ./restore.sh db 20260506              # автопоиск daily-копии за дату
#   ./restore.sh uploads 20260506
#   ./restore.sh all 20260506              # БД + uploads + конфиги
#
# Если файл .gpg — спросит пароль (или ENCRYPT_PASSPHRASE из env).

set -eo pipefail

[ -f /etc/clinika-backup.env ] && source /etc/clinika-backup.env
BACKUP_DIR="${BACKUP_DIR:-/opt/clinika/backups}"

usage() {
  cat <<EOF
Использование: $0 <db|uploads|configs|all> <путь_или_дата>

Примеры:
  $0 db <путь.sql.gz[.gpg]>
  $0 db 20260506              # ищет daily/clinika-db-20260506-*.sql.gz[.gpg]
  $0 uploads 20260506
  $0 all 20260506
EOF
  exit 1
}

[ $# -eq 2 ] || usage
TYPE="$1"
TARGET="$2"

# Поиск файла по дате
find_by_date() {
  local prefix="$1"
  local date="$2"
  local subdir="$3"
  local found
  found=$(ls -t "$BACKUP_DIR/$subdir/${prefix}-${date}"* 2>/dev/null | head -1)
  if [ -z "$found" ]; then
    echo "Не найдено: $BACKUP_DIR/$subdir/${prefix}-${date}*"
    exit 2
  fi
  echo "$found"
}

# Расшифровка gpg → выводит путь к разшифрованному файлу
decrypt_if_needed() {
  local file="$1"
  case "$file" in
    *.gpg)
      local out="${file%.gpg}"
      if [ -z "$ENCRYPT_PASSPHRASE" ]; then
        echo "Файл зашифрован. Введи пароль:" >&2
        read -s ENCRYPT_PASSPHRASE
        export ENCRYPT_PASSPHRASE
      fi
      echo "$ENCRYPT_PASSPHRASE" | gpg --batch --yes --passphrase-fd 0 \
        --output "$out" --decrypt "$file" 2>/dev/null
      echo "$out"
      ;;
    *)
      echo "$file"
      ;;
  esac
}

restore_db() {
  local file="$1"
  if [ ! -f "$file" ]; then
    file=$(find_by_date "clinika-db" "$file" "daily")
  fi
  echo "▶ Восстановление БД из: $file"
  local plain
  plain=$(decrypt_if_needed "$file")

  echo "⚠ ВНИМАНИЕ: текущая БД 'clinika' будет ПОЛНОСТЬЮ ПЕРЕЗАПИСАНА"
  read -p "Продолжить? (yes/нет): " confirm
  [ "$confirm" = "yes" ] || { echo "Отмена"; return 1; }

  echo "Создание тестовой БД 'clinika_restore_test' для проверки..."
  docker exec clinika-db psql -U clinika -d postgres -c "DROP DATABASE IF EXISTS clinika_restore_test"
  docker exec clinika-db psql -U clinika -d postgres -c "CREATE DATABASE clinika_restore_test"

  echo "Восстановление в тестовую БД..."
  gunzip -c "$plain" | docker exec -i clinika-db psql -U clinika -d clinika_restore_test > /dev/null

  echo "✓ Тестовая БД создана. Проверь: docker exec -it clinika-db psql -U clinika -d clinika_restore_test"
  echo
  read -p "Применить к боевой clinika? (yes/нет): " apply
  if [ "$apply" = "yes" ]; then
    echo "Останавливаем backend..."
    docker compose -f /opt/clinika/docker-compose.yml stop clinika-backend

    docker exec clinika-db psql -U clinika -d postgres -c "DROP DATABASE clinika"
    docker exec clinika-db psql -U clinika -d postgres -c "CREATE DATABASE clinika"
    gunzip -c "$plain" | docker exec -i clinika-db psql -U clinika -d clinika > /dev/null

    docker compose -f /opt/clinika/docker-compose.yml start clinika-backend
    echo "✓ БД восстановлена. Backend перезапущен."

    docker exec clinika-db psql -U clinika -d postgres -c "DROP DATABASE clinika_restore_test"
  else
    echo "Боевая БД не тронута. Тестовая 'clinika_restore_test' оставлена для анализа."
  fi

  [ "$plain" != "$file" ] && rm -f "$plain"
}

restore_uploads() {
  local file="$1"
  if [ ! -f "$file" ]; then
    file=$(find_by_date "uploads" "$file" "files")
  fi
  echo "▶ Восстановление uploads из: $file"
  local plain
  plain=$(decrypt_if_needed "$file")

  echo "⚠ Текущая папка /opt/clinika/uploads будет переименована в .backup-<timestamp>"
  if [ -d /opt/clinika/uploads ]; then
    mv /opt/clinika/uploads "/opt/clinika/uploads.backup-$(date +%s)"
  fi
  tar -C /opt/clinika -xzf "$plain"
  chown -R 1000:1000 /opt/clinika/uploads || true
  echo "✓ uploads восстановлены"

  [ "$plain" != "$file" ] && rm -f "$plain"
}

restore_configs() {
  local file="$1"
  if [ ! -f "$file" ]; then
    file=$(find_by_date "configs" "$file" "files")
  fi
  echo "▶ Восстановление конфигов из: $file"
  echo "⚠ ВНИМАНИЕ: распакуем в /tmp/clinika-configs-restore/, перенос вручную (чтобы не сломать боевой)"
  local plain
  plain=$(decrypt_if_needed "$file")

  mkdir -p /tmp/clinika-configs-restore
  tar -C /tmp/clinika-configs-restore -xzf "$plain"
  echo "✓ Распаковано в /tmp/clinika-configs-restore/"
  ls -la /tmp/clinika-configs-restore/

  [ "$plain" != "$file" ] && rm -f "$plain"
}

case "$TYPE" in
  db)       restore_db "$TARGET" ;;
  uploads)  restore_uploads "$TARGET" ;;
  configs)  restore_configs "$TARGET" ;;
  all)
    restore_db "$TARGET"
    restore_uploads "$TARGET"
    restore_configs "$TARGET"
    ;;
  *)        usage ;;
esac
