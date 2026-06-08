# components [01] — общие UI-компоненты кабинетов: оболочка, навигация, звонки, поддержка, impersonation

Это первый алфавитный срез каталога `frontend/src/components` (файлы `AdminSupportPanel` … `NotificationPreferencesModal`). Все 15 файлов — **презентационные / контейнерные React-компоненты**, которые шарятся между кабинетами (Layout сотрудника, AdminLayout платформы, ManagerShell, DoctorLayout, кабинет пациента). Это НЕ роутеры — здесь нет ни одного backend-эндпоинта; они только **потребляют** API через `../api` (axios instance) или прямой `axios` и через стор `../store/auth`.

Группа покрывает несколько сквозных подсистем:
- **Оболочка и навигация**: `Layout` (каркас кабинета сотрудника + push-подписка + темы) и `BottomNav` (мобильное нижнее меню).
- **Реалтайм-коммуникации**: `CallWidget` (WebRTC аудио/видео для персонала), `IncomingCallModal` (телемед-звонок пациенту), `AdminSupportPanel` (чат оператора поддержки).
- **Impersonation (вход под пользователем)**: `ImpersonateModal` (запуск) + `ImpersonationBanner` (плашка активной сессии).
- **Модалки франшизы/безопасности**: `ClinicEditModal`, `ForcePasswordChangeModal`, `ForgotPasswordDialog`, `CancelModal`, `NotificationPreferencesModal`.
- **Утилитарное/контентное**: `BrandLogo` (SVG-логотип), `CommandPalette` (Cmd+K поиск), `HelpModal` (встроенная справка, частично легаси).

Сквозная важная деталь: токены и определение тенанта вынесены в `../config` (`SLUG`, `BASE_PATH`, `API_BASE`) и `../api`; почти все модалки используют design-систему `../design` (`Modal`, `Button`, `useToast`, `useConfirm`, `Avatar`, `Tabs`, `Chip`).

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `AdminSupportPanel.jsx` | Панель оператора поддержки: список диалогов + чат | 339 |
| `BottomNav.jsx` | Нижнее мобильное меню по роли | 69 |
| `BrandLogo.jsx` | SVG-логотип КлиникСеть (два варианта) | 55 |
| `CallWidget.jsx` | WebRTC аудио/видео звонки между персоналом | 825 |
| `CancelModal.jsx` | Запрос на удаление направления с причиной | 73 |
| `ClinicEditModal.jsx` | Редактирование клиники сети + руководитель | 845 |
| `CommandPalette.jsx` | Глобальный поиск Cmd+K по сущностям | 366 |
| `ForcePasswordChangeModal.jsx` | Принудительная смена временного пароля | 185 |
| `ForgotPasswordDialog.jsx` | Запрос ссылки сброса пароля по email | 115 |
| `HelpModal.jsx` | Встроенная справка по ролям (частично легаси) | 573 |
| `ImpersonateModal.jsx` | Окно подтверждения входа под пользователем | 258 |
| `ImpersonationBanner.jsx` | Плашка активной impersonation-сессии | 276 |
| `IncomingCallModal.jsx` | Фуллскрин входящего телемед-звонка пациенту | 331 |
| `Layout.jsx` | Каркас кабинета сотрудника + push/тема | 245 |
| `NotificationPreferencesModal.jsx` | Управление категориями уведомлений | 212 |

---

