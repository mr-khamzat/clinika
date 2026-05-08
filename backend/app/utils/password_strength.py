"""
Минимальная проверка сложности пароля.
Применяется во всех endpoints где задаётся НОВЫЙ пароль (регистрация, смена,
админская выдача). Не применяется при login (там только сверка с хешем).

Требования (мягкий минимум):
  • длина ≥ 8 символов
  • ≥ 1 буква (a-z или A-Z)
  • ≥ 1 цифра ИЛИ ≥ 1 спецсимвол

Не требуем заглавную/строчную смесь — это раздражает и не сильно повышает
криптостойкость без существенно большей длины.
"""


_MIN_LEN = 8
_SPECIAL_CHARS = "!@#$%^&*()_+-=[]{}|;:'\",.<>/?`~\\"


def validate_password_strength(password: str) -> str:
    """Проверяет минимальную сложность. Бросает ValueError при нарушении.
    Возвращает исходный пароль (для chaining в Pydantic field_validator).
    """
    if not isinstance(password, str):
        raise ValueError("Пароль должен быть строкой")
    if len(password) < _MIN_LEN:
        raise ValueError(f"Пароль слишком короткий: минимум {_MIN_LEN} символов")
    has_letter = any(c.isalpha() for c in password)
    has_digit = any(c.isdigit() for c in password)
    has_special = any(c in _SPECIAL_CHARS for c in password)
    if not has_letter:
        raise ValueError("Пароль должен содержать хотя бы одну букву")
    if not (has_digit or has_special):
        raise ValueError("Пароль должен содержать хотя бы одну цифру или спецсимвол")
    return password
