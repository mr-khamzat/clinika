#!/usr/bin/env bash
# Скачивает свежую гео-IP базу dbip-city-lite (формат совместим с MaxMind GeoLite2).
# Источник: https://download.db-ip.com/free/dbip-city-lite-YYYY-MM.mmdb.gz (public, без аутентификации).
# Атомарно подменяет /app/data/GeoLite2-City.mmdb.
#
# Запускается:
#   - APScheduler-job geoip_update (каждый понедельник 03:00)
#   - вручную при первом деплое:
#       docker compose exec clinika-backend bash /app/scripts/download_geoip.sh
set -euo pipefail

DEST_DIR="${GEOIP_DIR:-/app/data}"
DEST_FILE="${DEST_DIR}/GeoLite2-City.mmdb"
TMP_FILE="$(mktemp /tmp/geoip.XXXXXX.mmdb.new)"
trap 'rm -f "$TMP_FILE"' EXIT

mkdir -p "$DEST_DIR"

# Текущий месяц YYYY-MM. На 1-2 числа dbip может ещё не выложить — fallback на предыдущий.
month_curr="$(date -u +%Y-%m)"
month_prev="$(date -u -d "$(date -u +%Y-%m-01) -1 day" +%Y-%m 2>/dev/null || date -u -v-1m +%Y-%m 2>/dev/null || echo "$month_curr")"

URL_CURR="https://download.db-ip.com/free/dbip-city-lite-${month_curr}.mmdb.gz"
URL_PREV="https://download.db-ip.com/free/dbip-city-lite-${month_prev}.mmdb.gz"

download_one() {
    local url="$1"
    echo "geoip: пробую $url"
    if curl -fsSL --max-time 120 --retry 2 "$url" | gunzip > "$TMP_FILE" 2>/dev/null; then
        # Sanity check — файл должен быть >1MB
        local size; size=$(stat -c%s "$TMP_FILE" 2>/dev/null || stat -f%z "$TMP_FILE" 2>/dev/null || echo 0)
        if [ "$size" -gt 1000000 ]; then
            return 0
        fi
        echo "geoip: подозрительно маленький файл ($size байт), пропускаю"
    fi
    return 1
}

if ! download_one "$URL_CURR"; then
    if ! download_one "$URL_PREV"; then
        echo "geoip: НЕ УДАЛОСЬ скачать ни один из источников" >&2
        exit 1
    fi
fi

# Атомарная замена
mv -f "$TMP_FILE" "$DEST_FILE"
trap - EXIT
echo "geoip: обновлено $DEST_FILE ($(stat -c%s "$DEST_FILE" 2>/dev/null || stat -f%z "$DEST_FILE") байт)"