## `frontend/src/components/AdminSupportPanel.jsx`
- **Назначение:** Рабочее место оператора поддержки: список входящих диалогов с сотрудниками и врачами-партнёрами + полноценный чат с одним пользователем (текст, картинки, документы), закрытие/переоткрытие диалога.
- **Ключевые элементы:** дефолтный экспорт `AdminSupportPanel({ tokenProp })`; вложенный компонент `ThreadView` (один диалог); хелпер `fmt(iso)` (формат времени ru-RU); словарь `ROLE_LABELS`; константа `PREFIX = '/support'`.
- **Эндпоинты:** не роутер. Потребляет support-API (полные пути = `API_BASE` + `/support/...`): `GET /support/admin/threads`, `GET /support/admin/thread/{userId}`, `POST /support/admin/reply/{userId}`, `POST /support/admin/close/{userId}`, `POST /support/admin/reopen/{userId}`, `POST /support/operator/heartbeat`, `POST /support/operator/offline`.
- **Зависимости:** `../api` (axios), `useAuthStore` (токен). Встраивается в AdminLayout (получает `tokenProp`) либо берёт токен из стора.
- **Где менять для типовых задач:** новый тип сообщения (видео/аудио-вложение) — блок рендера `m.file_type` в `ThreadView` (≈стр. 141-151); поведение онлайн-статуса оператора — heartbeat-эффект (стр. 44-53); фильтры диалогов (open/all/closed) — `filteredThreads` (стр. 238-242); интервалы опроса — `setInterval(load, 5000)` в `ThreadView` и `setInterval(loadThreads, 10000)`.
- **Подводные камни:** **поллинг, а не WebSocket** — диалог обновляется раз в 5с, список раз в 10с (нагрузка на API при многих открытых вкладках). При закрытии `ThreadView` принудительно шлёт `operator/offline` — если открыть два диалога подряд, размонтирование первого может пометить оператора офлайн. Все `catch {}` молча проглатывают ошибки (нет фидбэка при сбое отправки, только восстановление текста). `unread` агрегируется на фронте только по незакрытым тредам.
- **Строк:** 339

## `frontend/src/components/BottomNav.jsx`
- **Назначение:** Фиксированное нижнее меню навигации (мобильный таб-бар) для кабинетов сотрудника и врача-партнёра. Набор вкладок выбирается по роли.
- **Ключевые элементы:** дефолтный экспорт `BottomNav()`; три массива пунктов — `partnerItems`, `baseItems`, `managerItems` (последний фактически не используется, см. ниже).
- **Эндпоинты:** нет.
- **Зависимости:** `NavLink` (react-router-dom), `useAuthStore` (роль пользователя).
- **Где менять для типовых задач:** добавить/переименовать вкладку — соответствующий массив (`baseItems` для reg/nurse, `partnerItems` для partner_doctor); скрыть меню для роли — ранний `return null` (сейчас так сделано для `manager`).
- **Подводные камни:** **`managerItems` — мёртвый код**: при `role === 'manager'` компонент возвращает `null` (стр. 35), а навигация менеджера живёт в `_ManagerShell`. Массив `managerItems` объявлен, но никогда не рендерится — кандидат на удаление. `end={to === '/manager' || to === '/'}` критичен для корректной подсветки «Главной».
- **Строк:** 69

## `frontend/src/components/BrandLogo.jsx`
- **Назначение:** Единый inline-SVG логотип КлиникСеть (бирюзовый плюс), идентичный `favicon.svg`. Заменяет ранее использовавшиеся юникод-символы и текст по всему приложению.
- **Ключевые элементы:** два именованных экспорта — `BrandLogo({ size, color, white, style, className })` (квадрат с фоном) и `BrandMark({ size, color })` (только крест без фона для цветных поверхностей). Нет default-экспорта.
- **Эндпоинты:** нет.
- **Зависимости:** нет (чистый presentational, без импортов).
- **Где менять для типовых задач:** изменить геометрию/скругление — `viewBox`/`rect` и коэффициент `r = size * 0.18`; добавить вариант цвета — параметры `color`/`white`. Использование: Landing nav/footer/login, Franchise nav, PatientCabinet header, AdminLayout.
- **Подводные камни:** `white=true` делает фон прозрачным, а плюс остаётся белым — на светлом фоне станет невидимым (рассчитан на тёмного родителя). Импорт — **именованный** (`import { BrandLogo }`), легко ошибиться и написать default.
- **Строк:** 55

