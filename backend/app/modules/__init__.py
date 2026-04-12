"""
Система модулей Клиники.
has_feature(license, name) — главная функция для проверки доступа к фиче.
"""
from app.modules.features import PLAN_FEATURES, FEATURE_LABELS, FEATURE_MIN_PLAN


def has_feature(license_or_none, feature_name: str) -> bool:
    """
    Доступна ли фича для данной лицензии?

    Правила (в порядке приоритета):
    1. license is None → single-tenant режим, всё разрешено.
    2. license.features[feature_name] задан явно → используем его.
    3. Иначе → смотрим что включено в plan.

    Примеры:
        has_feature(None, "billing")           → True  (single-tenant)
        has_feature(basic_license, "analytics") → False (не в basic)
        has_feature(pro_license, "analytics")  → True
    """
    if license_or_none is None:
        return True

    plan = license_or_none.plan or "professional"

    # Явный override в JSONB (можно включить/выключить отдельную фичу)
    overrides: dict = license_or_none.features or {}
    if feature_name in overrides:
        return bool(overrides[feature_name])

    return feature_name in PLAN_FEATURES.get(plan, set())


def get_enabled_features(license_or_none) -> set[str]:
    """Множество всех включённых фич для данной лицензии."""
    if license_or_none is None:
        return set(FEATURE_LABELS.keys())

    plan = license_or_none.plan or "professional"
    enabled = set(PLAN_FEATURES.get(plan, set()))

    # Применяем JSONB-overrides
    for feat, val in (license_or_none.features or {}).items():
        if val:
            enabled.add(feat)
        else:
            enabled.discard(feat)

    return enabled


def get_features_for_ui(license_or_none) -> list[dict]:
    """
    Список всех известных фич с флагом enabled для фронтенда.
    Возвращает: [{name, label, enabled, min_plan}, ...]
    """
    enabled = get_enabled_features(license_or_none)
    return [
        {
            "name": name,
            "label": label,
            "enabled": name in enabled,
            "min_plan": FEATURE_MIN_PLAN.get(name, "enterprise"),
        }
        for name, label in FEATURE_LABELS.items()
    ]
