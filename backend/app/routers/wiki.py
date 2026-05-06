"""
Wiki — документация платформы.
Просмотр: все авторизованные пользователи.
Редактирование: только super_admin.
"""
import uuid, base64
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.core.deps import get_current_user, require_super_admin
from app.models.wiki import WikiPage, WikiImage
from app.models.user import User

router = APIRouter(prefix="/wiki", tags=["wiki"])


# ── Схемы ─────────────────────────────────────────────────────────────────────

class PageCreate(BaseModel):
    slug: str
    title: str
    content_md: str = ""
    icon: str = "article"
    parent_id: Optional[str] = None
    sort_order: int = 0
    is_published: bool = True


class PageUpdate(BaseModel):
    title: Optional[str] = None
    content_md: Optional[str] = None
    icon: Optional[str] = None
    parent_id: Optional[str] = None
    sort_order: Optional[int] = None
    is_published: Optional[bool] = None


def _page_out(p: WikiPage) -> dict:
    return {
        "id": str(p.id),
        "slug": p.slug,
        "title": p.title,
        "content_md": p.content_md,
        "icon": p.icon,
        "parent_id": str(p.parent_id) if p.parent_id else None,
        "sort_order": p.sort_order,
        "is_published": p.is_published,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


# ── Чтение ────────────────────────────────────────────────────────────────────

@router.get("/pages")
async def list_pages(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Дерево всех опубликованных страниц."""
    result = await db.execute(
        select(WikiPage).where(WikiPage.is_published == True)
        .order_by(WikiPage.sort_order, WikiPage.title)
    )
    pages = result.scalars().all()
    return [_page_out(p) for p in pages]


@router.get("/pages/all")
async def list_all_pages(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Все страницы включая черновики (только super_admin)."""
    result = await db.execute(
        select(WikiPage).order_by(WikiPage.sort_order, WikiPage.title)
    )
    return [_page_out(p) for p in result.scalars().all()]


@router.get("/pages/{slug}")
async def get_page(
    slug: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(WikiPage).where(WikiPage.slug == slug))
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Страница не найдена")
    return _page_out(page)


# ── Запись (только super_admin) ───────────────────────────────────────────────

@router.post("/pages", status_code=201)
async def create_page(
    body: PageCreate,
    current_user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = (await db.execute(select(WikiPage).where(WikiPage.slug == body.slug))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Slug уже занят")

    page = WikiPage(
        slug=body.slug,
        title=body.title,
        content_md=body.content_md,
        icon=body.icon,
        parent_id=uuid.UUID(body.parent_id) if body.parent_id else None,
        sort_order=body.sort_order,
        is_published=body.is_published,
        created_by_id=current_user.id,
    )
    db.add(page)
    await db.commit()
    await db.refresh(page)
    return _page_out(page)


@router.put("/pages/{page_id}")
async def update_page(
    page_id: uuid.UUID,
    body: PageUpdate,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    page = (await db.execute(select(WikiPage).where(WikiPage.id == page_id))).scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Страница не найдена")

    if body.title is not None:       page.title = body.title
    if body.content_md is not None:  page.content_md = body.content_md
    if body.icon is not None:        page.icon = body.icon
    if body.sort_order is not None:  page.sort_order = body.sort_order
    if body.is_published is not None: page.is_published = body.is_published
    if body.parent_id is not None:
        page.parent_id = uuid.UUID(body.parent_id) if body.parent_id != "null" else None
    page.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(page)
    return _page_out(page)


@router.delete("/pages/{page_id}", status_code=204)
async def delete_page(
    page_id: uuid.UUID,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    page = (await db.execute(select(WikiPage).where(WikiPage.id == page_id))).scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Страница не найдена")
    await db.delete(page)
    await db.commit()


# ── Изображения ───────────────────────────────────────────────────────────────

@router.post("/images")
async def upload_image(
    file: UploadFile = File(...),
    page_id: Optional[str] = None,
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Файл слишком большой (макс 10 МБ)")

    img = WikiImage(
        page_id=uuid.UUID(page_id) if page_id else None,
        filename=file.filename or "image",
        mime_type=file.content_type or "image/png",
        data_b64=base64.b64encode(content).decode(),
        size_bytes=len(content),
    )
    db.add(img)
    await db.commit()
    await db.refresh(img)
    return {"id": str(img.id), "filename": img.filename, "size_bytes": img.size_bytes}


@router.get("/images/{image_id}")
async def get_image(
    image_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    img = (await db.execute(select(WikiImage).where(WikiImage.id == image_id))).scalar_one_or_none()
    if not img:
        raise HTTPException(status_code=404, detail="Изображение не найдено")
    data = base64.b64decode(img.data_b64)
    return Response(content=data, media_type=img.mime_type)


# ── Сидирование стартовых страниц ─────────────────────────────────────────────

STARTER_PAGES = [
    {
        "slug": "overview",
        "title": "Обзор платформы",
        "icon": "home",
        "sort_order": 0,
        "parent_id": None,
        "content_md": """# Обзор платформы КлиникаСеть

**КлиникаСеть** — многотенантная SaaS-платформа для управления направлениями, пациентами, персоналом и финансами медицинских клиник.

---

## Ключевые возможности

- **Направления** — создание, отслеживание и подтверждение направлений между клиниками с QR-кодами
- **Биллинг** — подписки, тарифные планы, счета и платежи
- **Персонал** — роли, расписание, бонусы, KPI
- **Аналитика** — дашборды, отчёты, AI-анализ
- **Реклама** — баннеры в кабинете пациента
- **Интеграции** — МИС-системы, вебхуки, Telegram

---

## Архитектура

```
Клиент (React) ──▶ nginx ──▶ FastAPI Backend ──▶ PostgreSQL
                                    │
                               Redis Cache
```

| Сервис | Порт | Описание |
|--------|------|----------|
| Frontend | 8901 | React + Vite + Tailwind |
| Backend | 8900 | FastAPI + SQLAlchemy |
| Database | 5432 | PostgreSQL 16 |
| Cache | 6379 | Redis 7 |

---

## Домен и маршрутизация

Каждый тенант получает уникальный slug и работает по адресу:
`https://клиниксеть.рф/{slug}/`

Платформенная панель super_admin: `/admin`
Кабинет тенанта: `/{slug}/admin`
""",
    },
    {
        "slug": "roles",
        "title": "Роли и доступы",
        "icon": "manage_accounts",
        "sort_order": 1,
        "parent_id": None,
        "content_md": """# Роли и доступы

Платформа использует ролевую модель (RBAC). Каждый пользователь имеет одну роль.

---

## Таблица ролей

| Роль | Код | Описание | Кабинет |
|------|-----|----------|---------|
| Суперадмин | `super_admin` | Владелец платформы, полный доступ | `/admin` |
| Руководитель | `manager` | Управляющий тенантом | `/{slug}/manager` |
| Супервизор | `supervisor` | Контроль без редактирования | `/{slug}/admin` |
| Администратор | `admin` | Работа с направлениями | `/{slug}/admin` |
| Медсестра | `nurse` | Работа с направлениями | `/{slug}/admin` |
| Врач | `doctor` | Личный кабинет врача | `/{slug}/admin` |
| Партнёр | `partner` | Создание направлений | `/{slug}/` |
| Рекрутер | `recruiter` | Привлечение партнёров | `/{slug}/admin` |
| Менеджер привлечения | `acquisition_manager` | Привлечение врачей | `/{slug}/admin` |
| Внешний врач | `external_doctor` | Направления и бонусы | `/{slug}/admin` |
| Выездной врач | `visiting_doctor` | Приёмы и доход | `/{slug}/admin` |

---

## Матрица доступа к API

| Эндпоинт | admin | manager | supervisor | super_admin |
|----------|-------|---------|------------|-------------|
| GET /referrals | ✅ | ✅ | ✅ | ✅ |
| POST /referrals | ✅ | ✅ | ❌ | ✅ |
| GET /billing/* | ❌ | ✅ | ✅ | ✅ |
| POST /billing/subscription | ❌ | ✅ | ❌ | ✅ |
| GET /audit/log | ❌ | ✅ | ✅ | ✅ |
| POST /admin/tenants | ❌ | ❌ | ❌ | ✅ |

---

## Тенант-изоляция

Каждый запрос автоматически фильтруется по `tenant_id` пользователя.
Super_admin видит данные всех тенантов.
""",
    },
    {
        "slug": "api-auth",
        "title": "API: Аутентификация",
        "icon": "lock",
        "sort_order": 0,
        "parent_id": None,
        "content_md": """# API: Аутентификация

Все запросы к защищённым эндпоинтам требуют JWT Bearer токена.

---

## Получение токена

```
POST /auth/login
Content-Type: application/json

{
  "username": "khamzat",
  "password": "your_password"
}
```

**Ответ:**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "token_type": "bearer",
  "expires_in": 86400,
  "user": {
    "id": "uuid",
    "full_name": "Главный Администратор",
    "role": "super_admin",
    "tenant_slug": "arc"
  }
}
```

---

## Использование токена

```
GET /admins/me
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
```

---

## Refresh токен

```
POST /auth/refresh
Authorization: Bearer {refresh_token}
```

---

## Текущий пользователь

```
GET /admins/me
```

Возвращает профиль, роль, tenant_slug, redirect_url.

---

## Коды ошибок

| Код | Описание |
|-----|----------|
| 401 | Токен недействителен или истёк |
| 403 | Недостаточно прав для операции |
| 404 | Ресурс не найден |
| 409 | Конфликт (дубликат) |
| 422 | Ошибка валидации данных |
""",
    },
    {
        "slug": "api-referrals",
        "title": "API: Направления",
        "icon": "send",
        "sort_order": 1,
        "parent_id": None,
        "content_md": """# API: Направления

Направления — основная сущность платформы. Пациент направляется из одной клиники в другую на определённую услугу.

---

## Жизненный цикл

```
created ──▶ confirmed ──▶ (завершено)
    │
    └──▶ cancelled / expired
```

| Статус | Описание |
|--------|----------|
| `created` | Создано, ожидает подтверждения |
| `confirmed` | Подтверждено принимающей клиникой |
| `expired` | Истёк срок (авто, через N дней) |
| `cancelled` | Отменено |

---

## Создать направление

```
POST /referrals/
Authorization: Bearer {token}

{
  "to_clinic_id": "uuid",
  "service_id": "uuid",
  "patient_phone": "+79001234567",
  "patient_name": "Иванов Иван",
  "notes": "Комментарий"
}
```

---

## Список направлений

```
GET /referrals/?status=created&limit=50
```

---

## Подтвердить направление

```
POST /referrals/{id}/confirm
```

---

## QR-код

Каждое направление имеет уникальный QR-код (`qr_code` поле).
Пациент показывает QR в принимающей клинике — администратор сканирует и подтверждает.

```
GET /referrals/scan/{qr_code}
```

---

## Короткий код

Поле `short_code` — 6-значный код для быстрого поиска без QR.

```
GET /referrals/by-code/{short_code}
```
""",
    },
    {
        "slug": "api-billing",
        "title": "API: Биллинг",
        "icon": "receipt_long",
        "sort_order": 2,
        "parent_id": None,
        "content_md": """# API: Биллинг

Управление подписками, счетами и платежами тенантов.
Доступно только для `manager` и `super_admin`.

---

## Тарифные планы

```
GET /billing/plans
```

| План | Описание |
|------|----------|
| `basic` | Базовый, до 3 клиник |
| `professional` | Профессиональный, до 10 клиник |
| `enterprise` | Корпоративный, без ограничений |

---

## Создать подписку

```
POST /billing/subscription
Authorization: Bearer {manager_token}

{
  "plan": "professional",
  "billing_cycle": "monthly",
  "trial_days": 14
}
```

Циклы: `monthly`, `quarterly`, `semi_annual`, `nine_months`, `annual`

---

## Сводка биллинга

```
GET /billing/summary
```

Возвращает: активная подписка, баланс, просроченные счета, следующий платёж.

---

## Счета

```
GET /billing/invoices?status=unpaid&limit=20
GET /billing/invoices/{id}
POST /billing/invoices/generate
```

---

## Зарегистрировать платёж

```
POST /billing/invoices/{id}/pay

{
  "amount": 9900.00,
  "method": "bank_transfer",
  "transaction_id": "TXN-2026-001"
}
```

---

## Ledger (внутренний баланс)

```
GET /ledger/balance
GET /ledger/summary
GET /ledger/history
POST /ledger/adjust    (только manager)
```
""",
    },
    {
        "slug": "api-modules",
        "title": "API: Модули и фичи",
        "icon": "extension",
        "sort_order": 3,
        "parent_id": None,
        "content_md": """# API: Коммерческие модули

Платформа поддерживает подключаемые коммерческие модули для каждого тенанта.

---

## Список доступных модулей

| Ключ | Название | Описание |
|------|----------|----------|
| `ads_basic` | Реклама базовая | Баннеры в кабинете пациента |
| `ads_agency` | Реклама агентская | Расширенные рекламные инструменты |
| `ai_analytics_basic` | AI-аналитика базовая | Анализ направлений |
| `ai_analytics_pro` | AI-аналитика PRO | Полный AI-дашборд |
| `billing` | Биллинг | Управление подписками и счетами |
| `audit` | Аудит | Полный журнал действий |

---

## Активные модули тенанта

```
GET /modules/active-keys
Authorization: Bearer {token}
```

Возвращает список ключей активных модулей тенанта.

---

## Включить модуль (super_admin)

```
POST /commercial/tenants/{tenant_id}/modules/{key}/enable

{
  "price_override": 4900.00,
  "config": {}
}
```

---

## Проверка фичи

```
GET /modules/features/{name}
```

Возвращает `true/false` — доступна ли функция для текущего тенанта.

---

## Тарифные планы модулей

```
GET /modules/plans
```
""",
    },
    {
        "slug": "integrations",
        "title": "Интеграции",
        "icon": "sync_alt",
        "sort_order": 4,
        "parent_id": None,
        "content_md": """# Интеграции

Платформа поддерживает интеграцию с внешними МИС-системами и сервисами.

---

## МИС (Медицинские информационные системы)

Синхронизация пациентов, записей и врачей с МИС тенанта.

```
POST /mis/sync/patient
POST /mis/sync/appointment
POST /mis/sync/doctor
GET  /mis/sync/status
```

### Настройка

```
POST /commercial/tenants/{tenant_id}/integrations

{
  "type": "mis",
  "name": "МИС Инфоклиника",
  "base_url": "https://mis.example.com/api",
  "api_key": "your-api-key",
  "is_active": true
}
```

---

## Вебхуки

Получайте уведомления о событиях в реальном времени.

### Создать endpoint

```
POST /webhooks/endpoints

{
  "url": "https://your-server.com/webhook",
  "events": ["referral_created", "referral_confirmed", "payment_received"],
  "secret": "your-hmac-secret"
}
```

### События

| Событие | Описание |
|---------|----------|
| `referral_created` | Создано новое направление |
| `referral_confirmed` | Направление подтверждено |
| `referral_expired` | Направление истекло |
| `referral_cancelled` | Направление отменено |
| `payment_received` | Получен платёж |
| `subscription_changed` | Изменена подписка |

### Подпись запроса

Каждый вебхук содержит заголовок `X-Signature: sha256=...`
Проверяйте HMAC-SHA256 с вашим секретом.

---

## Telegram

Уведомления через Telegram-бота для менеджеров и администраторов.

Настройка: раздел **Настройки → Уведомления** в кабинете менеджера.
""",
    },
    {
        "slug": "api-staff",
        "title": "API: Персонал",
        "icon": "group",
        "sort_order": 5,
        "parent_id": None,
        "content_md": """# API: Персонал

Управление сотрудниками, врачами и расписанием.

---

## Список сотрудников

```
GET /admins/
Authorization: Bearer {manager_token}
```

---

## Создать сотрудника

Через систему приглашений:

```
POST /manager/staff/invite

{
  "email": "doctor@clinic.ru",
  "role": "reg",
  "clinic_id": "uuid",
  "full_name": "Иванов Иван"
}
```

Сотрудник получает ссылку для регистрации: `/invite/{token}`

---

## Врачи

```
GET  /scheduling/doctors
POST /scheduling/doctors
GET  /scheduling/doctors/{id}
```

### Расписание врача

```
GET  /scheduling/doctors/{id}/schedule
POST /scheduling/slots
```

---

## Внешние и выездные врачи

### Заявка на регистрацию (менеджер привлечения)

```
POST /acquisition/requests

{
  "doctor_name": "Иванов Иван",
  "phone": "+79001234567",
  "specialization": "Кардиология"
}
```

### Одобрить заявку (admin/manager)

```
POST /admins/doctor-requests/{id}/approve
```

Создаёт аккаунт с ролью `external_doctor` и возвращает временный пароль.

### Настройки выездного врача

```
POST /visiting/admin/settings

{
  "doctor_id": "uuid",
  "price_per_visit": 3000,
  "doctor_percent": 60,
  "start_date": "2026-05-01"
}
```

---

## Бонусы

```
GET /bonuses/summary
GET /bonuses/
```
""",
    },
    {
        "slug": "api-analytics",
        "title": "API: Аналитика",
        "icon": "bar_chart",
        "sort_order": 6,
        "parent_id": None,
        "content_md": """# API: Аналитика и отчёты

---

## Дашборд менеджера

```
GET /manager/analytics/dashboard?days=30
```

Возвращает: направления по статусам, топ-клиники, конверсия, динамика.

---

## Отчёты

```
GET /manager/reports/referrals?from=2026-01-01&to=2026-04-30
GET /manager/reports/bonuses
GET /manager/reports/clinics
```

---

## KPI

```
GET  /manager/kpi/targets
POST /manager/kpi/targets
```

---

## AI-аналитика

Требует модуль `ai_analytics_basic` или `ai_analytics_pro`.

```
POST /ai/analyze

{
  "type": "referrals_trend",
  "period_days": 30
}
```

Типы анализа:
- `referrals_trend` — тренды направлений
- `clinic_performance` — эффективность клиник
- `doctor_workload` — нагрузка врачей
- `patient_flow` — поток пациентов

---

## Аудит-лог

Требует модуль `audit`.

```
GET /audit/log?limit=100&entity_type=referral
GET /audit/log/{entity_type}/{entity_id}
GET /audit/log/actor/{user_id}
```

---

## Активность

```
GET /manager/activity?days=7
```
""",
    },
    {
        "slug": "faq",
        "title": "Частые вопросы",
        "icon": "help",
        "sort_order": 7,
        "parent_id": None,
        "content_md": """# Частые вопросы (FAQ)

---

## Как добавить новую клинику?

1. Войдите в кабинет менеджера
2. Раздел **Клиники → Добавить клинику**
3. Заполните название, адрес, расписание
4. Настройте видимость для других клиник

---

## Как направление становится подтверждённым?

Администратор принимающей клиники:
1. Сканирует QR-код пациента, или
2. Вводит короткий код в разделе «Направления → Подтвердить»

После подтверждения направляющему администратору начисляется бонус.

---

## Что делать если пациент потерял QR?

Найдите направление по номеру телефона или короткому коду.
Раздел: Направления → Поиск.

---

## Как настроить вебхуки?

1. Раздел **Настройки → Интеграции → Вебхуки**
2. Добавьте URL вашего сервера
3. Выберите события для подписки
4. Сохраните секрет для проверки подписи

---

## Как подключить модуль рекламы?

Обратитесь к администратору платформы (super_admin).
Он активирует модуль `ads_basic` или `ads_agency` для вашего тенанта.
После активации раздел **Реклама** появится в панели управления.

---

## Как сменить тарифный план?

Кабинет менеджера → **Биллинг → Сменить тариф**.
Изменение вступает в силу с начала следующего периода.

---

## Лимиты по тарифам

| Параметр | Basic | Professional | Enterprise |
|----------|-------|-------------|------------|
| Клиник | 3 | 10 | Без лимита |
| Пользователей | 20 | 100 | Без лимита |
| Направлений/мес | 500 | 5000 | Без лимита |
| API запросов/день | 1000 | 10000 | Без лимита |
""",
    },
]


@router.post("/seed", status_code=201)
async def seed_starter_pages(
    _: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Создать стартовые страницы документации (если их ещё нет)."""
    created = 0
    for data in STARTER_PAGES:
        existing = (await db.execute(
            select(WikiPage).where(WikiPage.slug == data["slug"])
        )).scalar_one_or_none()
        if not existing:
            page = WikiPage(**data)
            db.add(page)
            created += 1
    await db.commit()
    return {"created": created, "total": len(STARTER_PAGES)}
