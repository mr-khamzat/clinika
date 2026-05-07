# Security Headers & Rate-Limiting

Документ описывает защитный слой nginx + backend для прод-домена `клиниксеть.рф`
(`xn--e1afagcdp8ak4h.xn--p1ai`).

Файлы nginx (вне git, на сервере 212.57.118.126):
- `/etc/nginx/sites-enabled/clinikahttps.conf` — server-блоки 80/443 + CNAME
- `/etc/nginx/snippets/security_headers.conf` — общий include для всех `location`
- `/etc/nginx/conf.d/01-rate-limits.conf` — `limit_req_zone` зоны

## 1. Rate-limiting

| Зона | Rate | Burst | Применение |
|------|------|-------|------------|
| `login` | **5 req/min** | 8 (`nodelay`) | `^/([^/]+/)?api/auth/(login|refresh|reset-password|forgot-password)$` |
| `api` | 200 req/min | — | (резерв, пока не подключена) |
| `public` | 30 req/min | — | (резерв для публичных форм) |

При превышении возвращается **HTTP 429** (`limit_req_status 429`).
Тест: 6-й POST на `/api/auth/login` в течение минуты с одного IP → 429.

## 2. Security headers

Все исходящие ответы (и в server-блоке, и в каждой `location` через
`include /etc/nginx/snippets/security_headers.conf`) содержат:

| Header | Значение |
|--------|----------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(self), microphone=(self), geolocation=(self), interest-cohort=()` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `Content-Security-Policy` | см. ниже |

### CSP (Content-Security-Policy)

```
default-src 'self';
script-src  'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org https://js.sentry.io;
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src    'self' https://fonts.gstatic.com data:;
img-src     'self' data: blob: https:;
connect-src 'self' wss: https://*.sentry.io https://api.gemini.com https://mis.stoclinic.ru:3010;
frame-src   'self' https://web.whatsapp.com;
media-src   'self' blob: data:;
object-src  'none';
base-uri    'self';
form-action 'self';
```

Разрешённые внешние источники:
- **Telegram WebApp** (`telegram.org`) — встраиваемые виджеты
- **Sentry** (`js.sentry.io`, `*.sentry.io`) — клиентский error tracking
- **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`)
- **Gemini AI** (`api.gemini.com`) — `connect-src` для AI-инсайтов
- **MIS Renovatio** (`mis.stoclinic.ru:3010`) — синхронизация записей
- **WhatsApp Web** (`web.whatsapp.com`) — iframe для WA-чата

Если CSP блокирует нужный ресурс — расширить нужный список (`script-src`,
`connect-src`, `img-src` и т.д.) в обоих местах:
- `/etc/nginx/sites-enabled/clinikahttps.conf` (server-блок)
- `/etc/nginx/snippets/security_headers.conf` (общий snippet)

## 3. CORS (backend)

`backend/app/config.py` — дефолт жёстко закрыт:
```python
allowed_origins: str = "https://xn--e1afagcdp8ak4h.xn--p1ai,https://клиниксеть.рф,http://localhost:5173"
```

Реальное значение читается из `.env` (`ALLOWED_ORIGINS=...`) и применяется в
`backend/app/main.py`:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)
```

`http://localhost:8901` убран — фронтенд за nginx, отдельный CORS-источник
не нужен.

## 4. Применение изменений (без даунтайма)

```bash
# nginx-only:
nginx -t && systemctl reload nginx

# backend (если правился config.py / .env):
cd /opt/clinika && docker compose restart clinika-backend
```

Бэкап перед изменениями всегда лежит в `/opt/clinika/backups/`:
- `nginx-clinikahttps-YYYYMMDD_HHMM.conf`
- `nginx-security_headers-YYYYMMDD_HHMM.conf`
- `nginx-01-rate-limits-YYYYMMDD_HHMM.conf`
- `.env-YYYYMMDD_HHMM.bak`

## 5. Smoke-тесты

```bash
# Headers
curl -sI https://клиниксеть.рф/ | grep -iE 'strict|x-|referrer|permissions|content-security'

# Rate-limit (с одного IP должно быть 5×401 → 429)
for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{http_code} ' \
    -X POST https://клиниксеть.рф/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"x","password":"y"}'
done; echo
```