## `frontend/src/components/CallWidget.jsx`
- **Назначение:** Полноценный клиент WebRTC-звонков между сотрудниками сети (аудио и видео в одном попапе): presence-список контактов сгруппирован по тенанту → клинике, исходящие/входящие звонки, демонстрация экрана, ICE-restart переподключение. Самый крупный и сложный компонент группы.
- **Ключевые элементы:** дефолтный экспорт `CallWidget()`; константы `DEFAULT_RTC_CONFIG`, `STATUS_COLOR`, `STATUS_LABEL`, `ROLE_LABEL`. Внутренние функции: `createPC` (создание RTCPeerConnection + ICE-restart логика), `startCall`/`acceptCall`/`rejectCall`/`endCall`, `getMedia`, `cleanupMedia`, `attachRemoteStream`, `primeMediaSync` (Safari autoplay fix), `startScreenShare`/`stopScreenShare`/`toggleScreenShare`, `toggleMic`/`toggleCam`, `sendWs`. Множество `useRef` для медиа-потоков и PeerConnection.
- **Эндпоинты:** не роутер. Потребляет: `GET /presence/can-call` (capabilities тенанта), `GET /presence/ice-config` (TURN/STUN), `GET /presence/users` (контакты), `PUT /presence/status`. Сигналинг — **WebSocket** `API_BASE→ws + /presence/ws/{user.id}?token=...` с типами сообщений `presence_update`, `call_invite`, `call_ringing`, `call_accept`, `call_reject`, `call_failed`, `call_end`, `ice_candidate`.
- **Зависимости:** `../api`, `useAuthStore`, `API_BASE` (`../config`), `../lib/callTones` (звуки гудка/мелодии), `../lib/deviceStorage` (`buildMediaConstraints` — предпочитаемые mic/cam из localStorage), `useToast` (`../design`). Монтируется в `Layout.jsx` (но не для visiting_doctor/partner_doctor). Слушает window-event `clinika:start-call` (старт звонка из кросс-клиничного справочника).
- **Где менять для типовых задач:** добавить TURN-сервер — `DEFAULT_RTC_CONFIG.iceServers` или серверный `/presence/ice-config`; изменить логику переподключения (число попыток/задержки) — обработчик `iceconnectionstatechange` в `createPC` (стр. 241-285, лимит 3 попытки, задержки 1с/3с/6с); добавить новый тип WS-сообщения — `switch (msg.type)` в `ws.onmessage` (стр. 93); группировка контактов — IIFE внутри блока списка (стр. 695-795).
- **Подводные камни:** Завязан на **Safari autoplay-policy** — `primeMediaSync()` обязан вызываться синхронно из onClick, иначе видео/аудио не заиграет; медиа-теги `<audio>`/`<video>` смонтированы постоянно (один раз), не пересоздавать. `<audio>` держится muted (эхо-страховка) — звук играет через `<video>`. Старт звонка из CustomEvent использует `setTimeout(...,30)` как костыль для синхронизации `mode` со state. Множество `.catch(() => {})` глушат ошибки сети/медиа. WS-эффект зависит только от `user?.id` — смена токена без смены id канал не переподключит.
- **Строк:** 825

## `frontend/src/components/CancelModal.jsx`
- **Назначение:** Простая модалка для сотрудника: запросить удаление/отмену направления, указав обязательную текстовую причину. Запрос уходит руководителю на рассмотрение.
- **Ключевые элементы:** дефолтный экспорт `CancelModal({ referral, onClose, onDone })`; локальный state `reason/loading/error`; `handleSubmit`.
- **Эндпоинты:** нет (вызывает API-функцию). Использует `requestCancelReferral(referral.id, reason)` из `../api`.
- **Зависимости:** `requestCancelReferral` (именованный импорт из `../api`).
- **Где менять для типовых задач:** добавить выбор причины из списка вместо свободного текста — заменить `<textarea>` на select (стр. 43-49); изменить минимальную валидацию — проверка `reason.trim()` в `handleSubmit`.
- **Подводные камни:** Закрытие по клику на backdrop работает только при `e.target === e.currentTarget`. Ошибка показывается из `err.response?.data?.detail` — если бэкенд вернёт нестроковый detail, попадёт `[object Object]`. Это **запрос** на удаление (модерация менеджером), а не прямое удаление — не путать с реальным удалением.
- **Строк:** 73

