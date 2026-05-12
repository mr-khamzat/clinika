# Архитектура платформы

Высокоуровневая схема КлиникСеть для разработчиков и интеграторов.

## Компоненты

```
┌─────────────────────────────────────────────────────────┐
│                  Public Internet (TLS)                  │
└─────────────────────────────────────────────────────────┘
                          │
                ┌─────────▼─────────┐
                │   nginx (host)    │  TLS termination, static
                │  клиниксеть.рф    │  /api → backend
                └─────────┬─────────┘  /uploads → fs
                          │
        ┌─────────────────┼─────────────────────┐
        │                 │                     │
   ┌────▼────┐      ┌─────▼─────┐         ┌─────▼─────┐
   │frontend │      │  backend  │         │  coturn   │
   │ (nginx) │      │ (uvicorn) │         │  3478/udp │
   │  :8901  │      │   :8900   │         │  WebRTC   │
   └─────────┘      └─────┬─────┘         └───────────┘
                          │
            ┌─────────────┼─────────────┐
            │             │             │
       ┌────▼───┐    ┌────▼───┐    ┌────▼──────┐
       │  PG16  │    │ Redis7 │    │docker-proxy│
       │ shared │    │ cache  │    │ socket ro │
       │ schema │    │ presence│   └───────────┘
       └────────┘    └────────┘
```

Docker-сервисы (`docker-compose.yml`): `clinika-db`, `clinika-redis`, `clinika-backend`, `clinika-frontend`, `clinika-bot`, `clinika-docker-proxy`. Сеть `clinika-net` — внутренняя.

## Слои приложения backend

```
backend/app/
├── main.py              # FastAPI app, mount routers, startup hooks
├── database.py          # AsyncEngine, sessionmaker, set_config tenant_id
├── core/
│   ├── deps.py          # get_db, get_current_user, require_role
│   ├── security.py      # JWT encode/decode, password hashing
│   ├── tenant.py        # require_module, get_current_tenant
│   ├── region_lock.py   # GeoIP middleware
│   └── ...
├── models/              # SQLAlchemy 2.0 declarative
├── schemas/             # Pydantic 2 input/output
├── routers/             # FastAPI APIRouter — 102 файла
├── services/            # бизнес-логика (bonus_cascade, billing, audit)
├── plugins/             # MIS adapters, SMS providers, notification channels
├── templates/           # Jinja2 для PDF/email
└── ...
```

Поток типового запроса:
1. nginx → uvicorn (backend).
2. middleware: CORS, rate-limit, Sentry, region_lock.
3. router → dependency `get_current_user` (JWT decode + role check).
4. dependency `get_db` → AsyncSession + `SET app.tenant_id = '<uuid>'` (для RLS).
5. service layer → SQLAlchemy 2 → PG.
6. response Pydantic schema.

## Multi-tenancy

**Shared schema, фильтрация по tenant_id.** Все таблицы тенант-aware имеют `tenant_id` UUID NOT NULL + индекс.

- Изоляция на уровне service: каждая query JOIN/WHERE по `tenant_id`.
- `SET app.tenant_id = '<uuid>'` в начале каждой транзакции (для potential RLS policies).
- Тесты `test_tenant_isolation*.py` проверяют, что у тенанта A нет доступа к данным тенанта B.

## Frontend SPA

```
frontend/src/
├── main.jsx             # vite entry
├── App.jsx              # routes, lazy() секций
├── pages/               # страницы по ролям
│   ├── admin/           # super_admin кабинеты
│   ├── manager/         # manager
│   ├── doctor/          # врач
│   ├── reg/             # регистратор
│   ├── patient/         # пациент
│   └── ...
├── components/          # переиспользуемые
├── api/                 # axios клиент + interceptors
├── design/              # design system: oklch tokens, Page, Breadcrumbs
├── store/               # zustand (auth, theme, modules)
└── wiki-content/        # markdown статьи (этот раздел)
```

## WebRTC стек

- **coturn** на хосте, порт 3478/udp.
- **Signaling**: WebSocket `/presence/ws` + `/presence/ws/doctor/{session_id}`.
- **ICE-config**: `/presence/ice-config` отдаёт ephemeral credentials (HMAC-SHA1 REST, TTL 1ч).
- **TURN**: только relay через ваш сервер (privacy + reliability).

## AI стек

- **Google Gemini** — для AI-ассистента пациента, генерации treatment plan, summary.
- **OpenAI Whisper** — транскрипция звонков и видеоприёмов.
- **Knowledge Base** — `AIKnowledgeEntry` (RAG над FAQ тенанта).
- **AI-аналитика** (`ai_analytics_basic` / `ai_analytics_pro`) — отчёты с инсайтами.

## Развёртывание

- Production: один сервер `212.57.118.126`, всё в Docker.
- Mirror для Calls: `144.31.89.167` (зеркало installer'ов).
- Бэкапы: pg_dump ежедневно в 03:00, хранение 14 дней.
- Логи: json-file driver, ротация 20m × 5 файлов на контейнер.
- Мониторинг: внешний health-check от Telegram-бота.

## Производительность (текущие numbers)

- Backend: ~50 RPS на 1 vCPU при типовой нагрузке (CRUD + JWT).
- DB: PG16 на SSD, типичная query <50ms.
- Frontend bundle: ~600 KB gzip (с manualChunks).
- Wiki: загружается lazy при переходе на `/wiki`.

## Смотрите также

- [Dev · Технический стек](dev-stack.md)
- [Dev · API endpoints](dev-api.md)
- [Концепт · Multi-tenancy](concepts-multi-tenancy.md)
