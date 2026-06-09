# ПЛЕЙБУК РАЗРАБОТЧИКА «КлиникСеть» (clinika)

> Главный документ «как вносить изменения завтра». Пошаговые рецепты с конкретными
> файлами, порядком действий и чек-листами. Основано на реальном коде, не на догадках.

## TL;DR — карта проекта

| Слой | Где лежит | Как меняется |
|------|-----------|--------------|
| API-роутеры | `backend/app/routers/*.py` | `APIRouter(prefix=...)`, async, проверка ролей через `Depends` |
| Бизнес-логика | `backend/app/services/*.py` | чистые async-функции/классы, **никаких `APIRouter`** |
| ORM-модели | `backend/app/models/*.py` | SQLAlchemy 2.0 (`Mapped[...]` + `mapped_column`), `Numeric` для денег |
| Pydantic-схемы | внутри роутера ИЛИ `backend/app/schemas/*.py` | `*In`/`*Out` |
| Миграции | `backend/alembic/versions/*.py` | вручную, `revision`/`down_revision` строкой |
| Подключение роутеров | `backend/app/main.py` (основной блок импортов ~стр.32-204, но ~19 роутеров импортируются точечно ниже, вплоть до ~1846; `include_router` ниже) | один `app.include_router(...)` |
| Точка входа фронта | `frontend/src/App.jsx` | роуты, `lazy(...)`, ветки по `user.role` |
| API-клиент фронта | `frontend/src/api/index.js` | единый axios-инстанс + именованные функции |
| Дизайн-система | `frontend/src/design` | `Card/Button/Chip/Tabs/Page/useToast` |
| Ядро (auth/RBAC/tenant) | `backend/app/core/*.py` | `deps.py`, `tenant.py`, `permissions.py` |

**Запуск (прод-стиль, Docker):** `docker compose up -d` → `docker exec clinika-backend alembic -c /app/alembic.ini upgrade head`.
Бэкенд внутри контейнера слушает `:8000`, наружу: backend `127.0.0.1:8900`, frontend `127.0.0.1:8901`.

---

## 1. Как добавить новый API-эндпоинт

Порядок: **модель (если нужна новая таблица) → схема → сервис → роутер → подключение в `main.py`**.
В этом проекте сервис-слой реальный и важный: роутеры тонкие, вся логика в `app/services/*`.

### Шаги

1. **Модель** (если данные новые) — см. раздел 3. Если пишешь в существующую таблицу — пропусти.

2. **Pydantic-схемы.** Конвенция именования: `XIn` (вход), `XOut` (выход), `XPatch` (частичное обновление).
   Маленькие схемы держат **прямо в файле роутера** (как `OpenShiftRequest`/`ShiftOut` в `accountant/cash.py`).
   Крупные/переиспользуемые — в `backend/app/schemas/`.
   - Деньги на входе принимай `float`, но **сразу заворачивай в `Decimal(str(value))`** (паттерн из `billing.py`).
   - Деньги на выходе сериализуй `float(...)` — JSON не умеет Decimal.

3. **Сервис** — `backend/app/services/<feature>_service.py`. Чистая async-функция, принимает `db: AsyncSession`
   первым аргументом. **Не делает `commit` сам**, если это часть транзакции вызывающего (`activity_service.log_activity` —
   только `db.add()` без commit, явно «commit на вызывающей стороне» в докстринге; `aggregator_service.update_lead_status` — `db.flush()`).
   Если функция самодостаточна — коммитит сама
   (как `acts_service.generate_monthly_act`). Реши осознанно и задокументируй в докстринге.

