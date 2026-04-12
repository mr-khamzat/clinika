"""
Единая нормализация телефонных номеров.
Используется во всех сервисах вместо дублированного кода.
"""


def normalize_phone(phone: str) -> str:
    """Нормализует номер к формату 7XXXXXXXXXX (11 цифр без плюса)."""
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) == 10:
        digits = "7" + digits
    elif len(digits) == 11 and digits.startswith("8"):
        digits = "7" + digits[1:]
    return digits


def phone_variants(phone: str) -> list[str]:
    """Возвращает все форматы номера для поиска в БД (7..., +7..., 8...)."""
    norm = normalize_phone(phone)
    variants = [norm]
    if len(norm) == 11 and norm.startswith("7"):
        variants.append("+" + norm)
        variants.append("8" + norm[1:])
    return list(dict.fromkeys(variants))  # убираем дубли, сохраняя порядок
