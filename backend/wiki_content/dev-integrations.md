# Интеграции

Список внешних систем, с которыми работает КлиникСеть, и как это устроено технически.

## МИС (Renovatio)

Двусторонняя интеграция с МИС Renovatio:

- **Конфигурация**: в кабинете тенанта → `Настройки → МИС-интеграция` (URL + login + password).
- **Доступ**: super_admin, manager, registry_admin (после фикса от 2026-05-08).
- **Что синхронизируется**:
  - Клиники Renovatio → `Clinic` платформы (по `mis_clinic_id`)
  - Врачи МИС → `User.role=doctor` (`mis_user_id`)
  - Пациенты — поиск через `GET /mis/patients/search?q=<ФИО или телефон>`
  - Завершённые приёмы — Job `auto_confirm_referrals` каждые 5 минут проверяет статусы и автоматически подтверждает направления.
- **Webhooks от Renovatio** — отсутствуют, остаёмся на polling.

## Telegram

- **Mini App** — клиентам через бота. JWT-аутентификация по `initData` (verify HMAC).
- **Бот**: `/opt/clinika/bot/` — отдельный сервис, использует общий backend API.
- **Уведомления**: AWG bot и MeshCentral bot — отдельные. Платформа уведомления о Region Lock и системных алертах шлёт через Telegram (chat_id владельца — 293633093).
- **Конфиг**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` в `.env`.

## SMS-провайдеры

Stub режим по умолчанию (логи без отправки). Реальная отправка — два провайдера:

- **SMSC.ru** — `SMSC_LOGIN` + `SMSC_PASSWORD` в .env
- **SMS.ru** — `SMSRU_API_ID` в .env

Логика в `app/plugins/sms/plugin.py`. PII (номера телефонов) маскируется в логах через `mask_phone`.

## Платежи (эквайринг)

Адаптеры в `app/services/acquiring/`:

| Провайдер | Файл | Статус |
|---|---|---|
| ЮKassa | `yookassa_adapter.py` | Частично (init есть, find_one — `NotImplementedError`) |
| Сбер | `sber_adapter.py` | 5 методов = `NotImplementedError` |
| T-Bank | `tbank_adapter.py` | Stub |
| CloudPayments | `cloudpayments_adapter.py` | Stub |
| Robokassa | `robokassa_adapter.py` | Stub |

Конфигурация — `tenant_payments_config` per-tenant (shop_id, secret_key зашифрованы).

**Webhook сигнатуры**: каждый провайдер имеет свой формат подписи. Проверяется в `routers/payments_webhook.py`.

## OFD (54-ФЗ, фискальные чеки)

Адаптеры в `app/services/ofd/`: Атол, Эвотор, Платформа ОФД. Сейчас все три — stub возвращают 501.

## AI (Gemini, Whisper)

- **Google Gemini** — для AI-ассистента и резюме звонков. `GOOGLE_AI_API_KEY` в .env.
- **OpenAI Whisper** — транскрипция звонков. `OPENAI_API_KEY` в .env (или прокси через GigaChat).

## WebRTC

- **coturn** — на хосте `212.57.118.126:3478` (TURN+STUN). HMAC-SHA1 REST API через секрет `COTURN_SHARED_SECRET`.
- **Signalling** — внутренний WebSocket `/presence/ws` (FastAPI).
- **Multi-party**: текущая модель P2P, до 4 участников. Для 5+ нужен SFU (LiveKit/mediasoup) — отдельный модуль `video_conference`.

## GeoIP

- **GeoLite2-City.mmdb** — в `/app/data/GeoLite2-City.mmdb`. Обновляется через `scripts/update_geolite.sh` (раз в 30 дней). Используется audit log и Region Lock.

## Push-уведомления

- **Web Push** — VAPID-ключи в .env. Подписки в `push_subscriptions`.
- **Firebase Cloud Messaging** — пока не подключено.

## Email

- **SMTP** — настраивается в .env (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`). Сейчас часто пуст → email-уведомления молча не отправляются.

## Smoke-чеклист интеграций

```
GET /api/health/full
```

Возвращает статус каждой интеграции + версия + uptime.

## Смотрите также

- [Dev · Технический стек](dev-stack.md)
- [Dev · API endpoints](dev-api.md)