4. **Роутер.** Создай/открой `backend/app/routers/<feature>.py`:
   ```python
   from fastapi import APIRouter, Depends, HTTPException
   from sqlalchemy import select
   from app.database import get_db                 # или get_tenant_db для RLS
   from app.core.deps import get_current_user, require_role
   from app.models.user import User

   router = APIRouter(prefix="/<feature>", tags=["<feature>"])

   @router.get("", response_model=list[XOut])
   async def list_items(
       db = Depends(get_db),
       user: User = Depends(get_current_user),
   ):
       rows = (await db.execute(
           select(MyModel).where(MyModel.tenant_id == user.tenant_id)   # ОБЯЗАТЕЛЬНО!
       )).scalars().all()
       return [XOut(...) for r in rows]
   ```
   - **Префикс задаётся ВНУТРИ файла** (`APIRouter(prefix=...)`), а не при подключении. В `main.py` подключают «голым» `include_router`.
   - Гейты доступа выбирай из `app/core`:
     - роль: `Depends(require_role("manager", "franchise_owner"))` или готовые `require_manager`/`require_super_admin`/`require_accountant`;
     - гранулярное право: `Depends(require_permission("referrals:write"))` — **уже возвращает `Depends`, не оборачивай повторно**;
     - фича тарифа: `Depends(require_feature("billing"))` — возвращает «голую» функцию, **оборачивай `Depends(...)` сам**;
     - платный модуль: `Depends(require_module("telemedicine"))` (даёт 402 если нет подписки);
     - активная подписка для write: `dependencies=[Depends(require_active_subscription)]`.

5. **Подключение в `main.py`:**
   - Добавь импорт рядом с остальными (основной блок строк ~32-204; но учти — часть роутеров импортируется точечно ниже по файлу, вплоть до ~1846, напр. `reg_speed_router` на ~1639; ищи `Grep "from app.routers"`):
     `from app.routers.<feature> import router as <feature>_router`
   - Найди блок `app.include_router(...)` (ниже по файлу) и добавь:
     `app.include_router(<feature>_router)`
   - **Не задавай `prefix=` при подключении** — он уже в роутере.

### Чек-лист эндпоинта
- [ ] Запрос фильтрует по `tenant_id` (или RLS через `get_tenant_db`) — см. раздел 7.
- [ ] Доступ закрыт правильным `Depends` (роль/право/фича/модуль).
- [ ] Деньги: вход `Decimal(str(...))`, выход `float(...)`.
- [ ] `response_model` указан (Pydantic-схема), либо явный dict.
- [ ] Импорт + `include_router` добавлены в `main.py`.
- [ ] Сервис не «съедает» чужую транзакцию (`flush` vs `commit` — осознанно).
- [ ] IDOR: для доступа к объекту по `id` проверяешь `obj.tenant_id == user.tenant_id` (или `assert_tenant_owns(...)`).

### Подводные камни
- В проекте есть **дубли-алиасы роутеров** (например `acts.py` экспортирует `router` И `inter_clinic_router` на `/inter-clinic-acts` с теми же хендлерами). Меняешь логику — проверь, нет ли алиаса.
- Часть raw-SQL в admin-роутерах **PostgreSQL-специфична** (`date_trunc`, `FILTER (WHERE ...)`, `CAST(... AS inet)`) и **не работает на SQLite** — это ломает локальные тесты. Если можешь — пиши на ORM.
- Роли иногда заданы **строковыми литералами** (`"manager"`), а не enum `UserRole` — риск опечатки. Предпочитай enum/готовые `require_*`.

---

## 2. Как добавить новую страницу в кабинет

Фронт — React + Vite, без TypeScript. Навигация разная в разных кабинетах — это ключевая ловушка.

### 2а. Куда добавлять — три механизма навигации

| Кабинет / контекст | Механизм | Файл |
|--------------------|----------|------|
| Тенантное мини-приложение (manager/reg/doctor через MiniApp) | `react-router` `<Route>` внутри `<Routes>` | `frontend/src/App.jsx` |
| Панель super_admin | НЕ react-router; switch `renderSection()` + `pushState` | `frontend/src/pages/AdminLayout.jsx` |
| Кабинет бухгалтера | `react-router` `<Routes>` вложенный | `frontend/src/pages/AccountantCabinet.jsx` |
| Кабинет директора | `react-router` `<Outlet/>` + `DIR_NAV` | `frontend/src/pages/DirectorLayout.jsx` |
| Кабинет врача | switch `renderRoute()` + `NAV` (вне BrowserRouter!) | `frontend/src/pages/DoctorLayout.jsx` |

