# Mobile App Development Prompt — КлиникСеть

**Версия:** 1.0  
**Дата:** 2026-05-11  
**Аудитория:** mobile architect / senior native developer / AI-агент-разработчик  
**Целевой результат:** native Android (Kotlin + Jetpack Compose) + iOS (Swift + SwiftUI) приложения для платформы КлиникСеть

---

## 0. TL;DR (для быстрого онбординга)

Ты разрабатываешь два native мобильных приложения для multi-tenant SaaS медицинской платформы «КлиникСеть» (https://клиниксеть.рф):

1. **КлиникСеть — Пациент** (P0, MVP за 2 месяца) — для пациентов
2. **КлиникСеть Pro — Сотрудник** (P1, MVP за 2 месяца после Patient) — единое приложение для doctor / manager / reg / franchise_owner с role-based навигацией
3. **КлиникСеть Admin** (P2, можно отложить) — super_admin tooling

Backend готов: FastAPI на `https://клиниксеть.рф/api/`, ~100+ роутеров, JWT-аутентификация для персонала, session token для пациентов, WebSocket для чатов и WebRTC signaling (coturn TURN уже настроен).

**Стек:** Kotlin + Jetpack Compose (Android, minSdk 24) / Swift + SwiftUI (iOS 14+). Без React Native / Flutter — обоснование в §1.4.

---

## 1. Overview

### 1.1 Продукт
«КлиникСеть» — мультитенантная SaaS-платформа для сетей частных медицинских клиник (франшизная модель). Платформа покрывает 11 ролей пользователей и 10 функциональных глав: расписание, медкарта (EMR), лаборатория, телемедицина, документооборот, лояльность и подписки, AI-ассистент, региональная аналитика, биллинг франшиз, white-label CMS. Дополнительно есть модуль «Здоровье+» — wellness-сервис для пациентов с интеграцией vitals (давление, ЧСС, сон, шаги).

Мобильные приложения — это **второй основной канал доступа** к платформе (наряду с web), нацеленный на:
- **Пациентов** — ежедневное использование (запись, чаты, медкарта, vitals).
- **Врачей** — работа во время приёма (быстрый доступ к карте, голосовой ввод диагноза, AI-briefing).
- **Менеджеров/регистраторов** — мобильность по клинике (Kanban расписания на планшете, быстрые операции).

### 1.2 Целевая аудитория
| Сегмент | Возраст | Устройства | Юзкейсы |
|---------|---------|------------|---------|
| Пациент-семьянин | 28–55 | iPhone 11+ / Android mid-range | Запись, медкарта семьи, чаты, подписка |
| Пациент-пожилой | 55–75 | iPhone SE / Samsung A-серия | Запись по телефону клиники, просмотр анализов |
| Пациент-Чечня/Ингушетия | 18–50 | Android low/mid (Xiaomi, Tecno) | Запись, чаты, обход блокировок не нужен (домен резолвится) |
| Врач | 28–60 | iPad/Android-планшет на приёме + личный iPhone/Android | Карта пациента, AI-briefing, запись приёма |
| Менеджер/Reg | 22–40 | iPhone / Android-планшет на ресепшене | Kanban, быстрые операции, чат |
| Franchise owner | 30–55 | iPhone Pro / iPad Pro | KPI dashboard, тарифы, регламенты |

### 1.3 Платформы
- **Android:** API 24+ (Android 7.0 Nougat), target API 34, поддержка планшетов (sw600dp+).
- **iOS:** iOS 14+, iPadOS 14+, поддержка iPhone SE 2-го поколения и выше.
- **Дистрибуция:**
  - App Store (основной канал для iOS).
  - Google Play (основной для Android).
  - **Direct APK** для регионов с ограниченным доступом к Google Play (Чечня, Ингушетия) — хостинг APK на `https://клиниксеть.рф/download/android/`, с in-app self-update channel.
  - **TestFlight** для бета-тестов (50 internal + 1000 external).
  - **Internal Testing track** Google Play для бета-тестов Android.

### 1.4 Стек и обоснование выбора native vs cross-platform

**Решение: Native Kotlin + Swift. Не React Native, не Flutter.**

Обоснование:
1. **WebRTC + телемедицина:** для качественного 1:1 audio/video звонка нужны нативные WebRTC-фреймворки от Google (`libwebrtc`). React Native обвязки (`react-native-webrtc`) отстают на 1–2 версии и регулярно ломаются на новых iOS/Android.
2. **HealthKit / Google Fit:** глубокая интеграция с биометрией пациента — native API меняются часто, RN-мосты отстают.
3. **Push (FCM + APNs):** silent push с background sync для уведомлений о новых результатах анализов и сообщениях в чате. Нативная реализация надёжнее.
4. **Биометрия (FaceID / Fingerprint) + Keychain / Keystore:** работа с защищённым хранилищем токенов — native надёжнее, без зависимостей.
5. **Команда:** разделение труда (1 Android + 1 iOS + 1 designer) позволяет идти параллельно и не требует full-stack RN-инженера, которого сложно найти в РФ.
6. **Производительность:** Kanban с drag-and-drop, большие списки приёмов с offline-cache, графики vitals — native даёт стабильные 60 fps без оптимизаций.
7. **Размер приложения:** RN/Flutter добавляют 10–25 MB баз; для пациентов из регионов с медленным интернетом это критично.

**Когда оправдан Flutter (как backup-вариант):** если бюджет ограничен одним разработчиком и можно жертвовать качеством телемед-звонков и HealthKit-интеграцией. Тогда — Flutter (не RN), потому что Flutter даёт более предсказуемый UI на обеих платформах.

**Когда оправдан KMP (Kotlin Multiplatform):** для middle-ground — общий бизнес-логический слой (Repository, Network, Models) + native UI (Compose + SwiftUI). Это рекомендуемый компромисс при наличии Kotlin-разработчиков, но не обязательный для MVP.

---

## 2. Архитектура

### 2.1 Архитектурный паттерн
**MVVM + Repository + UseCase (Clean Architecture lite).**

```
┌────────────────────────────────────────────────┐
│                   UI Layer                     │
│  Jetpack Compose / SwiftUI                     │
│  Screen Composable → ViewModel (observed)      │
└────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────┐
│              ViewModel Layer                   │
│  StateFlow<UiState> / @Published UiState       │
│  + один-в-один Intents/Events                  │
└────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────┐
│               UseCase Layer                    │
│  Только бизнес-операции (не CRUD)              │
│  Например: BookAppointmentUseCase              │
│            SyncVitalsFromHealthKitUseCase      │
└────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────┐
│              Repository Layer                  │
│  Источник истины: API + Local DB + Cache       │
│  Strategy: offline-first / online-only / SoT-DB│
└────────────────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
   ┌───────────────┐         ┌──────────────────┐
   │  Remote DS    │         │   Local DS       │
   │  Retrofit /   │         │   Room / Core    │
   │  URLSession   │         │   Data / Swift   │
   │  + WebSocket  │         │   Data           │
   └───────────────┘         └──────────────────┘
```

### 2.2 Android: ключевые библиотеки

```kotlin
// Network
implementation("com.squareup.retrofit2:retrofit:2.11.0")
implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
implementation("io.ktor:ktor-client-okhttp:2.3.12") // for WebSocket

// DI
implementation("com.google.dagger:hilt-android:2.51")

// DB
implementation("androidx.room:room-runtime:2.6.1")
implementation("androidx.room:room-ktx:2.6.1")

// Async
implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")

// Compose
implementation(platform("androidx.compose:compose-bom:2024.06.00"))
implementation("androidx.compose.material3:material3")
implementation("androidx.navigation:navigation-compose:2.7.7")

// Security
implementation("androidx.security:security-crypto:1.1.0-alpha06")
implementation("androidx.biometric:biometric:1.2.0-alpha05")

// Push
implementation(platform("com.google.firebase:firebase-bom:33.1.0"))
implementation("com.google.firebase:firebase-messaging-ktx")

// WebRTC
implementation("io.getstream:stream-webrtc-android:1.1.3")

// Sentry
implementation("io.sentry:sentry-android:7.10.0")

// Image
implementation("io.coil-kt:coil-compose:2.6.0")

// HealthConnect
implementation("androidx.health.connect:connect-client:1.1.0-alpha07")
```

### 2.3 iOS: ключевые зависимости (SPM)

```swift
// Network
.package(url: "https://github.com/Alamofire/Alamofire.git", from: "5.9.0")

// JSON / Codable (нативно в Swift)

// DB: SwiftData (iOS 17+) или CoreData (iOS 14+)
// Используем CoreData для покрытия iOS 14+ или дуальную стратегию

// DI: либо Factory, либо самописное
.package(url: "https://github.com/hmlongco/Factory.git", from: "2.4.0")

// WebRTC
.package(url: "https://github.com/stasel/WebRTC.git", from: "120.0.0")

// Sentry
.package(url: "https://github.com/getsentry/sentry-cocoa.git", from: "8.30.0")

// Push (нативный UserNotifications)
// Firebase iOS SDK (для FCM как унифицированной отправки, не для APNs напрямую)
.package(url: "https://github.com/firebase/firebase-ios-sdk.git", from: "11.0.0")

// Image
.package(url: "https://github.com/onevcat/Kingfisher.git", from: "7.12.0")

// HealthKit — нативный фреймворк
```

### 2.4 Offline-first стратегия

**Принцип:** Source of Truth — локальная БД. UI читает из БД, БД синхронизируется с API.

**Кешируется (offline доступно):**
- Профиль пользователя (Patient/Staff).
- Список приёмов на ближайшие 7 дней + история за 90 дней.
- Медкарта (последние записи).
- Документы пациента (метаданные + локальные копии PDF).
- Лабораторные результаты (метаданные).
- Vitals последние 30 дней.
- Регламенты (для franchise_owner / staff) — только что прочитанные.
- Список клиник + врачей.
- Сообщения чата за последние 30 дней.

**Online-only:**
- Запись на приём (booking).
- Отправка сообщения в чат (но draft сохраняется локально и помещается в sync queue).
- Активация подписки (cash flow).
- Telemedicine call.
- AI-briefing (генерация).

**Sync queue (Android: WorkManager, iOS: BGTaskScheduler + URLSession background):**
- Очередь pending-операций в Room/CoreData.
- Retry с экспоненциальным backoff (1s → 2s → 4s → 16s → 1min → 5min → drop & notify).
- При успехе — confirmation в UI (toast/banner).

### 2.5 API client
- **Base URL:** `https://клиниксеть.рф/api/` (можно переопределить в dev-build на `http://localhost:8000/api/`).
- **Interceptors:**
  1. `AuthInterceptor` — добавляет `Authorization: Bearer <token>` или `X-Patient-Session: <token>`.
  2. `RefreshInterceptor` — на 401 пытается рефреш refresh-токена, повтор запроса (single-flight, чтобы не дублировать рефреши).
  3. `LoggingInterceptor` — только в debug-сборке.
  4. `SentryInterceptor` — присылает breadcrumb на не-2xx.
  5. `TenantHeaderInterceptor` — добавляет `X-Tenant-Slug` если приложение в режиме одной франшизы (white-label).
- **Timeout:** connect 15s / read 30s / write 30s.
- **Retry:** на 5xx + network errors — до 3 попыток с jitter.

### 2.6 WebSocket
- Endpoint: `wss://клиниксеть.рф/api/ws/chat/`, `wss://клиниксеть.рф/api/ws/presence/`, `wss://клиниксеть.рф/api/ws/calls/`.
- Auth: первый message — `{"type":"auth","token":"<jwt>"}`.
- Reconnect: jitter 1–5s, ping каждые 30s, drop при отсутствии pong > 60s.
- В Android — `OkHttpClient.newWebSocket()`. В iOS — `URLSessionWebSocketTask`.

---

## 3. Авторизация

### 3.1 Два типа токенов

| Тип | Используется в | Хранение | Срок |
|-----|----------------|----------|------|
| **JWT (access + refresh)** | Staff app (doctor, manager, reg, franchise_owner, super_admin) | Keychain (iOS) / EncryptedSharedPreferences (Android) | access: 30 мин, refresh: 30 дней |
| **Patient Session token** | Patient app | Keychain / EncryptedSharedPreferences | 90 дней, продляется при активности |

### 3.2 Endpoints
- `POST /api/auth/login` — staff login by email + password
- `POST /api/auth/refresh` — обновление access
- `POST /api/auth/logout` — отзыв refresh
- `POST /api/auth/patient/request-otp` — отправка SMS
- `POST /api/auth/patient/verify-otp` — верификация и выдача session token
- `POST /api/auth/patient/telegram` — авторизация через Telegram WebApp / Login Widget
- `GET /api/auth/me` — текущий пользователь (Staff)
- `GET /api/patient/me` — текущий пациент

### 3.3 Auth flows

**Patient flow (по умолчанию):**
1. Открытие приложения → проверка сохранённого session token → `GET /api/patient/me` для валидации.
2. Если 401 или нет токена → экран ввода телефона.
3. Запрос OTP → SMS приходит за 5–30 сек.
4. Ввод 4-значного кода → получение `patient_session_token` + сохранение.
5. Опционально: предложение включить FaceID/Fingerprint для следующих входов (хранит ссылку на session_token).

**Staff flow:**
1. Экран ввода email + password.
2. `POST /api/auth/login` → `{access_token, refresh_token, user}`.
3. Сохранение обоих токенов.
4. На 401 → silent refresh → retry. Если refresh тоже 401 → logout → возврат на login.

**Auto-refresh:**
- Single-flight mutex/actor — один рефреш в момент времени.
- Очередь ожидающих запросов держится до завершения рефреша.

### 3.4 Биометрия
- **Android:** `BiometricPrompt` + `BiometricManager.canAuthenticate(BIOMETRIC_STRONG)`.
- **iOS:** `LAContext().evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)`.
- При успехе — расшифровка session/access из Keychain.
- Fallback на пароль/PIN устройства.

### 3.5 Tenant switching
Если у Staff несколько ролей в разных франшизах (например, врач в двух клиниках) — на старте показывается выбор tenant. Сохраняется в `selected_tenant_id`.

---

## 4. Дизайн-система

### 4.1 Цвета (палитра КлиникСеть)

| Token | Light | Dark | Назначение |
|-------|-------|------|------------|
| `primary` | `#0A7C9C` (медицинский бирюзовый) | `#5BBED4` | CTA, акценты |
| `primary-container` | `#CDEEF5` | `#003F50` | Selected states |
| `secondary` | `#5C7F8C` | `#A8C5D0` | Вторичные акценты |
| `tertiary` | `#7E5A8C` | `#D0B4E0` | Декор, бэйджи |
| `background` | `#FAFCFD` | `#0E1416` | Фон экранов |
| `surface` | `#FFFFFF` | `#1A2124` | Карточки |
| `surface-variant` | `#E8EFF1` | `#252F33` | Поля ввода, кнопки secondary |
| `error` | `#BA1A1A` | `#FFB4AB` | Ошибки |
| `success` | `#0D8A4A` | `#6BD896` | Успех |
| `warning` | `#C76A00` | `#FFB876` | Предупреждения |
| `text-primary` | `#0E1416` | `#F0F2F4` | Основной текст |
| `text-secondary` | `#5C6B70` | `#A8B5BA` | Вторичный текст |
| `outline` | `#C5CDD0` | `#3D484C` | Границы, разделители |

> Точные HEX-значения уточнить у дизайнера; здесь референс-палитра в духе платформы.

### 4.2 Типографика

**iOS:** SF Pro Text / SF Pro Display (системный).  
**Android:** Roboto + Roboto Flex (системный) / Inter как опциональный.

Шкала (Material 3 / iOS HIG-совместимая):

| Стиль | Размер | Вес | Использование |
|-------|--------|-----|---------------|
| Display L | 32 / 40 | 700 | Большие заголовки |
| Headline L | 24 / 32 | 600 | Заголовок экрана |
| Headline M | 20 / 28 | 600 | Заголовок секции |
| Title L | 18 / 24 | 600 | Карточка заголовок |
| Body L | 16 / 22 | 400 | Основной текст |
| Body M | 14 / 20 | 400 | Вторичный текст |
| Label L | 14 / 20 | 500 | Кнопки, метки |
| Label M | 12 / 16 | 500 | Tab labels, бэйджи |
| Caption | 11 / 14 | 400 | Микротекст |

### 4.3 Spacing
Базовая сетка **4dp/pt**. Используем: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Минимальный тап-таргет — **44pt / 48dp**.

### 4.4 Border-radius
| Token | Значение |
|-------|----------|
| `radius-xs` | 4 |
| `radius-s` | 8 |
| `radius-m` | 12 (по умолчанию для карточек) |
| `radius-l` | 16 |
| `radius-xl` | 24 |
| `radius-pill` | 999 (для chips, badges) |

### 4.5 Иконки
- **iOS:** SF Symbols (sf-symbols 5).
- **Android:** Material Symbols (rounded, weight 400, fill on selected).
- Размеры: `16 / 20 / 24 / 32`.
- Кастомные иконки (логотип, медицинские специфические) — SVG в репозитории.

### 4.6 Темы
- **Light** (default).
- **Dark** (обязательно, не опционально).
- **System** — следовать настройке устройства.
- Switch в Настройках → Внешний вид.

### 4.7 Анимации и haptics
- Material Motion / SwiftUI implicit animations.
- Targeted 60 fps на устройствах от iPhone 8 / Snapdragon 660.
- Haptic feedback (`UIImpactFeedbackGenerator.light` / `HapticFeedbackConstants.CONFIRM`) на:
  - Booking confirmation.
  - Successful chat message send.
  - Pull-to-refresh trigger.
  - Long-press action.
  - Toggle switches.

### 4.8 Accessibility
- VoiceOver / TalkBack labels на всех интерактивных элементах.
- Минимум контраст 4.5:1 для текста, 3:1 для UI-элементов.
- Поддержка Dynamic Type (iOS) и Font Scale (Android) до 130%.
- Никаких info-only color cues (всегда + иконка/текст).

---

## 5. Экраны по кабинетам

### 5.1 Patient App (приоритет № 1)

#### Auth Flow
1. **Splash** (1.5 сек, лого + анимация прогресса).
2. **Onboarding** (только при первом запуске, 3 экрана — что умеет app, skip-able).
3. **Login by phone:**
   - `PhoneInput` (с автоопределением кода страны).
   - `OtpInput` (4 цифры, auto-fill с SMS).
   - Telegram-кнопка («Войти через Telegram», если приложение открыто из Telegram WebApp — auto-skip).
4. **Permissions:**
   - Push notifications (запрос мягкий, после первого приёма к показу).
   - Calendar access (запрос при первом booking).
   - Camera (запрос при первом document upload).
   - Health access (запрос на экране «Здоровье», never on startup).

#### Bottom Tab Bar (5 табов)

**Tab 1: Главная**
- **Назначение:** дашборд для пациента.
- **Контент:**
  - Hero-карточка: ближайший приём (врач, время, кабинет, кнопки «Подтвердить» / «Перенести» / «Отменить»).
  - Quick actions: «Записаться», «Чат с клиникой», «Активные направления», «Загрузить документ».
  - Раздел «Здоровье+»: статус подписки, последние vitals.
  - Раздел «Анализы»: новые результаты (бэйдж «N новых»).
  - Реклама / новости клиники (HorizontalPager с карточками от admin_ads).
- **API:**
  - `GET /api/patient/me`
  - `GET /api/appointments/upcoming?limit=5`
  - `GET /api/patient/lab/results?status=new`
  - `GET /api/ads/active`
  - `GET /api/patient/subscription/current`

**Tab 2: Здоровье**
- **Назначение:** медкарта + vitals + анализы + документы + календарь.
- **Подэкраны (вложенный navigation):**
  - **Медкарта** — список записей врачей (хронологический), фильтры по специальности.
    - Запись: дата, врач, диагноз, рецепты, файлы. Tap → детальная.
  - **Vitals** — графики: давление, ЧСС, температура, шаги, сон.
    - Pull-to-refresh = sync с Apple Health / Google Fit (через HealthKit / HealthConnect).
    - Tap «+» — ручной ввод.
  - **Анализы** — список результатов лабораторных исследований.
    - Бэйдж «новый», фильтр по статусу.
    - Tap → PDF preview + кнопки «Поделиться», «Прокомментировать».
  - **Документы** — личные документы (паспорт, СНИЛС, страховка, согласия).
    - Загрузка через камеру / галерею / iCloud Drive / Google Drive.
    - Категории, теги.
  - **Календарь** — все приёмы в виде календаря.
    - Tap на дату → список приёмов.
    - Кнопка «Записаться».
- **API:**
  - `GET /api/patient/medical-record`
  - `GET /api/vitals/me?from=...&to=...`
  - `POST /api/vitals/sync` (с payload из HealthKit/GoogleFit)
  - `GET /api/patient/lab/results`
  - `GET /api/patient_documents_v2/me`
  - `POST /api/patient_documents_v2/upload` (multipart)
  - `GET /api/patient_calendar`
- **Native:**
  - Apple Health: read `bloodPressureSystolic`, `bloodPressureDiastolic`, `heartRate`, `stepCount`, `sleepAnalysis`, `bodyTemperature`, `bodyMass`.
  - Health Connect (Android): аналогичные records.
  - Camera + PhotoKit / MediaStore для документов.
  - Files / SAF для импорта PDF.

**Tab 3: Чаты**
- **Назначение:** чаты с клиникой, врачами, AI.
- **Структура:**
  - Список тредов (по сегодня/неделя/архив).
  - Открытый тред — message bubbles, attachments, voice messages, typing indicator, read receipts.
  - Composer: text, attach (photo/file/voice), emoji.
  - AI-ассистент — отдельный тред «Ассистент Здоровья» (zero-state: примеры вопросов).
- **API:**
  - `GET /api/patient_chat_threads/`
  - `GET /api/patient_chat_threads/{thread_id}/messages?cursor=...`
  - `POST /api/patient_chat/send`
  - `POST /api/ai_assistant/ask` (или общий thread с ai-type)
  - WebSocket `wss://клиниксеть.рф/api/ws/chat/?token=...`
- **Native:**
  - AVAudioRecorder / MediaRecorder для голосовых.
  - LinkPreview для URL в сообщениях.
  - Push при background — `chat_message`.

**Tab 4: Бонусы**
- **Назначение:** подписка «Здоровье+», лояльность, wellness, расходник баланса.
- **Подэкраны:**
  - **Моя подписка** — текущий тариф, дата следующего списания, история платежей, кнопка «Изменить тариф» / «Активировать» / «Приостановить».
  - **Бонусы и кэшбек** — текущий баланс, история начислений и списаний, реферальный код.
  - **Wellness-программы** — список программ (питание, фитнес, ментальное здоровье), участие, прогресс.
  - **Сертификаты** — подарочные сертификаты, штрих-коды для использования в клинике.
- **API:**
  - `GET /api/patient_subscription/current`
  - `GET /api/patient_subscription/plans`
  - `POST /api/patient_subscription/change` (online payment — позже)
  - `GET /api/patient_loyalty/balance`
  - `GET /api/patient_loyalty/history`
  - `GET /api/wellness/programs`
  - `GET /api/patient_spending/summary`

**Tab 5: Профиль**
- **Назначение:** настройки + личные данные + семья + врачи + история визитов.
- **Подэкраны:**
  - **Личные данные** — ФИО, дата рождения, пол, телефон, email, адрес, аватар.
  - **Семья** — добавленные дети/родители, переключение «Записываюсь как…» (для booking за родственника).
  - **Мои врачи** — список «избранных» врачей и сетей клиник.
  - **История визитов** — все приёмы archive.
  - **Уведомления** — настройки push (типы on/off).
  - **Безопасность** — биометрия, смена телефона, выход на всех устройствах.
  - **Внешний вид** — тема, язык.
  - **Помощь** — FAQ, обратная связь, версия app.
  - **Выйти**.
- **API:**
  - `PATCH /api/patient/me`
  - `GET /api/patient_family/`
  - `POST /api/patient_family/add`
  - `GET /api/patient/visits/history`
  - `GET /api/patient_notifications/settings`
  - `PATCH /api/patient_notifications/settings`

#### Дополнительные экраны (модальные / pushed)
- **Booking Flow** (multi-step):
  1. Выбор клиники (поиск по карте, с GPS).
  2. Выбор специализации.
  3. Выбор врача (с рейтингом, фото, кратким bio).
  4. Выбор слота (calendar + time grid).
  5. Подтверждение (метод оплаты — позже, пока «оплата в клинике»).
  6. Success-экран с deep-link «Добавить в календарь».
- **Active Directions** — экран с активными направлениями (бронь + QR + код).
- **Telemed Call** — fullscreen видеозвонок (см. §7).

---

### 5.2 Staff App (приоритет № 2)

**Архитектура:** одно приложение, на старте — выбор роли (если у пользователя несколько). UI меняется через `RoleBasedNavigation`.

#### Общие экраны
- **Login** (email + password).
- **Tenant + Role Picker** (если применимо).
- **Settings / Profile** — личные данные, уведомления, биометрия, выход.

#### Doctor (приоритет внутри Staff)

**Tab 1: Приёмы**
- Список приёмов на сегодня (offline доступ).
- Группировка по статусу: scheduled, in_progress, completed, cancelled.
- Tap → детальный экран приёма.
- **API:**
  - `GET /api/scheduling/my-appointments?date=today`
  - `GET /api/scheduling/my-appointments?date=...` (offline cache)

**Tab 2: Пациенты**
- Поиск пациентов (по ФИО, телефону, номеру карты).
- Avatar, статус «Сегодня на приёме», последний визит.
- Tap → карта пациента.

**Detail: Карта пациента**
- Вкладки: Профиль / Медкарта / Анализы / Документы / Vitals / Чат.
- AI-briefing (кнопка «Сгенерировать брифинг») — генерирует summary за последние 12 мес.
- **API:**
  - `GET /api/doctor/patients/{id}`
  - `GET /api/doctor/patients/{id}/medical-record`
  - `GET /api/doctor_lab/results?patient_id=...`
  - `GET /api/doctor_patient_documents/?patient_id=...`
  - `POST /api/doctor_ai/briefing` `{patient_id, scope: "last_12m"}`

**Detail: Запись приёма**
- Жалобы / Анамнез / Объективный статус / Диагноз / План лечения / Рецепты / Направления.
- Voice-to-text (нативный SFSpeechRecognizer / SpeechRecognizer).
- Шаблоны (быстрые вставки).
- Save → закрыть приём.
- **API:**
  - `POST /api/appointments/{id}/complete` `{diagnosis, plan, prescriptions, referrals}`
  - `POST /api/prescriptions/` (несколько)

**Tab 3: Чаты с пациентами**
- Аналогично patient chats, но с медицинским контекстом.
- Quick replies (шаблоны).
- **API:**
  - `GET /api/clinic_chat/threads`
  - `POST /api/clinic_chat/send`

**Tab 4: Расписание**
- Календарь врача на неделю (read-only из mobile, edit — в web).
- **API:**
  - `GET /api/scheduling/doctor/{id}/week?date=...`

**Tab 5: Профиль**
- Стандартный.

#### Manager

**Tab 1: Kanban расписания**
- DnD scheduling: приёмы по колонкам врачей.
- Pull-to-refresh + WebSocket для realtime.
- **API:**
  - `GET /api/scheduling/clinic/{id}/day?date=...`
  - `PATCH /api/scheduling/appointments/{id}` `{doctor_id, slot}`
- **Native:** UICollectionView reorder / Compose LazyColumn DragHandle.

**Tab 2: Quick Operations**
- Создать пациента.
- Активировать подписку наличными (с печатью PDF чека через AirPrint / Android print).
- Печать направления (PDF preview → print).
- **API:**
  - `POST /api/patient/create`
  - `POST /api/manager_subscription_cash/activate`
  - `GET /api/fiscal_receipts/{id}/pdf`

**Tab 3: Аналитика клиники**
- KPI: приёмов сегодня, заполняемость, средний чек, лояльность.
- **API:**
  - `GET /api/analytics/clinic/{id}/today`

**Tab 4: Чаты клиники**
- Все треды пациентов клиники.
- **API:**
  - `GET /api/clinic_chat/threads?clinic_id=...`

**Tab 5: Профиль**

#### Reg (Регистратор)

Подмножество Manager:
- **Tab 1: Поиск пациентов** (быстрый поиск).
- **Tab 2: Создание пациента**.
- **Tab 3: Запись на приём** (для пациента).
- **Tab 4: Печать направлений + чеков**.
- **Tab 5: Чаты + Профиль**.

**API:**
- `GET /api/reg_speed/search?q=...`
- `POST /api/patient/create`
- `POST /api/appointments/` (от имени пациента)

#### Franchise Owner

**Tab 1: KPI Dashboard**
- Графики выручки, приёмов, конверсии, лояльности по всем клиникам сети.
- **API:**
  - `GET /api/franchise_analytics/overview`

**Tab 2: Клиники сети**
- Список клиник с метриками.
- **API:**
  - `GET /api/franchise_owner_clinics/`

**Tab 3: Тарифы и подписки**
- Configurator подписочных тарифов (read + light edit).
- **API:**
  - `GET /api/admin_subscription_plans/`

**Tab 4: Регламенты**
- Список регламентов сети + чтение.
- **API:**
  - `GET /api/regulations/`

**Tab 5: Профиль**

---

### 5.3 Super Admin App (приоритет № 3, отложить)

Минимальный функционал:
- **Marketplace модулей** — список tenants + их активные модули + toggle.
- **System status** — health-check всех сервисов (api, db, redis, coturn, sentry uptime).
- **Impersonation** — `POST /api/impersonation/start?user_id=...` + переход в Patient/Staff контекст.

---

## 6. Ключевые фичи (P0 — must для MVP)

### 6.1 Patient (MVP — Месяц 1–2)
| Фича | Native интеграция | API |
|------|-------------------|-----|
| Login by phone + OTP | SMS auto-fill, Keychain | `/auth/patient/*` |
| Главная — ближайший приём | Calendar reminder | `/appointments/upcoming` |
| Booking (выбор клиника → врач → слот) | Calendar event | `/clinics/`, `/scheduling/slots`, `/appointments/` |
| Активные направления | QR rendering | `/patient/referrals/active` |
| Чат с клиникой + AI | Push, WS | `/patient_chat/`, `/ai_assistant/` |
| Медкарта (просмотр) | — | `/patient/medical-record` |
| Анализы (просмотр + share PDF) | UIActivityController / Intent SEND | `/patient_lab/results` |
| Документы (upload via camera/gallery) | UIImagePickerController / PhotoPicker | `/patient_documents_v2/upload` |
| Apple Health / Google Fit sync | HealthKit, HealthConnect | `/vitals/sync` |
| Профиль + семья | — | `/patient/me`, `/patient_family/` |
| Push: appointment_reminder, chat_message, lab_result_ready | FCM/APNs | `/push/register-device` |
| Биометрия для входа | LAContext / BiometricPrompt | local |
| Темы (light/dark/system) | UITraitCollection / Configuration | local |

### 6.2 Doctor (MVP — Месяц 3)
| Фича | Native | API |
|------|--------|-----|
| Список приёмов на день (offline) | Room/CoreData cache | `/scheduling/my-appointments` |
| Карта пациента | — | `/doctor/patients/{id}/*` |
| AI Pre-visit briefing | — | `/doctor_ai/briefing` |
| Запись приёма (текст + voice-to-text) | SFSpeechRecognizer / SpeechRecognizer | `/appointments/{id}/complete` |
| Чат с пациентом | WS, push | `/clinic_chat/` |
| Просмотр документов пациента | PDF preview (PDFKit / Android PDF Viewer) | `/doctor_patient_documents/` |

### 6.3 Manager (MVP — Месяц 3)
| Фича | Native | API |
|------|--------|-----|
| Kanban DnD (на планшете) | Compose drag / SwiftUI drag-drop | `/scheduling/clinic/` |
| Создание пациента | — | `/patient/create` |
| Активация подписки наличными | AirPrint / Android Print | `/manager_subscription_cash/` |
| Чаты клиники (треды) | WS | `/clinic_chat/threads` |
| Печать чека / направления | Print framework | `/fiscal_receipts/{id}/pdf` |

---

## 7. WebRTC (телемедицина)

### 7.1 Стек
- **Android:** `io.getstream:stream-webrtc-android` (wrapper over Google libwebrtc).
- **iOS:** `WebRTC.xcframework` (https://github.com/stasel/WebRTC, build 120+).

### 7.2 Архитектура звонка
```
[Patient/Doctor mobile] ──WSS──▶ [Backend signaling: /api/ws/calls/]
                                        │
                                        ▼
                                 [coturn TURN/STUN]
                                        │
                                        ▼
                                 [Peer-to-peer audio/video]
```

### 7.3 Signaling protocol
WebSocket `wss://клиниксеть.рф/api/ws/calls/?token=...`. Messages:
- `{"type":"call.invite", "to_user_id":..., "call_id":..., "kind":"audio|video"}`
- `{"type":"call.accept", "call_id":...}`
- `{"type":"call.reject", "call_id":...}`
- `{"type":"call.sdp", "call_id":..., "sdp":..., "kind":"offer|answer"}`
- `{"type":"call.ice", "call_id":..., "candidate":...}`
- `{"type":"call.end", "call_id":..., "reason":"..."}`

### 7.4 TURN
- ICE-config endpoint: `GET /api/presence/ice-config` → возвращает STUN + TURN credentials (HMAC-SHA1 REST, time-limited).
- Refresh при reconnect.

### 7.5 Permissions
- iOS: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription` в Info.plist.
- Android: `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`.

### 7.6 UX
- Fullscreen call view: видео собеседника + small self-preview (PiP) + кнопки (mute, video on/off, switch camera, speaker, end).
- В background — продолжать аудио (`AVAudioSession` category .playAndRecord, Android — `ForegroundService` type "phoneCall").
- CallKit (iOS) + ConnectionService (Android) — для отображения в системном UI звонков. **Опционально для MVP** (можно отложить из-за сложности и App Store review).

---

## 8. Push notifications

### 8.1 Платформы
- **Android:** FCM (`firebase-messaging`).
- **iOS:** APNs через `UserNotifications` + FCM SDK (унифицированная отправка с backend через FCM HTTP v1).

### 8.2 Backend endpoint
Нужно добавить (если ещё нет):

```
POST /api/notifications/register-device
{
  "device_token": "<fcm-token>",
  "platform": "android|ios",
  "app_version": "1.0.0",
  "device_model": "...",
  "os_version": "..."
}

DELETE /api/notifications/unregister-device
{
  "device_token": "..."
}
```

### 8.3 Типы уведомлений
| Тип | Текст | Deep link |
|-----|-------|-----------|
| `appointment_reminder` | «Приём у [Доктор] завтра в 10:00» | `clinika://appointment/<id>` |
| `appointment_changed` | «Ваш приём перенесён» | `clinika://appointment/<id>` |
| `chat_message` | «Новое сообщение от [Клиника]» | `clinika://chat/<thread_id>` |
| `lab_result_ready` | «Готов результат анализа» | `clinika://lab/<result_id>` |
| `subscription_expiring` | «Подписка истекает через 3 дня» | `clinika://subscription` |
| `payment_received` | «Зачислено N бонусов» | `clinika://loyalty` |
| `prescription_ready` | «Готов рецепт» | `clinika://prescription/<id>` |
| `call_incoming` (silent + CallKit) | — (через CallKit/ConnectionService UI) | — |
| `regulation_published` (staff) | «Новый регламент» | `clinika://regulation/<id>` |

### 8.4 Deep links
- URL scheme: `clinika://`.
- Universal Links (iOS): `https://клиниксеть.рф/app/...` (apple-app-site-association).
- Android App Links: `https://клиниксеть.рф/app/...` (assetlinks.json).

### 8.5 In-app uplift
- При закрытом приложении — system notification.
- При foreground — in-app toast/banner (Material 3 Snackbar / SwiftUI overlay).
- Badge count на app icon — счётчик unread chat + unread lab.

---

## 9. Offline support

### 9.1 Что кешировать (Patient)
- Список приёмов на ±30 дней.
- Медкарта (последние 50 записей).
- Анализы (метаданные, PDF файлы по запросу).
- Документы пациента (метаданные + локальные копии).
- Vitals последние 30 дней.
- Сообщения чата последние 30 дней.
- Профиль + семья.

### 9.2 Что кешировать (Staff)
- Приёмы на сегодня + завтра.
- Карты пациентов сегодняшних приёмов.
- Шаблоны записей врача.

### 9.3 Sync queue
- Operations table в Room/CoreData: `{id, type, payload_json, created_at, attempts, last_error}`.
- Worker (WorkManager / BGProcessingTask) пробуждается:
  - При подключении сети (network observer).
  - По расписанию (раз в 15 мин, если в очереди есть items).
  - При foreground app.
- Идемпотентность: каждая операция содержит `client_request_id` → backend проверяет дубликаты.

### 9.4 Conflict resolution
- Last-write-wins для большинства полей.
- Для критичных (запись приёма) — merge с user prompt при конфликте версий.

---

## 10. Native интеграции

### 10.1 Calendar
- При booking — предложить «Добавить в календарь».
- iOS: `EventKit` (запрос permission `NSCalendarsUsageDescription`).
- Android: `CalendarContract` (запрос `WRITE_CALENDAR`).

### 10.2 Camera + Photo library
- Documents upload, profile photo, attachments в чате.
- iOS: `UIImagePickerController` (legacy) / `PHPickerViewController` (iOS 14+) для library, `AVFoundation` для camera.
- Android: ActivityResult + `MediaStore` (Q+) / `getContent`/`takePicture` contracts.

### 10.3 Apple Health / Google Fit (Health Connect)
- **iOS HealthKit:** read permissions для bloodPressure, heartRate, steps, sleep, bodyTemperature, weight, height, oxygenSaturation, bloodGlucose, respiratoryRate.
- **Android Health Connect:** аналогичные records (Health Connect 1.1+, в API 28+ нужен fallback на legacy Google Fit для < API 28).
- Sync стратегия: pull на pull-to-refresh + background fetch раз в 6 ч (отправка дельты с last sync timestamp).
- Payload: `{ type, value, unit, recorded_at, source: "apple_health"|"health_connect"|"manual" }`.

### 10.4 Apple Pay / Google Pay
- **Откладываем до post-MVP.** В MVP — placeholder «Скоро».
- Когда будет — Stripe / ЮKassa Mobile SDK + Apple Pay merchant ID + Google Pay merchant ID.

### 10.5 Telegram Login
- Web-flow: `TelegramLoginWidget` через `WKWebView` (iOS) / `WebView` (Android).
- Альтернатива: deep link в Telegram бот с auth-токеном (если приложение есть на устройстве).

### 10.6 Биометрия
- iOS: `LAContext`, fallback на passcode device.
- Android: `BiometricPrompt` с `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`.
- Биометрия защищает доступ к Keychain/Keystore entry, где хранится session.

### 10.7 Print
- iOS: `UIPrintInteractionController` (AirPrint).
- Android: `PrintManager` + `PrintDocumentAdapter`.
- Используется в Staff app для печати чеков и направлений (PDF из backend → print).

### 10.8 Share
- iOS: `UIActivityViewController`.
- Android: `Intent.ACTION_SEND` + `Intent.createChooser`.
- Использование: поделиться PDF результата анализа, приглашением (referral link).

---

## 11. Технические требования

### 11.1 Минимальные версии
- **iOS:** 14.0+ (покрывает 98%+ устройств).
- **iPadOS:** 14.0+.
- **Android:** API 24 (Android 7.0 Nougat), target 34.

### 11.2 Crash reporting
- **Sentry** (уже используется на backend / frontend).
- DSN передаётся через build-flavors.
- Sample rate: 100% errors, 10% performance в prod.

### 11.3 Analytics
- **Yandex Metrica Mobile SDK** (приоритет — гео-приоритет РФ).
- Опционально + Firebase Analytics (для cross-platform funnel analysis).
- События:
  - `app_open`, `login_success`, `login_failed`, `booking_started`, `booking_completed`, `chat_message_sent`, `lab_result_viewed`, `document_uploaded`, `subscription_changed`, `vitals_synced`, `telemed_call_started`, `telemed_call_ended`, `screen_view` (auto).

### 11.4 A/B testing
- Через Firebase Remote Config (или Yandex AppMetrica Experiments).
- Используется для:
  - Порядка onboarding-экранов.
  - Расположения CTA на главной.
  - Тестирование текста push-уведомлений.

### 11.5 CI/CD
- **Bitrise** или **GitHub Actions** (Codemagic как альтернатива для iOS).
- Workflows:
  - `pr-check` — lint + unit tests + UI tests on emulator.
  - `internal-build` — на merge в `develop` → TestFlight / Google Play Internal.
  - `release-build` — на tag → TestFlight Beta + Play Production (через staged rollout 10%→25%→50%→100%).
- Signing:
  - iOS — fastlane match с приватным репозиторием для сертификатов.
  - Android — keystore в GitHub Secrets, ProGuard/R8.

### 11.6 Версионирование
- SemVer: `MAJOR.MINOR.PATCH+BUILD` (1.0.0+100).
- Build number — git commit count или CI build ID.

### 11.7 Force-update
- Endpoint `GET /api/system/mobile-version-check?platform=ios|android&version=1.0.0` → `{action: "ok"|"recommend"|"force", message, store_url}`.
- При `force` — блокирующий экран с кнопкой «Обновить».

---

## 12. Дизайн-гайды (внешний UX)

### 12.1 iOS HIG
- Tab Bar (нижний) — основная навигация.
- Большие заголовки (`navigationBarTitleDisplayMode(.large)`).
- Native gestures (swipe to dismiss, edge swipe back).
- Haptics на ключевых действиях.
- Dynamic Type support.

### 12.2 Material Design 3
- NavigationBar (нижний).
- Top App Bar (с support для CollapsingToolbar).
- FAB для primary action.
- M3 colors + tonal surfaces.
- Material You theming (опционально).

### 12.3 Анимации
- Стандартные translations (push/pop) — нативные.
- Кастомные shared element transitions для booking flow (фото врача → детальная).
- 60 fps targeted; profilling через Android Studio Layout Inspector / iOS Instruments.

### 12.4 Loading states
- Skeleton screens (не spinners) для контента.
- Pull-to-refresh с native indicator.
- Shimmer effect для list placeholders.

### 12.5 Empty / Error states
- Иллюстрация + текст + CTA («Записаться» / «Повторить»).
- Не пустые экраны без объяснения.

### 12.6 Accessibility
- VoiceOver / TalkBack labels на ВСЕХ интерактивных элементах.
- Контраст ≥ 4.5:1.
- Tap target ≥ 44pt / 48dp.
- Поддержка Dynamic Type (до xxxLarge).
- Reduce Motion respect (анимации упрощённые).

---

## 13. Testing

### 13.1 Unit tests
- ViewModels: проверка StateFlow transitions.
- UseCases: бизнес-логика.
- Repositories: с MockRemote/MockLocal.
- Coverage target: ≥ 70% для ViewModels + Repos.
- **Android:** JUnit5 + MockK + Turbine.
- **iOS:** XCTest + ViewInspector (для SwiftUI).

### 13.2 UI tests
- Smoke flows: login, booking, chat send.
- **Android:** Espresso + Compose UI Test.
- **iOS:** XCUITest.
- Runs on CI на каждый PR.

### 13.3 Integration tests
- С MockServer (WireMock / Mockingjay) — full request/response cycle.

### 13.4 Manual QA checklist
По каждому экрану:
- [ ] Загружается с пустым state.
- [ ] Loading state виден.
- [ ] Error state с retry.
- [ ] Offline state (auto airplane mode toggle).
- [ ] Dark mode корректный.
- [ ] VoiceOver/TalkBack labels на месте.
- [ ] Dynamic Type до xxxLarge не ломает layout.
- [ ] Landscape (для планшетов).
- [ ] Тапы все ≥ 44pt.

### 13.5 Beta testing
- TestFlight internal (команда + designers + PM) — 25 человек.
- TestFlight external — до 1000 пациентов из 2 пилотных клиник.
- Google Play Internal track + Closed track.

---

## 14. Roadmap по неделям

### Месяц 1 — Patient App Foundation
- **W1:** Setup проектов (Android + iOS), CI/CD, Sentry, Firebase, базовый theme, DI.
- **W2:** Auth flow (phone + OTP + biometric), API client с auto-refresh.
- **W3:** Bottom Tab Bar + Главная экран (включая ближайший приём + quick actions).
- **W4:** Профиль + Настройки + Темы + Onboarding.

### Месяц 2 — Patient App Core
- **W5:** Booking flow (полный, 5 экранов).
- **W6:** Чаты (текст, WS, push, attachments).
- **W7:** Медкарта + Анализы (просмотр, share PDF).
- **W8:** Документы (upload), Vitals (HealthKit/HealthConnect sync), Календарь.

### Месяц 3 — Staff App
- **W9:** Doctor — приёмы list + карта пациента + AI briefing.
- **W10:** Doctor — запись приёма (voice-to-text) + чаты.
- **W11:** Manager — Kanban, Quick Ops, чаты клиники.
- **W12:** Reg — поиск, создание пациента, печать.

### Месяц 4 — Advanced
- **W13:** WebRTC телемедицина (Patient ↔ Doctor).
- **W14:** Push notifications (все типы) + Deep links + Universal/App Links.
- **W15:** Offline-first refinement, Sync queue, Conflict resolution.
- **W16:** Apple Pay / Google Pay infra (placeholder), Telegram login.

### Месяц 5 — QA + Beta
- **W17:** Internal QA pass всех чеклистов.
- **W18:** TestFlight + Google Play Internal beta launch (50 пилотов).
- **W19:** Bugfix sprint #1 на основе фидбека.
- **W20:** App Store + Google Play submission, marketing materials.

### Месяц 6 — Public Launch
- **W21:** Staged rollout 10% → 25% → 50%.
- **W22:** Full rollout 100% + monitoring + Sentry alerts.
- **W23:** Iteration sprint #1 (улучшения по metrics).
- **W24:** Franchise Owner модуль + Super Admin прототип (если время).

---

## 15. Бюджет (приблизительно)

### 15.1 Команда
**Вариант A — Solo dev (full-stack mobile):**
- Сроки: 6–9 месяцев на оба приложения.
- Стоимость (РФ market 2026): 350–500k руб/мес × 7 = **~2.5–3.5 млн руб**.
- Риски: bus factor, отсутствие code review, выгорание.

**Вариант B — Team (2 mobile + 1 designer + 0.5 PM):**
- Сроки: 3–4 месяца до MVP, 6 месяцев до public launch.
- Стоимость: (300–450k × 2) + 200k × 1 + 200k × 0.5 + 250k PM × 1 = **~1.5 млн руб/мес × 6 = 9 млн руб**.
- Плюсы: параллельная работа, качество.

**Вариант C — Outsource агентство:**
- Сроки: 4–6 мес.
- Стоимость: 8–15 млн руб (single-app, native, обе платформы).

**Рекомендация:** Вариант B (in-house team) — best value/quality.

### 15.2 Программы и сертификаты
- **Apple Developer Program:** $99/год (≈ 9000 руб).
- **Google Play Developer:** $25 единоразово.
- **Sentry:** Team plan $26/мес (≈ 2500 руб).
- **Firebase / FCM:** бесплатно для проекта средней нагрузки.
- **Bitrise** (CI/CD): $30–60/мес за пользователя.
- **Yandex Metrica Mobile:** бесплатно.

### 15.3 Маркетинг (launch budget)
- **ASO (App Store Optimization):** 30–50k руб разово (агентство ASO).
- **Скриншоты + промо-видео** для сторов: 50–100k руб.
- **Performance ads:** Yandex Direct + Telegram Ads — 100k руб/мес × 3 = 300k.
- **Influencer outreach** (мед.блогеры в TG/Instagram): 100–200k.
- **Итого launch:** ~500k–1М руб.

---

## 16. Что НЕ делать

1. **Не пытаться сразу сделать все 11 ролей в одном app.** Pattern: Patient app + Staff app (объединённый) + Admin app — 3 приложения максимум.
2. **Не дублировать всю веб-функциональность.** Mobile = ключевые задачи, которые делаются на ходу или ежедневно. Сложные настройки (configurator подписок, marketplace, регламенты edit) — остаются в web.
3. **Не зависеть от внешних UI-китов** (Tabler, NativeBase, Tamagui). Использовать стандартные Material 3 (Android) и SwiftUI (iOS) с своей дизайн-системой поверх.
4. **Не игнорировать темную тему.** Это базовая функциональность, не feature.
5. **Не использовать WebView для основного контента.** WebView — только для:
   - Telegram Login widget.
   - Платёжный шлюз (Apple/Google Pay redirect).
   - Договоры/политики (загружаются с сайта).
6. **Не запускать в App Store без CallKit-аналога**, если телемед — основной use case. Apple строго относится к VoIP.
7. **Не игнорировать accessibility** — может стать barrier к approval в App Store.
8. **Не делать одну universal app для всех ролей** в начале — слишком много условной логики, медленная разработка. Сначала Patient (1 app), потом Staff (1 app с role switching).
9. **Не использовать deprecated API** (UIWebView iOS, AsyncTask Android, etc) — App Store / Play Store отклоняют.
10. **Не хранить токены в UserDefaults / SharedPreferences без шифрования.** Только Keychain / EncryptedSharedPreferences.

---

## 17. Готовый промт для AI-разработчика (single paragraph)

```
You are building two native mobile apps for "КлиникСеть" (https://клиниксеть.рф) — a multi-tenant SaaS medical platform with FastAPI backend (~100 routers) at https://клиниксеть.рф/api/, supporting 11 user roles and 10 functional chapters including telemedicine, EMR, lab results, loyalty/subscription, AI assistant, and a "Здоровье+" wellness module. Stack: native Kotlin + Jetpack Compose (Android, minSdk 24) and Swift + SwiftUI (iOS 14+). Architecture: MVVM + Repository + UseCase, offline-first via Room/CoreData with WorkManager/BGTaskScheduler sync queue, Retrofit/Alamofire for REST + OkHttp/URLSessionWebSocketTask for WebSocket (chat, presence, calls signaling). Auth: dual-token — JWT (access 30min + refresh 30 days) for staff via /api/auth/login + /api/auth/refresh, and Patient Session token (90 days) for patients via /api/auth/patient/request-otp + /verify-otp, stored in Keychain/EncryptedSharedPreferences with biometric unlock (LAContext/BiometricPrompt). Priority 1 — Patient App with 5-tab bottom navigation (Главная, Здоровье, Чаты, Бонусы, Профиль), full booking flow (clinic→doctor→slot→confirm + calendar integration via EventKit/CalendarContract), chat with WS + FCM/APNs push (deep links clinika://), medical record + lab results viewer with PDF share, document upload from camera/gallery, Apple Health/Health Connect vitals sync, subscription view, loyalty balance. Priority 2 — unified Staff App with role-based navigation for doctor (appointments list with offline cache, patient card with AI briefing via /doctor_ai/briefing, appointment recording with SFSpeechRecognizer/Android SpeechRecognizer voice-to-text), manager (Kanban scheduling with native drag-drop, quick patient creation, cash subscription activation with AirPrint/PrintManager receipt printing), reg (fast search /reg_speed/search, patient creation, referral printing), franchise_owner (KPI dashboard /franchise_analytics, regulations list). WebRTC telemed via stream-webrtc-android + WebRTC.xcframework with signaling over wss://клиниксеть.рф/api/ws/calls/ and TURN credentials from /api/presence/ice-config (HMAC-SHA1 REST), CallKit/ConnectionService optional in MVP. Design system: Material 3 + iOS HIG with Light + Dark + System themes, color tokens (primary #0A7C9C teal), SF Pro/Roboto typography, 4dp spacing grid, 12dp default radius, 44pt/48dp minimum tap targets, haptic feedback on key actions, full VoiceOver/TalkBack accessibility, Dynamic Type support. Push notifications via FCM (Android) + APNs/FCM (iOS) for appointment_reminder, chat_message, lab_result_ready, subscription_expiring, payment_received with deep links and badge counts; backend endpoint POST /api/notifications/register-device. Crash reporting Sentry, analytics Yandex Metrica Mobile + optional Firebase Analytics, CI/CD via Bitrise or GitHub Actions with fastlane match (iOS) and ProGuard/R8 (Android), distribution App Store + Google Play + direct APK для Чечни/Ингушетии. Offline-first cache: appointments (±30 days), medical record (50 records), labs, documents, vitals (30 days), chats (30 days); sync queue with exponential backoff + idempotency client_request_id. Timeline: M1-M2 Patient MVP, M3 Staff MVP, M4 WebRTC + push + native integrations, M5 QA + beta, M6 public launch with staged rollout. Do NOT: build one universal app for all 11 roles, duplicate web functionality, use WebView for main content, skip dark mode, store tokens unencrypted, or ship without accessibility. Deliverables: two App Store + two Google Play listings + direct APK channel, full TestFlight/Internal beta, Sentry monitoring, ASO assets, fastlane automation, ≥70% test coverage on ViewModels/Repos.
```

---

## 18. Telegram-friendly summary (без markdown)

КлиникСеть — две нативные мобильные приложения для пациентов и сотрудников.

Платформы: Android API 24+, iOS 14+. Стек: Kotlin + Jetpack Compose и Swift + SwiftUI. Не RN, не Flutter — обоснование в документе.

Приоритеты:
1. Patient App — 5 табов: Главная, Здоровье, Чаты, Бонусы, Профиль. Booking, медкарта, анализы, документы, Apple Health/Google Fit, AI-ассистент.
2. Staff App — единое приложение для doctor/manager/reg/franchise_owner с role-based навигацией.
3. Admin App — опционально, отложить.

Архитектура: MVVM + Repository + UseCase, offline-first через Room/CoreData. Auth: JWT для персонала, Patient Session token для пациентов. Биометрия для входа.

Ключевые фичи: запись на приём с calendar event, чаты с WS+push, AI-briefing для врача, Kanban DnD для менеджера, WebRTC телемедицина (coturn уже настроен), Apple Health/Health Connect синхронизация vitals.

Дизайн: Material 3 + iOS HIG, обязательно dark theme, accessibility (VoiceOver/TalkBack), 60 fps анимации, haptics, 44pt/48dp тапы.

Push: FCM+APNs, типы — appointment_reminder, chat_message, lab_result_ready, subscription_expiring. Deep links clinika://. Нужно добавить /api/notifications/register-device.

Тесты: unit ≥70% покрытия, UI tests на CI, ручной QA чеклист по экранам, TestFlight + Google Play Internal beta.

Roadmap: 6 месяцев до публичного запуска. M1-M2 Patient MVP, M3 Staff MVP, M4 WebRTC+push, M5 QA+beta, M6 launch.

Бюджет: команда 2 mobile + 1 designer + PM = ~9 млн руб за 6 мес. Apple Dev $99/год, Google Play $25 разово. Маркетинг launch ~500k-1М руб.

Дистрибуция: App Store + Google Play + direct APK для Чечни/Ингушетии (хостинг на клиниксеть.рф/download/android/).

Не делать: универсальное приложение для всех 11 ролей, дублирование веба, WebView для основного контента, игнорирование dark mode, хранение токенов без шифрования, релиз без accessibility.

Полный документ: /opt/clinika/MOBILE_APP_PROMPT.md