## `frontend/src/components/ClinicEditModal.jsx`
- **Назначение:** Модалка редактирования одной клиники сети из кабинета `franchise_owner`. Две вкладки: «Реквизиты» (название/адрес/телефон + параметры контракта: royalty %, бонус за направление, тип контракта) и «Руководитель» (просмотр/редактирование manager-а, создание первого, генерация пароля, welcome-email).
- **Ключевые элементы:** дефолтный экспорт `ClinicEditModal({ open, onClose, tenantId, onSaved })`; вспомогательные `FormField`/`FormInput`/`FormSelect`/`Icon`/`PasswordRevealCard`; константа `CONTRACT_TYPES`; методы `saveDetails`, `saveManager` (PATCH — редактирование того же User), `submitCreateManager` (POST), `resetPassword`, `notifyEmailResult`.
- **Эндпоинты:** не роутер. Потребляет franchise-owner API: `GET /franchise-owner/clinics/{tenantId}`, `PATCH /franchise-owner/clinics/{tenantId}` (реквизиты+контракт), `PATCH /franchise-owner/clinics/{tenantId}/manager` (редактирование), `POST /franchise-owner/clinics/{tenantId}/manager` (создание), `POST /franchise-owner/clinics/{tenantId}/manager/reset-password`.
- **Зависимости:** `../api`; design-система `../design` (`Modal`, `Button`, `Tabs`, `Chip`, `useToast`, `useConfirm`). Внутренние формовые компоненты унифицированы с `TenantsSection`.
- **Где менять для типовых задач:** новый параметр контракта — `CONTRACT_TYPES` + поля в `details` и payload `saveDetails`; новое поле руководителя — `mgrForm`/`createMgr` + соответствующие payload; логика welcome-email — `notifyEmailResult` + чекбокс `send_welcome_email`.
- **Подводные камни:** **КРИТИЧНО**: смена руководителя — это РЕДАКТИРОВАНИЕ User (PATCH), а не удаление-создание; `user_id` сохраняется, все связи (записи/направления/бонусы/аудит) остаются целыми (см. backend `franchise_owner_clinics.py`). `royalty_percent`/`bonus_per_referral` отправляются как `Number(...)` — на бэке это деньги/проценты (риск float vs Decimal, серверная сторона должна квантовать). Plaintext-пароль из `PasswordRevealCard` показывается **один раз** — после закрытия не восстановить. `tenantId` здесь = идентификатор клиники-тенанта; вся выборка идёт строго по нему (мультитенантность).
- **Строк:** 845

## `frontend/src/components/CommandPalette.jsx`
- **Назначение:** Глобальный поиск по Cmd+K / Ctrl+K (пациенты, врачи, направления, услуги) для staff-кабинетов. Дебаунс-запрос к `/search`, навигация стрелками, Enter — переход на нужный URL с учётом slug.
- **Ключевые элементы:** дефолтный экспорт `CommandPalette()` — выбирает один из двух inner-компонентов: `CommandPaletteWithRouter` (внутри BrowserRouter, `useNavigate`) и `CommandPaletteNoRouter` (для AdminLayout, навигация через `window.location.assign`). Тело — `CommandPaletteImpl({ navigate })`. Хелперы `iconFor`, `labelFor`, `urlFor`.
- **Эндпоинты:** не роутер. Потребляет `GET /search?q=...` (доступ manager+), ответ `{ patients, doctors, referrals, services }` (каждый ≤5).
- **Зависимости:** `../api`, `BASE_PATH`/`SLUG` (`../config`), react-router (`useNavigate`, `useInRouterContext`).
- **Где менять для типовых задач:** новый тип сущности в поиске — добавить в `iconFor`/`labelFor`/`urlFor`, в `flat` (стр. 180) и в `renderGroup`-вызовы (стр. 344-347); изменить горячую клавишу — handler в эффекте (стр. 116); порог символов/дебаунс — стр. 153 (`length < 2`) и `setTimeout(..., 250)`.
- **Подводные камни:** **Дуализм Router/NoRouter** — необходим, потому что AdminLayout рендерится ВНЕ `<BrowserRouter>` (см. `App.jsx`), и прямой `useNavigate()` уронил бы /admin белым экраном. Inner-компонент выбирается один раз при mount (Rules of Hooks). `EMPTY` мемоизирован специально, чтобы не зациклить эффекты. `urlFor` зашивает маршруты под кабинет менеджера (`/manager/history`, `/manager/recruit-doctors`) — при добавлении ролей URL может быть неверным. Поиск отключён, если `SLUG` пуст (`enabled = !!SLUG`).
- **Строк:** 366