> **КРИТИЧНО:** `DoctorLayout` и `CreateReferralForm` рендерятся в `AdminRoot` **вне `BrowserRouter`**.
> Там `useNavigate`/`useSearchParams` **бросают invariant**. Навигация только через
> `window.location.assign('/' + SLUG + path)`. Не копируй `useNavigate` в эти файлы.

### 2б. Рецепт для тенантного кабинета (App.jsx, manager и т.п.)

1. Создай страницу `frontend/src/pages/ManagerX.jsx` (`export default function ManagerX()`).
2. В `App.jsx` объяви ленивый импорт:
   `const ManagerX = lazy(() => import('./pages/ManagerX'))`
3. Добавь маршрут в нужную ролевую ветку (`user?.role === 'manager' && (...)`):
   ```jsx
   <Route path="manager/x" element={
     <Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerX /></Suspense>
   } />
   ```
   `basename={"/" + SLUG}` уже задан, поэтому реальный URL = `/{slug}/manager/x`.
4. **Пункт меню (shell):** добавь ссылку в навигацию соответствующего кабинета (для manager — в его меню/Layout; для директора — `DIR_NAV`; для врача — `NAV` + `MOBILE_NAV`).
5. **Вызов API:** через единый axios-инстанс:
   ```jsx
   import api from '../api'
   const { data } = await api.get('/manager/x')        // base-URL и Bearer добавятся сами
   ```
   Либо добавь именованную функцию в конец `frontend/src/api/index.js` и используй её.

### 2в. Рецепт для панели super_admin (AdminLayout.jsx) — источник истины РАЗМАЗАН по 6 местам

Чтобы раздел появился полностью, синхронно правь **все шесть**:
1. `lazy()`-импорт (или inline-функция-секция).
2. Пункт в массиве `NAV[]` (`{key, label, icon}`).
3. Запись в `NAV_GROUP_OF` (в какую группу сайдбара).
4. `PAGE_TITLES[key]` (заголовок + подзаголовок).
5. Ключ в `Set ADMIN_SECTIONS` — **иначе deep-link `/admin/<key>` при перезагрузке сбросится на home**.
6. `case '<key>':` в `renderSection()`.

Видимость пункта — `visibleNav` (+ наборы `PLATFORM_ONLY_KEYS`/`TENANT_OPERATIONAL_KEYS`); привязка к платному модулю — ветка `m.has('module_key')`.

### Чек-лист страницы
- [ ] Используешь правильную навигацию для своего кабинета (см. таблицу; врач/CreateReferral — `window.location.assign`).
- [ ] Страница в `lazy(...)` (кроме мелких на критическом пути регистрации).
- [ ] API-вызовы через `../api` (axios с auto-Bearer/refresh), не голый `axios` — **исключение**: публичные страницы без auth (`ClinicPage`, `Franchise`, `ThemeLoader`) намеренно на голом `axios`.
- [ ] Ошибки запросов обработаны (см. раздел 7).
- [ ] Для AdminLayout — правил все 6 структур.
- [ ] Деньги с бэка приходят строкой (Decimal) — для отображения `Number(x).toLocaleString('ru-RU')`, не для расчётов.

### Подводные камни
- **Две токен-системы на один SLUG:** `clinika_token_<SLUG>` (пациент/партнёр) и `clinika_admin_token_<SLUG>` (admin/manager/franchise/super). Какой берётся — решает `_isAdminPath()` в `api/index.js` по `pathname`. Меняешь схему URL — синхронизируй там.
- **Расхождение API дизайн-компонентов:** `Tabs` где-то `tabs/value/onChange`, где-то `items/active/onChange`; `Chip` — `tone=` vs `variant=`; `Button` — `kind=` vs `variant=`. **Перед использованием смотри фактическую сигнатуру в `../design`**, не копируй вслепую.
- `day_of_week`: бэк хранит **0=Понедельник**. `CreateReferral`/`ClinicPage` делают пересчёт `(getDay()+6)%7`; `ClinicSchedules` — сырой индекс. Следи за конвенцией.

