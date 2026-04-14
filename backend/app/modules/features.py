"""
Каталог функциональных модулей (фич) и их доступность по планам.
Добавить новую фичу = 1 строка в PLAN_FEATURES + 1 строка в FEATURE_LABELS.
"""

# Планы в порядке возрастания
PLANS = ["basic", "professional", "enterprise"]

# Что включено в каждый план
_PLAN_BASE: dict[str, set[str]] = {
    "basic": {
        "referrals",        # Направления пациентов
        "bonuses",          # Бонусная система
        "clinics",          # Управление клиниками (до 3)
        "qr_scan",          # QR-сканирование партнёров
        "analytics",        # Базовая аналитика (обзор + воронка)
        "support",          # Чат технической поддержки
        "partner_portal",   # Личный кабинет партнёра
        "invitations",      # Инвайт-ссылки для партнёров
    },
    "professional": {
        "discounts",        # Скидки и акции
        "kpi",              # KPI и цели сотрудников
        "mis_sync",         # Интеграция с МИС (Renovatio и др.)
        "custom_branding",  # Кастомный брендинг (цвета, логотип)
        "sms_notify",       # SMS-уведомления
        "scheduling",       # Расписание врачей и онлайн-запись
        "audit_log",        # Полный аудит-лог действий
        "financial_ledger", # Финансовый реестр операций
        "billing",          # Биллинг и управление счетами
    },
    "enterprise": {
        "multi_tenant",     # Управление несколькими тенантами
        "api_access",       # Внешний REST API доступ
        "white_label",      # Полный white-label (свой домен + брендинг)
        "unlimited_users",  # Безлимитные пользователи и клиники
        "p2p_calls",        # P2P видеозвонки между клиниками
        "webhooks",         # Исходящие вебхуки (интеграции)
    },
}

# Наследование: professional = basic + своё; enterprise = professional + своё
PLAN_FEATURES: dict[str, set[str]] = {
    "basic":        _PLAN_BASE["basic"],
    "professional": _PLAN_BASE["basic"] | _PLAN_BASE["professional"],
    "enterprise":   _PLAN_BASE["basic"] | _PLAN_BASE["professional"] | _PLAN_BASE["enterprise"],
}

# Человекочитаемые названия для UI
FEATURE_LABELS: dict[str, str] = {
    "referrals":        "Направления пациентов",
    "bonuses":          "Бонусная система",
    "clinics":          "Управление клиниками",
    "qr_scan":          "QR-сканирование",
    "analytics":        "Аналитика и отчёты",
    "support":          "Чат поддержки",
    "partner_portal":   "Личный кабинет партнёра",
    "invitations":      "Инвайт-ссылки",
    "discounts":        "Скидки и акции",
    "kpi":              "KPI и цели",
    "mis_sync":         "Интеграция с МИС",
    "custom_branding":  "Кастомный брендинг",
    "sms_notify":       "SMS-уведомления",
    "scheduling":       "Расписание врачей",
    "audit_log":        "Аудит-лог действий",
    "financial_ledger": "Финансовый реестр",
    "billing":          "Биллинг и счета",
    "multi_tenant":     "Мульти-тенант управление",
    "api_access":       "REST API доступ",
    "white_label":      "Полный white-label",
    "unlimited_users":  "Безлимитные пользователи",
    "p2p_calls":        "P2P видеозвонки",
    "webhooks":         "Вебхуки и интеграции",
}

# Минимальный план для каждой фичи (для UI подсказок)
FEATURE_MIN_PLAN: dict[str, str] = {
    feat: plan
    for plan in PLANS
    for feat in _PLAN_BASE[plan]
}

# Лимиты ресурсов по планам
PLAN_LIMITS: dict[str, dict] = {
    "basic":        {"max_clinics": 3,  "max_users": 50,  "max_partners": 500},
    "professional": {"max_clinics": 15, "max_users": 200, "max_partners": 5000},
    "enterprise":   {"max_clinics": 0,  "max_users": 0,   "max_partners": 0},   # 0 = безлимит
}

# Описания тарифов
PLAN_DESCRIPTIONS: dict[str, dict] = {
    "basic": {
        "label":    "Базовый",
        "subtitle": "Для старта и небольших клиник",
        "color":    "#64748b",
        "gradient": "from-slate-500 to-slate-700",
    },
    "professional": {
        "label":    "Профессиональный",
        "subtitle": "Полный функционал для растущей сети",
        "color":    "#0097A7",
        "gradient": "from-[#0097A7] to-[#004D5F]",
        "badge":    "Популярный",
    },
    "enterprise": {
        "label":    "Корпоративный",
        "subtitle": "Максимум возможностей и интеграций",
        "color":    "#7c3aed",
        "gradient": "from-violet-600 to-violet-900",
        "badge":    "Максимум",
    },
}
