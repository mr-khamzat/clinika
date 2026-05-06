# Mobile Adaptation Backlog

## 2026-05-06: Quick mobile pass перед запуском мобильного приложения

Быстрый pass прошёл по 17 файлам кабинетов. Исправлены критичные проблемы:
- Тач-таргеты <44px (back-кнопки 32px → 44px, logout-кнопки 32px → 44px)
- Bottom nav кнопки без min-height
- Таблицы без overflow-x wrapper в ManagerDashboard / ManagerAnalytics
- Grid-cols-4 на 320px → grid-cols-3 sm:grid-cols-4 в ManagerDashboard quick links
- Заголовок ManagerAppointments с табами adjacent → flex-col на mobile

## TODO для следующей сессии (полный редизайн)

### AdminLayout.jsx
- 7700+ строк, не трогали в этой сессии
- Нужен **полный редизайн** под mobile-first
- Десктоп-таблицы с 8+ колонками не адаптированы (доктора, пациенты, направления, бонусы)
- Сложные модалы редактирования услуг/врачей/клиник — desktop-only сейчас
- Sidebar 250px → drawer на мобильном

### SupervisorCabinet.jsx
- 3758 строк, прошли только bottom nav
- Роль удаляется в ROADMAP — НЕ ИНВЕСТИРОВАТЬ время в редизайн
- Если решили оставить — нужен полный pass отдельно

### ManagerRecruitDoctors.jsx
- Inline styles вместо tailwind классов делает override сложным
- AddModal: на мобильном открывается как card без bottom-sheet стиля
- Список карточек врачей с кнопками "Сменить данные" / "Заблокировать" / "Активировать" на 320px wraps awkwardly
- TODO: переписать на tailwind + bottom-sheet модалы

### OperationalCabinet.jsx
- Bottom nav с 5 пунктами (4 + Ещё) — на 320px ≈64px на пункт, лейблы упираются
- Booking modal `bookVisitDoc` (приём приезжего врача) — занимает весь экран, scrollable, OK
- Forms с datepicker/timepicker на native HTML — приемлемо

### FranchiseOwnerCabinet.jsx
- 10 табов в bottom nav → сделан horizontal scroll, но для UX лучше вынести в drawer "Ещё"
- TenantsList с MRR данными на mobile сжимается, вторая строка с meta wraps
- TODO: переход на drawer pattern как в ManagerDashboard

### ManagerHistory.jsx
- Карточки направлений ОК на mobile
- Status tabs сделаны horizontal scrollable
- TODO: ExpandedRow содержимое (Bonus, Cancel reason etc.) использует text-xs (12px) — не критично, но не идеал

### ManagerAnalytics.jsx
- DailyChart SVG viewBox 340 — масштабируется, но на 320px метки могут перекрываться
- TODO: на 320px хотя бы каждый 7-й день вместо каждого 5-го, или вертикальные метки

### Общие TODO:
- Не везде применён `safe-area-inset-bottom` для нижней навигации (проверить iOS notch)
- Шрифт `text-xs` (12px) используется повсеместно для labels/captions — приемлемо, но в 4-5 местах основной контент тоже — нужна замена на text-sm
- Modal sheets: ручной back-button (Esc, swipe-down) не реализован
- Toast уведомлений нет, fallback на alert

## Принцип на следующую волну (Wave 5)
- Полный редизайн в стиле design-preview-2 (см. /opt/clinika/frontend/src/pages/DesignPreview2.jsx)
- Использовать дизайн-токены и компоненты из DesignSystem.jsx
- Bottom-sheet модалы везде на mobile
- Skeleton loaders вместо spinner
- Pull-to-refresh для списков
- Native-like transitions (slide-in, scale-out)
