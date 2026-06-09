# pages [07] — кабинеты сотрудников/пациентов, публичная запись и юр-страницы

Этот срез (`frontend/src/pages/`, файлы 73–84 алфавитного списка) — это **страницы-роуты верхнего уровня** фронта МИС «КлиникСеть». Это не роутеры в backend-смысле: каждый файл — самостоятельная React-страница, которую `App.jsx` монтирует по URL (по `SLUG` и пути). Группа смешанная по природе:

- **Публичные страницы без авторизации:** `OnlineBooking` (онлайн-запись по slug), `PatientTelemedRoom` (WebRTC-комната по одноразовому токену), `QRScreen` (карточка направления по id), `ResetPassword` (сброс пароля по токену из email), `PrivacyPolicy` (юр-документ).
- **Кабинеты сотрудников (рендерятся внутри `AdminLayout`, получают `adminToken/user/onLogout` пропсами):** `OperationalCabinet` (регистратор+медсестра — самый используемый), `PartnerDoctorCabinet` (врач-партнёр), `RecruiterCabinet` (рекрутёр).
- **Кабинеты/онбординг пациента:** `PatientCabinet` (основной, авторизация по session/token), `PatientCabinetPreview` (ПАРАЛЛЕЛЬНЫЙ ДУБЛЬ на `/p-new`, тёмная тема, синхронизировать руками), `ProfileSetup` (первичное заполнение профиля сотрудника).
- **Платформенная страница super_admin:** `PlatformAnnouncements` (рассылка объявлений).

Общие технические черты: REST-вызовы через `axios` напрямую (публичные страницы) или общий `apiClient`/`api` (кабинеты сотрудников с auto-Bearer и auto-refresh); SLUG/API_BASE/BASE_PATH из `../config`; стили — смесь Tailwind-классов, inline-`style` и design-system (`../design`). Mobile-first, Material Symbols иконки, premium-градиенты.

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `OnlineBooking.jsx` | Публичная онлайн-запись пациента, 4 шага | 796 |
| `OperationalCabinet.jsx` | Кабинет регистратора и медсестры | 2643 |
| `PartnerDoctorCabinet.jsx` | Кабинет врача-партнёра, направления+бонусы | 290 |
| `PatientCabinet.jsx` | Основной кабинет пациента, 5 секций | 3863 |
| `PatientCabinetPreview.jsx` | Дубль кабинета пациента, тёмная тема | 2373 |
| `PatientTelemedRoom.jsx` | WebRTC видео-приём пациента | 709 |
| `PlatformAnnouncements.jsx` | Рассылка объявлений всем (super_admin) | 236 |
| `PrivacyPolicy.jsx` | Политика конфиденциальности (152-ФЗ) | 97 |
| `ProfileSetup.jsx` | Первичная настройка профиля сотрудника | 147 |
| `QRScreen.jsx` | Карточка направления + QR + заметки | 267 |
| `RecruiterCabinet.jsx` | Кабинет рекрутёра, регистрация врачей | 588 |
| `ResetPassword.jsx` | Сброс пароля по токену из email | 180 |

---

