#!/bin/bash
# =============================================================
# Clinika — Deploy / Migrate script
# Запуск: bash deploy.sh [domain] [email]
# Пример: bash deploy.sh clinika.yourdomain.ru admin@yourdomain.ru
# =============================================================
set -e

DOMAIN="${1:-clinika.example.com}"
EMAIL="${2:-admin@example.com}"
INSTALL_DIR="/opt/clinika"
HUB_DIR="/opt/clinika-hub"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "╔══════════════════════════════════════╗"
echo "║        Clinika Deploy Script         ║"
echo "╚══════════════════════════════════════╝"
echo ""
info "Домен: $DOMAIN"
info "Email: $EMAIL"
echo ""

# ──────────────────────────────────────
# 1. Зависимости
# ──────────────────────────────────────
log "Проверка зависимостей..."

if ! command -v docker &>/dev/null; then
    warn "Docker не установлен. Устанавливаю..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    log "Docker установлен"
fi

if ! command -v docker compose version &>/dev/null 2>&1; then
    warn "Docker Compose plugin не найден. Устанавливаю..."
    apt-get update -qq && apt-get install -y -qq docker-compose-plugin
fi

if ! command -v nginx &>/dev/null; then
    warn "nginx не установлен. Устанавливаю..."
    apt-get update -qq && apt-get install -y -qq nginx
    systemctl enable --now nginx
fi

if ! command -v certbot &>/dev/null; then
    warn "certbot не установлен. Устанавливаю..."
    apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx
fi

log "Все зависимости установлены"

# ──────────────────────────────────────
# 2. Клонирование репозиториев
# ──────────────────────────────────────
log "Клонирование clinika..."
if [ -d "$INSTALL_DIR" ]; then
    warn "Папка $INSTALL_DIR уже существует — делаю git pull"
    git -C "$INSTALL_DIR" pull origin main
else
    git clone https://github.com/mr-khamzat/clinika.git "$INSTALL_DIR"
fi

log "Клонирование clinika-hub..."
if [ -d "$HUB_DIR" ]; then
    warn "Папка $HUB_DIR уже существует — делаю git pull"
    git -C "$HUB_DIR" pull origin main
else
    git clone https://github.com/mr-khamzat/clinika-hub.git "$HUB_DIR"
fi

# ──────────────────────────────────────
# 3. .env файлы
# ──────────────────────────────────────
if [ ! -f "$INSTALL_DIR/.env" ]; then
    log "Создаю $INSTALL_DIR/.env..."
    SECRET=$(openssl rand -hex 32)
    QR_SECRET=$(openssl rand -hex 16)
    cat > "$INSTALL_DIR/.env" << EOF
DATABASE_URL=postgresql://clinika:clinika_pass@clinika-db:5432/clinika
REDIS_URL=redis://clinika-redis:6379
SECRET_KEY=${SECRET}
JWT_ALGORITHM=HS256
JWT_EXPIRE_HOURS=24
QR_SECRET=${QR_SECRET}
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN_HERE
MINI_APP_URL=https://${DOMAIN}/clinika
BACKEND_URL=https://${DOMAIN}/clinika/api
MANAGER_TELEGRAM_IDS=
HUB_URL=https://${DOMAIN}
LICENSE_KEY=
EOF
    warn "Заполни TELEGRAM_BOT_TOKEN и MANAGER_TELEGRAM_IDS в $INSTALL_DIR/.env"
else
    log ".env уже существует — пропускаю"
fi

if [ ! -f "$HUB_DIR/.env" ]; then
    log "Создаю $HUB_DIR/.env..."
    HUB_SECRET=$(openssl rand -hex 32)
    cat > "$HUB_DIR/.env" << EOF
DATABASE_URL=postgresql://hub:hub_pass@hub-db:5432/clinikahub
SECRET_KEY=${HUB_SECRET}
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$(openssl rand -base64 12)
EOF
    warn "Проверь пароль Admin Hub в $HUB_DIR/.env"
else
    log "Hub .env уже существует — пропускаю"
fi

# ──────────────────────────────────────
# 4. SSL сертификат (TLS-ALPN-01)
# ──────────────────────────────────────
log "Получение SSL сертификата для $DOMAIN..."

# Временно ставим заглушку nginx для certbot
cat > /etc/nginx/sites-available/clinika-temp << EOF
server {
    listen 80;
    server_name ${DOMAIN};
    location / { return 200 "ok"; }
}
EOF
ln -sf /etc/nginx/sites-available/clinika-temp /etc/nginx/sites-enabled/clinika-temp 2>/dev/null || true
nginx -t && nginx -s reload 2>/dev/null || nginx

if certbot --nginx -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive --redirect; then
    log "SSL сертификат получен"
else
    warn "Не удалось получить SSL. Продолжаю без SSL (http)."
fi
rm -f /etc/nginx/sites-enabled/clinika-temp /etc/nginx/sites-available/clinika-temp

# ──────────────────────────────────────
# 5. nginx конфиг
# ──────────────────────────────────────
log "Настройка nginx..."
cat > /etc/nginx/sites-available/clinika << EOF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    add_header Strict-Transport-Security "max-age=63072000" always;

    # Clinika Hub
    location = /hub { return 301 /hub/; }
    location ^~ /hub/ {
        proxy_pass http://127.0.0.1:8911/hub/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }

    # Clinika App
    location = /clinika { return 301 /clinika/; }
    location ^~ /clinika/ {
        proxy_pass http://127.0.0.1:8901/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        client_max_body_size 20m;
    }
}
EOF
ln -sf /etc/nginx/sites-available/clinika /etc/nginx/sites-enabled/clinika
nginx -t && nginx -s reload
log "nginx настроен"

# ──────────────────────────────────────
# 6. Запуск Docker контейнеров
# ──────────────────────────────────────
log "Запуск Clinika..."
docker compose -f "$INSTALL_DIR/docker-compose.yml" up -d --build

log "Запуск Clinika Hub..."
docker compose -f "$HUB_DIR/docker-compose.yml" up -d --build

# ──────────────────────────────────────
# 7. Итог
# ──────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║              Деплой завершён!                        ║"
echo "╠══════════════════════════════════════════════════════╣"
printf "║  Clinika App:  https://%-31s║\n" "${DOMAIN}/clinika/"
printf "║  Clinika Hub:  https://%-31s║\n" "${DOMAIN}/hub/"
printf "║  Admin Panel:  https://%-31s║\n" "${DOMAIN}/clinika/admin"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Следующие шаги:                                     ║"
echo "║  1. Заполни TELEGRAM_BOT_TOKEN в .env               ║"
echo "║  2. Выдай лицензию в Hub и запиши в LICENSE_KEY     ║"
echo "║  3. Настрой Telegram Mini App URL в BotFather       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
