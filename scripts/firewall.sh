#!/usr/bin/env bash
# Whitelist firewall для prod-сервера КлиникСеть (212.57.118.126)
# ВАЖНО: применяет правила ТОЛЬКО к INPUT, не трогает DOCKER-USER/FORWARD/OUTPUT.
# Использование:
#   ./firewall.sh apply       — backup + at-rollback через 5 мин + применить
#   ./firewall.sh confirm     — отменить запланированный откат (atrm)
#   ./firewall.sh rollback ID — немедленный откат из конкретного backup-файла
set -euo pipefail

BACKUP_DIR=/root
TS=$(date +%Y%m%d-%H%M%S)

# Whitelist портов: SSH-22, HTTP-80, HTTPS-443, TURN-3478/udp, TG-proxy-18080,
# почта 25/465/587/110/143/993/995, ISPmgr 1500/1501
TCP_PORTS=(22 25 80 110 143 443 465 587 993 995 1500 1501 18080)
UDP_PORTS=(3478)

apply_rules() {
  local backup="$BACKUP_DIR/iptables-backup-${TS}.rules"
  echo "[firewall] Saving backup to $backup"
  iptables-save > "$backup"

  echo "[firewall] Scheduling auto-rollback in 5 minutes via at"
  # Чистая команда восстановления — на случай если SSH отвалится.
  AT_JOB=$(echo "iptables-restore < $backup && logger -t firewall.sh \"AUTO-ROLLBACK executed from $backup\"" | at now + 5 minutes 2>&1 | awk "/^job/ {print \$2}")
  echo "$AT_JOB" > /tmp/firewall_at_job
  echo "[firewall] at-job id: $AT_JOB  (rollback file: $backup)"

  echo "[firewall] Flushing INPUT chain (ispmgr/ufw subchains остаются)"
  iptables -F INPUT
  iptables -P INPUT ACCEPT  # на случай если кто-то менял

  # 1. loopback
  iptables -A INPUT -i lo -j ACCEPT

  # 2. established/related
  iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

  # 3. ICMP (ping) — оставляем чтоб видеть availability
  iptables -A INPUT -p icmp -j ACCEPT

  # 4. ispmgr-цепочки (сохраняем существующую логику панели)
  iptables -A INPUT -j ispmgr_deny_ip
  iptables -A INPUT -j ispmgr_allow_ip
  iptables -A INPUT -j ispmgr_allow_sub
  iptables -A INPUT -j ispmgr_deny_sub
  iptables -A INPUT -m set --match-set ispmgr_limit_req src -j DROP || true

  # 5. whitelist портов
  for p in "${TCP_PORTS[@]}"; do
    iptables -A INPUT -p tcp --dport "$p" -m conntrack --ctstate NEW -j ACCEPT
  done
  for p in "${UDP_PORTS[@]}"; do
    iptables -A INPUT -p udp --dport "$p" -j ACCEPT
  done

  # 6. DROP всё остальное
  iptables -A INPUT -j DROP

  echo "[firewall] Rules applied. Verify SSH from NEW connection within 5 min, then run:"
  echo "           /opt/clinika/scripts/firewall.sh confirm"
}

confirm_rules() {
  if [[ -f /tmp/firewall_at_job ]]; then
    JOB=$(cat /tmp/firewall_at_job)
    atrm "$JOB" && echo "[firewall] Auto-rollback job $JOB cancelled." || echo "[firewall] atrm failed (job уже выполнен?)"
    rm -f /tmp/firewall_at_job
  else
    echo "[firewall] No pending rollback job."
  fi
}

case "${1:-}" in
  apply)    apply_rules ;;
  confirm)  confirm_rules ;;
  rollback) iptables-restore < "$2" ;;
  *)        echo "Usage: $0 {apply|confirm|rollback <backup>}"; exit 1 ;;
esac
