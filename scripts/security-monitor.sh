#!/bin/bash
# Security monitor для сервера Клиники — алёрты в TG при изменениях
# Запускается каждые 5 минут через cron

TG_TOKEN="8689519551:AAHeH7apnU-gZfL59w8aBTpLrhDW5IdcIHU"
TG_CHAT="293633093"
STATE_DIR="/var/lib/clinika-monitor"
STATE_FILE="$STATE_DIR/state.txt"
ALERT_FILE="$STATE_DIR/last_alerts.txt"
MY_IP="144.31.89.167"  # IP откуда я (Claude) захожу — алёрт если кто-то другой

mkdir -p "$STATE_DIR"
touch "$STATE_FILE" "$ALERT_FILE"

# Защита от спама: алёрт того же типа не чаще раз в час
LAST_HOUR=$(date +%s -d "1 hour ago")

send_tg() {
    local key="$1" msg="$2"
    # Проверить когда был последний алёрт этого ключа
    local last=$(grep "^${key}:" "$ALERT_FILE" | tail -1 | cut -d: -f2)
    if [ -n "$last" ] && [ "$last" -gt "$LAST_HOUR" ]; then
        return  # уже слали в последний час
    fi
    curl -sS -X POST "https://api.telegram.org/bot$TG_TOKEN/sendMessage" \
        -d chat_id="$TG_CHAT" --data-urlencode text="$msg" > /dev/null 2>&1
    # запомнить время
    echo "${key}:$(date +%s)" >> "$ALERT_FILE"
    # обрезать файл если больше 1000 строк
    [ $(wc -l < "$ALERT_FILE") -gt 1000 ] && tail -500 "$ALERT_FILE" > "$ALERT_FILE.tmp" && mv "$ALERT_FILE.tmp" "$ALERT_FILE"
}

# ── 1. Load average ────────────────────────────────────────────────
LOAD=$(awk "{print int(\$1)}" /proc/loadavg)
if [ "$LOAD" -gt 10 ]; then
    send_tg "load_high" "⚠️ Сервер Клиники: high load $LOAD (норма ≤8 для 8 CPU). Топ процессов:
$(ps -eo pcpu,pmem,comm --sort=-pcpu --no-headers | head -5)"
fi

# ── 2. Disk usage ──────────────────────────────────────────────────
DISK=$(df / | awk "NR==2 {gsub(/%/,\"\"); print \$5}")
if [ "$DISK" -gt 80 ]; then
    send_tg "disk_high" "⚠️ Сервер Клиники: disk usage $DISK% / (>80%). Запусти clinika-cleanup.sh"
fi

# ── 3. RAM available ───────────────────────────────────────────────
RAM_MB=$(free -m | awk "/^Mem:/ {print \$NF}")
if [ "$RAM_MB" -lt 800 ]; then
    send_tg "ram_low" "⚠️ Сервер Клиники: MemAvailable ${RAM_MB} MB (<800 MB)"
fi

# ── 4. fail2ban новые баны ─────────────────────────────────────────
BANNED=$(fail2ban-client status sshd 2>/dev/null | grep "Currently banned" | grep -oE "[0-9]+\$")
BANNED=${BANNED:-0}
LAST_BANNED=$(grep "^banned:" "$STATE_FILE" | tail -1 | cut -d: -f2 || echo 0)
LAST_BANNED=${LAST_BANNED:-0}
if [ "$BANNED" -gt "$LAST_BANNED" ]; then
    DIFF=$((BANNED - LAST_BANNED))
    IPS=$(fail2ban-client status sshd | grep "Banned IP list" | sed "s/.*://")
    send_tg "ban_new_${DIFF}" "🛡 fail2ban забанил +${DIFF} IP (всего ${BANNED}). Текущий список:${IPS}"
fi
echo "banned:${BANNED}" > "$STATE_FILE"

# ── 5. SSH успешные логины не от меня (за последние 5 мин) ─────────
RECENT_LOGINS=$(journalctl -u ssh --since "5 minutes ago" 2>/dev/null | grep "Accepted" | grep -v "$MY_IP" | head -5)
if [ -n "$RECENT_LOGINS" ]; then
    # хеш для дедупа
    HASH=$(echo "$RECENT_LOGINS" | md5sum | cut -c1-8)
    send_tg "ssh_${HASH}" "🚨 НЕИЗВЕСТНЫЙ SSH-логин на сервер Клиники:
${RECENT_LOGINS}"
fi

# ── 6. Backend health ──────────────────────────────────────────────
HTTP=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 https://клиниксеть.рф/api/health)
if [ "$HTTP" != "200" ]; then
    send_tg "be_down" "🚨 Backend Клиники не отвечает: HTTP $HTTP (https://клиниксеть.рф/api/health)"
fi

# ── 7. Подозрительные процессы (xmrig, miner, cryptonight) ──────────
SUSPICIOUS=$(ps -eo pid,comm,args --no-headers | grep -iE "xmrig|cryptonight|kryptex|miner|stratum\+tcp" | grep -v grep | head -5)
if [ -n "$SUSPICIOUS" ]; then
    send_tg "miner_back" "🚨 ОБНАРУЖЕН МАЙНЕР на сервере Клиники!
${SUSPICIOUS}"
fi

# ── 8. /usr/local/bin/systemd (маскировка malware) ─────────────────
if [ -f /usr/local/bin/systemd ]; then
    send_tg "fake_systemd" "🚨 Появился /usr/local/bin/systemd (вероятно malware маскировка). Проверь!"
fi

exit 0
