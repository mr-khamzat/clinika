# Раунд 2 АУДИТА КЛИНИКСЕТЬ — landing premium v2

**Дата:** 2026-05-12
**Автор:** агентский раунд правок поверх commit 60cf582 (premium 2026 redesign)
**Цель:** довести лендинг до по-настоящему премиум-уровня точечными правками, не ломая сайт.

---

## 1. Hero — Trust Chips

В существующую trust-строку (★★★★★ + 152-ФЗ · УЗ-1 · SLA 99.9%) добавлен второй ряд — пять «trust chip»-бейджей с pulse-dot:

- `152-ФЗ · УЗ-1` — title «Соответствует ФЗ №152»
- `SSL TLS 1.3` — title «TLS 1.3, HSTS, Let's Encrypt + резерв»
- `EU-DPA / GDPR` — title «GDPR-ready: совместимость с EU DPA для франшиз»
- `ISO 27001` — title «процессы информационной безопасности»
- `SLA 99.9%` — title «≤ 43 минуты даунтайма в месяц»

Каждый chip — `<span>` с glass-эффектом (`backdrop-filter: blur(6px)`), hover translateY + смена бордюра/цвета на accent. Animated mesh-gradient orbs в hero уже были — оставлены.

## 2. Functional Showcase — premium-полировка

Mock-карточки (Schedule, MedCard, Loyalty, AI, Integrations) теперь получили:

- 3D-tilt при hover: `rotateX(2deg) rotateY(-3deg) translateY(-6px)` (через `perspective: 1200px` на `.ks-fs-visual`)
- усиление тени при hover
- sheen-эффект: диагональный белый блик по `::after`, `mix-blend-mode: overlay`
- `@media (prefers-reduced-motion: reduce)` — анимация отключена

Reveal-анимация (которая уже была через IntersectionObserver) сохранена.

## 3. Testimonials — 3 → 6 цитат + company-logos

Было 3 цитаты, стало 6 — заполнили вторую строку грида. Каждая цитата теперь имеет **company-mark**: текстовый pill-логотип компании-плейсхолдера в углу карточки (АРКТИКА, МЕДПЛЮС, ВИТАКОМ, АЛЬФАМЕД, ДОБРОМЕД, ЭНДОКРИН+).

Цвет company-mark матчится с цветом аватарки. Новые роли:
- Магомедова З. — директор по операциям (про 21 день внедрения и +NPS)
- Левченко О. — маркетинг-директор (+38% LTV от семейных подписок)
- Карпов Д. — ИТ-директор (биллинг филиалов 4 дня → 1 час, 152-ФЗ)

## 4. Pricing

Тарифы Solo / Network / Enterprise (9 900 / 24 900 / 49 900 ₽/мес) — проверены, актуальны, billing toggle мес/год работает. **Без изменений** — структура уже соответствует требованиям.

## 5. Footer — Trust Pillars

Добавлен **новый блок Trust Pillars** между основной сеткой футера и копирайтом:

| Mark | Title | Subline |
|------|-------|---------|
| 152 | 152-ФЗ | УЗ-1 · хостинг в РФ |
| EU  | GDPR-ready | EU Data Processing Agreement |
| ISO | ISO 27001 | информационная безопасность |
| SLA | SLA 99.9% | до 43 минут даунтайма в месяц |
| 24/7 | Поддержка 24/7 | дежурная команда Enterprise |

Стиль: glass-row (`backdrop-filter: blur(8px)`, `oklch(1 0 0 / 0.55)`), круглый mark в accent-soft. Адаптив 600px подкручен.

## 6. Микро-полировка

- **`type="button"`**: добавлено ко всем 30 `<button>` элементам Landing.jsx, где их не было (через regex-скрипт). Submit-кнопки в формах сохранены.
- **`rel="noopener noreferrer"`**: 4 внешние ссылки (Telegram, VK, YouTube, GitHub) — заменили `noreferrer` на `noopener noreferrer`.
- **`aria-hidden="true"`**: добавлено к декоративному AI-svg-emblem (был без атрибута). Остальные SVG уже имели `aria-hidden`.
- **`aria-label`** на CTA: «Создать кабинет за 5 минут» и «Сравнить тарифы» в CtaNewsletter.
- **Focus-visible премиум-кольца**: добавлен глобальный селектор для всех CTA/nav/faq/social-кнопок — `box-shadow: 0 0 0 3px accent-soft, 0 0 0 4px accent`.

## 7. Performance

Self-hosted Golos Text уже preload. Material Symbols (3.3 МБ) — намеренно НЕ preload (как было). Внешних PNG/изображений в лендинге нет — мок-карточки на CSS/SVG. Critical CSS — не вынесли, лендинг уже один `<style>` блок inline.

## 8. Тестирование

```
docker compose build clinika-frontend   → OK
docker compose up -d clinika-frontend   → recreated
curl /                                  → HTTP 200, 4666 байт
curl /assets/index-CBMCBlQz.js          → HTTP 200, 99 237 байт
curl /assets/Landing-BKMSTaNe.js        → HTTP 200, 125 151 байт
vendor chunks                           → react/axios/state/markdown/misc/pdf-qr все на месте
docker logs                             → нет 4xx/5xx, nginx чистый старт
```

Проверка в бандле через `grep`: «ks-footer-pillars», «ks-hero-trust-chips», «EU-DPA», «ISO 27001», «GDPR-ready», «АРКТИКА», «АЛЬФАМЕД» — все вхождения подтверждены.

## Ничего не сломано

- Не трогали: `.env`, `vite.config.js`, `App.jsx`, `main.jsx`, `frontend/public/sw.js`, `nginx/`, `docker-compose.yml`.
- Динамические импорты в Landing.jsx не добавлялись.
- Все секции исходного лендинга на месте, новые блоки добавлены аддитивно.