## `frontend/src/components/ForcePasswordChangeModal.jsx`
- **Назначение:** Блокирующая (неотменяемая) модалка смены временного пароля. Появляется при каждом входе, пока у сотрудника стоит флаг `user.password_must_change` (миграция pwdmust01).
- **Ключевые элементы:** дефолтный экспорт `ForcePasswordChangeModal({ open, onSuccess })`; локальная валидация в `submit` (длина ≥6, совпадение, отличие от текущего); inline `inputStyle`/`labelStyle`.
- **Эндпоинты:** не роутер. Потребляет `PATCH /profile/me { current_password, new_password }` — этот же эндпоинт на бэке сбрасывает `password_must_change=False` (см. `routers/profile.py`).
- **Зависимости:** `../design` (`Modal`, `Button`, `useToast`), `../api`.
- **Где менять для типовых задач:** ужесточить правила пароля — блок валидации `submit` (стр. 65-80); изменить триггер показа — родитель управляет через prop `open` на основе `user.password_must_change`.
- **Подводные камни:** **Неотменяемость достигается тем, что в `<Modal>` НЕ передаётся `onClose`** — нет X, ESC и клика по backdrop. Если случайно добавить `onClose`, модалку можно будет обойти (дыра в безопасности). `toast?.success?.(...)` вызывается опционально-цепочечно — несоответствие сигнатуры toast не уронит сабмит. Минимальная длина (6) — только клиентская, бэк может требовать строже.
- **Строк:** 185

## `frontend/src/components/ForgotPasswordDialog.jsx`
- **Назначение:** Мини-диалог «Забыли пароль?»: ввод email → отправка запроса на сброс. Используется на обоих экранах входа (`Login.jsx`, `AdminLogin.jsx`).
- **Ключевые элементы:** дефолтный экспорт `ForgotPasswordDialog({ open, onClose })`; state `email/loading/done/error`; `handleSubmit`, `handleClose`.
- **Эндпоинты:** не роутер. Потребляет `POST /auth/forgot-password { email, tenant_slug }` напрямую через `axios` (не через `../api`).
- **Зависимости:** прямой `axios`, `API_BASE`/`SLUG` (`../config`). **Не** использует общий `../api` instance (т.к. на экране логина токена ещё нет).
- **Где менять для типовых задач:** текст экрана успеха — блок `done` (стр. 73-85); добавить капчу/rate-limit фидбэк — `handleSubmit`.
- **Подводные камни:** **Защита от user-enumeration**: при ЛЮБОМ исходе (даже ошибка 422/429) показывается универсальное «если email есть — письмо отправлено» (`setDone(true)` в catch). Это намеренно — не «чинить» как баг. Жёстко зашиты HEX-цвета (`#1565c0` и т.п.), без dark-режима — отличается от модалок на CSS-переменных.
- **Строк:** 115

## `frontend/src/components/HelpModal.jsx`
- **Назначение:** Встроенная справка-аккордеон с контентом, зависящим от роли (manager/admin/partner). Поиск по разделам, контакты поддержки.
- **Ключевые элементы:** дефолтный экспорт `HelpModal({ onClose, role })`; вложенный `HelpSection`; три больших массива контента — `HELP_MANAGER`, `HELP_ADMIN`, `HELP_PARTNER` (статичные тексты разделов).
- **Эндпоинты:** нет (весь контент статичный, хардкод в файле).
- **Зависимости:** `useAuthStore` (роль). Импортов API нет.
- **Где менять для типовых задач:** обновить текст справки — соответствующий массив `HELP_*`; добавить роль — расширить выбор `sections`/`roleLabel` (стр. 493-499).
- **Подводные камни:** **Частично легаси**: в `Layout.jsx` импорт `HelpModal` закомментирован, кнопка «Справка» ведёт на внешний `/wiki` (`window.open("/wiki")`), а не открывает эту модалку. Файл, вероятно, ещё используется где-то локально, но в основном кабинете сотрудника он отключён — проверять реальных потребителей перед правкой контента. Тексты дублируют материал вики (риск рассинхрона). Упоминается «интеграция с МИС Renovatio» — справочный контент может устареть относительно реального функционала.
- **Строк:** 573

