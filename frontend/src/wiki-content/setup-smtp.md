# Настройка SMTP для отправки email

## Когда нужна

Email — критический канал уведомлений для платформы:

- Welcome email при регистрации франшизы
- Восстановление пароля
- Уведомления о приёмах
- Расходник за год пациенту
- Алерты безопасности

Без SMTP платформа работает, но многие сценарии (онбординг, password reset) недоступны.

## Поддерживаемые провайдеры

| Провайдер | Цена | Лимит/сутки (бесплатно) | Поддержка домена |
|---|---|---|---|
| Mailgun | от $35/мес | 100 (trial) | да |
| SendGrid | от $20/мес | 100 (trial) | да |
| Postmark | от $15/мес | 100 (trial) | да |
| AWS SES | по объёму | 200/сут | да |
| Yandex 360 | от 250 ₽/мес | 200 | да (только yandex.ru) |
| Свой SMTP | бесплатно (хостинг) | зависит | сложная настройка DNS |

Рекомендация для боевого использования — **Mailgun** или **Postmark** из-за высокой доставляемости в RU-домены.

## Что подготовить

- Домен для отправки (например, `mail.example.ru`)
- Доступ к DNS-зоне домена
- Аккаунт у провайдера

## Настройка DNS

Для любого провайдера нужны записи:

| Тип | Имя | Значение | Назначение |
|---|---|---|---|
| MX | mail.example.ru | (опц.) | для bounce |
| TXT | mail.example.ru | `v=spf1 include:<provider> ~all` | SPF |
| TXT | default._domainkey.mail.example.ru | (от провайдера) | DKIM |
| TXT | _dmarc.example.ru | `v=DMARC1; p=quarantine; rua=mailto:dmarc@example.ru` | DMARC |

После добавления записей — проверьте через `dig` или mxtoolbox.com. Распространение DNS 1-24 часа.

## Настройка в платформе

Кабинет super_admin → **Система → Email**:

```yaml
provider: mailgun       # или postmark / sendgrid / ses / smtp
api_key: <mailgun_key>
domain: mail.example.ru
from_email: noreply@example.ru
from_name: КлиникСеть
reply_to: support@example.ru
```

Для generic SMTP (Yandex 360, свой сервер):

```yaml
provider: smtp
smtp_host: smtp.yandex.ru
smtp_port: 465
smtp_use_ssl: true
smtp_username: noreply@yandex.ru
smtp_password: <app_password>
from_email: noreply@yandex.ru
```

## Тестовое письмо

```http
POST /admin/system/email/test
Authorization: Bearer <super_admin>

{ "to": "test@example.ru" }
```

Response:

```json
{
  "delivered": true,
  "provider_response": "...",
  "duration_ms": 412
}
```

В течение 30 секунд должно прийти письмо. Если нет — проверьте спам, потом DNS, потом ключи провайдера.

## Шаблоны писем

Все шаблоны лежат в `/opt/clinika/backend/app/templates/emails/` как Jinja2:

- `welcome_owner.html` — приветствие при регистрации
- `welcome_staff.html` — приглашение сотрудника
- `password_reset.html` — сброс пароля
- `appointment_reminder.html` — напоминание о приёме
- `subscription_charged.html` — оплачена подписка
- `subscription_failed.html` — не удалось списать
- `spending_report.html` — годовой расходник

Для брендирования (white-label):

1. Активируйте модуль `white_label`.
2. Загрузите свой логотип и цвета в **Брендирование**.
3. Шаблоны автоматически подставят логотип и цвета.

## Soft / hard bounces

Платформа отслеживает bounces:

- **Soft bounce** (временная ошибка) — retry до 5 раз.
- **Hard bounce** (адрес не существует) — адрес помечается `email_invalid=true`, дальше письма не шлются.

Просмотр bounces: `/admin/system/email/bounces`.

## Лимиты

Платформа сама применяет лимит **100 писем/час на один email** для защиты от спам-петель. Превышение → следующие письма откладываются.

## Безопасность

- API ключ провайдера хранится в БД зашифрованным (Fernet).
- Webhook от провайдера (если подключён) проверяется по подписи.
- SPF + DKIM + DMARC обязательны для prod (иначе письма уйдут в спам Mail.ru / Yandex).

## FAQ

**Письма уходят в спам.** Проверьте SPF/DKIM/DMARC через mail-tester.com. Если 8+/10 — норма. Если меньше — настройте DNS.

**Можно ли отправлять с своего @example.ru без провайдера?** Технически да, через свой SMTP. Но доставляемость в Mail.ru и Yandex.ru будет 30-50% (vs 95%+ через профессионального провайдера).

**Сколько писем в сутки реалистично?** На Professional плане платформа отправляет до 10 000 писем/сутки без проблем. На больших объёмах — нужен dedicated IP у провайдера.

**Что если кончился баланс у провайдера?** Disaster mode: письма ставятся в очередь, шлются после пополнения. Алерт super_admin приходит в Telegram при первом fail.

## Связанные статьи

- [Настройка платежей](/wiki/setup-payments)
- [Гл. 10: Интеграции](/wiki/chapter-10-integrations)
- [Гл. 2: Onboarding](/wiki/chapter-2-onboarding)