---

## 3. Как добавить новую модель + миграцию

Порядок: **модель → alembic revision (вручную) → upgrade**. Авто-генерация ревизий в этом проекте не используется — миграции пишут руками, `revision`/`down_revision` — строки-метки.

### 3а. Модель

`backend/app/models/<name>.py`, стиль SQLAlchemy 2.0:
```python
import uuid, datetime
from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class MyEntity(Base):
    __tablename__ = "my_entities"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))   # см. правило ondelete ниже
    amount: Mapped[...] = mapped_column(Numeric(12, 2), nullable=False)       # ДЕНЬГИ = Numeric, не Float
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="new")
    created_at: Mapped[datetime.datetime] = mapped_column(default=datetime.datetime.utcnow)
```
Правила проекта (см. `models/*`):
- **`tenant_id` почти всегда есть.** `ondelete="CASCADE"` для критичных данных (удаляются с тенантом); `ondelete="SET NULL"` + nullable для тех, что должны пережить удаление тенанта (аудит, реклама-история).
- **Деньги — `Numeric`/`Decimal`, никогда `Float`** (Float допустим только для координат `latitude/longitude`).
- **Статусы — строкой** через класс-константу (`class XStatus: NEW="new"`). Настоящий `enum.Enum` + `SAEnum` тоже встречается (`bonus.py`, `call_recording.py`), но это меняет тип в PostgreSQL (`ALTER TYPE` в миграции вместо правки Python) — без нужды не плоди ENUM-типы.
- Регистрируется автоматически через `from app.models import *` в `main.py` — отдельно импортировать не нужно, но убедись, что модель экспортирована из `app/models/__init__.py`.

### 3б. Миграция

1. Скопируй существующую как образец: `backend/alembic/versions/acct01_cashshift.py`.
2. Имя файла-метки осмысленное (`<feature><NN>_<short>.py`), `revision = '<метка>'`.
3. `down_revision` = метка **текущего head**. Узнать head: `docker exec clinika-backend alembic -c /app/alembic.ini heads`.
4. Напиши `upgrade()` через `op.create_table`/`op.add_column`/`op.create_index`. **Пиши и `downgrade()`** (drop в обратном порядке).
5. Шаблон (реальный, из `acct01`):
   ```python
   revision = 'myfeat01'
   down_revision = '<предыдущий_head>'
   branch_labels = None
   depends_on = None

   def upgrade():
       op.create_table("my_entities",
           sa.Column("id", UUID(as_uuid=True), primary_key=True),
           sa.Column("tenant_id", UUID(as_uuid=True),
                     sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
           sa.Column("amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
           sa.Column("created_at", sa.DateTime, nullable=False))
       op.create_index("ix_my_entities_tenant", "my_entities", ["tenant_id"])

   def downgrade():
       op.drop_index("ix_my_entities_tenant", table_name="my_entities")
       op.drop_table("my_entities")
   ```
6. Применить: `docker exec clinika-backend alembic -c /app/alembic.ini upgrade head`.

### Чек-лист модели+миграции
- [ ] `tenant_id` есть и `ondelete` выбран осознанно (CASCADE/SET NULL).
- [ ] Деньги — `Numeric`, не Float.
- [ ] Индекс на `tenant_id` (и на поля фильтрации).
- [ ] `server_default` в миграции **совпадает** с `default=` в модели (рассинхрон даёт разные значения у новых строк — реальный баг из `api_quota.py`).
- [ ] `down_revision` указывает на актуальный head; написан `downgrade()`.
- [ ] Если добавляешь значение в существующий PostgreSQL-ENUM: `op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS '...'")` (как в `acct01`); DROP VALUE Postgres не умеет — `downgrade` enum не откатывает.
- [ ] Partial unique / частичные индексы — только через `op.execute("CREATE UNIQUE INDEX ... WHERE ...")` (как инвариант «одна открытая смена на клинику»).

---

## 4. Как добавить новый кабинет/роль целиком