## `frontend/src/components/ImpersonateModal.jsx`
- **Назначение:** Окно подтверждения входа под пользователем (impersonation) для super_admin. Требует причину (≥3 симв., ≤500), чекбокс осознания аудита, а для пациента — дополнительный чекбокс 152-ФЗ/GDPR.
- **Ключевые элементы:** дефолтный экспорт `ImpersonateModal({ user, onClose })`; `ROLE_LABELS`; `handleConfirm` (логика выдачи токена и редиректа); `canSubmit`.
- **Эндпоинты:** не роутер. Потребляет `POST /admin/impersonate { target_user_id, reason, confirm_sensitive }` → возвращает `{ access_token, tenant_slug, redirect_url }`.
- **Зависимости:** `../api`, `SLUG` (`../config`), `localStorage`.
- **Где менять для типовых задач:** изменить минимальную длину причины/требования — `canSubmit` (стр. 44); добавить новую «чувствительную» роль с доп. подтверждением — `isPatient`-ветка (сейчас завязана только на `patient`).
- **Подводные камни:** **Тонкая работа с localStorage-токенами по слагам** (ключ `clinika_admin_token_<slug>`): сохраняет текущий super_admin-токен в `clinika_impersonation_origin`, кладёт impersonation-токен под `clinika_admin_token_<tenantSlug>` и делает **hard redirect** (`window.location.href`). Любая ошибка в этой раскладке ключей сломает либо вход, либо откат. RFC 8693 token exchange (claim `act`) — каждое действие в сессии логируется под ID super_admin. Парная компонента — `ImpersonationBanner` (отвечает за откат).
- **Строк:** 258

## `frontend/src/components/ImpersonationBanner.jsx`
- **Назначение:** Глобальная красная плашка сверху, видимая только во время активной impersonation-сессии (claim `imp=true` в admin-JWT). Показывает кого имперсонируем, причину, обратный таймер до истечения JWT и кнопку выхода.
- **Ключевые элементы:** дефолтный экспорт `ImpersonationBanner()`; хелперы `decodeJwt` (base64-decode payload без верификации), `readAdminToken`, `fmtTimeLeft`; `handleStop` (выход + восстановление токена + redirect).
- **Эндпоинты:** не роутер. Потребляет `GET /admin/impersonate/active` (валидация + имена actor/target) и `POST /admin/impersonate/stop` → `{ access_token, redirect_url }`.
- **Зависимости:** `../api`, `SLUG` (`../config`), `localStorage`. Парная к `ImpersonateModal`.
- **Где менять для типовых задач:** содержимое/стиль плашки — JSX блока `role="alert"` (стр. 190+); логика авто-выхода по таймеру — эффект `secondsLeft === 0` (стр. 130-135); восстановление токена — `handleStop` (стр. 138-181).
- **Зависимости/подводные камни:** **JWT декодируется руками** (`atob` payload), без проверки подписи — это намеренно (клиенту подпись не нужна), но при смене структуры claim (`imp`, `act`, `act_name`, `imp_reason`, `exp`) плашка сломается. `handleStop` имеет **тройной фолбэк** восстановления токена (ответ сервера → origin-копия → ручной откат при ошибке) — высокий риск рассинхрона ключей localStorage с `ImpersonateModal`. `z-index: 9999`, `exp` в секундах умножается на 1000. Слушает событие `storage` для реакции на смену токена в другой вкладке.
- **Строк:** 276

## `frontend/src/components/IncomingCallModal.jsx`
- **Назначение:** Фуллскрин входящего ВИДЕОприёма в кабинете пациента (стиль iOS-звонка): тёмный радиальный фон, пульсирующий аватар врача, ringtone через WebAudio, вибрация, кнопки «Принять»/«Отклонить» + проверка устройств перед приёмом.
- **Ключевые элементы:** дефолтный экспорт `IncomingCallModal({ call, onDismiss, apiBase, token })`; ringtone-генератор на WebAudio (`playTone`/`ringOnce`); `armed` (защита 1с от случайного клика); `performAccept`/`handleAccept`/`handleDecline`/`handleOpenDeviceTest`; `stopRingingResources`.
- **Эндпоинты:** не роутер. В props описан `POST /telemed/sessions/{id}/cancel-incoming`, но **фактически не вызывается** (см. ниже).
- **Зависимости:** `axios` (прямой, не `../api`), `Avatar` (`../design`), `./calls/DeviceTestModal` (модал проверки микрофона/камеры). Используется в кабинете пациента (токен пациента приходит через prop).
- **Где менять для типовых задач:** паттерн вибрации/звук — эффект ringtone (стр. 36-93); «Принять» ведёт на `call.join_url` — менять там; добавить реальное серверное отклонение — `handleDecline` (сейчас заглушка).
- **Подводные камни:** **`handleDecline` — заглушка**: комментарий (стр. 121-128) поясняет, что cancel-incoming — эндпоинт врача, поэтому пациент дропает только локально (`onDismiss`), без серверного уведомления; на стороне врача рассчитывают на автотаймаут. `apiBase`/`token` в props фактически не используются для отклонения. WebAudio ringtone может быть **заблокирован браузером без user-gesture** — это нормально (обёрнуто в try/catch). Кнопки disabled первые 1000мс (`armed`). `Avatar` импортируется из design-системы.
- **Строк:** 331

