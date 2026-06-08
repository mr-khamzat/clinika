# routers [13] — Wiki (встроенная база знаний платформы)

Эта группа состоит из одного роутера — `wiki.py`. Он реализует внутреннюю документацию («Wiki») платформы КлиникСеть: CRUD страниц с Markdown-контентом, загрузку/отдачу изображений (хранятся в БД в base64) и автоматическое сидирование стартового набора из 10 страниц документации. Это **платформенная**, а не тенант-специфичная сущность: страницы и изображения общие для всей инсталляции, без `tenant_id`. Просмотр доступен любому авторизованному пользователю, любое изменение (создание/редактирование/удаление/загрузка картинок/сидирование) — только `super_admin`.

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `backend/app/routers/wiki.py` | CRUD wiki-страниц, изображения, сид стартовых страниц | 972 |

---

## `backend/app/routers/wiki.py`

- **Назначение:** Управление внутренней документацией платформы. Хранит дерево Markdown-страниц (с иерархией через `parent_id`, сортировкой и флагом публикации) и изображения. Просмотр — для всех авторизованных, запись — только super_admin. Содержит большой захардкоженный массив `STARTER_PAGES` (10 готовых страниц документации) для первичного наполнения через эндпоинт `/wiki/seed`.

- **Ключевые элементы:**
  - `router = APIRouter(prefix="/wiki", tags=["wiki"])` — подключается в `main.py:1654` через `app.include_router(wiki_router)` **без дополнительного префикса**, поэтому итоговый префикс ровно `/wiki`.
  - Pydantic-схемы: `PageCreate` (slug, title, content_md, icon, parent_id, sort_order, is_published), `PageUpdate` (все поля Optional для частичного апдейта).
  - Хелпер `_page_out(p: WikiPage) -> dict` — единая сериализация страницы в JSON (UUID → str, datetime → isoformat).
  - 10 эндпоинтов (3 чтения страниц + 3 записи + 2 изображения + сид).
  - Константа `STARTER_PAGES: list[dict]` (строки 207–952) — 10 преднаполненных страниц документации в Markdown: `overview`, `roles`, `api-auth`, `api-referrals`, `api-billing`, `api-modules`, `integrations`, `api-staff`, `api-analytics`, `faq`.