Роль — сквозная сущность: затрагивает enum в БД, RBAC, редиректы логина, фронт-роутинг и UI-оболочку.

### Бэкенд
1. **Enum роли.** Добавь значение в `UserRole` (`backend/app/models/user.py`) и миграцией:
   `op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'my_role'")` (образец — `acct01_cashshift.py`).
2. **RBAC.** В `backend/app/core/permissions.py` → `ROLE_PERMISSIONS` добавь набор прав новой роли. При необходимости — в `EDITABLE_ROLES` (если франчайзи сможет настраивать её права в UI). После правок override в БД зови `await invalidate_rbac_cache(tenant_id, role)`.
3. **Ролевая зависимость.** Если нужен отдельный гейт — добавь `require_<role>` в `backend/app/core/deps.py` по образцу существующих `require_manager`/`require_director`. Чтобы пустить роль в кабинет бухгалтера — допиши её в `_ACCOUNTANT_ALLOWED` (`accountant/deps.py`).
4. **Редирект после логина.** В `backend/app/routers/auth.py` → `_issue_tokens` (словарь `ADMIN_CABINET_ROLES` и цепочка `if/elif`) задай, куда роль попадает после входа (какой `redirect_url`).

### Фронт
5. **Корневой роутинг ролей** — `frontend/src/pages/AdminRoot.jsx`: добавь ветку `if (role === 'my_role') return <MyCabinet .../>` (порядок веток = приоритет). Если роль рендерится не в AdminRoot, а как hard-redirect (как `manager` → `/{slug}/manager`) — добавь и в `RootRedirect` в `App.jsx`.
6. **Оболочка кабинета** — создай `MyCabinet.jsx`/`MyLayout.jsx` по образцу `DirectorLayout.jsx` (свой shell, `react-router` `<Outlet/>`) либо `AccountantCabinet.jsx` (вложенный `<Routes>`). Реши механизм навигации заранее (см. раздел 2а).
7. **Маршрут верхнего уровня** в `App.jsx` (как `director`/`accountant`):
   ```jsx
   {user?.role === 'my_role' && (
     <Route path="/my-cabinet/*" element={<Suspense ...><MyCabinet /></Suspense>} />
   )}
   ```
8. **Видимость пунктов** в админ-панели (если роль её видит) — `visibleNav`/`PLATFORM_ONLY_KEYS` в `AdminLayout.jsx`.

### Чек-лист новой роли
- [ ] Значение добавлено в `UserRole` + миграция `ALTER TYPE ... ADD VALUE`.
- [ ] Права в `ROLE_PERMISSIONS`; кэш RBAC инвалидируется.
- [ ] `_issue_tokens` знает redirect для роли.
- [ ] `AdminRoot` (и при необходимости `RootRedirect`) монтирует кабинет.
- [ ] Создан shell-кабинет с осознанным механизмом навигации.
- [ ] `require_*`-гейты обновлены везде, где роль должна иметь/не иметь доступ.
- [ ] Проверь, что `super_admin` по-прежнему всё видит (он проходит все гейты by design).

---

## 5. Как подключить нового провайдера (платёжный / ОФД / телефонный)

В проекте есть единый паттерн «адаптеров»: **абстрактная база → реестр → конкретный адаптер → фасад-сервис**.
Эталон — эквайринг (`backend/app/services/acquiring/`). Реально реализован только **ЮKassa**; Т-Банк/Сбер/CloudPayments/Robokassa — заглушки, бросающие `NotImplementedError`.

### Рецепт нового платёжного шлюза (по образцу ЮKassa)
1. **Реализуй адаптер** `backend/app/services/acquiring/<provider>_adapter.py`, наследуя `BasePaymentGateway` (из `acquiring/base.py`). Контракт — 4 async-метода:
   - `init_payment(amount, description, return_url, metadata)` → `PaymentInitResult(payment_url, payment_id, raw)`
   - `get_status(payment_id)` → `PaymentStatusResult(status, paid_at, raw)` (404 → `LookupError`)
   - `refund(payment_id, amount=None)`
   - `verify_webhook(headers, body)` — **обязан вернуть `None` при невалидной подписи** (не бросать!), иначе вебхук-роутер не отличит подделку.
   - `name = "<provider>"`. Образец живого кода — `yookassa_adapter.py` (httpx, Basic-auth, `idempotency_key`, IP-allowlist вебхука).
