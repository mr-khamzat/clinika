# Frontend (React + Vite)

SPA на React 18 + Vite 5 + Tailwind 3 + Zustand. Material Symbols для иконок (НЕ emoji). Design system на oklch-цветах.

## Стек

```json
{
  "react": "^18.3.0",
  "react-dom": "^18.3.0",
  "react-router-dom": "^6.24.0",
  "axios": "^1.7.2",
  "zustand": "^4.5.2",
  "tailwindcss": "^3.4.4",
  "vite": "^5.3.1",
  "@sentry/react": "^10.51.0",
  "dompurify": "^3.4.2",
  "react-markdown": "^9.0.1",
  "remark-gfm": "^4.0.0",
  "rehype-raw": "^7.0.0",
  "jspdf": "^2.5.1",
  "html5-qrcode": "^2.3.8",
  "jsqr": "^1.4.0",
  "xlsx": "^0.18.5",
  "material-symbols": "^0.24.0"
}
```

## Vite-конфиг

- Entry: `src/main.jsx`.
- Public path: `/`.
- Output: `dist/` → подхватывается nginx внутри контейнера.
- `manualChunks` разбивает vendor:
  - `vendor-react` (react, react-dom, react-router-dom).
  - `vendor-heavy` (jspdf, html5-qrcode, xlsx).
  - `vendor-state` (zustand, axios).
  - `vendor-markdown` (react-markdown, remark-gfm, rehype-raw, dompurify).
  - `vendor-other` (sentry, остальное).

Bundle ~600 KB gzip total. Wiki — lazy chunk, грузится только при переходе.

## Структура

```
frontend/src/
├── main.jsx                  # entry (не трогать без явной задачи)
├── App.jsx                   # router (lazy() секций)
├── api/
│   ├── index.js              # axios instance + interceptors
│   └── modules/              # api.users, api.patients, ...
├── pages/
│   ├── admin/                # super_admin / manager секции
│   ├── doctor/, reg/, nurse/, patient/
│   ├── recruiter/, partner-doctor/, visiting-doctor/
│   ├── auth/                 # login, register, password-reset
│   ├── public/               # публичные страницы тенантов
│   └── wiki/                 # компоненты wiki-движка
├── components/               # переиспользуемые
├── design/
│   ├── tokens.js             # oklch цвета, spacing, типографика
│   ├── Page.jsx              # Page wrapper
│   ├── Breadcrumbs.jsx       # хлебные крошки
│   └── ...
├── store/                    # zustand (auth, theme, modules, notifications)
├── hooks/                    # useDebounce, useLocalStorage, useAuth
├── wiki-content/             # markdown статьи + _index.json
└── styles/                   # global.css, tailwind base
```

## Design tokens

Все цвета в oklch (perceptually uniform). Tailwind extended:

```js
// tailwind.config.js
theme: {
  extend: {
    colors: {
      bg: 'oklch(var(--bg))',
      fg: 'oklch(var(--fg))',
      muted: 'oklch(var(--muted))',
      brand: { primary: 'oklch(var(--brand-primary))', ... }
    }
  }
}
```

Переменные `--brand-primary` приходят из `/cms/theme/css` тенанта (если активен `white_label`).

## Иконки

Только Material Symbols (через npm-пакет `material-symbols`):
```jsx
<span className="material-symbols-outlined">stethoscope</span>
```

Заполнение / вариант через CSS-переменные. Emoji — **запрещены** в UI (только для пользовательского контента).

## Routing

`react-router-dom@6` с lazy():
```jsx
const AdminUsers = lazy(() => import('./pages/admin/Users'))

<Route path="/admin/users" element={
  <RequireRole role="manager">
    <Suspense fallback={<Loader />}>
      <AdminUsers />
    </Suspense>
  </RequireRole>
} />
```

`RequireRole` / `RequireAuth` — wrappers в `components/auth/`.

## State management (Zustand)

```js
// store/auth.js
export const useAuth = create((set) => ({
  user: null,
  setUser: (u) => set({ user: u }),
  logout: () => { localStorage.clear(); set({ user: null }) },
}))
```

Глобальные сторы: `auth`, `theme`, `modules`, `notifications`. Не использовать Redux.

## API клиент

`src/api/index.js`:
```js
import axios from 'axios'

export const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('access_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(null, async (err) => {
  if (err.response?.status === 401 && !err.config._retry) {
    err.config._retry = true
    await refreshToken()
    return api(err.config)
  }
  throw err
})
```

## Безопасность

- Все user-input через DOMPurify перед `dangerouslySetInnerHTML`.
- React-markdown без `rehype-raw` для пользовательских markdown'ов.
- Sentry session-replay включён в production (с маскированием PII).
- HTTPS only, `Secure` + `HttpOnly` для refresh-token cookie.

## Добавление страницы

1. Создать `src/pages/admin/NewSection.jsx`.
2. Добавить роут в `App.jsx` с `lazy()`.
3. (Опционально) Добавить пункт в навигацию `components/layout/AdminSidebar.jsx`.
4. Тесты — пока нет фронт-тестов, фокус на e2e через ручной QA.

## Добавление wiki-статьи

1. Создать `src/wiki-content/<slug>.md`.
2. Добавить в `_index.json` запись `{slug, title, category, order, summary}`.
3. (Опционально) Иконку в `pages/Wiki.jsx → ARTICLE_ICONS`.
4. `docker compose build clinika-frontend && up -d` (статьи запекаются в bundle через `import.meta.glob`).

## Сборка и деплой

```bash
docker compose build clinika-frontend
docker compose up -d clinika-frontend
curl -s http://127.0.0.1:8901/ -w "%{http_code}\n"  # должен быть 200
```

После изменений `.jsx/.js`/`.md` нужна пересборка (Vite запекает в bundle).

## Смотрите также

- [Dev · Архитектура](dev-architecture.md)
- [Dev · Стек](dev-stack.md)
- [Концепт · Безопасность](concepts-security.md)
