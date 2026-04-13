"""
Каталог функциональных модулей (фич) и их доступность по планам.
Добавить новую фичу = 1 строка в PLAN_FEATURES + 1 строка в FEATURE_LABELS.
"""

# Планы в порядке возрастания
PLANS = ["basic", "professional", "enterprise"]

# Что включено в каждый план (enterprise наследует professional)
_PLAN_BASE: dict[str, set[str]] = {
    "basic": {
        "referrals",        # Направления пациентов
        "bonuses",          # Бонусная система
        "clinics",          # Управление клиниками
        "qr_scan",          # QR-сканирование
    },
    "professional": {
        "analytics",        # Аналитика и отчёты
        "support",          # Чат поддержки
        "invitations",      # Инвайт-ссылки для партнёров
        "discounts",        # Скидки и акции
        "kpi",              # KPI и цели
        "mis_sync",         # Синхронизация с МИС
        "partner_portal",   # Портал партнёров
        "custom_branding",  # Кастомный брендинг
        "sms_notify",       # SMS-уведомления
        "scheduling",       # Расписание врачей + слоты
        "audit_log",        # Полный аудит лог
        "financial_ledger", # Финансовый реестр операций
        "billing",          # Биллинг и счета
    },
    "enterprise": {
        "billing",          # (наследуется из professional)
        "multi_tenant",     # Управление несколькими тенантами
        "api_access",       # Внешний API доступ
        "white_label",      # Полный white-label (свой домен)
        "unlimited_users",  # Безлимитные пользователи
        "p2p_calls",        # P2P звонки
    },
}

# Наследование: enterprise = professional = basic + своё
PLAN_FEATURES: dict[str, set[str]] = {
    "basic": _PLAN_BASE["basic"],
    "professional": _PLAN_BASE["basic"] | _PLAN_BASE["professional"],
    "enterprise": _PLAN_BASE["basic"] | _PLAN_BASE["professional"] | _PLAN_BASE["enterprise"],
}

# Человекочитаемые названия для UI
FEATURE_LABELS: dict[str, str] = {
    "referrals":        "Направления пациентов",
    "bonuses":          "Бонусная система",
    "clinics":          "Управление клиниками",
    "qr_scan":          "QR-сканирование",
    "analytics":        "Аналитика и отчёты",
    "support":          "Чат поддержки",
    "invitations":      "Инвайт-ссылки",
    "discounts":        "Скидки и акции",
    "kpi":              "KPI и цели",
    "mis_sync":         "Синхронизация с МИС",
    "partner_portal":   "Портал партнёров",
    "custom_branding":  "Кастомный брендинг",
    "sms_notify":       "SMS-уведомления",
    "scheduling":       "Расписание врачей",
    "billing":          "Биллинг и счета",
    "audit_log":        "Аудит лог",
    "multi_tenant":     "Мульти-тенант управление",
    "api_access":       "API доступ",
    "financial_ledger": "Финансовый реестр",
    "white_label":      "Полный white-label",
    "unlimited_users":  "Безлимитные пользователи",
    "p2p_calls":        "P2P звонки",
}

# Минимальный план для каждой фичи (для подсказок UI)
FEATURE_MIN_PLAN: dict[str, str] = {
    feat: plan
    for plan in PLANS
    for feat in _PLAN_BASE[plan]
}