2. **Зарегистрируй** адаптер в `backend/app/services/acquiring/__init__.py` (там ~5 строк `register_gateway(...)`). **Не правь `registry.py`** — он заполняется как side-effect импорта пакета.
3. **Фасад** `acquiring_service.py` подхватит адаптер через `get_gateway(name, config)` автоматически — менять обычно не нужно. Выбор шлюза «по умолчанию» — `_get_active_config`.
4. **Конфиг/креды** хранятся в модели `PaymentGatewayConfig` (файл `app/models/payments_clinic.py`, таблица `payment_gateway_configs`) per-clinic, с env-fallback. UI правки — «Настройки → Онлайн-оплата».
5. **Деньги — `Decimal`** по всему контракту. Многие провайдеры хотят **сумму в копейках (int)** — не забудь `× 100` (это явная заметка в заглушках tinkoff/sber).

### ОФД (54-ФЗ) и фискальные адаптеры
Фискальные адаптеры (Платформа ОФД и т.п.) живут в `backend/app/services/fiscal/` (по аналогии с эквайрингом `services/acquiring/`: `base.py` + `registry.py` + конкретные `atol_online_adapter`/`platforma_ofd_adapter`/`perv_ofd_adapter`/`takskom_adapter`) и роутерах `fiscal_receipts.py`/`clinic_payments.py`. Подключение нового ОФД — тот же принцип «адаптер + реестр»; креды через env (`PLATFORMA_OFD_LOGIN/PASSWORD`, `COMPANY_INN`, `COMPANY_TAX_SYSTEM`).

### Телефония
Телефонные провайдеры/DID настраиваются через кабинет (`ManagerTelephony.jsx` → `manager/telephony`) и модели телефонии (миграция `tel01_telephony_models`). Интеграция звонков на фронте — `lib/phoneActions.js` (Electron deep-link `clinikset://call` или `tel:`).

### Чек-лист провайдера
- [ ] Адаптер реализует все 4 метода контракта; `verify_webhook` возвращает `None` на плохой подписи.
- [ ] `name` уникален; адаптер зарегистрирован в `acquiring/__init__.py`.
- [ ] Суммы в `Decimal`; конвертация в копейки/центы где требует провайдер.
- [ ] `NotImplementedError`/`LookupError` корректно транслируются роутером в 501/404.
- [ ] Креды не хардкодятся — `PaymentGatewayConfig` или env.
- [ ] Идемпотентность платежа (idempotency_key) — иначе двойные списания.

---

## 6. Локальный запуск, сборка фронта, линт/тесты, деплой

> Отдельного `deploy.sh` в репозитории **нет** — деплой через `docker compose` (см. README).

### Запуск (рекомендуемый — Docker, как в проде)
```bash
docker compose up -d                                              # db, redis, backend, frontend, bot
docker exec clinika-backend alembic -c /app/alembic.ini upgrade head   # миграции
# backend: 127.0.0.1:8900  frontend: 127.0.0.1:8901
```
Super-admin создаётся одноразово из ENV при первом старте (`SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD`).

### Запуск бэкенда без Docker (быстрый dev)
- Зависимости ставятся в **системный Python 3.11** (`pip install -r backend/requirements.txt`); `weasyprint` импортируется лениво, его системные libs не обязательны для старта.
- `uvicorn app.main:app --reload` из `backend/` (нужны доступные PostgreSQL и Redis; на старте `lifespan` проверяет секреты — в dev задай `ENVIRONMENT=development`, иначе fail-fast на дефолтных секретах).

### Сборка фронта
```bash
cd frontend
npm install
npm run build        # Vite-сборка; порог предупреждения о размере chunk — 1500 KB (chunkSizeWarningLimit; большие страницы lazy)
npm run dev          # dev-сервер с HMR
```
Sentry DSN запекается build-arg'ом (`VITE_SENTRY_DSN`).