## `frontend/src/pages/OnlineBooking.jsx`
- **Назначение:** Публичная (без авторизации) мастер-форма онлайн-записи пациента к врачу клиники по её `SLUG`. 4 шага: выбор врача → дата/время → контакты → успех.
- **Ключевые элементы:** `export default OnlineBooking()` (контролирует `step` 1–4, прогресс-бар). Внутренние компоненты: `StepDoctor`, `StepDateTime`, `StepContacts`, `StepSuccess`, `DoctorCard`, `SpecChip`, `Spinner`. Утилиты `formatDate`, `isoDate`, `getInitials`. Палитра бренда `C`.
- **Эндпоинты (вызывает напрямую через axios, без авторизации):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/public/{SLUG}/doctors` | публичный | — | список врачей `{id, full_name, specialty, clinic_name, photo_url}` | Шаг 1: список врачей с расписанием |
| GET | `/public/{SLUG}/doctors/{id}/slots?date=YYYY-MM-DD` | публичный | query `date` | `[{start_time, end_time, available}]` | Шаг 2: слоты на дату |
| POST | `/public/{SLUG}/book` | публичный | `{doctor_id, appointment_date, start_time, patient_name, patient_phone, website_url}` | `{short_code, qr_code, doctor_name, clinic_name, appointment_date, start_time, end_time, cabinet_url}` | Шаг 3: создать запись |
- **Зависимости:** `axios`, `API_BASE`, `SLUG` из `../config`. Полностью самодостаточен — design-system НЕ использует (своя палитра `C` и свои inline-стили).
- **Где менять для типовых задач:** изменить число дней выбора даты — `StepDateTime`, массив `dates` (сейчас 14). Поменять валидацию телефона/имени — `StepContacts`, `canSubmit`. Добавить поле в форму записи — `StepContacts` (форма + payload в `handleBook`). Изменить экран успеха/QR — `StepSuccess`.
- **Подводные камни:** **Honeypot-антибот** — скрытое поле `website_url` (line 487), заполняется только ботами → бэк должен отдать 403; не удаляйте. Слоты кешируются по дате в `slotCache`; `hasAvailable` возвращает `true` для незагруженных дат (серый кружок не показывается, пока дата не открыта). Обработка 409 «слот занят» — по `status===409` ИЛИ тексту detail с «занят».
- **Строк:** 796

---

## `frontend/src/pages/OperationalCabinet.jsx`
- **Назначение:** Самый используемый кабинет в системе — общий для ролей `reg` (регистратор) и `nurse` (медсестра). Создание направлений (услуга/врач/анализы), приём пациента по 5-значному коду, бонусы, запись к приезжим врачам, общий журнал записей, чат с пациентами/клиникой. Premium cyan/teal редизайн.
- **Ключевые элементы:** `export default OperationalCabinet({ adminToken, user, onLogout })`. Хелперы: `api(_token)` (обёртка над `apiClient`, токен-аргумент legacy/игнорируется), `Icon`, `fmtDate`, `fmtMoney`. Стили в `<style>{TEAL_ACCENT}</style>` (override OKLCH-токенов accent) + большой блок `.ks-*` классов. Вкладки (`tab`): `dashboard / create / referrals / appointments / visiting / bonuses / doctors / regulations / chat`. Загрузчики: `loadStats`, `loadReferrals`, `loadBonuses`, `loadClinics`, `loadServices`, `loadDoctors`, `loadVisiting`, `loadAppointments`, `loadDoctorsForClinic`, `loadLabCatalog`. Действия: `createReferral`, `submitAccept`, `saveBookVisit`, `openPrintForReferral`, `handleQuickAction`.
- **Эндпоинты (через `apiClient`, с авторизацией сотрудника):**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/profile/me` | reg/nurse | — | профиль (`avatar_url`) | Аватар в шапке |
| GET | `/referrals/?status=all&limit=200` | reg/nurse | query | список направлений | KPI + sparkline за 7 дней |
| GET | `/bonuses/summary` | reg/nurse | — | `{total_pending,total_paid,total_referrals,confirmed_referrals}` | Баланс бонусов |
| GET | `/referrals/?limit=100` | reg/nurse | query | список | Вкладка «Направления» |
| GET | `/bonuses/` | reg/nurse | — | список | Вкладка «Бонусы» |
| GET | `/clinics/` | reg/nurse | — | клиники | Селекты |
| GET | `/services/` | reg/nurse | — | услуги | Селект услуги |
| GET | `/doctors?clinic_id=` | reg/nurse | query | врачи клиники | Тип «к врачу» |
| GET | `/clinics/{id}/services?lab_only=true` | reg/nurse | query | услуги/анализы | Каталог анализов (фильтр по категории клиентский) |
| POST | `/referrals/` | reg/nurse | `{referral_type, to_clinic_id, patient_phone, patient_name?, notes?, appointment_at?, service_id|target_doctor_id|lab_tests}` | созданное направление (`short_code, qr_code, patient_qr_code, patient_url`) | Создать направление |
| GET | `/referrals/verify-patient?phone=&full_name=` | reg/nurse | query | `{matches:[...], error?}` | Поиск пациента в МИС Renovatio |
| POST | `/referrals/mis-add-patient` | reg/nurse | `{phone, full_name}` | `{mis_patient_id}` | Создать пациента в МИС |
| POST | `/referrals/confirm-by-code` | reg/nurse | `{short_code:int}` | подтверждённое направление | «Принять пациента» по коду |
| GET | `/referrals/{id}/print` (responseType blob) | reg/nurse | — | PDF | Печать направления (iframe→print) |
| GET | `/admins/external-doctors`, `/admins/doctor-requests` | reg/nurse | — | списки | Вкладка «Врачи» |
| GET | `/visiting/admin/settings`, `/visiting/admin/all-appointments` | reg/nurse | — | расписание/записи | Приезжие врачи |
| POST | `/visiting/admin/book-appointment` | reg | `{doctor_user_id, patient_name, patient_phone, appointment_date, start_time, end_time, price}` | `{short_code, patient_qr, patient_url}` | Запись к приезжему врачу |
| GET | `/appointments` (+`/doctors`) | reg/nurse | query фильтры | записи + справочник | Вкладка «Все записи» |
- **Зависимости:** `apiClient` (`../api`), `API_BASE/SLUG` (`../config`). Из `../design`: `Page, Card, KpiCard, KpiRow, Chip, Button, Tabs, Modal, Avatar, EmptyState, Sparkline, QuickActions, buildPatientCardActions, useToast`. Компоненты: `RegQuickBar`, `RegCommandPalette`, `RegMobilePatientForm`, `ProfileModal`. Хук `useRegHotkeys`. Lazy-секции: `RegulationsReaderSection`, `ClinicChatSection`. Внутренний чат сотрудников встраивается через `<iframe src="/staff-chat#access_token=...">`.
- **Где менять для типовых задач:** добавить тип направления — переключатель в `tab==='create'` (массив с `service/doctor/lab`) + ветка в `createReferral`. Поменять фильтры «Все записи» — `loadAppointments` (params) + select-ы в `tab==='appointments'`. Изменить горячие клавиши — `useRegHotkeys` (Alt+N/R/S/P/W, Ctrl+K) + `handleQuickAction`. Сменить цвет акцента — `TEAL_ACCENT`. Bottom-nav пунктов — массив `navItems` (различается для reg/nurse), доп-пункты — `moreItems`.
- **Подводные камни:** **`api(adminToken)` — legacy-сигнатура, токен игнорируется** (реально работает `apiClient` с auto-Bearer). При печати PDF iframe идёт без Authorization → грузим PDF через `apiClient` blob, иначе fallback в новую вкладку. **В резюме созданного направления нужно показывать `patient_qr_code`, а НЕ `qr_code`** (line 1018): `qr_code` — admin-QR с UUID для скана сотрудником, пациент по нему ЛК не откроет. Каталог анализов фильтруется на клиенте по ключевым словам (line 349) — хрупко. `chatMode==='staff'` явно прокидывает токен в hash iframe, иначе показывает чужие чаты от stale-сессии. Файл огромный (2643 строки) — все вкладки в одном компоненте.
- **Строк:** 2643

