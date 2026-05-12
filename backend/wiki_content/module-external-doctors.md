# Модуль «Внешние врачи (External Doctors)»

Бесплатный встроенный модуль для работы с внешними врачами: партнёр-докторы (`partner_doctor`), приходящие врачи (`visiting_doctor`) и менеджеры по привлечению (`acquisition_manager`) с каскадным расчётом бонусов.

## Что это даёт клинике

- Расширение пула врачей без найма в штат.
- Партнёр-врач направляет своих пациентов в сеть → клиника получает приём, врач — бонус.
- Приходящий врач работает в нескольких клиниках сети по % split — direct billing в realtime.
- Acquisition-менеджер привлекает врачей в сеть → получает % с их направлений.
- Каскадные бонусы: автор приёма → платформа → рекрутер → менеджер по привлечению.

## Три типа внешних врачей

### Partner Doctor (врач-партнёр)
- Не работает в клинике, но направляет пациентов из своей частной практики.
- Получает % от выручки за направлённых.
- Не имеет доступа к ЭМК пациентов клиники.

### Visiting Doctor (приходящий врач)
- Ведёт приём в одной или нескольких клиниках сети по контракту.
- % split с клиникой (например 60/40).
- Direct billing: при оформлении приёма сразу создаётся `DirectBill` с расчётом доли врача.
- Доступ к ЭМК только своих пациентов.

### Acquisition Manager (менеджер по привлечению)
- Привлекает partner_doctor и visiting_doctor в сеть.
- % attribution от направлений подопечных врачей (срок attribution настраивается).

## Что входит технически

- **Direct Bill** (`DirectBill`): счёт за прямой приём приходящего врача. Поля: services, total, doctor_share, clinic_share, status.
- **Partner Referral**: расширение `Referral` с флагом `is_partner_doctor` + расчёт комиссии в `Bonus`.
- **Attribution**: при добавлении врача acquisition-менеджером — связь `User.attributed_to_manager_id`. При направлении этого врача — каскад в `Bonus`.
- **Кабинеты**: отдельные UI-роуты для каждой роли (`/partner-doctor/*`, `/visiting-doctor/*`, `/acquisition-manager/*`).
- **Telegram-нотификации**: при создании direct-bill и при начислении бонуса.

## Как настроить

### Partner Doctor

1. `/admin/users/new` — создать пользователя с ролью `partner_doctor`.
2. Указать специализацию, % комиссии.
3. Партнёр получает welcome-email с паролем, заходит в `/partner-doctor`.
4. Делает направления через свой кабинет — клиника принимает.

### Visiting Doctor

1. `/admin/visiting-doctors/settings` (POST `/visiting-doctor/admin/settings`) — настройка контракта: split %, клиники, специализации.
2. Создаётся пользователь с ролью `visiting_doctor`.
3. Менеджер клиники бронирует приёмы через `POST /visiting-doctor/admin/book-appointment`.
4. Врач видит расписание в `/visiting-doctor/my-queue`.
5. После приёма — `POST /visiting-doctor/admin/complete-visit` → создаётся DirectBill.

### Acquisition Manager

1. `/admin/users/new` — роль `acquisition_manager`.
2. При привлечении врача — `attributed_to_manager_id` ставится автоматически.
3. Bonus каскад при каждом приёме привлечённого врача.

## API endpoints

### External / Partner Doctor

- `POST /external-doctor/direct-bill` — создать DirectBill (visiting/partner doctor).
- `GET /external-doctor/direct-bills` — мои счета.
- `GET /external-doctor/direct-bills/{bill_id}` — детали.
- `PATCH /external-doctor/direct-bills/{bill_id}/status` — сменить статус.
- `GET /external-doctor/direct-bills/{bill_id}/print` — печатная форма (HTML).
- `GET /external-doctor/my-stats` — статистика по доходу.

### Visiting Doctor

- `POST /visiting-doctor/admin/settings` — настройки контракта (admin).
- `GET /visiting-doctor/admin/settings` — текущие настройки.
- `GET /visiting-doctor/my-queue` — мои предстоящие приёмы.
- `GET /visiting-doctor/my-visits` — история.
- `GET /visiting-doctor/my-income` — мои доходы.
- `POST /visiting-doctor/admin/book-appointment` — забронировать приём.
- `POST /visiting-doctor/admin/complete-visit` — завершить + создать DirectBill.
- `PATCH /visiting-doctor/admin/appointments/{apt_id}/edit` — редактировать.
- `DELETE /visiting-doctor/admin/appointments/{apt_id}` — отменить.
- `PATCH /visiting-doctor/admin/suspend-doctor/{doctor_user_id}` — приостановить.

## Известные ограничения

- Acquisition Manager не может видеть личные данные пациентов своих врачей — только агрегированные метрики.
- Каскад максимум 3 уровня: автор → клиника/платформа → рекрутер → acquisition-manager.
- DirectBill пока без интеграции с ЮKassa — оплата только наличными / переводом.
- Налогообложение партнёров (НПД vs ИП) — учитывается в `User.tax_type`, отчётность ручная.

## Смотрите также

- [Роль · Врач-партнёр](role-partner-doctor.md)
- [Роль · Приходящий врач](role-visiting-doctor.md)
- [Роль · Менеджер по привлечению](role-acquisition-manager.md)
- [Концепт · Бонусы и каскадный расчёт](concepts-bonuses.md)