### Тесты / линт
```bash
docker exec clinika-backend pytest /app/tests/ -v                 # все тесты
docker exec clinika-backend pytest /app/tests/test_rbac_isolation.py -v   # критический путь
docker exec clinika-backend pytest --cov=app --cov-report=term-missing    # coverage (~35%)
```
- **Перед коммитом прогоняй pytest** — критические пути (бонусы, гонки направлений, approve_cancel, RBAC-изоляция) ловят реальные баги.
- Помни про **PostgreSQL-специфику в raw-SQL** (`date_trunc`, `FILTER`, `inet`) — такие места могут падать на SQLite-тестах; либо пиши на ORM, либо помечай тест как pg-only.

### Деплой (прод)
```bash
cd /opt/clinika
git pull
docker compose up -d --build                                      # пересборка изменённых сервисов
docker exec clinika-backend alembic -c /app/alembic.ini upgrade head
docker compose logs -f clinika-backend                            # проверить старт
```
Health: `GET /health` и `GET /health/full` (watchdog шлёт Telegram-алерт при 5 фейлах подряд).

### Чек-лист перед деплоем
- [ ] Миграции написаны и применяются (`upgrade head` без ошибок).
- [ ] `pytest` зелёный локально (хотя бы critical-path).
- [ ] `npm run build` проходит, бандл не раздулся.
- [ ] Новые ENV-переменные добавлены в `.env` на сервере.
- [ ] Секреты НЕ дефолтные (`lifespan` откажется стартовать в prod на `change-in-production`/`clinika-super-secret`).
- [ ] `.env` отслеживается git (техдолг проекта) — не закоммить новые секреты в открытом виде.

---

## 7. Конвенции кода и подводные камни

### 7.1 Tenant-изоляция (САМОЕ ВАЖНОЕ)
- **На уровне модели изоляции НЕТ** — фильтрация по `tenant_id` целиком на роутере/сервисе. Каждый `select(...)` по тенантным данным **обязан** иметь `.where(Model.tenant_id == user.tenant_id)`.
- **RLS включается только через `get_tenant_db`** (ставит `SET LOCAL app.tenant_id`). Обычный `get_db` RLS не ставит — ручная фильтрация обязательна.
- **IDOR:** доступ к объекту по `id` → проверь владение: `if obj.tenant_id != user.tenant_id: raise HTTPException(403)` или `assert_tenant_owns(obj.tenant_id, current_user.tenant_id)`.
- **Особые случаи изоляции:**
  - `super_admin` и юзер **без `tenant_id`** проходят почти все гейты (by design — admin-роутеры агрегируют по всем тенантам).
  - Записи с `tenant_id IS NULL` = «платформенные» (FAQ, шаблоны) — в выборке тенанта включай через `or_(Model.tenant_id == tid, Model.tenant_id.is_(None))` (см. `ai_knowledge_service`).
  - Лиды агрегатора и чаты изолируются **через `partnership_id`/`clinic_id`** (у самой записи `tenant_id` нет) — присоединяйся к тенанту JOIN'ом.
- **Два разных `get_current_tenant`:** в `deps.py` бросает 403 без тенанта, в `tenant.py` возвращает `None`. Импортируй осознанно.

### 7.2 Деньги — только Decimal
- Модели: `Numeric(12,2)`. Сервисы: считай в `Decimal`. Вход с фронта: `Decimal(str(body.amount))` (НЕ `Decimal(float)` — даёт «грязное» значение).
- Выход в JSON: `float(...)` (только для отображения; для сверок бери из БД).
- Ловушки из аудита: `sum(..., Decimal("0"))` со стартовым значением (иначе падает на пустом генераторе); **Decimal-в-JSONB** сериализуй вручную; не допускай двойного учёта (расходы в `cash_out` уже включены — в `net` повторно не вычитай).
- `bonus.py` имеет легаси-аннотацию `amount: Mapped[float]` при колонке `Numeric` — работай как с Decimal.