---

## `frontend/src/pages/PartnerDoctorCabinet.jsx`
- **Назначение:** Кабинет врача-партнёра (роль `PARTNER_DOCTOR`): просмотр своих направлений, расписания (read-only), бонусов/дохода и выставление счетов пациентам (Direct billing). Кабинет 6/9 из ROADMAP-миграции на design-system.
- **Ключевые элементы:** `export default PartnerDoctorCabinet({ adminToken, user, onLogout })`. Хелперы `fmt`, `StatusChip` (маппинг `STATUS_LABEL`/`STATUS_VARIANT`). Вкладки `NAV`: `dashboard / referrals / schedule / bonuses / billing / regulations`. Расчёты `totalIncome`, `totalBonuses`, `confirmed` — на клиенте через `reduce`.
- **Эндпоинты (через общий `api` из `../api`):**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/profile/me` | partner_doctor | — | профиль | Аватар |
| GET | `/referrals` | partner_doctor | — | список (или `{items}`) | Direct + dashboard |
| GET | `/bonuses` | partner_doctor | — | список | Вкладка «Бонусы» |
| GET | `/visiting/my-income` | partner_doctor | — | начисления дохода | Вкладка «Бонусы» (доход приезжего врача) |
- **Зависимости:** `api` (`../api`), `API_BASE/SLUG`. Из `../design`: `Card, KpiCard, KpiRow, Chip, EmptyState`. Компоненты `ProfileModal`, `ExternalDoctorBillingSection` (`../components/doctor/...` — вся логика счетов вкладки «Счета»). Lazy: `RegulationsReaderSection`.
- **Где менять для типовых задач:** добавить вкладку — массив `NAV` + блок `{tab === '...'}`. Логика счетов/PDF — НЕ здесь, а в `ExternalDoctorBillingSection`. Маппинг статусов направления — `STATUS_LABEL`/`STATUS_VARIANT`.
- **Подводные камни:** градиентный header и bottom-nav намеренно оставлены кастомными (TODO-комментарии: перенос на `<PageHeader>`/`<BottomNav>` сломает брендирование). `/referrals` может вернуть массив ИЛИ `{items}` — обработано через `r.data?.items`. Суммы через `parseFloat(... || 0)` (float, не Decimal) — для отображения нормально, но не для расчётов на запись.
- **Строк:** 290

---

## `frontend/src/pages/PatientCabinet.jsx`
- **Назначение:** ОСНОВНОЙ личный кабинет пациента (`/{slug}/p`). Авторизация без логина/пароля — по session-токену (cookie + localStorage) или по `?t=`/`?s=` из URL/QR. UX-редизайн Apple HIG: 5 верхнеуровневых секций (`home / health / chats / rewards / profile`) с под-страницами. Записи, медкарта, рецепты, витальные, лаборатория, бонусы/лояльность, подписка, документы, чат, семья, телемед-входящие звонки, PWA-установка, push.
- **Ключевые элементы:** `export default PatientCabinet()`. Состояние: `section` (5 табов) + `tab` (14 legacy sub-page значений), маппинг `TAB_TO_SECTION` и `SECTION_ROOTS`, навигация `goTo`/`switchSection`. Тема секций — `SECTION_THEMES`. Множество внутренних компонентов: `LoginScreen`, `AdBanner`, `QrFullscreen`, `ReferralCard`, `VisitCard`, `AppointmentCard`+`AptControls`, `ChatTab`, `DoctorsTab`/`DoctorCard`/`DoctorProfileModal`, `QuickBook`, `RescheduleModal`, `ReviewForm`/`Stars`/`StarSelect`, `HealthHub`, `PrivacyTab`, `FamilyModal`/`MisFamilySuggestions`. Cookie-хелперы `setSessionCookie/getSessionCookie/clearSessionCookie`, динамический PWA-манифест (`updateManifestStartUrl`), ICS/Google-календарь (`downloadIcs`, `googleCalendarUrl`). LS-ключи: `clinika_patient_token/ref/session/slug` + cookie `clinika_session`.
- **Эндпоинты (через axios, авторизация по `?t=`/session-токену):**

| Метод | Путь | Принимает | Назначение |
|-------|------|-----------|------------|
| POST | `/patient/by-code` | `{code, phone}` | Логин по 5-значному коду + телефону |
| POST | `/patient/session/from-token` | `{patient_token}` | Создать session по QR-токену |
| GET | `/patient/{refId}?t={token}` | — | Загрузка данных пациента/направления |
| POST | `/patient/session/restore` | `{session_token}` | Восстановление сессии |
| POST | `/patient/session/switch` | `{phone, short_code}` `?t=` | Переключение на профиль члена семьи |
| POST | `/patient/session/logout` | `{session_token}` | Выход |
| GET/POST | `/patient/family`, `/patient/family/add`, DELETE `/patient/family/{id}`, `/patient/family/mis-suggestions` | — / `{phone,name,relation}` | Семейные профили |
| POST | `/patient/appointment/{id}/cancel` `?t=` | `{reason}` | Отмена записи |
| POST | `/patient/appointment/{id}/reschedule` | слот | Перенос записи |
| GET/POST | `/patient/chat`, `/patient/chat/{id}/messages`, `/patient/chat/send`, `/patient/chat/{id}/manual` | — | Чат с клиникой |
| GET | `/patient/export-personal-data?t=`, DELETE `/patient/forget-personal-data?t=` | — | 152-ФЗ: экспорт/забвение |
| GET | `/push/vapid-key`, POST `/push/subscribe` | подписка | Web-push |
| GET | `/public/{SLUG}/clinic`, `/public/{SLUG}/doctors/{id}/profile`, `/public/{SLUG}/doctors/{id}/availability`, `.../slots`, POST `/public/{SLUG}/book` | — | Запись к врачу (общий с OnlineBooking) |
| POST | `/reviews` | отзыв | Оценка врача |
| GET/POST | `/ads/active`, `/ads/{id}/event` | — | Рекламные баннеры + аналитика показов |
- **Зависимости:** `axios`, `API_BASE/BASE_PATH/SLUG`. Хук `usePatientCallListener` + `IncomingCallModal` (входящий телемед-звонок). Из `../design`: `Card, Button, Chip, Tabs, EmptyState, Modal, useToast, useConfirm`. `useTheme` (`../lib/useTheme`), `loadTelegramSDK` (`../lib/tg`). Lazy-секции из `../sections/patient/*` (AppointmentsTab, MedCardTab, DocumentsTab, PrescriptionsTab, VitalsTab, PatientLabDynamics, PatientMedicalRecord, PatientAiWidget) и `../sections/Patient*Section` (Loyalty, Spending, Subscription, Documents, Chat, Calendar, Family, Wellness). Компоненты `PatientBottomNav`, `SubPageNav`, lazy `PatientChatHub`.
- **Где менять для типовых задач:** добавить под-страницу — добавить значение `tab`, прописать его в `TAB_TO_SECTION`, отрендерить в нужной секции. Изменить нижнюю навигацию — `PatientBottomNav` + `switchSection`/`SECTION_ROOTS`. Тема/градиент секции — `SECTION_THEMES`. Логика автологина — функции `from-token`/`restore` (~2461–2495). PWA-манифест/iOS — блоки `updateManifestStartUrl` и инициализация `<link rel="manifest">`. Контент конкретной вкладки чаще всего живёт в lazy-секции `../sections/...`, а не здесь.
- **Подводные камни:** **При любом изменении авторизации/сессии/манифеста нужно вручную повторить в `PatientCabinetPreview.jsx`** (дубль). Двойное хранение сессии (cookie + LS) — из-за iOS Safari ITP, очищающего LS PWA через 7 дней; не упрощайте до одного. `urlS==='present'` — маркер, реальный токен в LS (не из URL). Telegram SDK грузится ТОЛЬКО в `/p/` (см. `loadTelegramSDK`). 14 значений `tab` сохранены как legacy, чтобы не переписывать существующие условные рендеры. Хук `usePatientCallListener` вынесен ВВЕРХ до early-return (правила хуков), `phone` берётся из `data` и может быть `undefined` до загрузки.
- **Строк:** 3863

---

## `frontend/src/pages/PatientCabinetPreview.jsx`
- **Назначение:** ПАРАЛЛЕЛЬНЫЙ preview-кабинет пациента на `/{slug}/p-new` (тёмная тема, OKLCH-палитра, шрифты Golos Text + Inter). Развивается отдельно от `PatientCabinet.jsx`; полностью реализованы Home и Booking, остальные экраны (Appointments/History/Chat/Profile) — упрощённый layout. **Явный дубль** (в шапке файла: `WARNING: dublicate, sync changes from PatientCabinet manually`).
- **Ключевые элементы:** `export default PatientCabinetPreview()`. Feature-flags `FEATURE_*` (большинство `false` — фичи-заглушки до готовности backend; включены `ANALYSES`, `NOTIFY_RAIL`). Внутренние компоненты: `LoginScreen`, `QrFullscreen`, `Sparkline`, `RescheduleModal`, `FamilyModal`, `ChatTab`, `Sidebar`, `HomePage`/`NextApptCard`, `DoctorsPage`/`DoctorProfileModal`, `BookingPage`, `AppointmentsPage`/`VisitTlItem`, `HistoryPage`, `ProfilePage`, `ReviewFormModal`, `StarsRating`/`StarSelect`. Те же LS-ключи и логика манифеста/автологина, что в основном кабинете.
- **Эндпоинты:** подмножество `PatientCabinet` — `/patient/by-code`, `/patient/session/{from-token,restore,switch,logout}`, `/patient/{refId}?t=`, `/patient/family*`, `/patient/appointment/{id}/cancel`, `/patient/chat*`, `/public/{SLUG}/clinic|doctors/...|book`, `/reviews`, `/push/*`. Семантика совпадает с основным кабинетом (см. таблицу выше).
- **Зависимости:** `axios`, `API_BASE/SLUG`, `BrandLogo`/`BrandMark` (`../components/BrandLogo`), `useToast`/`useConfirm` (`../design`), все стили из `../styles/cabinet-dark.css` (изолированы под `.cabinet-preview`). Lazy-секции НЕ использует (всё инлайн).
- **Где менять для типовых задач:** включить фичу — соответствующий `FEATURE_*` флаг (но фича должна быть реализована и на backend). Стили — только `cabinet-dark.css` под `.cabinet-preview`. Любое изменение логики авторизации/сессии — синхронизировать с `PatientCabinet.jsx`.
- **Подводные камни:** **ЭТО ДУБЛЬ** — расхождение с основным кабинетом неизбежно копится; правки авторизации/манифеста дублировать руками. Большинство `FEATURE_*` выключены — UI рисует заглушки «скоро». Кандидат на удаление после миграции preview в основной кабинет. Логика манифеста немного отличается от основного (здесь `if (urlS)` без проверки `!== 'present'`).
- **Строк:** 2373

---

## `frontend/src/pages/PatientTelemedRoom.jsx`
- **Назначение:** Публичная (без логина) страница пациента для телемед-приёма по одноразовому JWT-токену сессии. Маршрут `/p/telemed/:token`. WebRTC видеозвонок врач↔пациент: info → согласие на ПД → проверка устройств → WebRTC-соединение → видео-комната с чатом.
- **Ключевые элементы:** `export default PatientTelemedRoom()` со стейт-машиной `stage` (`loading|info|consent|precheck|connecting|inroom|ended|error`). Refs: `wsRef, pcRef, localStreamRef, localVideoRef, remoteVideoRef, previewVideoRef, pendingIceRef, iceConfigRef`. Функции: `extractToken`, `submitConsent`, `startCall` (ICE→media→RTCPeerConnection→WebSocket→offer), `sendWs`, `toggleMic`, `toggleCam`, `fallbackAudioOnly`, `sendChatText`, `handleEnd`, `cleanup`, `fmtDur`. Вспом-компоненты `Centered`, `Spinner`, `CtrlBtn`. `DEFAULT_RTC_CONFIG` (Google STUN).
- **Эндпоинты (fetch, авторизация по токену в пути):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/patient-portal/telemed/{token}/info` | — | `{doctor_name, doctor_specialty, scheduled_at, recording_enabled}` | Инфо о приёме |
| POST | `/patient-portal/telemed/{token}/consent` | `{personal_data, recording}` | ok | Согласие на ПД/запись |
| GET | `/patient-portal/telemed/{token}/ice-config` | — | `{iceServers}` | TURN/STUN-конфиг |
| WS | `/telemed/ws/{token}` (ws/wss) | сигналинг `offer/answer/ice_candidate/chat_message/session_ended/leave` | — | WebRTC-сигналинг + чат |
- **Зависимости:** `API_BASE`, `BASE_PATH` (`../config`). Браузерные API: `navigator.mediaDevices`, `RTCPeerConnection`, `WebSocket`. Никаких внешних компонентов/design-system — полностью автономна, тёмный UI inline-стилями.
- **Где менять для типовых задач:** добавить контрол в комнате — блок `stage==='inroom'` + `CtrlBtn`. Изменить STUN/fallback — `DEFAULT_RTC_CONFIG` / `ice-config`. Поменять текст согласия — `stage==='consent'`. Логика качества связи — useEffect c `getStats()` (порог потерь 15% → `poor`).
- **Подводные камни:** WS-URL строится из `API_BASE.replace(/^http/,'ws')` — при HTTPS станет `wss`. ICE-кандидаты до установки remoteDescription буферизуются в `pendingIceRef`. `cleanupRef` защищает от ложного перехода в `ended` при ручном завершении. Все эффекты с `getUserMedia` корректно останавливают треки в cleanup (важно — иначе камера «горит»). Permission на устройства запрашивается в `precheck` (без него `deviceId` не виден).
- **Строк:** 709

---

## `frontend/src/pages/PlatformAnnouncements.jsx`
- **Назначение:** Страница super_admin для рассылки объявлений всем активным сотрудникам всех тенантов. Объявление попадает в колокольчик уведомлений (категория «announcements» в `/notifications/recent`). Создание / просмотр истории / отзыв.
- **Ключевые элементы:** `export default PlatformAnnouncements()`. `SEVERITY_META` (info/warning/critical — иконка, цвет, фон). Функции `load`, `send`, `revoke`. Состояние формы `{message, severity, expires_at}`, флаг `showRevoked`.
- **Эндпоинты (через общий `api`, super_admin):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/admin/announcements?include_revoked=` | super_admin | query | список объявлений | История |
| POST | `/admin/announcements` | super_admin | `{message, severity, expires_at?}` | созданное | Отправить всем |
| DELETE | `/admin/announcements/{id}` | super_admin | — | — | Отозвать |
- **Зависимости:** `api` (`../api`). UI — inline-стили на CSS-переменных (`--surface/--border/--fg*`), design-system НЕ использует.
- **Где менять для типовых задач:** добавить уровень важности — `SEVERITY_META`. Изменить формат `expires_at` — `send` (сейчас `new Date(...).toISOString()`). Поведение «показать отозванные» — флаг `showRevoked` + query.
- **Подводные камни:** `revoke` использует нативный `window.confirm`/`alert` (не design-system `useConfirm`). `expires_at` пустое → `null`. Просрочка вычисляется на клиенте (`expired`). Доступ к странице ограничивается роутером/бэком — сам компонент роль не проверяет.
- **Строк:** 236

---

## `frontend/src/pages/PrivacyPolicy.jsx`
- **Назначение:** Статическая публичная страница «Политика конфиденциальности» (152-ФЗ) на `/privacy`. Контент-страница без логики и API.
- **Ключевые элементы:** `export default PrivacyPolicy()` — оборачивает текст в `<LegalPage>`. Константа `updated = '08 мая 2026'`. 10 разделов (оператор, состав данных, цели, основания, хранение, сроки, передача, права субъекта, cookie, изменения).
- **Эндпоинты:** нет (не роутер).
- **Зависимости:** только `LegalPage` (`../components/legal/LegalPage`) — задаёт layout/типографику юр-страниц.
- **Где менять для типовых задач:** реквизиты оператора — заменить плейсхолдеры `[ОПЕРАТОР]/[ИНН]/[АДРЕС]/[EMAIL]/[ТЕЛ]/[ПРОВАЙДЕР SMS]/[ШЛЮЗ]` в тексте. Дата обновления — `updated`. Общий layout — в `LegalPage`.
- **Подводные камни:** **В тексте остались незаполненные плейсхолдеры** `[ОПЕРАТОР]`, `[ИНН]` и т.д. (комментарий в шапке: заменить перед запуском на реальные реквизиты юрлица). Срок хранения медкарты — 25 лет (Приказ Минздрава № 530н), не менять без юр-основания.
- **Строк:** 97

---

## `frontend/src/pages/ProfileSetup.jsx`
- **Назначение:** Экран первичного заполнения профиля СОТРУДНИКА после первого входа: ФИО, телефон, дата рождения, выбор клиники. После сохранения обновляет пользователя в auth-store.
- **Ключевые элементы:** `export default ProfileSetup()`. Стейт `form` (full_name, phone_number, date_of_birth, clinic_id), `handleChange`, `handleSubmit`. Tailwind-вёрстка карточки.
- **Эндпоинты (через именованные функции `../api`):**

| Метод (функция) | Назначение | Принимает | Возвращает |
|-----------------|-----------|-----------|------------|
| `getClinics()` | список клиник для селекта | — | клиники |
| `updateMe(payload)` | сохранить профиль | `{full_name, phone_number, date_of_birth?, clinic_id}` | — |
| `getMe()` | перечитать профиль | — | актуальный user |
- **Зависимости:** `getClinics, updateMe, getMe` из `../api`; `useAuthStore` (`../store/auth`) — `user`/`setUser`. Tailwind с `dark:`-вариантами и классом `bg-primary`.
- **Где менять для типовых задач:** добавить поле профиля — `form` + input + payload в `updateMe`. Сделать клинику опциональной — убрать валидацию `if (!form.clinic_id)`. После сохранения — `setUser(meRes.data)` (триггерит редирект в роутере).
- **Подводные камни:** `clinic_id` приводится через `Number(form.clinic_id)`; пустая дата → `undefined` (не отправляется). Это профиль СОТРУДНИКА, не пациента (не путать с `PatientCabinet`).
- **Строк:** 147

---

## `frontend/src/pages/QRScreen.jsx`
- **Назначение:** Карточка одного направления по `:id` (для сотрудника, создавшего направление): инфо, два QR (admin-QR для подтверждения визита + patient-QR на ЛК пациента), 5-значный код, заметки/комментарии. Поделиться/печать/скачать QR.
- **Ключевые элементы:** `export default QRScreen()`. `STATUS_STYLE`/`STATUS_LABELS`. Функции `handleSendComment`, `handlePrint` (печать через `window.open`), `handleDownload`, `handleShare` (Web Share API → fallback download). `daysLeft` — клиентский расчёт срока.
- **Эндпоинты:**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| `getReferral(id)` (`../api`) | `/referrals/{id}` | — | направление (`qr_code, patient_qr_code, short_code, status, expires_at, bonus_amount, ...`) | Загрузка карточки |
| GET | `/referrals/{id}/comments` | — | список заметок | Комментарии |
| POST | `/referrals/{id}/comments` | `{text}` | заметка | Добавить заметку |
- **Зависимости:** `getReferral` + `api` (`../api`), `useParams`/`useNavigate` (react-router), `API_BASE/BASE_PATH/SLUG`. Tailwind + Material Symbols.
- **Где менять для типовых задач:** изменить шаблон печати QR — `handlePrint` (HTML-строка). Поведение «поделиться» — `handleShare`. Отображение статусов — `STATUS_STYLE`/`STATUS_LABELS`. Блок кода без QR / ссылка для ввода — секция «Кабинет пациента».
- **Подводные камни:** два разных QR с разным назначением — `qr_code` (admin, подтверждение визита сотрудником) и `patient_qr_code` (ссылка на ЛК пациента) — не перепутать. QR показываются только при `status==='created'`. `handleShare` использует `navigator.canShare({files})` с graceful fallback на скачивание.
- **Строк:** 267

---

## `frontend/src/pages/RecruiterCabinet.jsx`
- **Назначение:** Кабинет рекрутёра (роль `RECRUITER`): регистрация новых врачей-партнёров (с выдачей QR + логин/пароль), список своих врачей, бонусы, процент вознаграждения. Кабинет 5/9 ROADMAP-миграции.
- **Ключевые элементы:** `export default RecruiterCabinet({ adminToken, user, onLogout })`. Хелпер `apiFetch(token, path, opts)` — **ручной `fetch` с Bearer-заголовком** (а не общий `api`). Вкладки `TABS`: `dashboard / register / doctors / bonuses / percent / regulations`. Внутренние компоненты: `QRPopup` (bottom-sheet с QR + копирование/печать логина-пароля), `RegisterTab`, `DoctorsTab`, `BonusesTab`, `PercentTab` (donut-индикатор %), `DashboardTab`, `Spinner`.
- **Эндпоинты (через `apiFetch` — fetch + Bearer):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/profile/me` (через `api`) | recruiter | — | профиль | Аватар |
| GET | `/recruiter/stats` | recruiter | — | `{doctors_count, total_bonuses, pending_bonuses, paid_bonuses, my_percent}` | KPI |
| GET | `/recruiter/clinics` | recruiter | — | клиники | Чекбоксы доступа в регистрации |
| POST | `/recruiter/register-doctor` | recruiter | `{full_name, email, phone_number, address, specialization, username, password, clinic_ids[]}` | `{full_name, username, temp_password?, qr_code, specialization}` | Регистрация врача → QRPopup |
| GET | `/recruiter/doctors` | recruiter | — | список врачей | Вкладка «Врачи» |
| GET | `/recruiter/bonuses` | recruiter | — | список | Вкладка «Бонусы» |
- **Зависимости:** `api` (только `/profile/me`), `API_BASE`. Из `../design`: `Card, Button, Chip, KpiCard, KpiRow, EmptyState`. `ProfileModal`. Lazy: `RegulationsReaderSection`. QR-печать через `window.open`.
- **Где менять для типовых задач:** поля формы регистрации врача — `RegisterTab` `form` + payload в `submit`. Шаблон печати QR — `QRPopup.printQR`. KPI — `DashboardTab` + поля `stats`. Объяснение схемы процентов — `PercentTab` (шаги 1–4).
- **Подводные камни:** **использует ручной `apiFetch` (raw fetch + Bearer), а не общий `api` с auto-refresh** — при протухшем токене не будет авто-обновления (в отличие от других кабинетов). Поэтому ответы ошибок обрабатываются вручную (`r.ok`/`r.json()`). QRPopup и bottom-nav оставлены кастомными (TODO: design-system `<Modal>` центрированный, нужен sheet с safe-area). Пароль показывается в открытом виде (`temp_password`) — передаётся врачу лично.
- **Строк:** 588

---

## `frontend/src/pages/ResetPassword.jsx`
- **Назначение:** Публичная страница сброса пароля по одноразовому токену из email. URL `/reset-password?token=XXX` (или `/{slug}/reset-password?token=XXX`). Без авторизации.
- **Ключевые элементы:** `export default ResetPassword()`. Токен из `?token=` через `useMemo`. Состояние `password/confirm/showPass/loading/error/done`. `validate()` (≥8 символов, минимум 1 буква + 1 цифра, совпадение), `handleSubmit`, `goLogin` (редирект на `/{slug}/admin`).
- **Эндпоинты:**

| Метод | Путь | Принимает | Назначение |
|-------|------|-----------|------------|
| POST | `/auth/reset-password` | `{token, new_password}` | Установить новый пароль |
- **Зависимости:** `axios` напрямую, `API_BASE/SLUG` (`../config`). Tailwind + Material Symbols. Design-system НЕ использует.
- **Где менять для типовых задач:** правила пароля — функция `validate` (дублирует backend-валидацию; синхронизировать). Куда редиректить после успеха — `goLogin`. Текст/брендинг — JSX напрямую.
- **Подводные камни:** клиентская валидация должна совпадать с серверной (иначе сообщения разойдутся). Ошибки FastAPI-валидации (массив с `[0].msg`) разбираются отдельно, срезается префикс `Value error,`. Кнопка submit заблокирована при отсутствии `token`. В футере захардкожен «© КлиникСеть 2025».
- **Строк:** 180