- **Эндпоинты:** (префикс `/wiki`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/wiki/pages` | любой авторизованный | — | `list[dict]` страниц | Дерево только **опубликованных** страниц, сортировка по `sort_order, title` |
| GET | `/wiki/pages/all` | super_admin | — | `list[dict]` | Все страницы, включая черновики (`is_published=False`) |
| GET | `/wiki/pages/{slug}` | любой авторизованный | `slug` в пути | `dict` страницы / 404 | Получить страницу по slug. **Не фильтрует по is_published** — отдаёт и черновики |
| POST | `/wiki/pages` | super_admin | `PageCreate` | `dict` страницы (201) | Создать страницу; 409 если slug занят. Проставляет `created_by_id` |
| PUT | `/wiki/pages/{page_id}` | super_admin | `page_id` (UUID), `PageUpdate` | `dict` страницы / 404 | Частичное обновление; вручную выставляет `updated_at` |
| DELETE | `/wiki/pages/{page_id}` | super_admin | `page_id` (UUID) | 204 / 404 | Удалить страницу |
| POST | `/wiki/images` | super_admin | `UploadFile` (`file`), опц. `page_id` | `{id, filename, size_bytes}` | Загрузить изображение в БД (base64); лимит 10 МБ → иначе 413 |
| GET | `/wiki/images/{image_id}` | любой авторизованный | `image_id` (UUID) | бинарный `Response` с `media_type` | Отдать картинку (декод из base64) / 404 |
| POST | `/wiki/seed` | super_admin | — | `{created, total}` (201) | Создать стартовые страницы из `STARTER_PAGES`, пропуская уже существующие по slug |

- **Зависимости:**
  - `app.database.get_db` — async-сессия SQLAlchemy.
  - `app.core.deps.get_current_user` — JWT Bearer аутентификация (любой авторизованный).
  - `app.core.deps.require_super_admin` — гейт super_admin; важно: пропускает по роли `UserRole.SUPER_ADMIN` **ИЛИ** по совпадению `user.username == settings.superadmin_username` (см. `deps.py:103-109`).
  - `app.models.wiki.WikiPage`, `app.models.wiki.WikiImage` — ORM-модели (`wiki_pages`, `wiki_images`). У `WikiPage` есть self-FK `parent_id → wiki_pages.id` (ondelete SET NULL) и `created_by_id → users.id`. `WikiImage` хранит файл целиком в `data_b64` (Text) + `mime_type`, `size_bytes`, опц. `page_id`.
  - `app.models.user.User` — тип для зависимостей.
  - Стандартные: `uuid`, `base64`, `datetime`, Pydantic `BaseModel`, `fastapi.responses.Response`.

- **Где менять для типовых задач:**
  - **Добавить/изменить поле страницы** (напр. `tags`, `lang`): правь модель `WikiPage` в `app/models/wiki.py`, схемы `PageCreate`/`PageUpdate`, хелпер `_page_out`, тело `create_page`/`update_page` — и нужна миграция БД.
  - **Изменить лимит размера картинки** — строка 176 (`10 * 1024 * 1024`).
  - **Поменять/дополнить стартовый контент документации** — редактируй массив `STARTER_PAGES` (строки 207–952). Каждая запись — `dict` с полями модели; `content_md` содержит Markdown целиком.
  - **Скрывать черновики при чтении по slug** — добавь `.where(WikiPage.is_published == True)` в `get_page` (строка 93), сейчас он отдаёт и неопубликованные.
  - **Разрешить редактирование не только super_admin** (напр. менеджеру) — замени зависимость `require_super_admin` на нужный гейт в соответствующих эндпоинтах.
  - **Сменить хранилище картинок** (с base64-в-БД на S3/диск) — переписывай `upload_image`/`get_image` и модель `WikiImage`.

- **Подводные камни:**
  - **Нет tenant_id-изоляции.** Wiki — глобальная для всей платформы; страницы/картинки видят все тенанты. Если потребуется приватная вики на тенант — это архитектурное изменение (добавление `tenant_id` + фильтрация).
  - **`get_page` по slug не фильтрует `is_published`** — любой авторизованный пользователь может прочитать черновик, зная slug (строки 87–97). Потенциальная утечка незавершённого контента.
  - **Изображения в base64 в БД** — большие файлы раздувают таблицу `wiki_images` и каждый ответ держит весь файл в памяти (`base64.b64decode`). Лимит 10 МБ на файл, но суммарный объём не ограничен.
  - **`page_id` для картинки не валидируется на существование** — можно привязать к несуществующей странице (FK на уровне БД с SET NULL, но проверки в коде нет; `uuid.UUID(page_id)` бросит 500 при кривом UUID, а не аккуратный 422).
  - **Магическая строка `"null"`** в `update_page` (строка 145): чтобы отвязать родителя, фронт должен прислать `parent_id="null"` (строка), иначе `parent_id` интерпретируется как UUID. Хрупкий контракт.
  - **`updated_at` выставляется вручную** в `update_page` (строка 146), хотя в модели есть `onupdate=datetime.utcnow`. Дублирование логики; модель использует наивный `datetime.utcnow`, а роутер — `datetime.now(timezone.utc)` (timezone-aware) → возможная рассогласованность tz.
  - **`create_page` не пишет `updated_at`/`created_at`** явно — полагается на дефолты модели (наивный UTC). Чтение через `_page_out` зовёт `.isoformat()`.
  - **Async/await везде корректны**; коммиты + `db.refresh` после записи. `delete_page` не делает refresh (объект удалён) — это ок.
  - Файл **рабочий, не легаси**: единственный роутер для фичи Wiki, активно включён в `main.py`.

- **Строк:** 972
