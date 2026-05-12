# Contributing

Как контрибьютить в код КлиникСеть: клонирование, dev-окружение, git flow, code style.

## Репозиторий

- GitHub: `https://github.com/mr-khamzat/clinika`.
- Основная ветка: `main` (защищена, PR + review).
- Production deploy: автоматический при merge в `main` (или ручной — см. `dev-deployment.md`).

## Клонирование

```bash
git clone https://github.com/mr-khamzat/clinika.git
cd clinika
```

## Локальное окружение

### Вариант 1: всё в Docker (рекомендуется)

1. Скопировать `.env.example` → `.env` и заполнить:
   ```bash
   cp .env.example .env
   ```
2. Минимальные обязательные переменные:
   - `JWT_SECRET=<random 32 bytes>`
   - `DATABASE_URL=postgresql+asyncpg://clinika:clinika_pass@clinika-db:5432/clinika`
   - `REDIS_URL=redis://clinika-redis:6379/0`
3. Запустить:
   ```bash
   docker compose up -d
   docker exec clinika-backend alembic -c /app/alembic.ini upgrade head
   ```
4. Открыть `http://localhost:8901` (frontend) и `http://localhost:8900/docs` (API).

### Вариант 2: backend native (для отладки)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# поднять только DB + Redis в Docker
docker compose up -d clinika-db clinika-redis
# запустить backend
uvicorn app.main:app --reload --port 8000
```

### Вариант 3: frontend native

```bash
cd frontend
npm install
npm run dev  # http://localhost:5173
```

Vite сам проксирует `/api` на `http://localhost:8000` (см. `vite.config.js`).

## Git flow

1. **Создать feature-ветку**:
   ```bash
   git checkout -b feature/loyalty-tiers
   ```
2. **Коммитить осмысленно**:
   - `feat(loyalty): добавить тиры с авто-повышением`
   - `fix(auth): исправить race-condition в refresh-token rotation`
   - `docs(wiki): описать модуль telemedicine`
   - `refactor(billing): извлечь bonus_cascade в service`
   - `test(referrals): покрыть race-condition`
3. **Pull / Rebase перед push**:
   ```bash
   git fetch origin
   git rebase origin/main
   ```
4. **Push + PR**:
   ```bash
   git push -u origin feature/loyalty-tiers
   gh pr create --title "feat(loyalty): тиры" --body "..."
   ```

## Code style

### Python (backend)

- Python 3.12+ (см. `Dockerfile`).
- Линтер: `ruff` (быстрый flake8-replacement).
- Форматирование: `black --line-length 100`.
- Типы: `mypy --strict` (постепенно вкатываем).
- Imports: `isort` (через ruff).

Конвенции:
- Async везде в backend, кроме чисто CPU-bound функций.
- Schemas (Pydantic) отделены от Models (SQLAlchemy).
- Бизнес-логика в `services/`, не в `routers/`.
- Запреты: bare `except:`, `print()` в проде, hardcoded secrets.

### JavaScript / React (frontend)

- ES2022, modules, no semicolons (style preference).
- Линтер: `eslint` (config `.eslintrc.js`).
- Форматирование: prettier (опционально).
- React hooks rules — обязательно.
- JSX: компонент в `PascalCase.jsx`, хук в `useCamelCase.js`.

Запреты:
- `var` (только `const`/`let`).
- Прямой DOM (`document.querySelector`), кроме hooks типа `useRef`.
- Inline стили (только Tailwind или design-tokens).
- `dangerouslySetInnerHTML` без DOMPurify.

### Markdown (wiki)

- Заголовки начинать с `## ` (без `# Title` в начале — заголовок берётся из `_index.json`).
- Code blocks с языком: ` ```python ` / ` ```bash `.
- Ссылки на другие статьи: `[Title](slug.md)`.
- Без emoji в техническом тексте.

## Тесты

Перед PR — запустить тесты:
```bash
docker exec clinika-backend pytest /app/tests -v
```

Если меняется бизнес-логика — обязательно добавить тест.

Для нового endpoint:
- Happy path.
- 401 без auth.
- 403 с неправильной ролью.
- Cross-tenant isolation.
- Edge-cases (пустой ввод, дубликаты).

## Review checklist

Перед approve PR:
- [ ] Тесты добавлены / обновлены.
- [ ] Миграции имеют осмысленные имена.
- [ ] Нет hardcoded secrets / IP / пароля.
- [ ] Нет `console.log` / `print()` / `debugger`.
- [ ] Pydantic schemas покрывают все поля.
- [ ] Audit-log пишется для важных операций.
- [ ] Wiki обновлена (если меняется UX).
- [ ] Backwards compatibility сохраняется (или есть migration plan).

## Релиз

1. PR → review → merge в `main`.
2. На production:
   ```bash
   cd /opt/clinika
   git pull origin main
   docker exec clinika-backend alembic upgrade head
   docker compose build clinika-backend && docker compose up -d clinika-backend
   # frontend если меняли .jsx/.js/.md
   docker compose build clinika-frontend && docker compose up -d clinika-frontend
   ```
3. Проверить `/health/full` → все ok.
4. Smoke-test основных сценариев.
5. Telegram-нотификация в команду «деплой такой-то commit hash».

## Контакты

- Maintainer: mrevil9995@gmail.com
- Issues: `https://github.com/mr-khamzat/clinika/issues`
- Telegram-чат команды (внутренний): по запросу.

## Лицензия

Проприетарный код, все права принадлежат владельцу. Внешние контрибьюторы — по NDA.

## Смотрите также

- [Dev · Архитектура](dev-architecture.md)
- [Dev · Стек](dev-stack.md)
- [Dev · Тестирование](dev-testing.md)
- [Dev · Деплой](dev-deployment.md)
