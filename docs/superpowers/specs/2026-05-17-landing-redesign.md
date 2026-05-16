# Landing redesign for B2B — Spec + Plan

**Целевая аудитория:** Владельцы клиник / франчайзи (B2B-decision-maker)

## Goal
Переоформить главную `frontend/src/pages/Landing.jsx` (2304 строки) под владельца клиники.
Не сносить существующее — встроить новые секции вокруг текущих, обновить copywriting hero.

## Сохраняем как есть
- Hero — структуру (layout с правой mockup-стороной), trust chips, downloads
- Login/Signup модалы
- Калькулятор тарифа

## Добавляем (5 новых секций)

### Secция 1: Numbers strip (под hero)
Лента 4-х метрик с большими цифрами и анимацией count-up:
```
[ 5 клиник ]  [ 50+ врачей ]  [ 3.5 мин ]  [ 99.9% ]
   в сети       онлайн         ср.ответ     uptime
```
Counter animation через useEffect + requestAnimationFrame.

### Секция 2: Product tour (4 шага с SVG-mockup'ами)
Карусель/grid 4 шагов:
1. **«Пациент пишет»** — SVG mock чата клиники с одним сообщением «Хочу записаться»
2. **«Регистратор отвечает»** — тот же чат + предлагаемый ответ + кнопка «Записать на приём»
3. **«Запись в 30 секунд»** — SVG mock расписания со слотом
4. **«Руководитель видит метрики»** — SVG mock дашборда с графиком и цифрами

Каждый mockup ~280×180px SVG в коде.

### Секция 3: Integrations grid
Логотипы и описания интеграций:
- ⚡ **МИС Renovatio** — синхронизация пациентов/расписания
- 📞 **Sipuni / Mango / Zadarma** — телефония
- 💳 **ЮKassa** — оплата подписок
- 📱 **1C** — Excel импорт
- 💬 **Telegram** — push-нотификации
- 🧾 **ОФД** — фискальные чеки

Карточки с иконками (без реальных логотипов — Material Symbols).

### Секция 4: Testimonial (placeholder)
Большая цитата + аватар-плейсхолдер с инициалами + должность:
> «Сократили время ответа регистраторов с 12 минут до 3. Конверсия первичных
> пациентов выросла на 18% за квартал.»
> — **Хамзат Гадаборшев**, основатель «КлиникСеть»

### Секция 5: FAQ (аккордеон, 6 вопросов)
- Сколько времени занимает запуск?
- Можно ли мигрировать с другой системы?
- Что с законом 152-ФЗ?
- Как считается тариф?
- Где хранятся данные?
- Что включает поддержка?

## File structure

| Файл | Что |
|------|-----|
| `frontend/src/pages/Landing.jsx` (modify) | Импорты + вставка 5 секций |
| `frontend/src/components/landing/NumbersStrip.jsx` (new) | Метрики + count-up |
| `frontend/src/components/landing/ProductTour.jsx` (new) | 4 шага + SVG mocks |
| `frontend/src/components/landing/IntegrationsGrid.jsx` (new) | Карточки интеграций |
| `frontend/src/components/landing/Testimonial.jsx` (new) | Цитата с аватаром |
| `frontend/src/components/landing/FAQ.jsx` (new) | Аккордеон |

## Style guidelines
- Цветовая палитра: существующая (бирюза `#0097A7` + индиго `#1565C0`)
- Анимации: `FadeIn` из существующего кода + `requestAnimationFrame` для count-up
- Mobile-first: все grid'ы в 1 колонку
- Glass effect: `background: rgba(255,255,255,.6); backdrop-filter: blur(12px)` на cards
- Padding между секциями: 72px desktop / 48px mobile

## Tour SVG mocks — пример

```jsx
function ChatMockup() {
  return (
    <svg viewBox="0 0 280 180" style={{ width: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id="lg-chat-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1f5f9"/>
          <stop offset="1" stopColor="#e2e8f0"/>
        </linearGradient>
      </defs>
      <rect width="280" height="180" rx="12" fill="url(#lg-chat-bg)"/>
      {/* Header */}
      <rect x="0" y="0" width="280" height="32" rx="12" fill="#fff"/>
      <circle cx="20" cy="16" r="8" fill="#0097A7"/>
      <rect x="34" y="11" width="80" height="6" rx="3" fill="#0F172A"/>
      <rect x="34" y="20" width="50" height="4" rx="2" fill="#94a3b8"/>
      {/* Messages */}
      <rect x="14" y="48" width="160" height="40" rx="14" fill="#fff" stroke="#e2e8f0"/>
      <rect x="22" y="56" width="100" height="4" rx="2" fill="#475569"/>
      <rect x="22" y="65" width="130" height="4" rx="2" fill="#475569"/>
      <rect x="22" y="74" width="80" height="4" rx="2" fill="#475569"/>
      <rect x="106" y="100" width="160" height="40" rx="14" fill="#0097A7"/>
      <rect x="116" y="108" width="120" height="4" rx="2" fill="#fff"/>
      <rect x="116" y="117" width="80" height="4" rx="2" fill="#fff"/>
      <rect x="116" y="126" width="100" height="4" rx="2" fill="#fff"/>
    </svg>
  )
}
```

## Tasks

### Task 1: NumbersStrip
- Файл `components/landing/NumbersStrip.jsx`
- 4 метрики + count-up через `requestAnimationFrame`
- IntersectionObserver — count-up запускается при появлении в viewport

### Task 2: ProductTour
- 4 SVG-mockup'а inline (ChatMockup, ResponseMockup, BookingMockup, DashboardMockup)
- Layout: grid 4 col desktop, 1 col mobile
- Каждый шаг: SVG + step number badge + title + description

### Task 3: IntegrationsGrid
- 6 карточек с Material Symbols иконкой + title + description
- Hover effect: scale + shadow

### Task 4: Testimonial
- Цитата 60-80 слов
- Avatar circle с инициалами (ХГ) + name + role + клиника
- Background: subtle gradient

### Task 5: FAQ
- Accordion (без библиотек, useState)
- Каждый вопрос: + → × при открытии, smooth height animation

### Task 6: Интеграция в Landing.jsx
- Импорты
- Вставка между существующими секциями:
  - После Hero → NumbersStrip
  - После Problems → ProductTour
  - После Flow → IntegrationsGrid
  - После калькулятора → Testimonial → FAQ
- Не трогать Hero copywriting в этом этапе (отдельная задача если потребуется)

### Task 7: Build + smoke
```bash
docker compose build --no-cache clinika-frontend && up -d
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8901/
```

### Task 8: Commit
```bash
git add frontend/src/components/landing/ frontend/src/pages/Landing.jsx
git -c commit.gpgsign=false commit -m "feat(landing): 5 новых секций — Numbers + Tour + Integrations + Testimonial + FAQ"
```

## Self-Review
- ✅ Все 5 секций определены с конкретным содержимым
- ✅ SVG mockup пример приведён, остальные 3 — по аналогии
- ✅ Существующее не ломаем — только добавления
- ✅ Mobile-first через grid auto-cols + media queries
- ✅ Анимации: FadeIn (существует) + count-up (новый, через RAF)
