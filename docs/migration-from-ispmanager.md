# План: уход от ispmanager на dedicated host

## Контекст

Сервер `theend95.fvds.ru` (212.57.118.126, FirstByte) — это general-purpose
hosting box с **ispmanager**, который тащит за собой:

- PHP-FPM 5.6 / 7.4 / 8.4
- Apache (для PHP-сайтов)
- MySQL
- Exim (SMTP)
- Dovecot (IMAP/POP3)
- BIND (DNS)
- ProFTPD (FTP)
- Roundcube (webmail)
- Свой iptables-перехватчик правил (ispmgr_allow_*)

Все эти сервисы НЕ относятся к нашему проекту Клиника. Из стека Клиники
нужны только: docker + postgres-в-docker + nginx + certbot.

ispmanager расширяет attack surface: лишние порты, лишние процессы, лишние
обновляемые пакеты (которые периодически ломают dpkg-цепочку, как сегодня).

---

## Два пути

### Путь A — «Чистая миграция» на новый VPS (рекомендуется)

Самый правильный, но трудоёмкий.

#### Что нужно подготовить

1. Новый VPS у FirstByte (или другого провайдера) с такими ресурсами:
   - 4 vCPU, 8 GB RAM, 100 GB SSD (текущие нагрузки нам с запасом)
   - Ubuntu 24.04 LTS, чистая
   - **БЕЗ ispmanager / panels** — bare OS
2. SSH-ключ для root (без пароля)
3. UFW настроенный с самого начала (22, 80, 443, 3478/5349 + coturn UDP-range)

#### Шаги миграции

```bash
# 1. На новом VPS — базовая подготовка
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx \
                ufw fail2ban git curl wget htop sshpass

# 2. UFW base
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp && ufw allow 3478/udp
ufw allow 5349/tcp && ufw allow 5349/udp
ufw allow 49152:65535/udp comment 'coturn relay'
ufw enable
systemctl enable ufw

# 3. Клонируем репо
mkdir -p /opt/clinika
cd /opt/clinika
git clone https://github.com/mr-khamzat/clinika.git .

# 4. Дамп БД со старого сервера
ssh root@212.57.118.126 'docker exec clinika-db pg_dump -U clinika -d clinika -Fc -f /tmp/clinika.dump'
scp root@212.57.118.126:/tmp/clinika.dump /tmp/clinika.dump

# 5. Перенос uploads, downloads, configs со старого
rsync -avz root@212.57.118.126:/opt/clinika/uploads/ /opt/clinika/uploads/
rsync -avz root@212.57.118.126:/opt/clinika/downloads/ /opt/clinika/downloads/
rsync -avz root@212.57.118.126:/opt/clinika/data/ /opt/clinika/data/
scp root@212.57.118.126:/opt/clinika/.env /opt/clinika/.env

# 6. Запуск стека
cd /opt/clinika
docker compose up -d
sleep 30

# 7. Restore БД
cat /tmp/clinika.dump | docker exec -i clinika-db pg_restore -U clinika -d clinika --clean --if-exists

# 8. SSL сертификаты — certbot перевыпустит на новом IP
certbot --nginx -d xn--e1afagcdp8ak4h.xn--p1ai -d клиниксеть.рф \
        --email admin@clinikset.ru --agree-tos --redirect

# 9. Переключение DNS
# В личном кабинете регистратора домена (или Cloudflare):
# A-запись xn--e1afagcdp8ak4h.xn--p1ai → новый IP
# TTL заранее уменьшить до 300 за день до миграции

# 10. Финал-проверка
curl https://xn--e1afagcdp8ak4h.xn--p1ai/arc/api/health
# Должно вернуть 200 OK

# 11. Старый сервер — оставить ещё на 7 дней (TTL DNS), затем выключить
```

#### Downtime в Path A
- Если делать с переключением DNS — несколько минут (после propagation)
- Для нулевого downtime можно использовать reverse proxy на старом сервере → новый, и переключать постепенно

---

### Путь B — «Чистка на месте» (быстрее, но не идеально)

На том же сервере отключить ispmanager-сервисы, но не удалять (чтобы не сломать dpkg).

#### Шаги

```bash
# 1. Backup конфигов ispmanager (на случай если придётся восстановить)
tar czf /root/ispmanager-backup-$(date +%Y%m%d).tar.gz \
        /usr/local/mgr5 /etc/exim* /etc/dovecot /etc/apache2 \
        2>/dev/null || true

# 2. Останавливаем и отключаем сервисы
for svc in exim4 dovecot apache2 mysql proftpd bind9 \
           isp-php56-fpm isp-php74-fpm isp-php84-fpm \
           coremanager ihttpd ispmgrnode roundcube; do
    systemctl stop $svc 2>/dev/null
    systemctl disable $svc 2>/dev/null
done

# 3. Чистим iptables ispmanager-rules (после reboot не вернутся)
iptables -F ispmgr_deny_ip 2>/dev/null
iptables -F ispmgr_allow_ip 2>/dev/null
iptables -F ispmgr_deny_sub 2>/dev/null
iptables -F ispmgr_allow_sub 2>/dev/null
# Их нельзя удалить пока есть refs в INPUT chain — нужно reboot
# либо вычистить через iptables -D INPUT по line-numbers

# 4. Удаляем coremanager (опасно если dpkg всё ещё broken)
# Лучше пока оставить hold-нутыми (как мы уже сделали)

# 5. Reboot — закрепить остановку всех сервисов
systemctl reboot

# 6. После reboot — проверить что ничего лишнего не слушает
ss -tlnp | grep LISTEN | grep -vE "127\.|::1"
# Должны быть только: 22, 80, 443, 3478, 5349, 49152-65535
```

#### Что сломается в Path B
- Webmail (если кто-то им пользовался)
- Любые PHP-сайты на этом сервере
- Mail-доменов (если этот сервер был MX-записью какого-то домена)
- Доступ в ispmanager-панель (1501)

#### Что НЕ сломается
- Клиника (сайт + API + БД)
- SSL-сертификаты
- Резервные копии

---

## Рекомендации

1. **Если на сервере НИЧЕГО кроме Клиники** — выбрать Path B (чистка на месте,
   проще, без миграции БД и DNS).
2. **Если есть другие сайты/почта** — выбрать Path A (полный перенос Клиники
   на новый VPS, старый оставить для тех проектов).
3. В обоих случаях — заранее предупредить пользователей о возможном
   плановом окне 1-2 часа.

## Что НЕ делаю автоматически

Ни Path A, ни Path B без явного твоего «да» с указанием пути.
Path A требует нового VPS (нужны от тебя кред + IP).
Path B убьёт всё что не Клиника — нужно подтверждение что других сайтов нет.