## `frontend/src/components/Layout.jsx`
- **Назначение:** Корневой каркас кабинета сотрудника (reg/nurse и т.п.): sticky-шапка с аватаром/ролью, колокольчик уведомлений, кнопки push/тема/справка/выход, `<Outlet/>` для дочерних страниц, нижнее меню, виджеты звонков и поддержки. Также регистрирует service worker и подписывает устройство на VAPID push.
- **Ключевые элементы:** дефолтный экспорт `Layout()`; контексты `ThemeContext` и `HelpContext` + хуки `useTheme`/`useHelp`; async-функции `registerStaffSW`/`subscribeStaffPush` (push-подписка); `handleEnablePush`, `handleLogout`; `ROLE_LABELS`.
- **Эндпоинты:** не роутер. Потребляет `GET /push/vapid-key` и `POST /push/subscribe-user` (через `fetch`, токен `clinika_token_<slug>` из localStorage).
- **Зависимости:** `BottomNav`, `SupportChat`, `CallWidget`, `CommandPalette`, `NotificationsBell` (соседние компоненты); `useAuthStore`; `API_BASE`/`BASE_PATH`/`SLUG` (`../config`); `useConfirm`/`useToast` (`../design`); `useThemeHook` (`../lib/useTheme`, общий с AdminLayout/DoctorLayout). `react-router-dom` `Outlet`.
- **Где менять для типовых задач:** кнопки в шапке кабинета — блок «Правая часть» (стр. 188-226); логика push-подписки сотрудника — `subscribeStaffPush` (стр. 30-81); какие роли НЕ видят звонки/поддержку — условия рендера `<CallWidget/>`/`<SupportChat/>` (стр. 236-237, исключены visiting_doctor и partner_doctor); справка — `window.open("/wiki")`.
- **Подводные камни:** **Токен в push-подписке берётся напрямую из localStorage по ключу `clinika_token_<SLUG>`** (см. `store/auth.js`) — при смене схемы ключей push сломается молча. Service worker регистрируется по `/<SLUG>/sw.js` со scope `/<SLUG>/` — мультитенантный путь. `HelpModal` отключён (импорт закомментирован), справка ведёт на `/wiki`. `useTheme`/`useHelp` экспортируются отсюда — другие компоненты могут импортировать их именно из `Layout.jsx`.
- **Строк:** 245

## `frontend/src/components/NotificationPreferencesModal.jsx`
- **Назначение:** Модалка управления категориями уведомлений: пользователь отмечает категории, которые хочет ОТКЛЮЧИТЬ (они исчезнут из колокольчика). Открывается из `NotificationsBell`.
- **Ключевые элементы:** дефолтный экспорт `NotificationPreferencesModal({ onClose, onSaved })`; state `categories`/`disabled` (Set); `toggle`, `save`. Рендерится через `createPortal` в `document.body`.
- **Эндпоинты:** не роутер. Потребляет `GET /notifications/preferences` → `{ categories, disabled }` и `PUT /notifications/preferences { disabled: [...] }`.
- **Зависимости:** `../api`, `createPortal` (react-dom).
- **Где менять для типовых задач:** поведение списка категорий — блок `categories.map` (стр. 126-162); кнопка «Включить всё» — сбрасывает `disabled` в пустой Set (стр. 175); семантика хранения «disabled» (а не «enabled») — `save`/`toggle`.
- **Подводные камни:** **Семантика инвертирована** — хранится список ОТКЛЮЧЁННЫХ категорий (`disabled`), checkbox=true означает «выключено». Легко перепутать при добавлении новой категории на бэке. Рендерится через портал в `body` с `z-index 9999` — поверх dropdown колокольчика. `categories` приходят с сервера (`cat.id/title/description`) — добавление категории делается на бэке, не здесь. Guard `typeof document === 'undefined'` — защита от SSR.
- **Строк:** 212
