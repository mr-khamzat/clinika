# Модуль «White-Label брендинг»

**3 990 ₽/мес · 39 900 ₽/год** · ключ `white_label` · категория `branding` · подключается в `/admin → Тарифы → Подключаемые модули`.

Кастомизация бренда франшизи: своя цветовая палитра, логотип, домен, шаблоны документов, шаблоны email/SMS. Полностью убирает упоминания «КлиникСеть» из публичных интерфейсов.

## Что это даёт клинике

- Свой бренд везде: на публичных страницах, в письмах, в SMS, в PDF-актах.
- Свой домен или поддомен (например `med.example.ru` вместо `клиниксеть.рф/p/example/`).
- Брендированное мобильное PWA (icon, splash, manifest).
- Возможность редактировать публичные страницы CMS (CRUD страниц требует активного `white_label`).

## Что входит технически

- **Тема** (`CMSTheme`): primary / secondary / accent цвета в oklch + логотип + фавикон + шрифт.
- **Domain alias**: добавление кастомного домена (`tenant.custom_domain = "med.example.ru"`). nginx + ACME (через DNS-01) выдают SSL.
- **Email templates**: переопределение шаблонов transactional email (welcome, password-reset, appointment-reminder).
- **SMS templates**: переопределение шаблонов SMS-уведомлений.
- **PDF templates**: акты, согласия, договоры — Jinja2 шаблоны с логотипом и реквизитами тенанта.
- **CMS pages CRUD**: создание / редактирование / удаление публичных страниц (`/cms/pages` POST/PUT/DELETE требуют `require_module("white_label")`).
- **PWA manifest**: `/manifest.json?tenant={slug}` отдаёт брендированный манифест.
- **Удаление "Powered by"**: footer на публичных страницах не содержит ссылок на платформу.

## Как настроить

1. Активировать модуль в `/admin → Тарифы → Подключаемые модули`.
2. `/admin/cms/theme` — палитра. Загрузить логотип (PNG / SVG, прозрачный фон).
3. `/admin/cms/theme/preview` — превью на разных экранах.
4. (Опционально) Кастомный домен:
   - Прописать CNAME → `клиниксеть.рф` в DNS вашего домена.
   - В `/admin/tenant/settings` указать `custom_domain`.
   - nginx + acme.sh автоматически выдаст SSL через DNS-01.
5. Переопределить email-шаблоны: `/admin/cms/email-templates` (welcome, reminder, etc).
6. Опубликовать.

## Как пользоваться

### Публикация страницы

1. `/admin/cms/pages` (доступно при активном модуле).
2. Создать страницу `about`, `services`, `contacts`, `privacy`.
3. Markdown-редактор.
4. Опубликовать → видно на `https://med.example.ru/about` или `https://клиниксеть.рф/p/{slug}/about`.

### Применение темы

1. Цвета oklch применяются ко всем UI-элементам публичных страниц.
2. CSS-переменные доступны: `--primary`, `--secondary`, `--accent`, `--bg`, `--fg`.
3. Загружаются через `<link rel="stylesheet" href="/cms/theme/css">`.

### Замена шаблонов

1. Дефолтные шаблоны лежат в `/opt/clinika/backend/app/templates/`.
2. При активации модуля — для тенанта создаются override-копии в `tenant_module_subscriptions.config.templates`.
3. Редактирование через `/admin/cms/email-templates` (Jinja2 синтаксис).

## API endpoints

CMS CRUD (требует модуль):
- `POST /cms/pages` — создать страницу.
- `PUT /cms/pages/{slug}` — обновить.
- `DELETE /cms/pages/{slug}` — удалить.

CMS публичный доступ:
- `GET /cms/theme` — тема тенанта.
- `GET /cms/theme/css` — CSS-переменные.
- `GET /cms/menu` — меню.
- `GET /cms/pages` — список (только опубликованные для гостя).
- `GET /cms/pages/{slug}` — конкретная страница.

Email/SMS templates:
- `GET /admin/cms/email-templates` — список.
- `PUT /admin/cms/email-templates/{key}` — обновить.

## Известные ограничения

- Кастомный домен требует ручного добавления в nginx (автоматизация TODO).
- Шрифты — только из CDN (Google Fonts / fontsource). Загрузка своих TTF/WOFF — TODO.
- Email-шаблоны: ограниченный набор Jinja2-фильтров (safe-mode).
- PWA-иконки 192×192 и 512×512 загружаются вручную через uploads.

## Смотрите также

- [Модуль «CMS — страницы тенанта»](module-cms.md)
- [Модуль «Акты и документы»](module-acts.md)
- [Роль · Владелец франшизы](role-franchise-owner.md)