### 7.3 Обработка ошибок на фронте
- Все запросы — через `../api` (axios): авто-Bearer, авто-refresh при 401, обработка region-lock 403. Голый `axios` — только для публичных страниц без auth (намеренно).
- **Region-lock** детектится по строковому префиксу русского `detail` — хрупко, не меняй текст на бэке без синхронизации `api/index.js`. Слушай событие `window.addEventListener('region-lock-blocked', ...)` для своей модалки.
- Многие легаси-страницы глотают ошибки (`.catch(() => {})`) — **пустой экран ≠ отсутствие бага**. В новых премиум-страницах используй `useToast()`/`useConfirm()` из `../design` вместо нативных `alert/confirm/prompt`.
- Деньги с бэка приходят строкой (Decimal сериализован как string) — `parseFloat`/`Number` только для отображения.

### 7.4 Дубль-роутеры и дубли-источники истины (следи за рассинхроном)
- `acts.py`: `router` + алиас `inter_clinic_router` — те же хендлеры.
- Цены планов: **два источника** — хардкод `PLAN_PRICES` (`models/billing.py`) и БД-каталог `TenantPlan` (`billing_plan.py`). Пойми, какой используется в твоём сервисе.
- Метрики MRR/churn/health дублированы в `admin.py` и `admin_analytics.py` — две реализации, легко разъезжаются.
- `PLAN_BULLETS` в `billing.py` продублирован в `list_plans` и `trial_status` — менять в **обоих**.
- `AdminLayout` хранит секции в 6 структурах (см. раздел 2в) — правь все.
- `useTheme.js` пишет тему в три ключа localStorage (`clinika-theme`/`theme`/`adminTheme`) — техдолг.

### 7.5 Гигантские файлы — читай частями, не целиком
- `AdminLayout.jsx` — **9004 строки**; `main.py` — ~1951; `DoctorLayout.jsx` — 1526; `CreateReferral.jsx` — 1032; `admin.py` — 2110; `PatientCabinet.jsx` — 3000+.
- Открывай через `Read offset/limit` или ищи `Grep`'ом нужную секцию — не грузи целиком.

### 7.6 Прочие острые углы
- **Фабрики зависимостей возвращают разное:** `require_permission` уже отдаёт `Depends(...)` (НЕ оборачивай); `require_role`/`require_feature`/`require_module` — голую функцию (оборачивай `Depends`).
- **Семантика кодов:** `require_feature` → 403 (нет в тарифе); `require_module` → 402 (нет оплаты); `require_active_subscription` → 402.
- **Fail-open везде:** rate-limit, region-lock, RBAC-кэш при недоступности Redis пропускают запрос. Не полагайся на гейт как на единственную защиту.
- **In-process кэши** (`block_ip_middleware`, `_QUOTA_CACHE`, `api_key_deps` rate-limit) не шарятся между воркерами — распределённость только через Redis.
- **Token blacklist существует, но не вызывается** в `get_current_user` — полноценный logout требует доработки `deps.py`.
- **Время:** часть таблиц `DateTime(timezone=True)` (aware), часть — naive `DateTime`. Осторожно при сравнении timestamp'ов.
- **APScheduler-джобы** регистрируются в `lifespan` (`main.py`); на нескольких воркерах с Memory-jobstore возможны дубли — следи, что джоба регистрируется в одном процессе / Redis-jobstore настроен.

---

## Быстрый справочник «куда смотреть»
- Аутентификация/JWT/refresh/lockout → `backend/app/routers/auth.py`, `backend/app/core/security.py`, `core/deps.py`.
- RBAC/права → `backend/app/core/permissions.py`.
- Tenant/фичи/модули → `backend/app/core/tenant.py`.
- Эквайринг (эталон адаптеров) → `backend/app/services/acquiring/`.
- API-клиент фронта → `frontend/src/api/index.js`.
- Дизайн-система (живой справочник) → страница `/design-system` (`pages/DesignSystem.jsx`).
- Образец миграции → `backend/alembic/versions/acct01_cashshift.py`.
