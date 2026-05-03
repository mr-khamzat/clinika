#!/bin/bash
LOG=/var/log/clinika-health.log
DATE=$(date "+%Y-%m-%d %H:%M:%S")

check_http() {
  local url=$1 name=$2
  local code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null)
  if [ "$code" != "200" ]; then
    echo "[$DATE] ❌ $name DOWN (HTTP $code)" >> $LOG
    # Перезапускаем backend если он не отвечает
    if [ "$name" = "backend" ]; then
      cd /opt/clinika && docker compose restart clinika-backend >> $LOG 2>&1
      echo "[$DATE] 🔄 clinika-backend restarted" >> $LOG
    fi
    return 1
  fi
  return 0
}

check_http "http://127.0.0.1:8900/health" "backend"
check_http "http://127.0.0.1:8901" "frontend"

# Проверяем что все контейнеры живы
for svc in clinika-backend clinika-frontend clinika-db clinika-redis; do
  STATUS=$(docker inspect --format="{{.State.Status}}" $svc 2>/dev/null)
  if [ "$STATUS" != "running" ]; then
    echo "[$DATE] ❌ Container $svc is $STATUS — restarting" >> $LOG
    cd /opt/clinika && docker compose start ${svc#clinika-} >> $LOG 2>&1
  fi
done
